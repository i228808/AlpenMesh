const { role } = require('../middleware/roleMiddleware');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('role middleware', () => {
  test('blocks unauthorized role', () => {
    const req = { user: { role: 'basic' } };
    const res = mockRes();
    const next = jest.fn();
    role('admin')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('allows authorized role', () => {
    const req = { user: { role: 'admin' } };
    const res = mockRes();
    const next = jest.fn();
    role('admin')(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

