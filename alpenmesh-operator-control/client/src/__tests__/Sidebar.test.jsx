import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '../components/ui/Sidebar';
import AuthContext from '../context/AuthContext';

const renderSidebar = () =>
  render(
    <AuthContext.Provider
      value={{ user: { username: 'tester', role: 'admin' }, logout: jest.fn() }}
    >
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </AuthContext.Provider>,
  );

describe('Sidebar', () => {
  it('renders key nav links', () => {
    renderSidebar();
    expect(screen.getByText(/Operator Control/i)).toBeInTheDocument();
    expect(screen.getByText(/Camera Map/i)).toBeInTheDocument();
    expect(screen.getByText(/Congestion Logs/i)).toBeInTheDocument();
    expect(screen.getByText(/Accident Logs/i)).toBeInTheDocument();
    expect(screen.getByText(/Alerts/i)).toBeInTheDocument();
  });
});
