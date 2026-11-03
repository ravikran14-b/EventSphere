import os
import json
import time
import uuid
import hashlib
import threading
import pika
import psycopg2
from fastapi import FastAPI, HTTPException

app = FastAPI(title="EventSphere Ticket Worker")

PORT = int(os.getenv("PORT", "8080"))
PG_HOST = os.getenv("PG_HOST", "postgresql.ravi-devops.space")
PG_PORT = int(os.getenv("PG_PORT", "5432"))
PG_USER = os.getenv("PG_USER", "eventsphere")
PG_PASSWORD = os.getenv("PG_PASSWORD", "EventSphere@1")
PG_DATABASE = os.getenv("PG_DATABASE", "eventsphere")

RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "rabbitmq.ravi-devops.space")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_USER = os.getenv("RABBITMQ_USER", "eventsphere")
RABBITMQ_PASS = os.getenv("RABBITMQ_PASS", "EventSphere@1")
QUEUE_NAME = os.getenv("QUEUE_NAME", "booking.paid")

worker_state = {
    "rabbitmq": "connecting",
    "processed_orders": 0
}


def get_pg_connection():
    return psycopg2.connect(
        host=PG_HOST,
        port=PG_PORT,
        user=PG_USER,
        password=PG_PASSWORD,
        dbname=PG_DATABASE,
        connect_timeout=5
    )


def process_booking_message(ch, method, properties, body):
    try:
        payload = json.loads(body.decode("utf-8"))
        booking_id = payload["bookingId"]
        event_id = payload["eventId"]
        tier_code = payload["tierCode"]
        seat_count = int(payload["seatCount"])
        user_id = payload.get("userId", "GUEST")

        print(f"[ticket-worker] Processing QR generation for booking {booking_id} ({seat_count} seats)")

        conn = get_pg_connection()
        cur = conn.cursor()

        for i in range(1, seat_count + 1):
            ticket_id = f"TKT-{uuid.uuid4().hex[:8].upper()}"
            seat_number = f"{tier_code}-{uuid.uuid4().hex[:4].upper()}"
            raw_signature = f"{booking_id}:{ticket_id}:{event_id}:{user_id}:{seat_number}"
            qr_hash = hashlib.sha256(raw_signature.encode()).hexdigest()[:24].upper()
            qr_payload = f"EVENTSPHERE|{event_id}|{booking_id}|{ticket_id}|{seat_number}|SIG:{qr_hash}"

            cur.execute(
                """
                INSERT INTO tickets (ticket_id, booking_id, event_id, tier_code, seat_number, qr_code_payload)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (ticket_id) DO NOTHING;
                """,
                (ticket_id, booking_id, event_id, tier_code, seat_number, qr_payload)
            )

        cur.execute(
            "UPDATE bookings SET ticket_status = 'ISSUED' WHERE booking_id = %s;",
            (booking_id,)
        )

        conn.commit()
        cur.close()
        conn.close()

        worker_state["processed_orders"] += 1
        ch.basic_ack(delivery_tag=method.delivery_tag)
        print(f"[ticket-worker] Issued {seat_count} QR tickets for booking {booking_id}")

    except Exception as e:
        print(f"[ticket-worker] Error processing message: {str(e)}")
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)


def consume_loop():
    while True:
        try:
            credentials = pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASS)
            params = pika.ConnectionParameters(
                host=RABBITMQ_HOST,
                port=RABBITMQ_PORT,
                credentials=credentials,
                heartbeat=60,
                blocked_connection_timeout=30
            )
            connection = pika.BlockingConnection(params)
            channel = connection.channel()
            channel.queue_declare(queue=QUEUE_NAME, durable=True)
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue=QUEUE_NAME, on_message_callback=process_booking_message)

            worker_state["rabbitmq"] = "connected"
            print(f"[ticket-worker] Connected to RabbitMQ at {RABBITMQ_HOST}:{RABBITMQ_PORT}, waiting for '{QUEUE_NAME}' messages...")
            channel.start_consuming()
        except Exception as e:
            worker_state["rabbitmq"] = f"reconnecting ({str(e)})"
            print(f"[ticket-worker] RabbitMQ connection lost: {str(e)}. Retrying in 5 seconds...")
            time.sleep(5)


@app.on_event("startup")
def start_background_consumer():
    consumer_thread = threading.Thread(target=consume_loop, daemon=True)
    consumer_thread.start()


@app.get("/health")
def health_check():
    try:
        conn = get_pg_connection()
        cur = conn.cursor()
        cur.execute("SELECT 1;")
        cur.close()
        conn.close()

        if worker_state["rabbitmq"] != "connected":
            raise HTTPException(status_code=503, detail=f"RabbitMQ status: {worker_state['rabbitmq']}")

        return {
            "status": "UP",
            "service": "ticket-worker",
            "postgresql": "connected",
            "rabbitmq": worker_state["rabbitmq"],
            "processedOrders": worker_state["processed_orders"]
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
