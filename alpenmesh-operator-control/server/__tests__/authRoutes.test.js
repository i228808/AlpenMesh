const express = require('express');
const request = require('supertest');

jest.mock('../controllers/authController', () => ({
  registerUser: jest.fn((req, res) => res.status(201).json({ ok: true })),
  loginUser: jest.fn((req, res) => res.status(200).json({ ok: true })),
}));

jest.mock('../middleware/authMiddleware', () => ({
  protect: jest.fn((req, _res, next) => {
    req.user = { role: 'admin' };
    next();
  }),
}));

jest.mock('../middleware/roleMiddleware', () => ({
  role: jest.fn(() => (req, _res, next) => next()),
}));

const authRoutes = require('../routes/authRoutes');

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
};

describe('authRoutes', () => {
  test('register route calls controller', async () => {
    const res = await request(buildApp())
      .post('/api/auth/register')
      .send({ username: 'u', email: 'e', password: 'p' });
    expect(res.status).toBe(201);
  });

  test('login route calls controller', async () => {
    const res = await request(buildApp())
      .post('/api/auth/login')
      .send({ email: 'e', password: 'p' });
    expect(res.status).toBe(200);
  });

  test('admin route passes through protect and role', async () => {
    const res = await request(buildApp()).get('/api/auth/admin');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Admin access granted');
  });
});

