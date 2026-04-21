import types
import pytest
import agents.master.master_agent as ma


class DummyCol:
    def insert_one(self, *_args, **_kwargs):
        return types.SimpleNamespace()

    def aggregate(self, pipeline):
        # return one fake metric document
        return [
            {
                "_id": "cam1",
                "latest_metric": {
                    "metrics": {"camera_name": "cam1", "vehicle_counts": {"up": 1}},
                    "decision": {"action": "NO_ACTION"},
                    "created_at": 1.0,
                },
            }
        ]


@pytest.fixture(autouse=True)
def patch_db(monkeypatch):
    monkeypatch.setattr(ma, "decisions_col", DummyCol())
    yield


def test_health_and_status():
    client = ma.app.test_client()
    assert client.get("/health").status_code == 200
    status = client.get("/api/status")
    assert status.status_code == 200
    assert "active_overrides" in status.get_json()


def test_metrics_endpoint():
    client = ma.app.test_client()
    resp = client.get("/api/metrics")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)
    assert data[0]["camera_name"] == "cam1"


def test_override_and_decision(monkeypatch):
    client = ma.app.test_client()
    # override set
    r1 = client.post("/api/override", json={"camera_name": "camx", "action": "AUTO"})
    assert r1.status_code == 200

    # decision call
    # stub insert_one to avoid mongo access
    monkeypatch.setattr(ma.decisions_col, "insert_one", lambda *_args, **_kwargs: types.SimpleNamespace())
    resp = client.post("/decision", json={"camera_name": "camx", "vehicle_counts": {"up": 1}})
    assert resp.status_code == 200
    assert "action" in resp.get_json()

