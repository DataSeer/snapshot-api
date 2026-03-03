/**
 * Integration tests for POST /processPDF and POST /processPDF/sync
 * Uses Supertest with a minimal Express app that mocks auth/permissions
 * but exercises the real controller + middleware chain
 */

const fs = require('fs');

const { createMockSession } = require('../mocks/processingSession.mock');
const {
  MOCK_GENSHARE_RESPONSE,
  VALID_OPTIONS_QAEF,
  VALID_OPTIONS_MINIMAL
} = require('../fixtures/testData');

// Create mock session instance
let mockSessionInstance;

// Mock all modules that load conf/*.json at require-time
jest.mock('../../src/utils/s3Storage', () => ({
  ProcessingSession: jest.fn().mockImplementation(() => {
    return mockSessionInstance;
  })
}));

jest.mock('../../src/utils/genshareManager', () => ({
  processPDF: jest.fn(),
  appendToSummary: jest.fn().mockResolvedValue(undefined),
  handleGenshareJobCompletion: jest.fn(),
  handleGenshareJobFailure: jest.fn(),
  processGenshareSubmissionJob: jest.fn()
}));

jest.mock('../../src/utils/queueManager', () => ({
  JobType: { GENSHARE_SUBMISSION: 'genshare_submission' },
  enqueueJob: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/utils/userManager', () => ({
  getUserById: jest.fn().mockReturnValue({ id: 'testuser', name: 'Test' }),
  isAdmin: jest.fn().mockReturnValue(false)
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      unlink: jest.fn().mockResolvedValue(undefined)
    }
  };
});

const supertest = require('supertest');
const { createTestApp } = require('../helpers/createTestApp');
const { processPDF } = require('../../src/controllers/genshareController');
const genshareManager = require('../../src/utils/genshareManager');

// Create a small valid PDF buffer for testing
const TINY_PDF = Buffer.from('%PDF-1.4 test content');

describe('Integration: POST /processPDF (sync)', () => {
  let app, request;

  beforeEach(() => {
    mockSessionInstance = createMockSession();
    genshareManager.processPDF.mockResolvedValue(MOCK_GENSHARE_RESPONSE);

    app = createTestApp({
      user: { id: 'testuser' },
      controller: processPDF,
      method: 'post',
      path: '/processPDF'
    });
    request = supertest(app);
  });

  // --- Auth failures ---

  it('should return 401 when auth is skipped', async () => {
    app = createTestApp({
      skipAuth: true,
      controller: processPDF,
      path: '/processPDF'
    });

    const res = await supertest(app)
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('should return 403 when permissions block user', async () => {
    app = createTestApp({
      blockPermissions: true,
      controller: processPDF,
      path: '/processPDF'
    });

    const res = await supertest(app)
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(res.status).toBe(403);
  });

  // --- Valid requests ---

  it('should return 200 with response data for valid PDF', async () => {
    const res = await request
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf')
      .field('options', JSON.stringify(VALID_OPTIONS_MINIMAL));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('response');
    expect(res.body.response).toEqual(MOCK_GENSHARE_RESPONSE.data);
  });

  it('should call genshareManager.processPDF with uploaded file', async () => {
    await request
      .post('/processPDF')
      .attach('file', TINY_PDF, 'document.pdf')
      .field('options', JSON.stringify(VALID_OPTIONS_MINIMAL));

    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ originalname: 'document.pdf' }),
        options: expect.objectContaining({ article_id: 'TEST-2026-0001' })
      }),
      mockSessionInstance
    );
  });

  it('should handle request with options as form field', async () => {
    const options = { article_id: 'FORM-001', document_type: 'article' };

    const res = await request
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf')
      .field('options', JSON.stringify(options));

    expect(res.status).toBe(200);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ article_id: 'FORM-001' })
      }),
      mockSessionInstance
    );
  });

  it('should handle request without options field', async () => {
    const res = await request
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(res.status).toBe(200);
  });

  it('should save session to S3 on success', async () => {
    await request
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(mockSessionInstance.saveToS3).toHaveBeenCalled();
  });

  it('should store API request in session', async () => {
    await request
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(mockSessionInstance.setAPIRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        files: expect.any(Array)
      })
    );
  });

  // --- /processPDF/sync alias ---

  it('should work on /processPDF/sync alias', async () => {
    app = createTestApp({
      user: { id: 'testuser' },
      controller: processPDF,
      method: 'post',
      path: '/processPDF/sync'
    });

    const res = await supertest(app)
      .post('/processPDF/sync')
      .attach('file', TINY_PDF, 'test.pdf')
      .field('options', JSON.stringify(VALID_OPTIONS_MINIMAL));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('response');
  });

  // --- Supplementary file handling ---

  it('should accept valid ZIP supplementary file', async () => {
    const zipBuffer = Buffer.from('PK\x03\x04 fake zip content');

    const res = await request
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf')
      .attach('supplementary_file', zipBuffer, { filename: 'supp.zip', contentType: 'application/zip' })
      .field('options', JSON.stringify(VALID_OPTIONS_MINIMAL));

    expect(res.status).toBe(200);
  });

  // --- Error handling ---

  it('should return 500 when processPDF throws', async () => {
    genshareManager.processPDF.mockRejectedValue(new Error('Processing failed'));

    const res = await request
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(res.status).toBe(500);
  });

  it('should forward genshare error status', async () => {
    const error = new Error('Bad gateway');
    error.response = { status: 502 };
    genshareManager.processPDF.mockRejectedValue(error);

    const res = await request
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(res.status).toBe(502);
  });

  // --- Editorial policy in integration ---

  it('should set SURR for KWG user with QAEF article', async () => {
    app = createTestApp({
      user: { id: 'KWG' },
      controller: processPDF,
      path: '/processPDF'
    });

    await supertest(app)
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf')
      .field('options', JSON.stringify(VALID_OPTIONS_QAEF));

    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ editorial_policy: 'SURR' })
      }),
      mockSessionInstance
    );
  });

  // --- No file ---

  it('should handle request with no file attached', async () => {
    const res = await request
      .post('/processPDF')
      .field('options', JSON.stringify(VALID_OPTIONS_MINIMAL));

    expect(res.status).toBe(200);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({ file: null }),
      mockSessionInstance
    );
  });

  // --- Temp file cleanup ---

  it('should clean up temp files after successful processing', async () => {
    await request
      .post('/processPDF')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(fs.promises.unlink).toHaveBeenCalled();
  });
});
