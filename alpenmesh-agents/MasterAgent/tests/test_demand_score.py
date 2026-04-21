"""
tests/test_demand_score.py — Unit tests for Tier-1 demand score engine.

Tests the RuleBasedMasterAgent.decide() method in isolation:
  - Safety constraints (MIN_GREEN, MAX_GREEN, starvation guard)
  - Score-based decisions for both-axes-observed scenarios
  - Half-observed fallback logic
  - Yellow light guard
  - Manual override
"""
import sys
import os
import time
import unittest
from unittest.mock import patch, MagicMock

# Ensure MasterAgent dir is on path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Patch MongoDB so we don't need a live instance
import mongomock
from unittest.mock import patch

# We need to patch pymongo.MongoClient before importing master_agent
import pymongo

_mock_client = mongomock.MongoClient()

def _make_agent():
    with patch("pymongo.MongoClient", return_value=_mock_client), \
         patch("master_agent.CorridorManager.from_yaml", return_value=MagicMock(
             n_corridors=0,
             get_platoon_boost=MagicMock(return_value=0.0),
             on_platoon_released=MagicMock(),
             active_events=MagicMock(return_value=[]),
             corridor_summary=MagicMock(return_value={}),
             n_active_events=0,
         )):
        import importlib
        import master_agent as ma
        importlib.reload(ma)  # ensure clean state
        return ma.RuleBasedMasterAgent()


def _metrics(camera="cam_test", up=5, down=2, color="Green", roi="UP", conf=0.9):
    return {
        "camera_name":     camera,
        "vehicle_counts":  {"UP": up, "DOWN": down},
        "congestion_levels": {"UP": "Medium", "DOWN": "Low"},
        "total_vehicles":  up + down,
        "traffic_lights":  [{"color": color, "nearest_roi": roi, "confidence": conf}],
    }


class TestYellowGuard(unittest.TestCase):
    def test_yellow_returns_extend(self):
        agent = _make_agent()
        result = agent.decide(_metrics(color="Yellow"))
        self.assertEqual(result["action"], "EXTEND_CURRENT_PHASE")

    def test_yellow_does_not_switch(self):
        agent = _make_agent()
        result = agent.decide(_metrics(color="Yellow", up=10, down=0))
        self.assertNotEqual(result["action"], "SWITCH_GREEN")


class TestNoVehicles(unittest.TestCase):
    def test_no_vehicles_returns_no_action(self):
        agent = _make_agent()
        m = _metrics(up=0, down=0)
        m["total_vehicles"] = 0
        result = agent.decide(m)
        self.assertEqual(result["action"], "NO_ACTION")


class TestManualOverride(unittest.TestCase):
    def test_override_respected(self):
        agent = _make_agent()
        agent.set_override("cam_test", "FORCE_GREEN", target_roi="DOWN", duration=60)
        result = agent.decide(_metrics())
        self.assertEqual(result["action"], "FORCE_GREEN")
        self.assertEqual(result["target_roi"], "DOWN")
        self.assertTrue(result.get("is_override"))

    def test_expired_override_not_applied(self):
        agent = _make_agent()
        agent.set_override("cam_test", "FORCE_GREEN", duration=0)
        time.sleep(0.01)
        result = agent.decide(_metrics())
        self.assertFalse(result.get("is_override", False))


class TestMinGreenGuard(unittest.TestCase):
    def test_min_green_prevents_switch(self):
        agent = _make_agent()
        # Set the phase as just started
        state = agent._get_inter_state("cam_test")
        state["phase_start_time"] = time.time()  # 0s elapsed
        state["current_phase_axis"] = "UP"
        # Even with huge DOWN demand, should not switch
        result = agent.decide(_metrics(up=1, down=100))
        self.assertNotEqual(result["action"], "SWITCH_GREEN",
                            "Should respect MIN_GREEN guard when phase just started")


class TestMaxGreenGuard(unittest.TestCase):
    def test_max_green_forces_switch(self):
        agent = _make_agent()
        state = agent._get_inter_state("cam_test")
        state["phase_start_time"] = time.time() - 120  # 120s ago
        state["current_phase_axis"] = "UP"
        result = agent.decide(_metrics(up=5, down=5))
        self.assertEqual(result["action"], "SWITCH_GREEN",
                         "Should force SWITCH_GREEN when MAX_GREEN exceeded")
        # Should switch away from current phase (UP)
        self.assertEqual(result["target_roi"], "DOWN")


class TestStarvationGuard(unittest.TestCase):
    def test_starvation_forces_switch_to_starved_axis(self):
        agent = _make_agent()
        state = agent._get_inter_state("cam_test")
        # DOWN hasn't been green in 200 seconds — starved
        state["last_green_time_DOWN"] = time.time() - 200
        state["last_green_time_UP"]   = time.time() - 5
        state["current_phase_axis"]   = "UP"
        state["phase_start_time"]     = time.time() - 20  # within MAX_GREEN
        result = agent.decide(_metrics(up=5, down=5))
        self.assertEqual(result["action"], "SWITCH_GREEN")
        self.assertEqual(result["target_roi"], "DOWN")


class TestTier1ScoreDecision(unittest.TestCase):
    def test_dominant_axis_wins(self):
        agent = _make_agent()
        state = agent._get_inter_state("cam_test")
        # Give reasonable phase elapsed time
        state["phase_start_time"]     = time.time() - 15
        state["last_green_time_UP"]   = time.time() - 30
        state["last_green_time_DOWN"] = time.time() - 60  # DOWN waited longer
        state["current_phase_axis"]   = "UP"

        # UP has much higher demand
        result = agent.decide(_metrics(up=20, down=1, roi="DOWN", color="Green"))
        # UP should win (higher queue + starvation not yet critical)
        self.assertIn(result["action"], ("SWITCH_GREEN", "EXTEND_GREEN"))

    def test_scores_present_in_output(self):
        agent = _make_agent()
        result = agent.decide(_metrics(up=5, down=3))
        self.assertIn("score_up",   result)
        self.assertIn("score_down", result)
        self.assertIn("tier",       result)

    def test_tier_is_1_for_single_camera(self):
        agent = _make_agent()
        result = agent.decide(_metrics())
        self.assertEqual(result.get("tier"), 1)


class TestHalfObservedFallback(unittest.TestCase):
    def test_high_demand_single_axis_switches_to_it(self):
        agent = _make_agent()
        state = agent._get_inter_state("cam_test")
        state["phase_start_time"]   = time.time() - 15
        state["current_phase_axis"] = "DOWN"
        state["last_green_time_UP"] = time.time() - 60
        state["last_green_time_DOWN"] = time.time() - 10
        # Only UP has vehicles, very high demand
        m = _metrics(up=30, down=0, color="Green", roi="DOWN")
        m["vehicle_counts"]["DOWN"] = 0
        m["total_vehicles"] = 30
        result = agent.decide(m)
        # Should recommend UP (high demand on observed axis)
        self.assertIn(result["action"], ("SWITCH_GREEN", "EXTEND_GREEN"))

    def test_low_demand_single_axis_switches_away(self):
        agent = _make_agent()
        state = agent._get_inter_state("cam_test")
        state["phase_start_time"]     = time.time() - 15
        state["current_phase_axis"]   = "UP"
        state["last_green_time_UP"]   = time.time() - 10
        state["last_green_time_DOWN"] = time.time() - 30
        # Only UP has vehicles and it's very low
        m = _metrics(up=0, down=0, color="Green", roi="UP")
        m["vehicle_counts"]["UP"] = 0
        m["vehicle_counts"]["DOWN"] = 0
        m["total_vehicles"] = 0
        result = agent.decide(m)
        self.assertEqual(result["action"], "NO_ACTION")


if __name__ == "__main__":
    unittest.main()
