"""
services/ingest_worker.py — Mongo change stream → Redis hot cache.

Watches the traffic_metrics collection for new inserts, applies
RoiMapper, computes derived features (arrival_rate from occupancy delta),
and publishes to Redis for consumption by decision workers.

Requires MongoDB replica set for change streams.
"""
import os
import json
import time
import signal
import sys
from typing import Any, Dict, Optional

from pymongo import MongoClient

try:
    import redis
    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from topology.roi_adapter import RoiMapper, RoiLocation
from observability.logging import configure_logging, log

MONGO_URI     = os.getenv("MONGO_URI", "mongodb://admin:adminpassword@localhost:27017/alpenmesh")
DB_NAME       = os.getenv("MASTER_DB_NAME", "alpenmesh")
COLLECTION    = os.getenv("METRICS_COLLECTION", "traffic_metrics")
REDIS_URL     = os.getenv("REDIS_URL", "redis://localhost:6379/0")
FEATURE_TTL   = int(os.getenv("FEATURE_TTL_S", "30"))
HISTORY_WINDOW = int(os.getenv("HISTORY_WINDOW_S", "600"))  # 10 min

_running = True


def _sigterm_handler(signum, frame):
    global _running
    _running = False


def _feature_key(loc: RoiLocation) -> str:
    return f"feat:{loc.intersection_id}:{loc.approach}:{loc.movement}"


def _history_key(loc: RoiLocation) -> str:
    return f"hist:{loc.intersection_id}:{loc.approach}:{loc.movement}"


def _corridor_for_intersection(intersection_id: str) -> str:
    parts = intersection_id.split("__")
    return parts[0] if parts else intersection_id


def run():
    configure_logging()
    signal.signal(signal.SIGTERM, _sigterm_handler)

    if not HAS_REDIS:
        log.error("redis package not installed; ingest_worker cannot start")
        sys.exit(1)

    mongo = MongoClient(MONGO_URI)
    db = mongo[DB_NAME]
    col = db[COLLECTION]
    r = redis.Redis.from_url(REDIS_URL, decode_responses=True)

    roi_mapper = RoiMapper(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "topology", "roi_mapping.yaml")
    )

    # Resume token for change stream restart
    resume_token = None
    saved = r.get("ingest:resume_token")
    if saved:
        try:
            resume_token = json.loads(saved)
        except (json.JSONDecodeError, TypeError):
            pass

    log.info("ingest_worker starting", collection=COLLECTION, redis=REDIS_URL)

    while _running:
        try:
            kwargs: Dict[str, Any] = {"full_document": "updateLookup"}
            if resume_token:
                kwargs["resume_after"] = resume_token

            with col.watch([{"$match": {"operationType": "insert"}}], **kwargs) as stream:
                for change in stream:
                    if not _running:
                        break
                    _process_change(change, r, roi_mapper)
                    resume_token = change.get("_id")
                    if resume_token:
                        r.set("ingest:resume_token", json.dumps(resume_token))

        except Exception as e:
            log.error("change_stream_error", error=str(e))
            if not _running:
                break
            time.sleep(2)

    log.info("ingest_worker stopped")


def _process_change(change: Dict, r: "redis.Redis", roi_mapper: RoiMapper) -> None:
    doc = change.get("fullDocument")
    if not doc:
        return

    camera_name = doc.get("camera_name", "unknown")
    ts = time.time()
    vehicle_counts = doc.get("vehicle_counts", {}) or {}
    congestion_levels = doc.get("congestion_levels", {}) or {}
    traffic_metrics = doc.get("traffic_metrics", {}) or {}
    total_vehicles = doc.get("total_vehicles", 0)
    tracked_vehicles = doc.get("tracked_vehicles", 0)
    latency_ms = doc.get("latency", 0)

    all_rois = set(vehicle_counts.keys()) | set(congestion_levels.keys()) | set(traffic_metrics.keys())
    unmapped_count = 0

    pipe = r.pipeline()

    for roi_name in all_rois:
        loc = roi_mapper.resolve(camera_name, roi_name)
        if loc is None:
            unmapped_count += 1
            continue

        fkey = _feature_key(loc)
        hkey = _history_key(loc)

        tm = traffic_metrics.get(roi_name, {})
        occupancy = tm.get("occupancy", vehicle_counts.get(roi_name, 0))
        mean_dwell = tm.get("mean_dwell_sec", 0.0)
        stalled = tm.get("stalled_count", 0)
        slow_throughput = tm.get("slow_throughput", 0)

        # Compute arrival_rate from occupancy delta (fills EdgeAgent's queue_growth_rate TODO)
        prev_occ_raw = r.hget(fkey, "occupancy")
        prev_ts_raw = r.hget(fkey, "ts")
        arrival_rate = 0.0
        if prev_occ_raw is not None and prev_ts_raw is not None:
            try:
                prev_occ = float(prev_occ_raw)
                prev_ts = float(prev_ts_raw)
                dt = ts - prev_ts
                if dt > 0:
                    arrival_rate = (float(occupancy) - prev_occ) / dt
            except (ValueError, TypeError):
                pass

        features = {
            "camera_name": camera_name,
            "roi_name": roi_name,
            "occupancy": occupancy,
            "mean_dwell_sec": mean_dwell,
            "stalled_count": stalled,
            "slow_throughput": slow_throughput,
            "arrival_rate": round(arrival_rate, 4),
            "congestion": congestion_levels.get(roi_name, "Low"),
            "vehicle_count": vehicle_counts.get(roi_name, 0),
            "total_vehicles": total_vehicles,
            "tracked_vehicles": tracked_vehicles,
            "latency_ms": latency_ms,
            "ts": ts,
        }

        pipe.hset(fkey, mapping={k: str(v) for k, v in features.items()})
        pipe.expire(fkey, FEATURE_TTL)

        history_entry = json.dumps({
            "occ": occupancy, "dwell": mean_dwell,
            "stalled": stalled, "slow": slow_throughput,
            "arr_rate": round(arrival_rate, 4),
        })
        pipe.zadd(hkey, {history_entry: ts})
        cutoff = ts - HISTORY_WINDOW
        pipe.zremrangebyscore(hkey, "-inf", cutoff)

    # Publish corridor update
    corridor = _corridor_for_intersection(
        RoiMapper._camera_to_intersection(camera_name)
    )
    pipe.publish(f"updates:{corridor}", camera_name)
    pipe.execute()

    if unmapped_count > 0:
        log.warning("unmapped_rois", camera=camera_name, count=unmapped_count)


if __name__ == "__main__":
    run()
