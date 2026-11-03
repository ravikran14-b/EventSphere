const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const PG_HOST = process.env.PG_HOST || 'postgresql.ravi-devops.space';
const PG_PORT = process.env.PG_PORT || 5432;
const PG_USER = process.env.PG_USER || 'eventsphere';
const PG_PASSWORD = process.env.PG_PASSWORD || 'EventSphere@1';
const PG_DATABASE = process.env.PG_DATABASE || 'eventsphere';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://eventsphere:EventSphere@1@rabbitmq.ravi-devops.space:5672';
const QUEUE_NAME = process.env.QUEUE_NAME || 'booking.paid';

const RESERVATION_SERVICE_URL = process.env.RESERVATION_SERVICE_URL || 'http://reservation.ravi-devops.space:8080';
const EVENT_SERVICE_URL = process.env.EVENT_SERVICE_URL || 'http://event.ravi-devops.space:8080';

const pgPool = new Pool({
  host: PG_HOST,
  port: PG_PORT,
  user: PG_USER,
  password: PG_PASSWORD,
  database: PG_DATABASE,
  connectionTimeoutMillis: 5000
});

let amqpChannel = null;

async function initConnections() {
  try {
    const client = await pgPool.connect();
    await client.query('SELECT 1');
    client.release();
    console.log(`[booking-service] Connected to PostgreSQL at ${PG_HOST}:${PG_PORT}`);

    const conn = await amqp.connect(RABBITMQ_URL);
    amqpChannel = await conn.createChannel();
    await amqpChannel.assertQueue(QUEUE_NAME, { durable: true });
    console.log(`[booking-service] Connected to RabbitMQ and asserted queue '${QUEUE_NAME}'`);
  } catch (err) {
    console.error(`[booking-service] Startup error: ${err.message}`);
    process.exit(1);
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    await pgPool.query('SELECT 1');
    const mqStatus = amqpChannel ? 'connected' : 'disconnected';
    res.status(200).json({
      status: 'UP',
      service: 'booking-service',
      postgresql: 'connected',
      rabbitmq: mqStatus
    });
  } catch (err) {
    res.status(503).json({ status: 'DOWN', error: err.message });
  }
});

// Checkout & Order Creation
app.post('/api/bookings/checkout', async (req, res) => {
  const { holdId, userId, paymentMethod } = req.body;
  if (!holdId) {
    return res.status(400).json({ error: 'holdId is required to complete checkout' });
  }

  try {
    // 1. Verify active seat hold in reservation-service
    let holdData;
    try {
      const holdResp = await axios.get(`${RESERVATION_SERVICE_URL}/api/reserve/status/${holdId}`, { timeout: 4000 });
      holdData = holdResp.data.hold;
    } catch (err) {
      return res.status(404).json({ error: 'Seat reservation expired or invalid holdId' });
    }

    const finalUserId = userId || holdData.userId || 'GUEST';
    const bookingId = `BKG-${Date.now().toString(36).toUpperCase()}`;

    // 2. Decrement live seat inventory in event-service
    try {
      await axios.patch(`${EVENT_SERVICE_URL}/api/events/${holdData.eventId}/inventory`, {
        tierCode: holdData.tierCode,
        count: holdData.seatCount
      }, { timeout: 4000 });
    } catch (err) {
      return res.status(409).json({ error: 'Failed to deduct seat inventory from event-service' });
    }

    // 3. Write ACID booking transaction to PostgreSQL
    const insertQuery = `
      INSERT INTO bookings (booking_id, hold_id, user_id, event_id, tier_code, seat_count, total_amount, payment_status, ticket_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'PAID', 'PENDING_QR')
      RETURNING *;
    `;
    const values = [
      bookingId,
      holdId,
      finalUserId,
      holdData.eventId,
      holdData.tierCode,
      holdData.seatCount,
      holdData.totalAmount
    ];

    const dbResult = await pgPool.query(insertQuery, values);
    const bookingRecord = dbResult.rows[0];

    // 4. Release the temporary Redis hold in reservation-service
    try {
      await axios.delete(`${RESERVATION_SERVICE_URL}/api/reserve/release/${holdId}`, { timeout: 3000 });
    } catch (releaseErr) {
      console.warn(`[booking-service] Non-fatal: could not delete hold ${holdId}: ${releaseErr.message}`);
    }

    // 5. Publish asynchronous event to RabbitMQ for ticket-worker
    const eventPayload = {
      bookingId,
      userId: finalUserId,
      eventId: holdData.eventId,
      tierCode: holdData.tierCode,
      seatCount: holdData.seatCount,
      totalAmount: holdData.totalAmount,
      paymentMethod: paymentMethod || 'CARD',
      timestamp: new Date().toISOString()
    };

    amqpChannel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(eventPayload)), {
      persistent: true
    });

    res.status(201).json({
      message: 'Booking confirmed! Ticket QR generation in progress.',
      booking: bookingRecord
    });
  } catch (err) {
    console.error(`[booking-service] Checkout failed: ${err.message}`);
    res.status(500).json({ error: 'Checkout processing failed', details: err.message });
  }
});

// Get bookings and generated QR tickets for a user
app.get('/api/bookings/user/:userId', async (req, res) => {
  try {
    const bookingsRes = await pgPool.query(
      'SELECT * FROM bookings WHERE user_id = $1 ORDER BY created_at DESC',
      [req.params.userId]
    );

    const bookings = bookingsRes.rows;
    for (const b of bookings) {
      const ticketsRes = await pgPool.query(
        'SELECT ticket_id, seat_number, qr_code_payload, issued_at FROM tickets WHERE booking_id = $1',
        [b.booking_id]
      );
      b.tickets = ticketsRes.rows;
    }

    res.status(200).json(bookings);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user bookings', details: err.message });
  }
});

initConnections().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[booking-service] Listening on port ${PORT}`);
  });
});
