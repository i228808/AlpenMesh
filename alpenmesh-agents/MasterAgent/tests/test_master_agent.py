import unittest
import sys
import os
import time
from unittest.mock import MagicMock, patch

# Add parent directory to path to import master_agent
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Mock environment variables BEFORE importing master_agent
with patch.dict(os.environ, {"MONGO_URI": "mongodb://mock:27017", "MASTER_DB_NAME": "test_db"}):
    # We also need to mock MongoClient so it doesn't try to connect during import
    with patch("pymongo.MongoClient") as mock_mongo:
        from master_agent import RuleBasedMasterAgent, app

class TestMasterAgent(unittest.TestCase):
    def setUp(self):
        self.agent = RuleBasedMasterAgent()

    def test_rule_0_no_data(self):
        """Rule 0: No data / no vehicles"""
        metrics = {
            "camera_name": "cam1",
            "vehicle_counts": {},
            "total_vehicles": 0
        }
        decision = self.agent.decide(metrics)
        self.assertEqual(decision["action"], "NO_ACTION")
        self.assertEqual(decision["reason"], "No vehicles detected")

    def test_rule_1_yellow(self):
        """Rule 1: Never switch during Yellow"""
        metrics = {
            "camera_name": "cam1",
            "vehicle_counts": {"up": 5},
            "traffic_lights": [{"color": "Yellow", "confidence": 0.9, "nearest_roi": "up"}]
        }
        decision = self.agent.decide(metrics)
        self.assertEqual(decision["action"], "EXTEND_CURRENT_PHASE")

    def test_rule_3_extend_green(self):
        """Rule 3: Extend Green if it matches dominant direction"""
        metrics = {
            "camera_name": "cam1",
            "vehicle_counts": {"up": 10, "down": 2},
            "congestion_levels": {"up": "High", "down": "Low"},
            "traffic_lights": [{"color": "Green", "confidence": 0.9, "nearest_roi": "up"}]
        }
        # up should be dominant (10 + weight 3 = 13) vs down (2 + weight 1 = 3)
        decision = self.agent.decide(metrics)
        self.assertEqual(decision["action"], "EXTEND_GREEN")
        self.assertEqual(decision["target_roi"], "up")

    def test_rule_4_switch_green(self):
        """Rule 4: Switch Green if dominant direction is different and difference > 2"""
        metrics = {
            "camera_name": "cam1",
            "vehicle_counts": {"up": 2, "down": 10}, # Down is dominant
            "traffic_lights": [{"color": "Green", "confidence": 0.9, "nearest_roi": "up"}]
        }
        decision = self.agent.decide(metrics)
        self.assertEqual(decision["action"], "SWITCH_GREEN")
        self.assertEqual(decision["target_roi"], "down")

    def test_manual_override(self):
        """Test Manual Override Logic"""
        metrics = {"camera_name": "cam1", "vehicle_counts": {"up": 10}}
        
        # Set override
        self.agent.set_override("cam1", "FORCE_RED", duration=60)
        
        decision = self.agent.decide(metrics)
        self.assertEqual(decision["action"], "FORCE_RED")
        self.assertTrue(decision.get("is_override"))
        
        # Test Expiry
        # Manually expire it
        self.agent.active_overrides["cam1"]["expires_at"] = time.time() - 1
        
        decision = self.agent.decide(metrics)
        # Should revert to normal logic (Rule 2 or similar since no Traffic Light info)
        self.assertNotEqual(decision["action"], "FORCE_RED")
        self.assertFalse(decision.get("is_override", False))

    def test_anomaly_stuck_signal(self):
        """Test detection of Stuck Signal"""
        metrics = {
            "camera_name": "cam_stuck",
            "vehicle_counts": {"up": 5},
            # Simulate seeing "Green" for many frames
            "traffic_lights": [{"color": "Green", "confidence": 0.9, "nearest_roi": "up"}]
        }
        
        # Populate history to be just below threshold (which is 20)
        self.agent._color_history["cam_stuck"] = {"last_color": "Green", "count": 19}
        
        # This call should trip it to 20
        # This call should trip it to 20
        decision = self.agent.decide(metrics)
        self.assertEqual(decision["anomaly"], "LIGHT_STUCK_Green", f"Actual anomaly: {decision.get('anomaly')}")
        
        # And after reset/change, it should clear
        metrics_red = {
             "camera_name": "cam_stuck",
             "vehicle_counts": {"up": 5},
             "traffic_lights": [{"color": "Red", "confidence": 0.9, "nearest_roi": "up"}]
        }
        decision = self.agent.decide(metrics_red)
        self.assertIsNone(decision["anomaly"])

    def test_rule_2_prioritize_dominant(self):
        """Rule 2: No active signal found, prioritize dominant"""
        metrics = {
            "camera_name": "cam1",
            "vehicle_counts": {"up": 2, "down": 10}, 
            # High congestion on down
            "congestion_levels": {"up": "Low", "down": "High"},
            "traffic_lights": [] # No light info
        }
        # Down score = 10 + 3 = 13
        # Up score = 2 + 1 = 3
        decision = self.agent.decide(metrics)
        self.assertEqual(decision["action"], "PRIORITIZE")
        self.assertEqual(decision["target_roi"], "down")

    def test_rule_5_switch_to_dominant(self):
         """Rule 5: Signal is Red, switch to dominant queue"""
         metrics = {
            "camera_name": "cam1",
            "vehicle_counts": {"left": 20},
            "traffic_lights": [{"color": "Red", "confidence": 0.9, "nearest_roi": "left"}]
         }
         decision = self.agent.decide(metrics)
         self.assertEqual(decision["action"], "SWITCH_GREEN")
         self.assertEqual(decision["target_roi"], "left")

if __name__ == '__main__':
    unittest.main()
