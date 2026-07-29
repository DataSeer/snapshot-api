/**
 * Integration tests for POST /processPDF/async
 * Uses Supertest with a minimal Express app that mocks auth/permissions
 * but exercises the real controller
 */

const { createMockSession } = require('../mocks/processingSession.mock');
const { VALID_OPTIONS_MINIMAL, VALID_OPTIONS_QAEF } = require('../fixtures/testData');

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
const { processPDFAsync } = require('../../src/controllers/genshareController');
const queueManager = require('../../src/utils/queueManager');

const TINY_PDF = Buffer.from('%PDF-1.4 test content');

describe('Integration: POST /processPDF/async', () => {
  let app, request;

  beforeEach(() => {
    mockSessionInstance = createMockSession();
    queueManager.enqueueJob.mockResolvedValue(true);

    app = createTestApp({
      user: { id: 'testuser' },
      controller: processPDFAsync,
      method: 'post',
      path: '/processPDF/async'
    });
    request = supertest(app);
  });

  // --- Auth failures ---

  it('should return 401 when auth is skipped', async () => {
    app = createTestApp({
      skipAuth: true,
      controller: processPDFAsync,
      path: '/processPDF/async'
    });

    const res = await supertest(app)
      .post('/processPDF/async')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(res.status).toBe(401);
  });

  it('should return 403 when permissions block user', async () => {
    app = createTestApp({
      blockPermissions: true,
      controller: processPDFAsync,
      path: '/processPDF/async'
    });

    const res = await supertest(app)
      .post('/processPDF/async')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(res.status).toBe(403);
  });

  // --- Happy path ---

  it('should return processing status with request_id', async () => {
    const res = await request
      .post('/processPDF/async')
      .attach('file', TINY_PDF, 'test.pdf')
      .field('options', JSON.stringify(VALID_OPTIONS_MINIMAL));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'processing');
    expect(res.body).toHaveProperty('request_id', mockSessionInstance.requestId);
  });

  it('should enqueue job with correct data', async () => {
    await request
      .post('/processPDF/async')
      .attach('file', TINY_PDF, 'test.pdf')
      .field('options', JSON.stringify(VALID_OPTIONS_MINIMAL))
      .field('notification_url', 'https://example.com/callback');

    expect(queueManager.enqueueJob).toHaveBeenCalledWith(
      mockSessionInstance.requestId,
      'genshare_submission',
      expect.objectContaining({
        file: expect.objectContaining({ originalname: 'test.pdf' }),
        options: expect.objectContaining({ article_id: 'TEST-2026-0001' }),
        user_id: 'testuser',
        notification_url: 'https://example.com/callback'
      }),
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('should save initial session to S3', async () => {
    await request
      .post('/processPDF/async')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(mockSessionInstance.saveToS3).toHaveBeenCalled();
  });

  // --- Editorial policy ---

  it('should set SURR for KWG user with QAEF article', async () => {
    app = createTestApp({
      user: { id: 'KWG' },
      controller: processPDFAsync,
      path: '/processPDF/async'
    });

    await supertest(app)
      .post('/processPDF/async')
      .attach('file', TINY_PDF, 'test.pdf')
      .field('options', JSON.stringify(VALID_OPTIONS_QAEF));

    expect(queueManager.enqueueJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        options: expect.objectContaining({ editorial_policy: 'SURR' })
      }),
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function)
    );
  });

  // --- Error handling ---

  it('should return 500 when enqueueJob fails', async () => {
    queueManager.enqueueJob.mockRejectedValue(new Error('Queue error'));

    const res = await request
      .post('/processPDF/async')
      .attach('file', TINY_PDF, 'test.pdf');

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  // --- No file ---

  it('should handle request with no file', async () => {
    const res = await request
      .post('/processPDF/async')
      .field('options', JSON.stringify(VALID_OPTIONS_MINIMAL));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'processing');
  });

  it('should handle request without notification_url', async () => {
    await request
      .post('/processPDF/async')
      .attach('file', TINY_PDF, 'test.pdf')
      .field('options', JSON.stringify(VALID_OPTIONS_MINIMAL));

    expect(queueManager.enqueueJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ notification_url: undefined }),
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function)
    );
  });
});
