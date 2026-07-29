/**
 * Unit tests for checkPermissions middleware
 */

jest.mock('../../src/utils/permissionsManager', () => ({
  getPermissions: jest.fn(),
  normalizeUrl: jest.fn((url) => url === '/' ? url : url.replace(/\/$/, ''))
}));

const { checkPermissions } = require('../../src/middleware/permissions');
const { getPermissions } = require('../../src/utils/permissionsManager');
const { createMockReq, createMockRes, createMockNext } = require('../helpers/mockReqRes');

describe('checkPermissions middleware', () => {
  let req, res, next;

  const mockPermissions = {
    '/processPDF': {
      POST: {
        allowed: ['testuser', 'KWG'],
        blocked: ['blockeduser']
      }
    },
    '/processPDF/async': {
      POST: {
        allowed: [],
        blocked: ['blockeduser']
      }
    },
    '/jobs/:requestId': {
      GET: {
        allowed: [],
        blocked: []
      }
    }
  };

  beforeEach(() => {
    req = createMockReq({ path: '/processPDF', method: 'POST' });
    res = createMockRes();
    next = createMockNext();
    getPermissions.mockReturnValue(mockPermissions);
  });

  it('should call next() for allowed user on direct route match', () => {
    checkPermissions(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should return 403 for blocked user', () => {
    req.user = { id: 'blockeduser' };
    checkPermissions(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('blocked') })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 403 for unauthorized user on restricted route', () => {
    req.user = { id: 'unknownuser' };
    checkPermissions(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 404 for unconfigured route', () => {
    req.path = '/nonexistent';
    checkPermissions(req, res, next);
    expect(res.sendStatus).toHaveBeenCalledWith(404);
  });

  it('should return 405 for unconfigured method on existing route', () => {
    req.method = 'DELETE';
    checkPermissions(req, res, next);
    expect(res.sendStatus).toHaveBeenCalledWith(405);
  });

  it('should allow any non-blocked user when allowed list is empty', () => {
    req.path = '/processPDF/async';
    req.user = { id: 'anyuser' };
    checkPermissions(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('should match parameterized routes', () => {
    req.path = '/jobs/abc-123';
    req.method = 'GET';
    req.user = { id: 'anyuser' };
    checkPermissions(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
