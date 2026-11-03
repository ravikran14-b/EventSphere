
# EventSphere — Reservation Service

## 1. Service Overview

The Reservation Service manages temporary seat reservations during concert ticket flash sales.

When a user selects seats and proceeds to checkout, the service creates a temporary reservation in Redis with a **600-second (10-minute) TTL**. If the reservation is not completed, Redis automatically expires the lock.

| Property | Details |
|---|---|
| Service Name | Reservation Service |
| Domain | `reservation.ravi-devops.space` |
| Technology | Python 3.11, FastAPI, Uvicorn |
| Operating System | RHEL 9 / AlmaLinux 9 |
| Listening Port | 8080 |
| Cache | Redis |
| Authentication | User Service |

### Upstream Dependencies

- Redis: `redis.ravi-devops.space:6379`
- User Service: `user.ravi-devops.space:8080`

### Downstream Consumers

- Frontend Service
- Booking Service

### Responsibilities

- Create temporary seat holds.
- Set a 10-minute expiration timer.
- Store reservation details in Redis.
- Check reservation status and remaining time.
- Release reservations when requested.
- Verify user session tokens through the User Service.

---

## 2. GitHub Repository Structure

Create the following files inside `Services/reservation-service/`.

```text
EventSphere/
└── Services/
    └── reservation-service/
        ├── README.md
        ├── requirements.txt
        ├── main.py
        └── .env.example
```

---

## 3. Application Source Code

### 3.1 requirements.txt

Create `Services/reservation-service/requirements.txt`.

```text
fastapi==0.110.0
uvicorn==0.29.0
redis==5.0.3
requests==2.31.0
pydantic==2.6.4
```

### 3.2 main.py

Create `Services/reservation-service/main.py`.

```python
import os
import json
import uuid
import redis
import requests

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional

app = FastAPI(title="EventSphere Reservation Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

PORT = int(os.getenv("PORT", "8080"))

REDIS_HOST = os.getenv(
    "REDIS_HOST",
    "redis.ravi-devops.space"
)

REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))

USER_SERVICE_URL = os.getenv(
    "USER_SERVICE_URL",
    "http://user.ravi-devops.space:8080"
)

HOLD_TTL_SECONDS = 600

redis_client = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    decode_responses=True,
    socket_connect_timeout=5
)


class HoldRequest(BaseModel):
    eventId: str
    tierCode: str
    seatCount: int = Field(..., gt=0, le=10)
    unitPrice: float = Field(..., gt=0)
    userId: Optional[str] = "GUEST"


# Health Check
@app.get("/health")
def health_check():
    try:
        ping = redis_client.ping()

        return {
            "status": "UP",
            "service": "reservation-service",
            "redis": "connected" if ping else "down"
        }

    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Redis connection failed"
        )


# Create a Temporary Seat Hold
@app.post("/api/reserve/hold", status_code=201)
def hold_seats(
    req: HoldRequest,
    authorization: Optional[str] = Header(None)
):
    user_id = req.userId

    # Verify the session when a Bearer token is supplied.
    if authorization and authorization.startswith("Bearer "):
        try:
            resp = requests.get(
                f"{USER_SERVICE_URL}/api/users/verify",
                headers={"Authorization": authorization},
                timeout=3
            )

            if resp.status_code == 200:
                user_id = (
                    resp.json()
                    .get("user", {})
                    .get("userId", user_id)
                )

        except requests.RequestException:
            pass

    hold_id = f"HOLD-{uuid.uuid4().hex[:10].upper()}"

    total_amount = round(
        req.seatCount * req.unitPrice,
        2
    )

    hold_payload = {
        "holdId": hold_id,
        "userId": user_id,
        "eventId": req.eventId,
        "tierCode": req.tierCode,
        "seatCount": req.seatCount,
        "unitPrice": req.unitPrice,
        "totalAmount": total_amount,
        "status": "HELD"
    }

    try:
        redis_client.setex(
            f"hold:{hold_id}",
            HOLD_TTL_SECONDS,
            json.dumps(hold_payload)
        )

    except redis.RedisError:
        raise HTTPException(
            status_code=503,
            detail="Unable to create seat hold"
        )

    return {
        "message": "Seats locked for 10 minutes",
        "expiresInSeconds": HOLD_TTL_SECONDS,
        "hold": hold_payload
    }


# Check Seat Hold Status
@app.get("/api/reserve/status/{hold_id}")
def get_hold_status(hold_id: str):
    key = f"hold:{hold_id}"

    try:
        data = redis_client.get(key)

        if not data:
            raise HTTPException(
                status_code=404,
                detail="Seat hold expired or does not exist"
            )

        ttl = redis_client.ttl(key)

        return {
            "hold": json.loads(data),
            "remainingSeconds": max(ttl, 0)
        }

    except redis.RedisError:
        raise HTTPException(
            status_code=503,
            detail="Unable to check reservation status"
        )


# Release Seat Hold
@app.delete("/api/reserve/release/{hold_id}")
def release_hold(hold_id: str):
    try:
        deleted = redis_client.delete(f"hold:{hold_id}")

        if not deleted:
            raise HTTPException(
                status_code=404,
                detail="Hold ID not found or already released"
            )

        return {
            "message": "Seat hold released successfully",
            "holdId": hold_id
        }

    except redis.RedisError:
        raise HTTPException(
            status_code=503,
            detail="Unable to release seat hold"
        )
```

### 3.3 .env.example

Create `Services/reservation-service/.env.example`.

```dotenv
PORT=8080
REDIS_HOST=redis.ravi-devops.space
REDIS_PORT=6379
USER_SERVICE_URL=http://user.ravi-devops.space:8080
```

---

## 4. Deploy on the Reservation EC2 Instance

Connect to the Reservation Service EC2 instance using SSH.

### Step 1: Install Python 3.11

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

curl -L -o reservation.zip \
https://github.com/ravikran14-b/EventSphere/archive/refs/heads/main.zip

unzip -o /tmp/reservation.zip -d /tmp/

sudo cp -r \
/tmp/EventSphere-main/Services/reservation-service/. \
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
main.py
.env.example
```

### Step 4: Install Python Dependencies

Create a virtual environment to isolate application dependencies.

```bash
cd /app

sudo python3.11 -m venv /app/venv

sudo /app/venv/bin/pip install --upgrade pip

sudo /app/venv/bin/pip install -r /app/requirements.txt

sudo chown -R eventsphere:eventsphere /app
```

---

## 5. Configure the systemd Service

Create the service unit:

```bash
sudo vi /etc/systemd/system/reservation.service
```

Add this configuration:

```ini
[Unit]
Description=EventSphere Seat Reservation Service
After=network.target

[Service]
Type=simple
User=eventsphere
WorkingDirectory=/app

Environment=PORT=8080
Environment=REDIS_HOST=redis.ravi-devops.space
Environment=REDIS_PORT=6379
Environment=USER_SERVICE_URL=http://user.ravi-devops.space:8080

ExecStart=/app/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8080

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Save the file and exit.

Reload systemd and start the service:

```bash
sudo systemctl daemon-reload

sudo systemctl enable reservation

sudo systemctl start reservation
```

Check the service status:

```bash
sudo systemctl status reservation --no-pager
```

View recent logs:

```bash
sudo journalctl -u reservation -n 100 --no-pager
```

Follow live logs:

```bash
sudo journalctl -u reservation -f
```

---

## 6. Validate the Reservation Service

### Check Port 8080

```bash
sudo ss -lntp | grep ':8080'
```

### Test the Health Endpoint

```bash
curl -i http://localhost:8080/health
```

Expected response:

```json
{
  "status": "UP",
  "service": "reservation-service",
  "redis": "connected"
}
```

### Create a Seat Hold

```bash
curl -s -X POST http://localhost:8080/api/reserve/hold \
-H "Content-Type: application/json" \
-d '{
  "eventId": "EVT-1001",
  "tierCode": "VIP",
  "seatCount": 2,
  "unitPrice": 4999
}'
```

Expected behavior:

- A unique hold ID is generated.
- Reservation details are stored in Redis.
- The hold expires after 600 seconds.
- The response includes the hold ID and expiration duration.

Example response:

```json
{
  "message": "Seats locked for 10 minutes",
  "expiresInSeconds": 600,
  "hold": {
    "holdId": "HOLD-EXAMPLE123",
    "userId": "GUEST",
    "eventId": "EVT-1001",
    "tierCode": "VIP",
    "seatCount": 2,
    "unitPrice": 4999,
    "totalAmount": 9998,
    "status": "HELD"
  }
}
```

The hold ID above is an example. Use the actual ID returned by your API.

### Check Reservation Status

Replace `YOUR_HOLD_ID` with the ID returned by the previous request.

```bash
curl -i http://localhost:8080/api/reserve/status/YOUR_HOLD_ID
```

The response includes the reservation details and remaining TTL.

### Release a Reservation

```bash
curl -i -X DELETE \
http://localhost:8080/api/reserve/release/YOUR_HOLD_ID
```

Expected response:

```json
{
  "message": "Seat hold released successfully",
  "holdId": "YOUR_HOLD_ID"
}
```

### Test Automatic Expiration in Redis

```bash
redis-cli -h redis.ravi-devops.space -p 6379 TTL hold:YOUR_HOLD_ID
```

If Redis requires authentication, use your approved authentication method. Avoid putting passwords directly in shell history.

The TTL should decrease over time. After expiration, the status endpoint should return HTTP 404.

---

## 7. Route 53 Configuration

Create a private DNS record in the Route 53 hosted zone used by your EventSphere services.

| Setting | Value |
|---|---|
| Record name | `reservation.ravi-devops.space` |
| Record type | A |
| Value | Private IP of the Reservation EC2 instance |
| Routing policy | Simple |

Validate DNS resolution:

```bash
nslookup reservation.ravi-devops.space
```

Or:

```bash
dig +short reservation.ravi-devops.space
```

The result should match the Reservation Service EC2 instance's private IP.

---

## 8. AWS Security Group Rules

Configure the rules according to your actual Security Group IDs.

### Inbound Rules

| Protocol | Port | Source |
|---|---:|---|
| TCP | 8080 | Frontend Service Security Group |
| TCP | 8080 | Booking Service Security Group |

### Outbound Rules

| Protocol | Port | Destination |
|---|---:|---|
| TCP | 6379 | Redis Security Group |
| TCP | 8080 | User Service Security Group |

Also ensure that the Redis and User Service Security Groups permit inbound connections from the Reservation Service Security Group on their respective ports.

Use Security Group references where possible instead of allowing unrestricted traffic.

---

## 9. Troubleshooting

### Service Fails to Start

```bash
sudo systemctl status reservation --no-pager

sudo journalctl -u reservation -n 100 --no-pager
```

### Python Dependency Errors

```bash
/app/venv/bin/python --version

/app/venv/bin/pip list

/app/venv/bin/pip install -r /app/requirements.txt
```

### Redis Connection Failure

```bash
getent hosts redis.ravi-devops.space

nc -vz -w 5 redis.ravi-devops.space 6379
```

If `nc` is unavailable:

```bash
sudo dnf install nmap-ncat -y
```

### User Service Connectivity

```bash
getent hosts user.ravi-devops.space

curl -i http://user.ravi-devops.space:8080/health
```

### Restart the Service

```bash
sudo systemctl daemon-reload

sudo systemctl restart reservation

sudo systemctl status reservation --no-pager
```

---

## 10. Important Implementation Notes

- The current implementation creates a Redis record for each hold; it does not reserve individual seat IDs or prevent two requests from holding the same physical seats.
- The current token verification is optional. A missing or invalid Bearer token can still lead to a guest hold. Enforce authentication if reservations must belong to verified users.
- The current CORS configuration allows all origins. Restrict allowed origins to trusted frontend domains in production.
- The User Service must be reachable from the Reservation Service for authentication verification.
- Booking Service should validate the hold and user ownership before confirming an order.
- Redis TTL automatically expires the hold record, but it does not itself implement seat inventory management.
- Configure Redis authentication and TLS when required by your environment.

---

## 11. Final Validation Checklist

- [ ] Python 3.11 installed.
- [ ] Application files copied to `/app`.
- [ ] Virtual environment and dependencies installed.
- [ ] Reservation systemd service enabled and running.
- [ ] Port 8080 listening.
- [ ] Redis connectivity confirmed.
- [ ] User Service DNS and connectivity verified.
- [ ] `/health` returns HTTP 200.
- [ ] Seat hold creation works.
- [ ] Reservation status endpoint works.
- [ ] Reservation release endpoint works.
- [ ] Redis TTL expiration verified.
- [ ] Route 53 record resolves correctly.
- [ ] Security Group rules configured.

**Reservation Service deployment is complete when the API is reachable and Redis-backed reservation holds can be created, checked, released, and automatically expired.**
