import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SumoControl from '../SumoControl';
import '@testing-library/jest-dom';

// Mock Lucide icons
jest.mock('lucide-react', () => ({
  Play: () => <span data-testid="icon-play" />,
  Square: () => <span data-testid="icon-square" />,
  Activity: () => <span data-testid="icon-activity" />,
  AlertTriangle: () => <span data-testid="icon-alert" />,
  TrafficCone: () => <span data-testid="icon-cone" />,
  Shield: () => <span data-testid="icon-shield" />,
  RefreshCw: () => <span data-testid="icon-refresh" />,
  Zap: () => <span data-testid="icon-zap" />,
  TrendingUp: () => <span data-testid="icon-trending" />,
  Clock: () => <span data-testid="icon-clock" />,
}));

// Mock toast
jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn(),
}));

global.fetch = jest.fn();

describe('SumoControl Component', () => {
  beforeEach(() => {
    fetch.mockClear();
  });

  test('renders initial state (stopped)', async () => {
    fetch.mockImplementation((url) => {
      if (url.includes('/api/simulation/status')) {
        return Promise.resolve({
          json: () => Promise.resolve({ running: false, pid: null }),
        });
      }
      return Promise.resolve({ json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(<SumoControl />);
    });

    expect(screen.getByText('SUMO CONTROL')).toBeInTheDocument();
    expect(screen.getByText('OFFLINE')).toBeInTheDocument();
    expect(screen.getByText('START SIM')).toBeInTheDocument();
  });

  test('renders running state with metrics', async () => {
    fetch.mockImplementation((url) => {
      if (url.includes('/api/simulation/status')) {
        return Promise.resolve({
          json: () => Promise.resolve({ running: true, pid: 1234 }),
        });
      }
      if (url.includes('/api/sumo-metrics')) {
        return Promise.resolve({
          json: () =>
            Promise.resolve({
              avg_wait_time: 45.5,
              total_queue: 12,
              throughput: 150,
            }),
        });
      }
      return Promise.resolve({ json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(<SumoControl />);
    });

    expect(screen.getByText('ONLINE (PID:1234)')).toBeInTheDocument();
    expect(screen.getByText('45.5')).toBeInTheDocument(); // Wait time
    expect(screen.getByText('12')).toBeInTheDocument(); // Queue
    expect(screen.getByText('150')).toBeInTheDocument(); // Throughput
  });

  test('handles Global All Red command', async () => {
    fetch.mockImplementation((url) => {
      return Promise.resolve({
        json: () => Promise.resolve({ status: 'set' }),
      });
    });

    await act(async () => {
      render(<SumoControl />);
    });

    const allRedBtn = screen.getByText(/Emergency All Red/i);
    await act(async () => {
      fireEvent.click(allRedBtn);
    });

    // Should call API for each camera (10 cameras in list)
    // Checking if fetch was called with correct payload for at least one
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/override'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"action":"SWITCH_RED"'),
      }),
    );
  });
});
