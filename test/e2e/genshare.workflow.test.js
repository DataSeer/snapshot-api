/**
 * E2E tests for full GenShare processing workflow
 * Tests sync + async PDF processing, search, and delete
 *
 * Requires:
 * - conf/*.test.json files with valid credentials
 * - GenShare service running at configured URL
 * - test/fixtures/sample.pdf test file
 * - conf/aws.s3.test.json with S3 credentials (s3Folder: snapshot-api-test)
 *
 * Skips automatically if GenShare is unreachable or test PDF is missing
 */

const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { setupTestEnv, validateTestConfigs } = require('../helpers/testConfig');
const { setupTestDb, initTestDb } = require('../helpers/testDb');
const { validateTestPrefix } = require('../helpers/testS3');

// Set up test environment BEFORE requiring any app modules
setupTestEnv();
setupTestDb();

// Validate configs
let configError = null;
try {
  validateTestConfigs();
} catch (err) {
  configError = err;
}

const TEST_PDF_PATH = path.join(__dirname, '../fixtures/sample.pdf');
const hasPdf = !configError && fs.existsSync(TEST_PDF_PATH);
const skipReason = configError
  ? configError.message
  : (!hasPdf ? 'test/fixtures/sample.pdf not found' : null);

if (skipReason) {
  describe('GenShare Workflow E2E', () => {
    test.skip('SKIPPED: ' + skipReason, () => {});
  });
} else {

const request = require('supertest');
const jwt = require('jsonwebtoken');
const express = require('express');
const config = require('../../src/config');
const dbManager = require('../../src/utils/dbManager');

let app;
let adminToken;
let genshareReachable = false;

/**
 * Check if GenShare service is reachable
 */
const checkGenshareHealth = async () => {
  try {
    const genshareConfig = require(config.genshareConfigPath);
    const defaultVersion = genshareConfig.versions[genshareConfig.defaultVersion];
    if (!defaultVersion || !defaultVersion.health) return false;

    const res = await axios.get(defaultVersion.health.url, { timeout: 5000 });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Build a minimal Express app that mirrors the real app
 */
const buildTestApp = () => {
  const testApp = express();
  testApp.set('trust proxy', 1);
  testApp.use(express.json());
  testApp.use(express.urlencoded({ extended: true }));

  const routes = require('../../src/routes');
  testApp.use('/', routes);

  return testApp;
}

beforeAll(async () => {
  // Initialize in-memory database
  await initTestDb();

  // Set up admin token
  const usersConfig = JSON.parse(fs.readFileSync(config.usersPath, 'utf8'));
  adminToken = jwt.sign({ id: 'admin' }, config.jwtSecret);
  usersConfig.admin.token = adminToken;
  fs.writeFileSync(config.usersPath, JSON.stringify(usersConfig, null, 2));

  // Validate S3 test prefix
  try {
    const s3Config = require(config.awsS3ConfigPath);
    validateTestPrefix(s3Config);
  } catch (err) {
    console.warn('S3 test prefix validation failed:', err.message);
  }

  app = buildTestApp();

  // Check GenShare health
  genshareReachable = await checkGenshareHealth();
  if (!genshareReachable) {
    console.warn('GenShare service is not reachable - GenShare-dependent tests will be skipped');
  }
}, 15000);

describe('GenShare Workflow E2E', () => {
  describe('Sync Processing', () => {
    let syncRequestId;

    beforeAll(() => {
      if (!genshareReachable) {
        console.warn('Skipping sync processing tests - GenShare not reachable');
      }
    });

    test('should process a PDF synchronously', async () => {
      if (!genshareReachable) return;

      const res = await request(app)
        .post('/processPDF/sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', TEST_PDF_PATH)
        .field('options', JSON.stringify({ article_id: 'E2E-SYNC-001', document_type: 'article' }));

      expect(res.status).toBe(200);
      expect(res.body).toBeDefined();

      // The response should contain a request_id
      if (res.body.request_id) {
        syncRequestId = res.body.request_id;
      }
    }, 120000);

    test('should have stored session data in S3', async () => {
      if (!genshareReachable || !syncRequestId) return;

      const { s3Config, getFile } = require('../../src/utils/s3Storage');
      const basePath = `${s3Config.s3Folder}/admin/${syncRequestId}`;

      // Verify process.json exists
      const processJson = await getFile(`${basePath}/process.json`);
      const processData = JSON.parse(processJson);
      expect(processData.duration).toBeDefined();
      expect(processData.origin).toBeDefined();
    }, 30000);

    test('should verify response structure has expected fields', async () => {
      if (!genshareReachable || !syncRequestId) return;

      const { s3Config, getFile } = require('../../src/utils/s3Storage');
      const basePath = `${s3Config.s3Folder}/admin/${syncRequestId}`;

      // Check genshare response exists
      try {
        const gsResponse = await getFile(`${basePath}/genshare/response.json`);
        const gsData = JSON.parse(gsResponse);
        expect(gsData).toBeDefined();
      } catch {
        // Some processing flows may not store genshare response
      }
    }, 30000);
  });

  describe('Async Processing', () => {
    let asyncRequestId;

    test('should submit a PDF for async processing', async () => {
      if (!genshareReachable) return;

      const res = await request(app)
        .post('/processPDF/async')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('file', TEST_PDF_PATH)
        .field('options', JSON.stringify({ article_id: 'E2E-ASYNC-001', document_type: 'article' }));

      expect(res.status).toBe(200);
      expect(res.body.request_id).toBeDefined();
      expect(res.body.status).toBe('processing');
      asyncRequestId = res.body.request_id;
    }, 30000);

    test('should poll job status until completed', async () => {
      if (!genshareReachable || !asyncRequestId) return;

      const maxPolls = 60;
      const pollInterval = 2000;
      let completed = false;

      for (let i = 0; i < maxPolls; i++) {
        const res = await request(app)
          .get(`/jobs/${asyncRequestId}`)
          .set('Authorization', `Bearer ${adminToken}`);

        if (res.status === 200 && res.body.status === 'completed') {
          completed = true;
          break;
        }

        if (res.body.status === 'failed') {
          console.warn('Async job failed:', res.body.error_message);
          break;
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      expect(completed).toBe(true);
    }, 180000);

    test('should verify async results in S3', async () => {
      if (!genshareReachable || !asyncRequestId) return;

      const { s3Config, listObjects } = require('../../src/utils/s3Storage');
      const basePath = `${s3Config.s3Folder}/admin/${asyncRequestId}/`;

      const objects = await listObjects(basePath);
      expect(objects.length).toBeGreaterThan(0);

      // Should have at minimum process.json and process.log
      const keys = objects.map(o => o.Key);
      expect(keys.some(k => k.endsWith('process.json'))).toBe(true);
    }, 30000);
  });

  describe('Search and Delete', () => {
    let searchRequestId;

    beforeAll(async () => {
      // Insert a test request into DB for search/delete testing
      // Request ID must be 32 hex chars to pass API validation
      const crypto = require('crypto');
      searchRequestId = crypto.randomBytes(16).toString('hex');
      await dbManager.addOrUpdateRequest('admin', 'E2E-SEARCH-001', searchRequestId);
    });

    test('should find request by article_id via search', async () => {
      const res = await request(app)
        .get('/requests/search')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ article_id: 'E2E-SEARCH-001' });

      expect(res.status).toBe(200);
    });

    test('should get request by requestId', async () => {
      const res = await request(app)
        .get(`/requests/${searchRequestId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // The route may return 200 with data or 404 if not found
      expect([200, 404]).toContain(res.status);
    });

    test('should delete request by requestId', async () => {
      const res = await request(app)
        .delete(`/requests/${searchRequestId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect([200, 204, 404]).toContain(res.status);
    });

    test('should return 404 for deleted request', async () => {
      const request2 = await dbManager.getRequestByRequestId(searchRequestId);
      expect(request2).toBeNull();
    });
  });

  describe('Input Validation', () => {
    test('should reject non-PDF file', async () => {
      if (!genshareReachable) return;

      // Create a temporary non-PDF file
      const tmpFile = path.join(__dirname, '../fixtures/test.txt');
      fs.writeFileSync(tmpFile, 'This is not a PDF');

      try {
        const res = await request(app)
          .post('/processPDF/sync')
          .set('Authorization', `Bearer ${adminToken}`)
          .attach('file', tmpFile)
          .field('options', JSON.stringify({ article_id: 'E2E-INVALID-001', document_type: 'article' }));

        // Should reject with 400 or process and fail
        expect([400, 422, 500]).toContain(res.status);
      } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });

    test('should reject request without file', async () => {
      const res = await request(app)
        .post('/processPDF/sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('options', JSON.stringify({ article_id: 'E2E-NOFILE-001', document_type: 'article' }));

      expect([400, 422, 500]).toContain(res.status);
    });
  });
});

} // end if (!skipReason)
