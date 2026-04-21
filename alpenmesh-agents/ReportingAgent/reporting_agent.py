import os
import time
import base64
import logging
from typing import Any, Dict, Optional

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pymongo import MongoClient
from pymongo.errors import PyMongoError
import gridfs
from bson import ObjectId
import uvicorn

try:
    import httpx
    _http_client = httpx.AsyncClient(timeout=0.2)
except ImportError:
    _http_client = None

_log = logging.getLogger("reporting_agent")

# -----------------------------
# Configuration
# -----------------------------
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/alpenmesh")
DB_NAME = os.getenv("REPORTING_DB_NAME", "alpenmesh")
ACCIDENTS_COLLECTION = os.getenv("REPORTING_COLLECTION", "accidents")
CONGESTION_COLLECTION = os.getenv("REPORTING_CONGESTION_COLLECTION", "congestion_reports")
ALERTS_COLLECTION = os.getenv("REPORTING_ALERTS_COLLECTION", "alerts")
DEFAULT_PORT = int(os.getenv("REPORTING_PORT", "8001"))
MASTER_AGENT_URL = os.getenv("MASTER_AGENT_URL", "http://127.0.0.1:8080")

# -----------------------------
# Persistence
# -----------------------------
mongo_client = MongoClient(MONGO_URI)
db = mongo_client[DB_NAME]
accidents_col = db[ACCIDENTS_COLLECTION]
congestion_col = db[CONGESTION_COLLECTION]
alerts_col = db[ALERTS_COLLECTION]
fs = gridfs.GridFS(db)

# -----------------------------
# FastAPI App
# -----------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def _clean_record(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Convert Mongo document to JSON-safe dict."""
    out = dict(doc)
    _id = out.pop("_id", None)
    if _id is not None:
        out["id"] = str(_id)
    return out


def _validate_report(payload: Dict[str, Any]):
    """Minimal validation for accident and stalled report payloads."""
    errors = []
    required = ["camera_name", "timestamp"]
    if payload.get("type") == "stalled_vehicle":
        required.append("report")
    else:
        required.append("details")

    for key in required:
        if key not in payload:
            errors.append(f"missing '{key}'")
    return errors


def _validate_congestion(payload: Dict[str, Any]):
    """Minimal validation for congestion alert payload."""
    errors = []
    required = ("camera_name", "timestamp", "congestion_levels")
    for key in required:
        if key not in payload:
            errors.append(f"missing '{key}'")
    return errors


def _store_image_and_get_id(image_b64: Optional[str], content_type: str = "image/jpeg") -> Optional[str]:
    """
    Decode base64 image, store in GridFS, return id as string.
    Returns None on failure.
    """
    if not image_b64:
        return None
    try:
        raw_bytes = base64.b64decode(image_b64, validate=True)
        file_id = fs.put(raw_bytes, content_type=content_type)
        return str(file_id)
    except Exception:
        return None


def _prune_alerts():
    cutoff = time.time() - 86400  # 1 day
    try:
        alerts_col.delete_many({"created_at": {"$lt": cutoff}})
    except Exception:
        pass


@app.get("/health")
async def health():
    return {"status": "ok", "time": time.time()}


@app.post("/report")
async def report(request: Request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
        
    if not payload:
        return JSONResponse({"error": "Invalid or empty JSON"}, status_code=400)

    errors = _validate_report(payload)
    if errors:
        return JSONResponse({"error": "; ".join(errors)}, status_code=400)

    image_id = _store_image_and_get_id(payload.get("image"), payload.get("image_content_type", "image/jpeg"))

    doc = {
        "type": payload.get("type", "accident_alert"),
        "camera_name": payload.get("camera_name"),
        "timestamp": float(payload.get("timestamp", time.time())),
        "datetime": payload.get("datetime"),
        "details": payload.get("report") if payload.get("type") == "stalled_vehicle" else payload.get("details"),
        "image_id": image_id,
        "received_at": time.time(),
        "status": "open",
        # keep the original payload for any future enrichment/debugging
        "raw": {k: v for k, v in payload.items() if k != "image"},  # drop base64 to keep doc small
    }

    try:
        res = accidents_col.insert_one(doc)
        doc["id"] = str(res.inserted_id)
    except PyMongoError as e:
        return JSONResponse({"error": f"DB insert failed: {e}"}, status_code=500)

    # also create alert (expires in 1 day)
    alert_type = "stalled" if doc["type"] == "stalled_vehicle" else "accident"
    message = f"Stalled vehicle detected on {doc.get('camera_name') or 'unknown'}" if doc["type"] == "stalled_vehicle" else f"Accident detected on {doc.get('camera_name') or 'unknown'}"

    alert = {
        "type": alert_type,
        "camera_name": doc.get("camera_name"),
        "message": message,
        "created_at": time.time(),
        "expires_at": time.time() + 86400,
        "ref_id": doc["id"],
    }
    try:
        alerts_col.insert_one(alert)
    except Exception:
        pass

    # Fan-out to MasterAgent incident webhook (non-blocking, log-and-drop)
    if _http_client:
        try:
            await _http_client.post(
                f"{MASTER_AGENT_URL}/incidents/{alert_type}",
                json={"camera_name": doc.get("camera_name"), "id": doc["id"],
                      "timestamp": doc.get("timestamp"), "type": alert_type},
            )
        except Exception as e:
            _log.debug("master_agent fanout failed: %s", e)

    return {"status": "stored", "id": doc["id"]}


@app.get("/reports")
async def list_reports(limit: str = "50"):
    """
    Fetch recent accident reports (default: 50). Useful for dashboards/testing.
    """
    try:
        limit_val = int(limit)
        limit_val = min(max(limit_val, 1), 200)
    except ValueError:
        limit_val = 50

    try:
        docs = list(
            accidents_col.find().sort("received_at", -1).limit(limit_val)
        )
    except PyMongoError as e:
        return JSONResponse({"error": f"DB read failed: {e}"}, status_code=500)

    return [_clean_record(d) for d in docs]


@app.get("/congestion-logs")
async def list_congestion(limit: str = "50"):
    """
    Fetch recent congestion reports (default: 50).
    """
    try:
        limit_val = int(limit)
        limit_val = min(max(limit_val, 1), 200)
    except ValueError:
        limit_val = 50

    try:
        docs = list(
            congestion_col.find().sort("received_at", -1).limit(limit_val)
        )
    except PyMongoError as e:
        return JSONResponse({"error": f"DB read failed: {e}"}, status_code=500)

    return [_clean_record(d) for d in docs]


@app.get("/accidents")
async def list_accidents(limit: str = "50"):
    """Alias for list_reports; returns accident reports."""
    return await list_reports(limit=limit)


@app.get("/alerts")
async def list_alerts(limit: str = "100"):
    """
    Return alerts from the last 24h (pruning expired).
    """
    _prune_alerts()
    try:
        limit_val = int(limit)
        limit_val = min(max(limit_val, 1), 200)
    except ValueError:
        limit_val = 100

    try:
        docs = list(
            alerts_col.find({"created_at": {"$gte": time.time() - 86400}})
            .sort("created_at", -1)
            .limit(limit_val)
        )
    except PyMongoError as e:
        return JSONResponse({"error": f"DB read failed: {e}"}, status_code=500)

    return [_clean_record(d) for d in docs]


@app.delete("/alerts/{alert_id}")
async def delete_alert(alert_id: str):
    try:
        oid = ObjectId(alert_id)
    except Exception:
        return JSONResponse({"error": "Invalid alert id"}, status_code=400)

    try:
        res = alerts_col.delete_one({"_id": oid})
        if res.deleted_count == 0:
            return JSONResponse({"error": "Alert not found"}, status_code=404)
    except PyMongoError as e:
        return JSONResponse({"error": f"DB delete failed: {e}"}, status_code=500)

    return {"status": "deleted"}


def _delete_image(image_id: str):
    if not image_id:
        return
    try:
        oid = ObjectId(image_id)
        fs.delete(oid)
    except Exception:
        pass


@app.patch("/accidents/{accident_id}")
async def update_accident(accident_id: str, request: Request):
    """
    Minimal update endpoint: supports status and notes.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}
        
    allowed = {}
    if "status" in payload:
        allowed["status"] = str(payload["status"])
    if "notes" in payload:
        allowed["notes"] = str(payload["notes"])

    if not allowed:
        return JSONResponse({"error": "No updatable fields provided"}, status_code=400)

    try:
        oid = ObjectId(accident_id)
    except Exception:
        return JSONResponse({"error": "Invalid accident id"}, status_code=400)

    try:
        res = accidents_col.update_one({"_id": oid}, {"$set": allowed})
        if res.matched_count == 0:
            return JSONResponse({"error": "Accident not found"}, status_code=404)
    except PyMongoError as e:
        return JSONResponse({"error": f"DB update failed: {e}"}, status_code=500)

    return {"status": "updated"}


@app.delete("/accidents/{accident_id}")
async def delete_accident(accident_id: str):
    """Delete an accident report (and associated image if present)."""
    try:
        oid = ObjectId(accident_id)
    except Exception:
        return JSONResponse({"error": "Invalid accident id"}, status_code=400)

    try:
        doc = accidents_col.find_one({"_id": oid})
        if not doc:
            return JSONResponse({"error": "Accident not found"}, status_code=404)
        _delete_image(doc.get("image_id"))
        accidents_col.delete_one({"_id": oid})
    except PyMongoError as e:
        return JSONResponse({"error": f"DB delete failed: {e}"}, status_code=500)

    return {"status": "deleted"}


@app.post("/report-congestion")
async def report_congestion(request: Request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
        
    if not payload:
        return JSONResponse({"error": "Invalid or empty JSON"}, status_code=400)

    errors = _validate_congestion(payload)
    if errors:
        return JSONResponse({"error": "; ".join(errors)}, status_code=400)

    image_id = _store_image_and_get_id(payload.get("image"), payload.get("image_content_type", "image/jpeg"))

    doc = {
        "type": payload.get("type", "congestion_alert"),
        "camera_name": payload.get("camera_name"),
        "timestamp": float(payload.get("timestamp", time.time())),
        "datetime": payload.get("datetime"),
        "congestion_levels": payload.get("congestion_levels"),
        "vehicle_counts": payload.get("vehicle_counts"),
        "total_vehicles": payload.get("total_vehicles"),
        "image_id": image_id,
        "received_at": time.time(),
        "raw": {k: v for k, v in payload.items() if k != "image"},
    }

    try:
        res = congestion_col.insert_one(doc)
        doc["id"] = str(res.inserted_id)
    except PyMongoError as e:
        return JSONResponse({"error": f"DB insert failed: {e}"}, status_code=500)

    # also create alert (expires in 1 day)
    alert = {
        "type": "congestion",
        "camera_name": doc.get("camera_name"),
        "message": f"Congestion detected on {doc.get('camera_name') or 'unknown'}",
        "created_at": time.time(),
        "expires_at": time.time() + 86400,
        "ref_id": doc["id"],
    }
    try:
        alerts_col.insert_one(alert)
    except Exception:
        pass

    # Fan-out to MasterAgent incident webhook (non-blocking, log-and-drop)
    if _http_client:
        try:
            await _http_client.post(
                f"{MASTER_AGENT_URL}/incidents/congestion",
                json={"camera_name": doc.get("camera_name"), "id": doc["id"],
                      "timestamp": doc.get("timestamp"), "type": "congestion",
                      "congestion_levels": doc.get("congestion_levels")},
            )
        except Exception as e:
            _log.debug("master_agent congestion fanout failed: %s", e)

    return {"status": "stored", "id": doc["id"]}


@app.get("/image/{image_id}")
async def get_image(image_id: str):
    """Serve stored image by GridFS id."""
    try:
        oid = ObjectId(image_id)
    except Exception:
        return JSONResponse({"error": "Invalid image id"}, status_code=400)

    try:
        grid_out = fs.get(oid)
    except Exception:
        return JSONResponse({"error": "Image not found"}, status_code=404)

    data = grid_out.read()
    content_type = getattr(grid_out, "content_type", "application/octet-stream")
    return Response(content=data, media_type=content_type)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=DEFAULT_PORT)
