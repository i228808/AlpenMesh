import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import Register from '../pages/Register';
import axios from 'axios';
import { MemoryRouter } from 'react-router-dom';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

jest.mock('axios');

describe('Register page', () => {
  beforeEach(() => {
    axios.post.mockReset();
    mockNavigate.mockReset();
  });

  const fillFormAndSubmit = () => {
    fireEvent.change(screen.getByPlaceholderText(/Username/i), { target: { value: 'user' } });
    fireEvent.change(screen.getByPlaceholderText(/Email/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText(/Password/i), { target: { value: 'pass' } });
    const roleSelect = screen.getByRole('combobox');
    fireEvent.change(roleSelect, { target: { value: 'operator' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Account/i }));
  };

  it('registers successfully and navigates', async () => {
    axios.post.mockResolvedValueOnce({ data: {} });
    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>,
    );
    fillFormAndSubmit();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
  });

  it('shows error on failure', async () => {
    axios.post.mockRejectedValueOnce({ response: { data: { message: 'fail' } } });
    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>,
    );
    fillFormAndSubmit();
    await waitFor(() => expect(mockNavigate).not.toHaveBeenCalled());
  });

  it('toggles password visibility', () => {
    render(
      <MemoryRouter>
        <Register />
      </MemoryRouter>,
    );
    const toggleEye = screen.getByRole('button', { name: /Show password/i });
    fireEvent.click(toggleEye);
    expect(toggleEye).toHaveAttribute('aria-label', 'Hide password');
  });
});
