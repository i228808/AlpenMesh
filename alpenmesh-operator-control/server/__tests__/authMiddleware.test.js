const jwt = require('jsonwebtoken');

jest.mock('../models/User', () => ({
  findById: jest.fn(),
}));

const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('protect middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('no token returns 401', async () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();
    await protect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('invalid token returns 401', async () => {
    const req = { headers: { authorization: 'Bearer bad' } };
    const res = mockRes();
    const next = jest.fn();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(jwt, 'verify').mockImplementation(() => {
      throw new Error('bad');
    });
    await protect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('valid token attaches user and calls next', async () => {
    const req = { headers: { authorization: 'Bearer good' } };
    const res = mockRes();
    const next = jest.fn();
    jest.spyOn(jwt, 'verify').mockReturnValue({ id: 'user123' });
    User.findById.mockReturnValueOnce({
      select: jest.fn().mockResolvedValue({ id: 'user123', role: 'admin' }),
    });
    await protect(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
  });
});

