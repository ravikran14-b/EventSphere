const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongodb.ravi-devops.space:27017';
const DB_NAME = process.env.DB_NAME || 'eventsphere';

let dbClient = null;
let db = null;

async function initDB() {
  try {
    dbClient = new MongoClient(MONGO_URL, { connectTimeoutMS: 5000 });
    await dbClient.connect();
    db = dbClient.db(DB_NAME);
    console.log(`[event-service] Connected successfully to MongoDB at ${MONGO_URL}`);
  } catch (err) {
    console.error(`[event-service] Failed to connect to MongoDB: ${err.message}`);
    process.exit(1);
  }
}

// Liveness & Readiness Probe
app.get('/health', async (req, res) => {
  try {
    await db.command({ ping: 1 });
    res.status(200).json({ status: 'UP', service: 'event-service', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'DOWN', error: err.message });
  }
});

// List all active concerts
app.get('/api/events', async (req, res) => {
  try {
    const events = await db.collection('events').find({ status: 'ACTIVE' }).toArray();
    res.status(200).json(events);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve events', details: err.message });
  }
});

// Get single concert by ID
app.get('/api/events/:eventId', async (req, res) => {
  try {
    const event = await db.collection('events').findOne({ eventId: req.params.eventId });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.status(200).json(event);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve event', details: err.message });
  }
});

// Inventory decrement called by booking-service during final checkout
app.patch('/api/events/:eventId/inventory', async (req, res) => {
  const { tierCode, count } = req.body;
  if (!tierCode || !count || count <= 0) {
    return res.status(400).json({ error: 'tierCode and positive count are required' });
  }

  try {
    const result = await db.collection('events').updateOne(
      {
        eventId: req.params.eventId,
        'tiers.tierCode': tierCode,
        'tiers.availableSeats': { $gte: count }
      },
      {
        $inc: { 'tiers.$.availableSeats': -count }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(409).json({ error: 'Not enough available seats or invalid tierCode' });
    }

    res.status(200).json({ message: 'Inventory updated successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update inventory', details: err.message });
  }
});

initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[event-service] Server listening on port ${PORT}`);
  });
});
