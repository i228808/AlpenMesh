import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AccidentLogs from '../pages/AccidentLogs';
import axios from 'axios';

jest.mock('axios');

describe('AccidentLogs', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.delete.mockReset();
    axios.patch.mockReset();
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('renders hero and fetched accident', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: 'acc1',
          camera_name: 'cam-1',
          timestamp: 123,
          datetime: 'now',
          details: { involved_ids: [1, 2], reasons: ['High IoU'], speed_1: 10, speed_2: 12 },
          status: 'open',
          image_id: null,
        },
      ],
    });
    render(<AccidentLogs />);
    expect(screen.getByText(/Accident Archive/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/cam-1/i)).toBeInTheDocument();
      expect(screen.getByText(/High IoU/i)).toBeInTheDocument();
    });
  });

  it('handles error state', async () => {
    axios.get.mockRejectedValueOnce(new Error('fail'));
    render(<AccidentLogs />);
    const msg = await screen.findByText(/Could not load accident archive/i);
    expect(msg).toBeInTheDocument();
  });

  it('shows empty state when no accidents', async () => {
    axios.get.mockResolvedValueOnce({ data: [] });
    render(<AccidentLogs />);
    const empty = await screen.findByText(/No accidents recorded yet/i);
    expect(empty).toBeInTheDocument();
  });

  it('renders image branch and lanes', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: 'acc-img',
          camera_name: 'cam-img',
          timestamp: 222,
          datetime: 'time',
          details: { lanes: ['L1'], reasons: [], involved_ids: [] },
          status: 'open',
          image_id: 'img123',
        },
      ],
    });
    render(<AccidentLogs />);
    await waitFor(() => {
      expect(screen.getByText(/cam-img/i)).toBeInTheDocument();
      expect(screen.getByText(/Lanes: L1/i)).toBeInTheDocument();
    });
  });

  it('renders resolved status pill', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: 'acc-res',
          camera_name: 'cam-res',
          timestamp: 333,
          datetime: 'time',
          details: {},
          status: 'resolved',
          image_id: null,
        },
      ],
    });
    render(<AccidentLogs />);
    await waitFor(() => {
      expect(screen.getByText(/resolved/i)).toBeInTheDocument();
    });
  });

  it('updates status and deletes', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: 'acc1',
          camera_name: 'cam-1',
          timestamp: 123,
          datetime: 'now',
          details: {},
          status: 'open',
          image_id: null,
        },
      ],
    });
    axios.patch.mockResolvedValue({ data: {} });
    axios.delete.mockResolvedValue({ data: {} });

    render(<AccidentLogs />);
    const resolveBtn = await screen.findByText(/Resolve/i);
    fireEvent.click(resolveBtn);

    const deleteBtn = await screen.findByTitle(/Delete log/i);
    fireEvent.click(deleteBtn);
    // allow async handlers to settle
    await waitFor(() => {});
  });
});
