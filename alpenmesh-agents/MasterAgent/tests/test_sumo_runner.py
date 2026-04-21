import unittest
from unittest.mock import MagicMock, patch
import sys
import os

# Add parent directory to path
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sumo_runner import calculate_metrics

class TestSumoRunner(unittest.TestCase):
    
    @patch('sumo_runner.traci')
    def test_calculate_metrics_empty(self, mock_traci):
        # Test with no vehicles
        metrics, total_arrived = calculate_metrics([], 0, 100)
        
        self.assertEqual(metrics['total_vehicles'], 0)
        self.assertEqual(metrics['avg_wait_time'], 0.0)
        self.assertEqual(metrics['total_queue'], 0)
        self.assertEqual(metrics['throughput'], 100)
        self.assertEqual(total_arrived, 100)

    @patch('sumo_runner.traci')
    def test_calculate_metrics_data(self, mock_traci):
        # Setup mock vehicles
        # Veh 1: Waiting 10s, Speed 0
        # Veh 2: Waiting 0s, Speed 10
        veh_list = ['v1', 'v2']
        
        # Configure getWaitingTime
        def get_wait(veh_id):
            return 10.0 if veh_id == 'v1' else 0.0
        mock_traci.vehicle.getWaitingTime.side_effect = get_wait

        # Configure getSpeed
        def get_speed(veh_id):
            return 0.0 if veh_id == 'v1' else 10.0
        mock_traci.vehicle.getSpeed.side_effect = get_speed

        # Run calc
        # Arrived now = 5, Prev total = 50
        metrics, total_arrived = calculate_metrics(veh_list, 5, 50)

        self.assertEqual(total_arrived, 55)
        self.assertEqual(metrics['throughput'], 55)
        self.assertEqual(metrics['total_vehicles'], 2)
        
        # Avg wait: (10 + 0) / 2 = 5.0
        self.assertEqual(metrics['avg_wait_time'], 5.0)
        
        # Queue: v1 has speed 0 (< 0.1), v2 has 10
        self.assertEqual(metrics['total_queue'], 1)

if __name__ == '__main__':
    unittest.main()
