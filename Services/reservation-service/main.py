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
REDIS_HOST = os.getenv("REDIS_HOST", "redis.ravi-devops.space")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
USER_SERVICE_URL = os.getenv("USER_SERVICE_URL", "http://user.ravi-devops.space:8080")
HOLD_TTL_SECONDS = 600  # 10-minute seat lock

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


@app.get("/health")
def health_check():
    try:
        ping = redis_client.ping()
        return {
            "status": "UP",
            "service": "reservation-service",
            "redis": "connected" if ping else "down"
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Redis connection failed: {str(e)}")


@app.post("/api/reserve/hold", status_code=201)
def hold_seats(req: HoldRequest, authorization: Optional[str] = Header(None)):
    user_id = req.userId

    # If a Bearer token is passed, verify it against user-service
    if authorization and authorization.startswith("Bearer "):
        try:
            resp = requests.get(
                f"{USER_SERVICE_URL}/api/users/verify",
                headers={"Authorization": authorization},
                timeout=3
            )
            if resp.status_code == 200:
                user_id = resp.json().get("user", {}).get("userId", user_id)
        except requests.RequestException:
            pass

    hold_id = f"HOLD-{uuid.uuid4().hex[:10].upper()}"
    total_amount = round(req.seatCount * req.unitPrice, 2)

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
        redis_client.setex(f"hold:{hold_id}", HOLD_TTL_SECONDS, json.dumps(hold_payload))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to lock seats in Redis: {str(e)}")

    return {
        "message": "Seats locked for 10 minutes",
        "expiresInSeconds": HOLD_TTL_SECONDS,
        "hold": hold_payload
    }


@app.get("/api/reserve/status/{hold_id}")
def get_hold_status(hold_id: str):
    key = f"hold:{hold_id}"
    data = redis_client.get(key)
    if not data:
        raise HTTPException(status_code=404, detail="Seat hold expired or does not exist")

    ttl = redis_client.ttl(key)
    return {
        "hold": json.loads(data),
        "remainingSeconds": max(ttl, 0)
    }


@app.delete("/api/reserve/release/{hold_id}")
def release_hold(hold_id: str):
    deleted = redis_client.delete(f"hold:{hold_id}")
    if not deleted:
        raise HTTPException(status_code=404, detail="Hold ID not found or already released")
    return {"message": "Seat hold released successfully", "holdId": hold_id}
