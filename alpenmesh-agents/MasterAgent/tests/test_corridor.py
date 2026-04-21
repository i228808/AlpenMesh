"""
tests/test_corridor.py — Unit tests for CorridorManager and PlatoonEvent.
"""
import sys
import os
import time
import unittest
import tempfile
import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from corridor import CorridorManager, PlatoonEvent


def _write_yaml(data: dict, tmpdir: str, filename: str) -> str:
    path = os.path.join(tmpdir, filename)
    with open(path, "w") as f:
        yaml.dump(data, f)
    return path


def _make_manager(tmpdir: str, n_cameras: int = 3) -> CorridorManager:
    """Build a CorridorManager from minimal synthetic YAML files."""
    camera_cfg = {
        "cameras": {
            "Cam A": {"sumo_x": 0.0,   "sumo_y": 0.0,    "axis": "NS"},
            "Cam B": {"sumo_x": 0.0,   "sumo_y": 100.0,  "axis": "NS"},
            "Cam C": {"sumo_x": 0.0,   "sumo_y": 200.0,  "axis": "NS"},
        }
    }
    corridor_cfg = {
        "corridors": {
            "Test_Ave": {
                "street_name": "Test Ave",
                "axis": "NS",
                "cameras_ordered": ["Cam A", "Cam B", "Cam C"],
                "avg_block_distance_m": 100.0,
            }
        }
    }

    cam_yaml = _write_yaml(camera_cfg, tmpdir, "camera_config.yaml")
    cor_yaml = _write_yaml(corridor_cfg, tmpdir, "corridor_config.yaml")

    return CorridorManager.from_yaml(corridor_yaml=cor_yaml, camera_yaml=cam_yaml)


class TestCorridorManagerLoad(unittest.TestCase):
    def test_loads_corridors(self):
        with tempfile.TemporaryDirectory() as td:
            mgr = _make_manager(td)
            self.assertEqual(mgr.n_corridors, 1)

    def test_missing_files_returns_empty_manager(self):
        mgr = CorridorManager.from_yaml("/nonexistent/a.yaml", "/nonexistent/b.yaml")
        self.assertEqual(mgr.n_corridors, 0)

    def test_corridor_summary_has_correct_keys(self):
        with tempfile.TemporaryDirectory() as td:
            mgr = _make_manager(td)
            summary = mgr.corridor_summary()
            self.assertIn("Test_Ave", summary)
            self.assertIn("cameras", summary["Test_Ave"])
            self.assertIn("axis",    summary["Test_Ave"])


class TestPlatoonEventFiring(unittest.TestCase):
    def test_platoon_fires_for_large_queue(self):
        with tempfile.TemporaryDirectory() as td:
            mgr = _make_manager(td)
            mgr.on_platoon_released("Cam A", "UP", queue_size=10)
            self.assertEqual(mgr.n_active_events, 0)  # ETA is in the future
            # The event should be in the internal list
            with mgr._lock:
                self.assertEqual(len(mgr._events), 1)
                self.assertEqual(mgr._events[0].destination_camera, "Cam B")

    def test_platoon_not_fired_below_threshold(self):
        with tempfile.TemporaryDirectory() as td:
            mgr = _make_manager(td)
            mgr.on_platoon_released("Cam A", "UP", queue_size=2)  # < MIN_PLATOON_QUEUE=4
            with mgr._lock:
                self.assertEqual(len(mgr._events), 0)

    def test_no_event_for_last_camera(self):
        with tempfile.TemporaryDirectory() as td:
            mgr = _make_manager(td)
            mgr.on_platoon_released("Cam C", "UP", queue_size=10)
            with mgr._lock:
                self.assertEqual(len(mgr._events), 0,
                                 "Last camera in corridor has no downstream")


class TestPlatoonBoost(unittest.TestCase):
    def test_boost_applied_when_event_is_active(self):
        with tempfile.TemporaryDirectory() as td:
            mgr = _make_manager(td)
            # Inject an event with ETA in the past (so it's active now)
            evt = PlatoonEvent(
                origin_camera="Cam A",
                destination_camera="Cam B",
                direction="UP",
                queue_size=10,
                eta=time.time() - 2.0,  # arrived 2s ago, still within tail_window
            )
            with mgr._lock:
                mgr._events.append(evt)

            boost = mgr.get_platoon_boost("Cam B", "UP")
            self.assertGreater(boost, 0.0)

    def test_boost_zero_for_wrong_camera(self):
        with tempfile.TemporaryDirectory() as td:
            mgr = _make_manager(td)
            evt = PlatoonEvent(
                origin_camera="Cam A",
                destination_camera="Cam B",
                direction="UP",
                queue_size=10,
                eta=time.time() - 2.0,
            )
            with mgr._lock:
                mgr._events.append(evt)

            # Cam C should not receive boost from this event (wrong destination)
            boost = mgr.get_platoon_boost("Cam C", "UP")
            self.assertEqual(boost, 0.0)

    def test_boost_zero_for_wrong_direction(self):
        with tempfile.TemporaryDirectory() as td:
            mgr = _make_manager(td)
            evt = PlatoonEvent(
                origin_camera="Cam A",
                destination_camera="Cam B",
                direction="UP",
                queue_size=10,
                eta=time.time() - 2.0,
            )
            with mgr._lock:
                mgr._events.append(evt)

            boost = mgr.get_platoon_boost("Cam B", "DOWN")
            self.assertEqual(boost, 0.0)

    def test_boost_capped_at_3(self):
        with tempfile.TemporaryDirectory() as td:
            mgr = _make_manager(td)
            # Insert many large events
            for _ in range(10):
                evt = PlatoonEvent(
                    origin_camera="Cam A",
                    destination_camera="Cam B",
                    direction="UP",
                    queue_size=100,
                    eta=time.time() - 2.0,
                )
                with mgr._lock:
                    mgr._events.append(evt)

            boost = mgr.get_platoon_boost("Cam B", "UP")
            self.assertLessEqual(boost, 3.0)


class TestPlatoonEventExpiry(unittest.TestCase):
    def test_expired_events_purged(self):
        with tempfile.TemporaryDirectory() as td:
            mgr = _make_manager(td)
            evt = PlatoonEvent(
                origin_camera="Cam A",
                destination_camera="Cam B",
                direction="UP",
                queue_size=10,
                eta=time.time() - 100.0,  # long expired
            )
            with mgr._lock:
                mgr._events.append(evt)

            # Trigger purge
            mgr.get_platoon_boost("Cam B", "UP")

            with mgr._lock:
                self.assertEqual(len(mgr._events), 0,
                                 "Expired events should be purged")


class TestPlatoonEventDataclass(unittest.TestCase):
    def test_boost_magnitude_capped(self):
        e = PlatoonEvent("A", "B", "UP", queue_size=100, eta=time.time())
        self.assertLessEqual(e.boost_magnitude, 2.0)

    def test_boost_magnitude_scales(self):
        e5  = PlatoonEvent("A", "B", "UP", queue_size=5,  eta=time.time())
        e10 = PlatoonEvent("A", "B", "UP", queue_size=10, eta=time.time())
        self.assertLess(e5.boost_magnitude, e10.boost_magnitude)

    def test_is_active_within_window(self):
        e = PlatoonEvent("A", "B", "UP", queue_size=5,
                         eta=time.time())  # ETA is now
        self.assertTrue(e.is_active(time.time()))

    def test_not_active_before_lead_window(self):
        e = PlatoonEvent("A", "B", "UP", queue_size=5,
                         eta=time.time() + 100)  # 100s in the future
        self.assertFalse(e.is_active(time.time()))


if __name__ == "__main__":
    unittest.main()
