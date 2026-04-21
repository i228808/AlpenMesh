import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import CongestionLogs from '../pages/CongestionLogs';
import axios from 'axios';

jest.mock('axios');

describe('CongestionLogs', () => {
  beforeEach(() => {
    axios.get.mockReset();
  });

  it('renders hero title and a fetched log', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: '1',
          camera_name: 'cam-1',
          timestamp: 123,
          datetime: 'now',
          congestion_levels: { laneA: 'High' },
          vehicle_counts: { laneA: 5 },
          total_vehicles: 5,
          image_id: null,
        },
      ],
    });

    render(<CongestionLogs />);
    expect(screen.getByText(/Congestion Archive/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/cam-1/i)).toBeInTheDocument();
      expect(screen.getByText(/High load/i)).toBeInTheDocument();
    });
  });

  it('shows error state on failure', async () => {
    axios.get.mockRejectedValueOnce(new Error('fail'));
    render(<CongestionLogs />);
    const error = await screen.findByText(/Could not load congestion archive/i);
    expect(error).toBeInTheDocument();
  });

  it('shows empty state when no logs', async () => {
    axios.get.mockResolvedValueOnce({ data: [] });
    render(<CongestionLogs />);
    const empty = await screen.findByText(/No congestion events logged yet/i);
    expect(empty).toBeInTheDocument();
  });

  it('renders medium-load badge path', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: '2',
          camera_name: 'cam-2',
          timestamp: 321,
          datetime: 'later',
          congestion_levels: { laneB: 'Medium' },
          vehicle_counts: { laneB: 3 },
          total_vehicles: 3,
          image_id: null,
        },
      ],
    });
    render(<CongestionLogs />);
    await waitFor(() => {
      expect(screen.getByText(/cam-2/i)).toBeInTheDocument();
      expect(screen.getByText(/Medium/i)).toBeInTheDocument();
    });
  });

  it('renders calm/low badge path', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: '3',
          camera_name: 'cam-3',
          timestamp: 999,
          datetime: 'later',
          congestion_levels: { laneC: 'Low' },
          vehicle_counts: { laneC: 1 },
          total_vehicles: 1,
          image_id: null,
        },
      ],
    });
    render(<CongestionLogs />);
    await waitFor(() => {
      expect(screen.getByText(/cam-3/i)).toBeInTheDocument();
      expect(screen.getByText(/Calm/i)).toBeInTheDocument();
    });
  });

  it('renders image branch', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: '4',
          camera_name: 'cam-4',
          timestamp: 777,
          datetime: 'later',
          congestion_levels: { laneD: 'High' },
          vehicle_counts: { laneD: 9 },
          total_vehicles: 9,
          image_id: 'img-4',
        },
      ],
    });
    render(<CongestionLogs />);
    await waitFor(() => {
      expect(screen.getByAltText(/Congestion frame/i)).toBeInTheDocument();
    });
  });
});
