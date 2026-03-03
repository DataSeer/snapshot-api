/**
 * Unit tests for processPDF and processPDFAsync controllers
 */

const { createMockSession } = require('../../mocks/processingSession.mock');
const { createMockReq, createMockRes } = require('../../helpers/mockReqRes');
const {
  MOCK_PDF_FILE,
  MOCK_SUPPLEMENTARY_ZIP,
  MOCK_SUPPLEMENTARY_INVALID,
  VALID_OPTIONS_QAEF,
  VALID_OPTIONS_QAEN,
  VALID_OPTIONS_MINIMAL,
  MOCK_GENSHARE_RESPONSE
} = require('../../fixtures/testData');

// Create mock session instance
let mockSessionInstance;

// Mock modules that load conf/*.json at require-time
jest.mock('../../../src/utils/s3Storage', () => ({
  ProcessingSession: jest.fn().mockImplementation(() => {
    return mockSessionInstance;
  })
}));

jest.mock('../../../src/utils/genshareManager', () => ({
  processPDF: jest.fn(),
  appendToSummary: jest.fn(),
  handleGenshareJobCompletion: jest.fn(),
  handleGenshareJobFailure: jest.fn(),
  processGenshareSubmissionJob: jest.fn()
}));

jest.mock('../../../src/utils/queueManager', () => ({
  JobType: { GENSHARE_SUBMISSION: 'genshare_submission' },
  enqueueJob: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../../src/utils/userManager', () => ({
  getUserById: jest.fn().mockReturnValue({ id: 'testuser', name: 'Test' }),
  isAdmin: jest.fn().mockReturnValue(false)
}));

// Mock fs.promises.unlink to avoid real file deletion
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

const { processPDF, processPDFAsync } = require('../../../src/controllers/genshareController');
const genshareManager = require('../../../src/utils/genshareManager');
const queueManager = require('../../../src/utils/queueManager');
const fs = require('fs');

describe('processPDF (sync)', () => {
  let req, res;

  beforeEach(() => {
    mockSessionInstance = createMockSession();
    req = createMockReq({
      files: {
        file: [{ ...MOCK_PDF_FILE }]
      },
      body: {
        options: JSON.stringify(VALID_OPTIONS_MINIMAL)
      }
    });
    res = createMockRes();

    genshareManager.processPDF.mockResolvedValue(MOCK_GENSHARE_RESPONSE);
    genshareManager.appendToSummary.mockResolvedValue(undefined);
  });

  // --- Happy path ---

  it('should create a ProcessingSession with user id', async () => {
    const { ProcessingSession } = require('../../../src/utils/s3Storage');
    await processPDF(req, res);
    expect(ProcessingSession).toHaveBeenCalledWith('testuser');
  });

  it('should set origin as direct', async () => {
    await processPDF(req, res);
    expect(mockSessionInstance.setOrigin).toHaveBeenCalledWith('direct');
  });

  it('should store API request metadata', async () => {
    await processPDF(req, res);
    expect(mockSessionInstance.setAPIRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/processPDF'
      })
    );
  });

  it('should extract main file from req.files', async () => {
    await processPDF(req, res);
    expect(mockSessionInstance.addFile).toHaveBeenCalledWith(
      expect.objectContaining({ originalname: 'R36382-63891157.pdf' }),
      'api'
    );
  });

  it('should call genshareManager.processPDF with correct data', async () => {
    await processPDF(req, res);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({ originalname: 'R36382-63891157.pdf' }),
        user: { id: 'testuser' },
        options: expect.objectContaining({ article_id: 'TEST-2026-0001' })
      }),
      mockSessionInstance
    );
  });

  it('should return response with status 200 and data', async () => {
    await processPDF(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      response: MOCK_GENSHARE_RESPONSE.data
    });
  });

  it('should set response headers from genshare result', async () => {
    await processPDF(req, res);
    expect(res.set).toHaveBeenCalledWith('content-type', 'application/json');
  });

  it('should save session to S3', async () => {
    await processPDF(req, res);
    expect(mockSessionInstance.saveToS3).toHaveBeenCalled();
  });

  it('should store API response in session', async () => {
    await processPDF(req, res);
    expect(mockSessionInstance.setAPIResponse).toHaveBeenCalledWith({
      status: 200,
      data: MOCK_GENSHARE_RESPONSE.data
    });
  });

  it('should clean up temporary files after processing', async () => {
    await processPDF(req, res);
    expect(fs.promises.unlink).toHaveBeenCalledWith('tmp/mock-file.pdf');
  });

  // --- File handling ---

  it('should handle no supplementary file', async () => {
    req.files = { file: [{ ...MOCK_PDF_FILE }] };
    await processPDF(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({ supplementary_file: null }),
      mockSessionInstance
    );
  });

  it('should handle valid ZIP supplementary file', async () => {
    req.files = {
      file: [{ ...MOCK_PDF_FILE }],
      supplementary_file: [{ ...MOCK_SUPPLEMENTARY_ZIP }]
    };
    await processPDF(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSessionInstance.addFile).toHaveBeenCalledTimes(2);
  });

  it('should reject non-ZIP supplementary file with 400', async () => {
    req.files = {
      file: [{ ...MOCK_PDF_FILE }],
      supplementary_file: [{ ...MOCK_SUPPLEMENTARY_INVALID }]
    };
    await processPDF(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('ZIP') })
    );
  });

  it('should clean up files when supplementary file validation fails', async () => {
    req.files = {
      file: [{ ...MOCK_PDF_FILE }],
      supplementary_file: [{ ...MOCK_SUPPLEMENTARY_INVALID }]
    };
    await processPDF(req, res);
    expect(fs.promises.unlink).toHaveBeenCalledWith(MOCK_PDF_FILE.path);
    expect(fs.promises.unlink).toHaveBeenCalledWith(MOCK_SUPPLEMENTARY_INVALID.path);
  });

  it('should handle no files at all', async () => {
    req.files = null;
    await processPDF(req, res);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({ file: null, supplementary_file: null }),
      mockSessionInstance
    );
  });

  // --- Options parsing ---

  it('should parse JSON string options', async () => {
    req.body.options = JSON.stringify({ article_id: 'ABC-123' });
    await processPDF(req, res);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ article_id: 'ABC-123' })
      }),
      mockSessionInstance
    );
  });

  it('should handle undefined options as empty object', async () => {
    req.body = {};
    await processPDF(req, res);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({ options: {} }),
      mockSessionInstance
    );
  });

  it('should handle malformed JSON options gracefully', async () => {
    req.body.options = '{invalid json}';
    await processPDF(req, res);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({ options: {} }),
      mockSessionInstance
    );
  });

  it('should handle pre-parsed object options', async () => {
    req.body.options = { article_id: 'PRE-PARSED' };
    await processPDF(req, res);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ article_id: 'PRE-PARSED' })
      }),
      mockSessionInstance
    );
  });

  // --- Editorial policy ---

  it('should set SURR editorial_policy for KWG user with QAEF article', async () => {
    req.user = { id: 'KWG' };
    req.body.options = JSON.stringify(VALID_OPTIONS_QAEF);
    await processPDF(req, res);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ editorial_policy: 'SURR' })
      }),
      mockSessionInstance
    );
  });

  it('should set TFOD editorial_policy for KWG user with QAEN article', async () => {
    req.user = { id: 'KWG' };
    req.body.options = JSON.stringify(VALID_OPTIONS_QAEN);
    await processPDF(req, res);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ editorial_policy: 'TFOD' })
      }),
      mockSessionInstance
    );
  });

  it('should NOT set editorial_policy for non-KWG user', async () => {
    req.user = { id: 'otheruser' };
    req.body.options = JSON.stringify(VALID_OPTIONS_QAEF);
    await processPDF(req, res);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.not.objectContaining({ editorial_policy: expect.anything() })
      }),
      mockSessionInstance
    );
  });

  // --- Error handling ---

  it('should return 500 when genshareManager.processPDF throws', async () => {
    genshareManager.processPDF.mockRejectedValue(new Error('Processing failed'));
    await processPDF(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('GenShare returned an error');
  });

  it('should save error session to S3', async () => {
    genshareManager.processPDF.mockRejectedValue(new Error('Processing failed'));
    await processPDF(req, res);
    expect(mockSessionInstance.setAPIResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', error: 'Processing failed' })
    );
    expect(mockSessionInstance.saveToS3).toHaveBeenCalled();
  });

  it('should clean up files on error', async () => {
    genshareManager.processPDF.mockRejectedValue(new Error('fail'));
    await processPDF(req, res);
    expect(fs.promises.unlink).toHaveBeenCalled();
  });

  it('should forward error.response.status if available', async () => {
    const error = new Error('Bad gateway');
    error.response = { status: 502 };
    genshareManager.processPDF.mockRejectedValue(error);
    await processPDF(req, res);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it('should handle appendToSummary failure gracefully', async () => {
    genshareManager.processPDF.mockRejectedValue(new Error('fail'));
    genshareManager.appendToSummary.mockRejectedValue(new Error('sheet error'));
    await processPDF(req, res);
    // Should still return error response
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should include additional body fields in processingData', async () => {
    req.body.notification_url = 'https://example.com/callback';
    await processPDF(req, res);
    expect(genshareManager.processPDF).toHaveBeenCalledWith(
      expect.objectContaining({ notification_url: 'https://example.com/callback' }),
      mockSessionInstance
    );
  });
});

describe('processPDFAsync', () => {
  let req, res;

  beforeEach(() => {
    mockSessionInstance = createMockSession();
    req = createMockReq({
      files: {
        file: [{ ...MOCK_PDF_FILE }]
      },
      body: {
        options: JSON.stringify(VALID_OPTIONS_MINIMAL),
        notification_url: 'https://example.com/callback'
      }
    });
    res = createMockRes();

    queueManager.enqueueJob.mockResolvedValue(true);
  });

  // --- Happy path ---

  it('should create a ProcessingSession with user id', async () => {
    const { ProcessingSession } = require('../../../src/utils/s3Storage');
    await processPDFAsync(req, res);
    expect(ProcessingSession).toHaveBeenCalledWith('testuser');
  });

  it('should set origin as direct', async () => {
    await processPDFAsync(req, res);
    expect(mockSessionInstance.setOrigin).toHaveBeenCalledWith('direct');
  });

  it('should save initial session to S3 before enqueueing', async () => {
    await processPDFAsync(req, res);
    expect(mockSessionInstance.saveToS3).toHaveBeenCalled();
  });

  it('should enqueue job with correct data', async () => {
    await processPDFAsync(req, res);
    expect(queueManager.enqueueJob).toHaveBeenCalledWith(
      mockSessionInstance.requestId,
      'genshare_submission',
      expect.objectContaining({
        file: expect.objectContaining({ originalname: 'R36382-63891157.pdf' }),
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

  it('should return processing status with request_id', async () => {
    await processPDFAsync(req, res);
    expect(res.json).toHaveBeenCalledWith({
      status: 'processing',
      request_id: mockSessionInstance.requestId
    });
  });

  it('should NOT clean up temp files on success (job processor handles them)', async () => {
    await processPDFAsync(req, res);
    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });

  // --- Queue data ---

  it('should include file metadata in queue data', async () => {
    await processPDFAsync(req, res);
    expect(queueManager.enqueueJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        file: expect.objectContaining({
          path: MOCK_PDF_FILE.path,
          originalname: MOCK_PDF_FILE.originalname,
          mimetype: MOCK_PDF_FILE.mimetype,
          size: MOCK_PDF_FILE.size
        })
      }),
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('should set supplementary_file to null when not provided', async () => {
    req.files = { file: [{ ...MOCK_PDF_FILE }] };
    await processPDFAsync(req, res);
    expect(queueManager.enqueueJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ supplementary_file: null }),
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('should reject non-ZIP supplementary file with 400', async () => {
    req.files = {
      file: [{ ...MOCK_PDF_FILE }],
      supplementary_file: [{ ...MOCK_SUPPLEMENTARY_INVALID }]
    };
    await processPDFAsync(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('ZIP') })
    );
  });

  // --- Editorial policy for async ---

  it('should set editorial_policy for KWG user in async', async () => {
    req.user = { id: 'KWG' };
    req.body.options = JSON.stringify(VALID_OPTIONS_QAEF);
    await processPDFAsync(req, res);
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
    await processPDFAsync(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('enqueue') })
    );
  });

  it('should clean up temp files on error', async () => {
    queueManager.enqueueJob.mockRejectedValue(new Error('Queue error'));
    await processPDFAsync(req, res);
    expect(fs.promises.unlink).toHaveBeenCalledWith(MOCK_PDF_FILE.path);
  });

  it('should log error in session on failure', async () => {
    queueManager.enqueueJob.mockRejectedValue(new Error('Queue error'));
    await processPDFAsync(req, res);
    expect(mockSessionInstance.addLog).toHaveBeenCalledWith(
      expect.stringContaining('Queue error')
    );
  });

  it('should handle no files gracefully', async () => {
    req.files = null;
    await processPDFAsync(req, res);
    expect(queueManager.enqueueJob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ file: null, supplementary_file: null }),
      undefined,
      undefined,
      expect.any(Function),
      expect.any(Function)
    );
  });
});
