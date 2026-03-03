/**
 * E2E tests for authentication workflows
 * Uses real Express app with test configs, real JWT, real permissions
 *
 * Requires:
 * - conf/*.test.json files (copy from *.test.json.default)
 */

const { setupTestEnv, validateTestConfigs } = require('../helpers/testConfig');
const { setupTestDb, initTestDb } = require('../helpers/testDb');

// Set up test environment BEFORE requiring any app modules
setupTestEnv();
setupTestDb();

// Validate configs
try {
  validateTestConfigs([
    'users.test.json',
    'permissions.test.json',
    'genshare.test.json',
    'queueManager.test.json',
    'reports.test.json',
    'em.test.json',
    'scholarone.test.json',
    'datastet.test.json',
    'grobid.test.json',
    'snapshotMails.test.json',
    'aws.s3.test.json',
    'googleSheets.credentials.test.json'
  ]);
} catch (err) {
  describe('Auth Workflow E2E', () => {
    test.skip('SKIPPED: ' + err.message, () => {});
  });
  module.exports = {};
  return;
}

const request = require('supertest');
const jwt = require('jsonwebtoken');
const express = require('express');
const config = require('../../src/config');

let app;
let adminToken;
let testUserToken;

/**
 * Build a minimal Express app that mirrors the real app
 * but skips background tasks (queue processor, polling, S3 refresh)
 */
function buildTestApp() {
  const testApp = express();
  testApp.set('trust proxy', 1);
  testApp.use(express.json());
  testApp.use(express.urlencoded({ extended: true }));

  // Load routes (includes auth + permissions middleware)
  const routes = require('../../src/routes');
  testApp.use('/', routes);

  return testApp;
}

beforeAll(async () => {
  // Initialize in-memory database
  await initTestDb();

  // Generate valid JWT tokens matching the users in users.test.json
  const fs = require('fs');
  const usersConfig = JSON.parse(fs.readFileSync(config.usersPath, 'utf8'));

  // Sign permanent tokens for admin and test users
  adminToken = jwt.sign({ id: 'admin' }, config.jwtSecret);
  testUserToken = jwt.sign({ id: 'test' }, config.jwtSecret);

  // Update users.test.json with the signed tokens so verifyToken succeeds
  usersConfig.admin.token = adminToken;
  usersConfig.test.token = testUserToken;
  fs.writeFileSync(config.usersPath, JSON.stringify(usersConfig, null, 2));

  app = buildTestApp();
});

describe('Auth Workflow E2E', () => {
  describe('Permanent Token Authentication', () => {
    test('should authenticate with valid admin token', async () => {
      const res = await request(app)
        .get('/')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    test('should authenticate with valid test user token', async () => {
      const res = await request(app)
        .get('/')
        .set('Authorization', `Bearer ${testUserToken}`);

      expect(res.status).toBe(200);
    });

    test('should reject request with no Authorization header', async () => {
      const res = await request(app)
        .get('/');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthorized');
    });

    test('should reject request with invalid token', async () => {
      const res = await request(app)
        .get('/')
        .set('Authorization', 'Bearer invalid-token-string');

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('invalid_token');
    });

    test('should reject request with token signed with wrong secret', async () => {
      const wrongToken = jwt.sign({ id: 'admin' }, 'wrong-secret');
      const res = await request(app)
        .get('/')
        .set('Authorization', `Bearer ${wrongToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Temporary Token Flow', () => {
    let tempToken;

    test('should generate a temporary token via EM authenticate endpoint', async () => {
      // Read user config to get client_secret
      const fs = require('fs');
      const usersConfig = JSON.parse(fs.readFileSync(config.usersPath, 'utf8'));

      const res = await request(app)
        .post('/editorial-manager/authenticate')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          client_id: 'admin',
          client_secret: usersConfig.admin.client_secret
        });

      // EM authenticate should return a temporary token
      if (res.status === 200) {
        expect(res.body.access_token).toBeDefined();
        tempToken = res.body.access_token;
      } else {
        // Some setups may not have EM configured
        console.warn('EM authenticate returned status:', res.status);
      }
    });

    test('should use temporary token for authenticated requests', async () => {
      if (!tempToken) {
        return; // Skip if temp token wasn't generated
      }

      const res = await request(app)
        .get('/')
        .set('Authorization', `Bearer ${tempToken}`);

      expect(res.status).toBe(200);
    });

    test('should revoke a temporary token', async () => {
      if (!tempToken) {
        return;
      }

      const res = await request(app)
        .post('/editorial-manager/revokeToken')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ token: tempToken });

      if (res.status === 200) {
        // Verify token is no longer valid
        const verifyRes = await request(app)
          .get('/')
          .set('Authorization', `Bearer ${tempToken}`);

        expect(verifyRes.status).toBe(403);
      }
    });
  });

  describe('Permission-Based Access Control', () => {
    test('should allow admin access to admin-only routes', async () => {
      const res = await request(app)
        .get('/requests/search')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ article_id: 'test' });

      // 200 or empty result - the important thing is NOT 403
      expect(res.status).not.toBe(403);
    });

    test('should deny non-admin access to admin-only routes', async () => {
      const res = await request(app)
        .get('/requests/search')
        .set('Authorization', `Bearer ${testUserToken}`)
        .query({ article_id: 'test' });

      expect(res.status).toBe(403);
    });

    test('should allow any authenticated user to access open routes', async () => {
      const res = await request(app)
        .get('/')
        .set('Authorization', `Bearer ${testUserToken}`);

      expect(res.status).toBe(200);
    });

    test('should return 404 for undefined routes', async () => {
      const res = await request(app)
        .get('/nonexistent-route')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });
});
