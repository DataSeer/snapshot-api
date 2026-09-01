/**
 * Unit tests for the per-user rate limiter.
 *
 * Behaviour under test:
 * - `max: 0`  -> every request is rejected with 429
 * - `windowMs: 0` -> rate limiting is disabled
 * - anything else -> `max` requests per window, then 429
 */

// Mock userManager: it loads conf/users.json at require-time
jest.mock('../../src/utils/userManager', () => ({
  getUserById: jest.fn()
}));

const express = require('express');
const request = require('supertest');
const userManager = require('../../src/utils/userManager');

const USERS = {};

/**
 * Build an express app with a fresh limiter (and therefore a fresh store).
 * @param {Object} [options] - Test options
 * @param {boolean} [options.authenticated] - Attach req.user when true
 * @returns {Object} An express app exposing GET /
 */
const buildApp = ({ authenticated = true } = {}) => {
  jest.resetModules();
  jest.doMock('../../src/utils/userManager', () => ({
    getUserById: (userId) => {
      if (!USERS[userId]) throw new Error(`User ${userId} not found`);
      return { id: userId, ...USERS[userId] };
    }
  }));

  // eslint-disable-next-line global-require
  const rateLimiter = require('../../src/utils/rateLimiter');
  const app = express();

  if (authenticated) app.use((req, res, next) => {
    req.user = { id: req.get('x-test-user') };
    next();
  });

  app.use(rateLimiter);
  app.get('/', (req, res) => res.status(200).send('OK'));

  return app;
};

/**
 * Issue `count` requests as `userId` and collect the status codes.
 * @param {Object} app - Express app
 * @param {string} userId - User making the requests
 * @param {number} count - Number of requests to issue
 * @returns {Promise<Array<number>>} The status codes, in order
 */
const call = async (app, userId, count) => {
  const statuses = [];

  for (let i = 0; i < count; i++) {
    const res = await request(app).get('/').set('x-test-user', userId);
    statuses.push(res.status);
  }

  return statuses;
};

beforeEach(() => {
  Object.keys(USERS).forEach((key) => delete USERS[key]);
  userManager.getUserById.mockReset();
});

describe('rateLimiter - max: 0', () => {
  it('rejects every request with 429', async () => {
    USERS.blocked = { rateLimit: { max: 0, windowMs: 900000 } };

    expect(await call(buildApp(), 'blocked', 5)).toEqual([429, 429, 429, 429, 429]);
  });

  it('never lets a single request through, even the first one', async () => {
    USERS.blocked = { rateLimit: { max: 0, windowMs: 900000 } };
    const res = await request(buildApp()).get('/').set('x-test-user', 'blocked');

    expect(res.status).toBe(429);
    expect(res.text).not.toBe('OK');
  });

  it('returns the user message and the rate limit headers', async () => {
    USERS.blocked = { rateLimit: { max: 0, windowMs: 900000, message: 'Access suspended.' } };
    const res = await request(buildApp()).get('/').set('x-test-user', 'blocked');

    expect(res.text).toBe('Access suspended.');
    expect(res.headers['x-ratelimit-limit']).toBe('0');
    expect(res.headers['x-ratelimit-remaining']).toBe('0');
    expect(res.headers['retry-after']).toBe('900');
  });

  it('falls back to the default message when the user defines none', async () => {
    USERS.blocked = { rateLimit: { max: 0, windowMs: 900000 } };
    const res = await request(buildApp()).get('/').set('x-test-user', 'blocked');

    expect(res.text).toBe('Too many requests, please try again later.');
  });

  it('is overridden by windowMs: 0 (disabled wins over blocked)', async () => {
    USERS.unlimited = { rateLimit: { max: 0, windowMs: 0 } };

    expect(await call(buildApp(), 'unlimited', 4)).toEqual([200, 200, 200, 200]);
  });
});

describe('rateLimiter - regular limits', () => {
  it('allows max requests then answers 429', async () => {
    USERS.limited = { rateLimit: { max: 2, windowMs: 900000 } };

    expect(await call(buildApp(), 'limited', 4)).toEqual([200, 200, 429, 429]);
  });

  it('uses the per-user message once the limit is reached', async () => {
    USERS.limited = { rateLimit: { max: 1, windowMs: 900000, message: 'Slow down.' } };
    const app = buildApp();

    await request(app).get('/').set('x-test-user', 'limited');
    const res = await request(app).get('/').set('x-test-user', 'limited');

    expect(res.status).toBe(429);
    expect(res.text).toBe('Slow down.');
  });

  it('counts each user separately', async () => {
    USERS.a = { rateLimit: { max: 1, windowMs: 900000 } };
    USERS.b = { rateLimit: { max: 1, windowMs: 900000 } };
    const app = buildApp();

    expect(await call(app, 'a', 2)).toEqual([200, 429]);
    expect(await call(app, 'b', 1)).toEqual([200]);
  });

  it('defaults to 100 requests when max is not configured', async () => {
    USERS.nomax = { rateLimit: { windowMs: 900000 } };

    expect(await call(buildApp(), 'nomax', 3)).toEqual([200, 200, 200]);
  });

  it('does not rate limit a user with windowMs: 0', async () => {
    USERS.unlimited = { rateLimit: { max: 1, windowMs: 0 } };

    expect(await call(buildApp(), 'unlimited', 5)).toEqual([200, 200, 200, 200, 200]);
  });
});

describe('rateLimiter - unknown user', () => {
  it('applies the default limit instead of failing with a 500', async () => {
    const res = await request(buildApp()).get('/').set('x-test-user', 'deleted-user');

    expect(res.status).toBe(200);
  });

  it('applies the default limit to unauthenticated requests', async () => {
    const res = await request(buildApp({ authenticated: false })).get('/');

    expect(res.status).toBe(200);
  });
});
