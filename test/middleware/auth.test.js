/**
 * Unit tests for authenticateToken middleware
 */

jest.mock('../../src/utils/jwtManager', () => ({
  verifyToken: jest.fn()
}));

const { authenticateToken } = require('../../src/middleware/auth');
const jwtManager = require('../../src/utils/jwtManager');
const { createMockReq, createMockRes, createMockNext } = require('../helpers/mockReqRes');

describe('authenticateToken middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = createMockReq({ headers: {} });
    res = createMockRes();
    next = createMockNext();
  });

  it('should return 401 when authorization header is missing', async () => {
    await authenticateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'unauthorized' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 when token is empty', async () => {
    req.headers['authorization'] = 'Bearer ';
    await authenticateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 for expired token', async () => {
    req.headers['authorization'] = 'Bearer expired-token';
    const expiredError = new Error('Token expired');
    expiredError.name = 'TokenExpiredError';
    jwtManager.verifyToken.mockRejectedValue(expiredError);

    await authenticateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token', error_description: 'Token has expired' })
    );
  });

  it('should return 403 for invalid token', async () => {
    req.headers['authorization'] = 'Bearer invalid-token';
    jwtManager.verifyToken.mockRejectedValue(new Error('Invalid token'));

    await authenticateToken(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_token' })
    );
  });

  it('should set req.user and call next on valid token', async () => {
    req.headers['authorization'] = 'Bearer valid-token';
    jwtManager.verifyToken.mockResolvedValue({ id: 'testuser', name: 'Test' });

    await authenticateToken(req, res, next);
    expect(req.user).toEqual({ id: 'testuser', name: 'Test' });
    expect(next).toHaveBeenCalled();
  });

  it('should extract token correctly from Bearer scheme', async () => {
    req.headers['authorization'] = 'Bearer my-jwt-token-123';
    jwtManager.verifyToken.mockResolvedValue({ id: 'user1' });

    await authenticateToken(req, res, next);
    expect(jwtManager.verifyToken).toHaveBeenCalledWith('my-jwt-token-123');
  });
});
