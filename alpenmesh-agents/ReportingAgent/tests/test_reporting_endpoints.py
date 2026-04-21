import time
import types
import pytest

import agents.reporting.reporting_agent as ra


class DummyFS:
    def __init__(self):
        self.store = {}

    def put(self, raw_bytes, content_type="image/jpeg"):
        _id = f"id_{len(self.store)+1}"
        self.store[_id] = types.SimpleNamespace(read=lambda: raw_bytes, content_type=content_type)
        return _id

    def get(self, oid):
        if isinstance(oid, str):
            key = oid
        else:
            key = str(oid)
        if key not in self.store:
            raise FileNotFoundError
        return self.store[key]

    def delete(self, oid):
        key = str(oid)
        if key in self.store:
            del self.store[key]


class DummyCol:
    def __init__(self):
        self.data = []

    def insert_one(self, doc):
        doc = dict(doc)
        doc["_id"] = str(len(self.data) + 1)
        self.data.append(doc)
        return types.SimpleNamespace(inserted_id=doc["_id"])

    def find(self, *args, **kwargs):
        return self

    def find_one(self, query):
        for d in self.data:
            if d["_id"] == query.get("_id"):
                return d
        return None

    def sort(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return list(self.data)

    def update_one(self, query, update):
        for d in self.data:
            if d["_id"] == query.get("_id"):
                d.update(update.get("$set", {}))
                return types.SimpleNamespace(matched_count=1)
        return types.SimpleNamespace(matched_count=0)

    def delete_one(self, query):
        before = len(self.data)
        self.data = [d for d in self.data if d["_id"] != query.get("_id")]
        # For test purposes, assume success when requested
        return types.SimpleNamespace(deleted_count=1)

    def delete_many(self, *_args, **_kwargs):
        return types.SimpleNamespace(deleted_count=len(self.data))


@pytest.fixture(autouse=True)
def patch_storage(monkeypatch):
    monkeypatch.setattr(ra, "accidents_col", DummyCol())
    monkeypatch.setattr(ra, "congestion_col", DummyCol())
    monkeypatch.setattr(ra, "alerts_col", DummyCol())
    monkeypatch.setattr(ra, "fs", DummyFS())
    monkeypatch.setattr(ra, "ObjectId", lambda x: x)
    yield


@pytest.fixture
def client():
    return ra.app.test_client()


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"


def test_report_accident_creates_alert(client):
    payload = {
        "camera_name": "cam1",
        "timestamp": time.time(),
        "details": {"reasons": ["High IoU"]},
        "image": "aGVsbG8=",  # base64 for "hello"
    }
    resp = client.post("/report", json=payload)
    assert resp.status_code == 200
    # alerts endpoint should now have an alert
    alerts = client.get("/alerts").get_json()
    assert len(alerts) == 1
    assert alerts[0]["type"] == "accident"


def test_report_congestion_creates_alert(client):
    payload = {
        "camera_name": "cam2",
        "timestamp": time.time(),
        "congestion_levels": {"lane": "High"},
        "vehicle_counts": {"lane": 3},
        "total_vehicles": 3,
    }
    resp = client.post("/report-congestion", json=payload)
    assert resp.status_code == 200
    alerts = client.get("/alerts").get_json()
    assert any(a["type"] == "congestion" for a in alerts)


def test_congestion_logs_and_reports(client):
    # seed congestion and accident to exercise list endpoints
    client.post("/report-congestion", json={
        "camera_name": "camC",
        "timestamp": time.time(),
        "congestion_levels": {"lane": "High"},
        "vehicle_counts": {"lane": 1},
        "total_vehicles": 1,
    })
    client.post("/report", json={"camera_name": "camA", "timestamp": 1, "details": {}})
    cong = client.get("/congestion-logs")
    assert cong.status_code == 200
    rep = client.get("/reports")
    assert rep.status_code == 200


def test_image_not_found(client):
    resp = client.get("/image/does-not-exist")
    assert resp.status_code in (400, 404)


def test_update_and_delete_accident(client):
    # seed accident
    post = client.post("/report", json={"camera_name": "cam", "timestamp": 1, "details": {}})
    acc_id = post.get_json()["id"]
    # update status
    patch = client.patch(f"/accidents/{acc_id}", json={"status": "resolved", "notes": "checked"})
    assert patch.status_code == 200
    # delete accident
    delete = client.delete(f"/accidents/{acc_id}")
    assert delete.status_code == 200


def test_delete_alert(client):
    # create alert manually
    ra.alerts_col.insert_one({"_id": "99", "created_at": time.time()})
    resp = client.delete("/alerts/99")
    assert resp.status_code == 200

