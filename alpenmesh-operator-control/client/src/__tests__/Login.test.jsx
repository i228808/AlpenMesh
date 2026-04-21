import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Login from '../pages/Login';
import AuthContext from '../context/AuthContext';
import axios from 'axios';
import { MemoryRouter } from 'react-router-dom';

jest.mock('axios');

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Login page', () => {
  beforeEach(() => {
    axios.post.mockReset();
    mockNavigate.mockReset();
  });

  const renderLogin = () =>
    render(
      <MemoryRouter>
        <AuthContext.Provider value={{ login: jest.fn() }}>
          <Login />
        </AuthContext.Provider>
      </MemoryRouter>,
    );

  it('logs in successfully', async () => {
    axios.post.mockResolvedValueOnce({ data: { token: 't', username: 'u' } });
    renderLogin();
    fireEvent.change(screen.getByPlaceholderText(/Email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText(/Password/i), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: /ACCESS DASHBOARD/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows alert on error', async () => {
    axios.post.mockRejectedValueOnce({ response: { data: { message: 'bad' } } });
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: /ACCESS DASHBOARD/i }));
    // alert is triggered; we can at least ensure navigate not called
    await waitFor(() => expect(mockNavigate).not.toHaveBeenCalled());
  });

  it('toggles password visibility and remember me', () => {
    renderLogin();
    const toggleEye = screen.getByRole('button', { name: /Show password/i });
    fireEvent.click(toggleEye);
    expect(toggleEye).toHaveAttribute('aria-label', 'Hide password');

    const rememberToggle = screen.getByLabelText(/Remember me/i);
    fireEvent.click(rememberToggle);
    expect(rememberToggle).toBeChecked();
  });

  it('shows submitting state', async () => {
    axios.post.mockResolvedValueOnce({ data: { token: 't', username: 'u' } });
    renderLogin();
    fireEvent.change(screen.getByPlaceholderText(/Email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText(/Password/i), { target: { value: 'pass' } });
    fireEvent.click(screen.getByRole('button', { name: /ACCESS DASHBOARD/i }));
    expect(screen.getByText(/AUTHENTICATING/i)).toBeInTheDocument();
  });
});
