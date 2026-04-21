import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AlertsPage from '../pages/AlertsPage';
import axios from 'axios';

jest.mock('axios');

describe('AlertsPage', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.delete.mockReset();
  });

  it('renders heading and fetched alert', async () => {
    axios.get.mockResolvedValueOnce({
      data: [
        {
          id: 'a1',
          message: 'Accident detected',
          camera_name: 'cam-1',
          created_at: 123,
        },
      ],
    });
    axios.delete.mockResolvedValue({ data: {} });

    render(<AlertsPage />);
    expect(screen.getByText(/Alerts Feed/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Accident detected/i)).toBeInTheDocument();
    });
  });

  it('shows error state on fetch failure', async () => {
    axios.get.mockRejectedValueOnce(new Error('fail'));
    render(<AlertsPage />);
    const error = await screen.findByText(/Unable to load alerts/i);
    expect(error).toBeInTheDocument();
  });

  it('deletes an alert', async () => {
    axios.get.mockResolvedValueOnce({
      data: [{ id: 'a1', message: 'Accident detected', camera_name: 'cam-1', created_at: 123 }],
    });
    axios.delete.mockResolvedValueOnce({ data: {} });

    render(<AlertsPage />);
    const deleteBtn = await screen.findByTitle(/Delete alert/i);
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalled();
    });
  });

  it('handles delete failure gracefully', async () => {
    axios.get.mockResolvedValueOnce({
      data: [{ id: 'a2', message: 'Congestion detected', camera_name: 'cam-2', created_at: 456 }],
    });
    axios.delete.mockRejectedValueOnce(new Error('fail'));
    render(<AlertsPage />);
    const deleteBtn = await screen.findByTitle(/Delete alert/i);
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(axios.delete).toHaveBeenCalled();
    });
  });
});
