const jwt = require('jsonwebtoken');

jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  create: jest.fn(),
}));

const User = require('../models/User');
const { registerUser, loginUser } = require('../controllers/authController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('authController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('registerUser returns 400 when fields missing', async () => {
    const req = { body: { username: '', email: '', password: '' } };
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('registerUser rejects existing user', async () => {
    User.findOne.mockResolvedValueOnce({ id: 1 });
    const req = { body: { username: 'u', email: 'e', password: 'p' } };
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'User already exists' });
  });

  test('registerUser creates user', async () => {
    User.findOne.mockResolvedValueOnce(null);
    User.create.mockResolvedValueOnce({ id: '1', _id: '1', username: 'u', email: 'e', role: 'basic' });
    const req = { body: { username: 'u', email: 'e', password: 'p' } };
    const res = mockRes();
    await registerUser(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ username: 'u', token: expect.any(String) }));
  });

  test('loginUser invalid credentials', async () => {
    User.findOne.mockResolvedValueOnce(null);
    const req = { body: { email: 'e', password: 'p' } };
    const res = mockRes();
    await loginUser(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('loginUser success', async () => {
    User.findOne.mockResolvedValueOnce({
      id: '1',
      username: 'u',
      email: 'e',
      role: 'basic',
      matchPassword: jest.fn().mockResolvedValue(true),
    });
    const req = { body: { email: 'e', password: 'p' } };
    const res = mockRes();
    await loginUser(req, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ username: 'u', token: expect.any(String) }));
  });
});

