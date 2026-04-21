"""
services/incident_handler.py — FastAPI routes for receiving incident webhooks.

ReportingAgent POSTs here after storing incidents in Mongo.
We write to Redis `incidents:active` with appropriate TTLs.
"""
import os
import json
import time
from typing import Any, Dict

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

try:
    import redis
    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from topology.roi_adapter import RoiMapper

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# TTLs by incident kind (seconds)
_TTLS = {
    "stalled":    120,
    "accident":   600,
    "congestion": 300,
}

router = APIRouter()

_roi_mapper: RoiMapper | None = None
_redis: "redis.Redis | None" = None


def init(roi_mapper: RoiMapper, redis_client: "redis.Redis | None" = None):
    global _roi_mapper, _redis
    _roi_mapper = roi_mapper
    if redis_client:
        _redis = redis_client
    elif HAS_REDIS:
        _redis = redis.Redis.from_url(REDIS_URL, decode_responses=True)


@router.post("/incidents/{kind}")
async def receive_incident(kind: str, request: Request):
    if kind not in _TTLS:
        return JSONResponse({"error": f"Unknown incident kind: {kind}"}, status_code=400)

    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    camera_name = payload.get("camera_name", "unknown")
    ref_id = payload.get("id") or payload.get("ref_id") or ""
    now = time.time()
    ttl = _TTLS[kind]

    # Resolve affected intersection/approach
    affected_approaches = []
    if _roi_mapper:
        congestion_levels = payload.get("congestion_levels", {})
        if congestion_levels:
            for roi_name in congestion_levels:
                loc = _roi_mapper.resolve(camera_name, roi_name)
                if loc:
                    affected_approaches.append(loc)
        else:
            for d in ("UP", "DOWN", "NB_through", "SB_through"):
                loc = _roi_mapper.resolve(camera_name, d)
                if loc:
                    affected_approaches.append(loc)

    incident_data = {
        "kind": kind,
        "camera_name": camera_name,
        "ref_id": ref_id,
        "timestamp": payload.get("timestamp", now),
        "expires_at": now + ttl,
        "approaches": [
            {"intersection_id": a.intersection_id, "approach": a.approach, "movement": a.movement}
            for a in affected_approaches
        ],
    }

    if _redis:
        incident_key = f"incident:{kind}:{camera_name}:{ref_id}"
        _redis.setex(incident_key, ttl, json.dumps(incident_data))
        _redis.sadd("incidents:active", incident_key)
        _redis.publish("incidents:new", json.dumps(incident_data))

    return {"status": "received", "kind": kind, "ttl": ttl, "approaches": len(affected_approaches)}
