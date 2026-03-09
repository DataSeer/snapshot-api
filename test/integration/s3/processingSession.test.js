/**
 * Integration tests for ProcessingSession with real S3
 * Requires conf/aws.s3.test.json with valid credentials
 * Tests the full saveToS3() flow
 */

const { setupTestEnv, validateTestConfigs } = require('../../helpers/testConfig');
const { validateTestPrefix, cleanupTestPrefix, generateTestRequestId } = require('../../helpers/testS3');

// Set up test environment before requiring modules
setupTestEnv();

// Validate required configs exist
let configError = null;
try {
  validateTestConfigs(['aws.s3.test.json']);
} catch (err) {
  configError = err;
}

if (configError) {
  describe('ProcessingSession Integration', () => {
    test.skip('SKIPPED: ' + configError.message, () => {});
  });
} else {

const {
  ProcessingSession,
  getFile,
  listObjects,
  deleteObjectsByPrefix,
  s3Config
} = require('../../../src/utils/s3Storage');

// Safety check
validateTestPrefix(s3Config);

const testUserId = 's3-session-test';
const testRequestId = generateTestRequestId();
let session;

afterAll(async () => {
  // Clean up all test objects for this user
  await cleanupTestPrefix(
    deleteObjectsByPrefix,
    `${s3Config.s3Folder}/${testUserId}/`
  );
});

describe('ProcessingSession Integration', () => {
  describe('Basic Session', () => {
    test('should create a session with correct base path', () => {
      session = new ProcessingSession(testUserId, testRequestId);
      expect(session.requestId).toBe(testRequestId);
      expect(session.userId).toBe(testUserId);
      expect(session.getBasePath()).toBe(`${s3Config.s3Folder}/${testUserId}/${testRequestId}`);
    });

    test('should save process.json and process.log to S3', async () => {
      session.setSnapshotAPIVersion('v3.11.0');
      session.setOrigin('direct');
      session.setAPIRequest({ body: { article_id: 'TEST-001' } });
      session.setAPIResponse({ status: 200, data: { result: 'ok' } });

      const returnedId = await session.saveToS3();
      expect(returnedId).toBe(testRequestId);

      // Verify process.json exists
      const processJson = await getFile(`${session.getBasePath()}/process.json`);
      const processData = JSON.parse(processJson);
      expect(processData.snapshotAPIVersion).toBe('v3.11.0');
      expect(processData.origin.type).toBe('direct');
      expect(processData.duration).toBeDefined();

      // Verify process.log exists
      const processLog = await getFile(`${session.getBasePath()}/process.log`);
      expect(processLog).toContain('[S3] Session started');
      expect(processLog).toContain('[S3] Session ended');
    });

    test('should store API request/response JSON', async () => {
      const requestJson = await getFile(`${session.getBasePath()}/request.json`);
      const requestData = JSON.parse(requestJson);
      expect(requestData.body.article_id).toBe('TEST-001');

      const responseJson = await getFile(`${session.getBasePath()}/response.json`);
      const responseData = JSON.parse(responseJson);
      expect(responseData.status).toBe(200);
    });
  });

  describe('Session with GenShare', () => {
    let genshareSession;
    let gsRequestId;

    beforeAll(async () => {
      gsRequestId = generateTestRequestId();
      genshareSession = new ProcessingSession(testUserId, gsRequestId);

      genshareSession.setSnapshotAPIVersion('v3.11.0');
      genshareSession.setOrigin('direct');
      genshareSession.initGenShare('v81.3.0');
      genshareSession.setGenshareRequest({
        url: 'http://genshare:5001/snapshot',
        method: 'POST',
        fields: { article_id: 'GS-TEST-001' }
      });
      genshareSession.setGenshareResponse({
        status: 200,
        data: { results: [{ score: 0.95 }] }
      });

      await genshareSession.saveToS3();
    });

    test('should store genshare metadata', async () => {
      const metadataJson = await getFile(`${genshareSession.getBasePath()}/genshare/metadata.json`);
      const metadata = JSON.parse(metadataJson);
      expect(metadata.isActive).toBe(true);
      expect(metadata.version).toBe('v81.3.0');
    });

    test('should store genshare request', async () => {
      const requestJson = await getFile(`${genshareSession.getBasePath()}/genshare/request.json`);
      const request = JSON.parse(requestJson);
      expect(request.url).toContain('/snapshot');
      expect(request.fields.article_id).toBe('GS-TEST-001');
    });

    test('should store genshare response', async () => {
      const responseJson = await getFile(`${genshareSession.getBasePath()}/genshare/response.json`);
      const response = JSON.parse(responseJson);
      expect(response.status).toBe(200);
      expect(response.data.results[0].score).toBe(0.95);
    });
  });

  describe('Session with Report', () => {
    let reportSession;
    let reportRequestId;

    beforeAll(async () => {
      reportRequestId = generateTestRequestId();
      reportSession = new ProcessingSession(testUserId, reportRequestId);

      reportSession.setSnapshotAPIVersion('v3.11.0');
      reportSession.setReport({
        reportId: 'rpt-001',
        reportUrl: 'https://example.com/report',
        version: 'Generic (v0.1)'
      });

      await reportSession.saveToS3();
    });

    test('should store report data', async () => {
      const reportJson = await getFile(`${reportSession.getBasePath()}/report/report.json`);
      const report = JSON.parse(reportJson);
      expect(report.reportId).toBe('rpt-001');
      expect(report.version).toBe('Generic (v0.1)');
    });
  });

  describe('Session generates correct S3 paths', () => {
    test('should use test prefix in all paths', async () => {
      const objects = await listObjects(`${s3Config.s3Folder}/${testUserId}/`);
      expect(objects.length).toBeGreaterThan(0);
      objects.forEach(obj => {
        expect(obj.Key.startsWith(s3Config.s3Folder)).toBe(true);
      });
    });
  });
});

} // end if (!configError)
