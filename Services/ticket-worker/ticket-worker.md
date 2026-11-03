
# EventSphere — Ticket Worker

## 1. Service Overview

The Ticket Worker is an asynchronous background processor that generates QR tickets after successful booking payments.

It consumes `booking.paid` messages from RabbitMQ, generates ticket records, stores them in PostgreSQL, and updates the booking status to `ISSUED`.

| Property | Details |
|---|---|
| Service Name | Ticket Worker |
| Domain | `worker.ravi-devops.space` |
| Technology | Python 3.11, Pika, FastAPI, Uvicorn |
| Database Driver | psycopg2-binary |
| Operating System | RHEL 9 / AlmaLinux 9 |
| Health Port | 8080 |
| Message Broker | RabbitMQ |
| Database | PostgreSQL |

### Upstream Dependencies

- RabbitMQ: `rabbitmq.ravi-devops.space:5672`
- PostgreSQL: `postgresql.ravi-devops.space:5432`

### Responsibilities

- Consume confirmed payment messages from the `booking.paid` queue.
- Generate unique ticket IDs and seat numbers.
- Generate QR verification payloads.
- Insert ticket records into PostgreSQL.
- Update booking ticket status to `ISSUED`.
- Acknowledge successfully processed messages.
- Expose a health endpoint on port 8080.

---

## 2. GitHub Repository Structure

Create the following files inside `Services/ticket-worker/`.

```text
EventSphere/
└── Services/
    └── ticket-worker/
        ├── README.md
        ├── requirements.txt
        ├── worker.py
        └── .env.example
```

---

## 3. Application Source Code

### 3.1 requirements.txt

Create `Services/ticket-worker/requirements.txt`.

```text
fastapi==0.110.0
uvicorn==0.29.0
pika==1.3.2
psycopg2-binary==2.9.9
```

### 3.2 worker.py

Create `Services/ticket-worker/worker.py`.

```python
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

PG_HOST = os.getenv(
    "PG_HOST",
    "postgresql.ravi-devops.space"
)
PG_PORT = int(os.getenv("PG_PORT", "5432"))
PG_USER = os.getenv("PG_USER", "eventsphere")
PG_PASSWORD = os.getenv("PG_PASSWORD", "")
PG_DATABASE = os.getenv("PG_DATABASE", "eventsphere")

RABBITMQ_HOST = os.getenv(
    "RABBITMQ_HOST",
    "rabbitmq.ravi-devops.space"
)
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT", "5672"))
RABBITMQ_USER = os.getenv("RABBITMQ_USER", "eventsphere")
RABBITMQ_PASS = os.getenv("RABBITMQ_PASS", "")
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

        if seat_count <= 0:
            raise ValueError("seatCount must be positive")

        print(
            f"[ticket-worker] Processing booking "
            f"{booking_id} for {seat_count} seats"
        )

        conn = get_pg_connection()

        try:
            with conn.cursor() as cur:
                for _ in range(seat_count):
                    ticket_id = (
                        f"TKT-{uuid.uuid4().hex[:8].upper()}"
                    )

                    seat_number = (
                        f"{tier_code}-"
                        f"{uuid.uuid4().hex[:4].upper()}"
                    )

                    raw_signature = (
                        f"{booking_id}:{ticket_id}:"
                        f"{event_id}:{user_id}:{seat_number}"
                    )

                    qr_hash = hashlib.sha256(
                        raw_signature.encode()
                    ).hexdigest()[:24].upper()

                    qr_payload = (
                        f"EVENTSPHERE|{event_id}|{booking_id}|"
                        f"{ticket_id}|{seat_number}|SIG:{qr_hash}"
                    )

                    cur.execute(
                        """
                        INSERT INTO tickets (
                            ticket_id,
                            booking_id,
                            event_id,
                            tier_code,
                            seat_number,
                            qr_code_payload
                        )
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (ticket_id) DO NOTHING;
                        """,
                        (
                            ticket_id,
                            booking_id,
                            event_id,
                            tier_code,
                            seat_number,
                            qr_payload
                        )
                    )

                cur.execute(
                    """
                    UPDATE bookings
                    SET ticket_status = 'ISSUED'
                    WHERE booking_id = %s;
                    """,
                    (booking_id,)
                )

            conn.commit()

        except Exception:
            conn.rollback()
            raise

        finally:
            conn.close()

        worker_state["processed_orders"] += 1

        ch.basic_ack(
            delivery_tag=method.delivery_tag
        )

        print(
            f"[ticket-worker] Issued {seat_count} tickets "
            f"for booking {booking_id}"
        )

    except Exception as exc:
        print(
            f"[ticket-worker] Error processing message: {exc}"
        )

        # Reject without requeue. Configure a dead-letter queue
        # if failed messages must be retained for investigation.
        ch.basic_nack(
            delivery_tag=method.delivery_tag,
            requeue=False
        )


def consume_loop():
    while True:
        connection = None

        try:
            credentials = pika.PlainCredentials(
                RABBITMQ_USER,
                RABBITMQ_PASS
            )

            params = pika.ConnectionParameters(
                host=RABBITMQ_HOST,
                port=RABBITMQ_PORT,
                credentials=credentials,
                heartbeat=60,
                blocked_connection_timeout=30
            )

            connection = pika.BlockingConnection(params)
            channel = connection.channel()

            channel.queue_declare(
                queue=QUEUE_NAME,
                durable=True
            )

            channel.basic_qos(prefetch_count=1)

            channel.basic_consume(
                queue=QUEUE_NAME,
                on_message_callback=process_booking_message
            )

            worker_state["rabbitmq"] = "connected"

            print(
                f"[ticket-worker] Connected to "
                f"{RABBITMQ_HOST}:{RABBITMQ_PORT}; "
                f"consuming queue '{QUEUE_NAME}'"
            )

            channel.start_consuming()

        except Exception as exc:
            worker_state["rabbitmq"] = "disconnected"

            print(
                f"[ticket-worker] RabbitMQ connection lost: "
                f"{exc}. Retrying in 5 seconds..."
            )

            time.sleep(5)

        finally:
            if connection is not None and connection.is_open:
                try:
                    connection.close()
                except Exception:
                    pass


@app.on_event("startup")
def start_background_consumer():
    consumer_thread = threading.Thread(
        target=consume_loop,
        daemon=True
    )

    consumer_thread.start()


@app.get("/health")
def health_check():
    try:
        conn = get_pg_connection()

        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
                cur.fetchone()
        finally:
            conn.close()

        if worker_state["rabbitmq"] != "connected":
            raise HTTPException(
                status_code=503,
                detail="RabbitMQ consumer is not connected"
            )

        return {
            "status": "UP",
            "service": "ticket-worker",
            "postgresql": "connected",
            "rabbitmq": "connected",
            "processedOrders": worker_state["processed_orders"]
        }

    except HTTPException:
        raise

    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Health check failed"
        )
```

### 3.3 .env.example

Create `Services/ticket-worker/.env.example`.

```dotenv
PORT=8080

PG_HOST=postgresql.ravi-devops.space
PG_PORT=5432
PG_USER=eventsphere
PG_PASSWORD=CHANGE_ME
PG_DATABASE=eventsphere

RABBITMQ_HOST=rabbitmq.ravi-devops.space
RABBITMQ_PORT=5672
RABBITMQ_USER=eventsphere
RABBITMQ_PASS=CHANGE_ME

QUEUE_NAME=booking.paid
```

---

## 4. Deploy on the Worker EC2 Instance

Connect to the Worker EC2 instance using SSH.

### Step 1: Install Python 3.11 and Required Packages

```bash
sudo dnf install python3.11 python3.11-devel python3.11-pip gcc unzip curl -y
```

Verify the installation:

```bash
python3.11 --version
pip3.11 --version
```

### Step 2: Create the Service User and Application Directory

```bash
id eventsphere &>/dev/null || \
sudo useradd --system --home /app --shell /sbin/nologin eventsphere

sudo mkdir -p /app
```

### Step 3: Download Application Code from GitHub

```bash
cd /tmp

curl -L -o worker.zip \
https://github.com/ravikran14-b/EventSphere/archive/refs/heads/main.zip

unzip -o /tmp/worker.zip -d /tmp/

sudo cp -r \
/tmp/EventSphere-main/Services/ticket-worker/. \
/app/

sudo chown -R eventsphere:eventsphere /app
```

Verify the files:

```bash
ls -la /app
```

Expected files:

```text
README.md
requirements.txt
worker.py
.env.example
```

### Step 4: Install Python Dependencies

Create an isolated Python virtual environment.

```bash
sudo python3.11 -m venv /app/venv

sudo /app/venv/bin/pip install --upgrade pip

sudo /app/venv/bin/pip install \
-r /app/requirements.txt

sudo chown -R eventsphere:eventsphere /app
```

---

## 5. Configure the systemd Service

Create the service unit:

```bash
sudo vi /etc/systemd/system/worker.service
```

Add the following configuration:

```ini
[Unit]
Description=EventSphere Asynchronous Ticket QR Worker
After=network.target

[Service]
Type=simple
User=eventsphere
WorkingDirectory=/app

Environment=PORT=8080

Environment=PG_HOST=postgresql.ravi-devops.space
Environment=PG_PORT=5432
Environment=PG_USER=eventsphere
Environment=PG_DATABASE=eventsphere

Environment=RABBITMQ_HOST=rabbitmq.ravi-devops.space
Environment=RABBITMQ_PORT=5672
Environment=RABBITMQ_USER=eventsphere
Environment=QUEUE_NAME=booking.paid

# Store actual credentials in a root-owned environment file.
EnvironmentFile=/etc/eventsphere/worker.env

ExecStart=/app/venv/bin/uvicorn worker:app --host 0.0.0.0 --port 8080

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Create the environment file:

```bash
sudo mkdir -p /etc/eventsphere

sudo vi /etc/eventsphere/worker.env
```

Add the actual credentials configured in PostgreSQL and RabbitMQ:

```dotenv
PG_PASSWORD=CHANGE_ME
RABBITMQ_PASS=CHANGE_ME
```

Protect the file:

```bash
sudo chown root:root /etc/eventsphere/worker.env
sudo chmod 600 /etc/eventsphere/worker.env
```

Replace both placeholder values before starting the service.

Reload systemd and start the worker:

```bash
sudo systemctl daemon-reload

sudo systemctl enable worker

sudo systemctl start worker
```

---

## 6. Verify Service Status and Connectivity

### Check systemd Status

```bash
sudo systemctl status worker --no-pager
```

### Check Port 8080

```bash
sudo ss -lntp | grep ':8080'
```

### Check Recent Logs

```bash
sudo journalctl -u worker -n 100 --no-pager
```

### Follow Live Logs

```bash
sudo journalctl -u worker -f
```

### Test the Health Endpoint

```bash
curl -i http://localhost:8080/health
```

Expected response when PostgreSQL and RabbitMQ are connected:

```json
{
  "status": "UP",
  "service": "ticket-worker",
  "postgresql": "connected",
  "rabbitmq": "connected",
  "processedOrders": 0
}
```

The processed order count increases as messages are successfully handled.

---

## 7. Validate Dependencies

### PostgreSQL Connectivity

```bash
getent hosts postgresql.ravi-devops.space

nc -vz -w 5 postgresql.ravi-devops.space 5432
```

### RabbitMQ Connectivity

```bash
getent hosts rabbitmq.ravi-devops.space

nc -vz -w 5 rabbitmq.ravi-devops.space 5672
```

If `nc` is unavailable:

```bash
sudo dnf install nmap-ncat -y
```

A successful TCP connection confirms network reachability, not that database credentials or RabbitMQ authentication are valid. Check application logs and the health endpoint for those details.

---

## 8. Route 53 Configuration

Create a private DNS record for the Worker EC2 instance.

| Setting | Value |
|---|---|
| Record name | `worker.ravi-devops.space` |
| Record type | A |
| Value | Private IP of the Worker EC2 instance |
| Routing policy | Simple |

Validate DNS resolution:

```bash
nslookup worker.ravi-devops.space
```

Or:

```bash
dig +short worker.ravi-devops.space
```

The result should match the Worker EC2 instance's private IP.

---

## 9. AWS Security Group Rules

Configure the rules using the actual Security Group IDs in your environment.

### Inbound Rules

| Protocol | Port | Source |
|---|---:|---|
| TCP | 8080 | Monitoring or administration Security Group |

Add the Frontend Security Group only if the frontend genuinely needs to call the worker's health endpoint.

### Outbound Rules

| Protocol | Port | Destination |
|---|---:|---|
| TCP | 5672 | RabbitMQ Security Group |
| TCP | 5432 | PostgreSQL Security Group |

Ensure that the RabbitMQ and PostgreSQL Security Groups permit inbound connections from the Worker Security Group on the required ports.

Prefer Security Group references instead of unrestricted inbound rules.

---

## 10. Troubleshooting

### Worker Service Is Not Starting

```bash
sudo systemctl status worker --no-pager

sudo journalctl -u worker -n 100 --no-pager
```

### Python Dependency Errors

```bash
/app/venv/bin/python --version

/app/venv/bin/pip list

sudo /app/venv/bin/pip install \
-r /app/requirements.txt
```

### PostgreSQL Connection Failure

```bash
getent hosts postgresql.ravi-devops.space

nc -vz -w 5 postgresql.ravi-devops.space 5432
```

Check the PostgreSQL hostname, port, credentials, database name, and inbound Security Group rules.

### RabbitMQ Connection Failure

```bash
getent hosts rabbitmq.ravi-devops.space

nc -vz -w 5 rabbitmq.ravi-devops.space 5672
```

Check the RabbitMQ hostname, port, username, password, queue permissions, and Security Group rules.

### Health Endpoint Returns HTTP 503

```bash
curl -i http://localhost:8080/health

sudo journalctl -u worker -n 100 --no-pager
```

Confirm that both PostgreSQL and the RabbitMQ consumer are operational.

### Restart the Worker

```bash
sudo systemctl daemon-reload

sudo systemctl restart worker

sudo systemctl status worker --no-pager
```

---

## 11. Important Implementation Notes

- The worker expects RabbitMQ messages to contain `bookingId`, `eventId`, `tierCode`, and `seatCount`. It optionally accepts `userId`.
- The `tickets` and `bookings` tables must exist in PostgreSQL with the expected columns.
- The worker acknowledges a message after its database transaction commits.
- Failed messages are rejected without requeueing. Configure a RabbitMQ dead-letter exchange and queue if failed messages must be retained.
- For production reliability, make ticket generation idempotent using a stable ticket identity and database constraints. Random ticket IDs alone do not prevent duplicate ticket issuance when a message is redelivered.
- The generated QR payload is a hash-based identifier, not a complete cryptographic authentication mechanism. Production ticket validation should use a trusted signing strategy and a verification endpoint.
- Store real credentials outside the GitHub repository. Use appropriate permissions for environment files and consider a secrets manager.
- Restrict access to port 8080 to monitoring or administration systems that need it.

---

## 12. Final Validation Checklist

- [ ] Python 3.11 installed.
- [ ] Application files copied to `/app`.
- [ ] Virtual environment and dependencies installed.
- [ ] PostgreSQL connectivity verified.
- [ ] RabbitMQ connectivity verified.
- [ ] Credentials configured securely.
- [ ] `worker.service` enabled and running.
- [ ] Port 8080 listening.
- [ ] `/health` returns HTTP 200.
- [ ] Worker connected to the `booking.paid` queue.
- [ ] Ticket records are inserted into PostgreSQL.
- [ ] Booking status changes to `ISSUED`.
- [ ] Route 53 resolves to the correct private IP.
- [ ] Security Group rules configured.

**Ticket Worker deployment is complete when RabbitMQ messages are processed successfully, tickets are persisted in PostgreSQL, and the health endpoint reports both dependencies as connected.**
