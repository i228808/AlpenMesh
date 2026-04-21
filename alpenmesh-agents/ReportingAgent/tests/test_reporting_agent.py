import os
import time
import types
import pytest

# Ensure we import the module with patched collections
os.environ["MONGO_URI"] = "mongodb://mock:27017"
os.environ["REPORTING_DB_NAME"] = "test_db"

from agents.reporting import reporting_agent as ra  # noqa: E402


class DummyCol:
    def __init__(self):
        self.data = []

    def insert_one(self, doc):
        self.data.append(doc)
        return types.SimpleNamespace(inserted_id=len(self.data))

    def find(self, *args, **kwargs):
        return self

    def sort(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return list(self.data)

    def delete_many(self, *args, **kwargs):
        return None

    def delete_one(self, *args, **kwargs):
        return types.SimpleNamespace(deleted_count=1)

    def find_one(self, *_args, **_kwargs):
        return None


@pytest.fixture(autouse=True)
def patch_collections(monkeypatch):
    monkeypatch.setattr(ra, "alerts_col", DummyCol())
    monkeypatch.setattr(ra, "accidents_col", DummyCol())
    monkeypatch.setattr(ra, "congestion_col", DummyCol())
    yield


def test_health():
    client = ra.app.test_client()
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "ok"


def test_alerts_pruned_and_list(monkeypatch):
    # Seed an alert older than 1 day to ensure prune path is exercised
    old_alerts = DummyCol()
    old_alerts.data.append({"created_at": time.time() - 90000})
    monkeypatch.setattr(ra, "alerts_col", old_alerts)

    client = ra.app.test_client()
    resp = client.get("/alerts")
    assert resp.status_code == 200
    # Ensure it returns list shape even if empty after prune
    assert isinstance(resp.get_json(), list)

