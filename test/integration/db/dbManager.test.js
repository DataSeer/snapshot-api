/**
 * Integration tests for dbManager with real in-memory SQLite
 * Tests all CRUD operations against actual database
 */

const { setupTestDb, initTestDb } = require('../../helpers/testDb');

// Set up in-memory DB before requiring dbManager
setupTestDb();

const dbManager = require('../../../src/utils/dbManager');

beforeAll(async () => {
  await initTestDb();
});

describe('Database Initialization', () => {
  test('should create all 7 tables', async () => {
    const db = await dbManager.getDBConnection();
    const tables = await new Promise((resolve, reject) => {
      db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        [],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows.map(r => r.name));
        }
      );
    });
    await new Promise((resolve) => db.close(resolve));

    expect(tables).toContain('requests');
    expect(tables).toContain('temporary_tokens');
    expect(tables).toContain('editorial-manager-submissions');
    expect(tables).toContain('scholarone-submissions');
    expect(tables).toContain('scholarone-notifications');
    expect(tables).toContain('snapshot-mails-submissions');
    expect(tables).toContain('processing_jobs');
  });

  test('should be idempotent (run initDatabase again without error)', async () => {
    await expect(dbManager.initDatabase()).resolves.not.toThrow();
  });
});

describe('Token Management', () => {
  const clientId = 'test-client';
  let storedToken;

  test('should store a new token', async () => {
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now
    const id = await dbManager.storeToken(clientId, 'token-abc-123', expiresAt);
    expect(id).toBeGreaterThan(0);
    storedToken = 'token-abc-123';
  });

  test('should retrieve a valid token for client', async () => {
    const token = await dbManager.getValidToken(clientId);
    expect(token).not.toBeNull();
    expect(token.client_id).toBe(clientId);
    expect(token.token).toBe(storedToken);
    expect(token.revoked).toBe(0);
  });

  test('should validate a valid token', async () => {
    const isValid = await dbManager.isTokenValid(storedToken);
    expect(isValid).toBe(true);
  });

  test('should return false for non-existent token', async () => {
    const isValid = await dbManager.isTokenValid('non-existent-token');
    expect(isValid).toBe(false);
  });

  test('should revoke a token', async () => {
    const revoked = await dbManager.revokeToken(storedToken);
    expect(revoked).toBe(true);
  });

  test('should not validate a revoked token', async () => {
    const isValid = await dbManager.isTokenValid(storedToken);
    expect(isValid).toBe(false);
  });

  test('should not return a revoked token as valid', async () => {
    const token = await dbManager.getValidToken(clientId);
    expect(token).toBeNull();
  });

  test('should handle expired tokens', async () => {
    const pastDate = new Date(Date.now() - 1000);
    await dbManager.storeToken('expired-client', 'expired-token', pastDate);
    const isValid = await dbManager.isTokenValid('expired-token');
    expect(isValid).toBe(false);
  });

  test('should cleanup expired and revoked tokens', async () => {
    const deleted = await dbManager.cleanupExpiredTokens();
    expect(deleted).toBeGreaterThanOrEqual(1); // At least the expired + revoked tokens
  });
});

describe('Request Management', () => {
  const userName = 'testuser';
  const articleId = 'ARTICLE-001';
  const requestId = 'req-001';

  test('should insert a new request', async () => {
    const result = await dbManager.addOrUpdateRequest(userName, articleId, requestId);
    expect(result.changes).toBe(1);
  });

  test('should retrieve request by requestId', async () => {
    const request = await dbManager.getRequestByRequestId(requestId);
    expect(request).not.toBeNull();
    expect(request.user_name).toBe(userName);
    expect(request.article_id).toBe(articleId);
    expect(request.request_id).toBe(requestId);
  });

  test('should update an existing request', async () => {
    const result = await dbManager.addOrUpdateRequest(userName, 'ARTICLE-001-UPDATED', requestId);
    expect(result.changes).toBe(1);

    const request = await dbManager.getRequestByRequestId(requestId);
    expect(request.article_id).toBe('ARTICLE-001-UPDATED');
  });

  test('should update request with report data', async () => {
    const reportData = { score: 0.95, status: 'complete' };
    const result = await dbManager.addOrUpdateRequest(
      userName, articleId, requestId, reportData
    );
    expect(result.changes).toBe(1);
  });

  test('should retrieve request with parsed report data', async () => {
    const request = await dbManager.getRequestWithReportData(userName, requestId);
    expect(request).not.toBeNull();
    expect(request.report_data).toEqual({ score: 0.95, status: 'complete' });
  });

  test('should update report data separately', async () => {
    const newReport = { score: 0.98, status: 'revised' };
    const updated = await dbManager.updateRequestReportData(requestId, newReport);
    expect(updated).toBe(true);

    const request = await dbManager.getRequestWithReportData(userName, requestId);
    expect(request.report_data).toEqual(newReport);
  });

  test('should get request by articleId', async () => {
    const reqId = await dbManager.getRequestIdByArticleId(userName, articleId);
    expect(reqId).toBe(requestId);
  });

  test('should get articleId by requestId', async () => {
    const artId = await dbManager.getArticleIdByRequestId(userName, requestId);
    expect(artId).toBe(articleId);
  });

  test('should insert multiple requests for same article', async () => {
    await dbManager.addOrUpdateRequest(userName, articleId, 'req-002');
    const ids = await dbManager.getRequestIdsByArticleId(userName, articleId);
    expect(ids).toContain(requestId);
    expect(ids).toContain('req-002');
    expect(ids.length).toBe(2);
  });

  test('should get requests with report data by articleId', async () => {
    const requests = await dbManager.getRequestsWithReportDataByArticleId(userName, articleId);
    expect(requests.length).toBeGreaterThanOrEqual(1);
    expect(requests[0].article_id).toBe(articleId);
  });

  // Cross-user methods
  test('should get request by requestId (any user)', async () => {
    const request = await dbManager.getRequestWithReportDataAnyUser(requestId);
    expect(request).not.toBeNull();
    expect(request.request_id).toBe(requestId);
  });

  test('should get requestId by articleId (any user)', async () => {
    const reqId = await dbManager.getRequestIdByArticleIdAnyUser(articleId);
    expect(reqId).not.toBeNull();
  });

  test('should get articleId by requestId (any user)', async () => {
    const artId = await dbManager.getArticleIdByRequestIdAnyUser(requestId);
    expect(artId).toBe(articleId);
  });

  test('should get all requestIds by articleId (any user)', async () => {
    const ids = await dbManager.getRequestIdsByArticleIdAnyUser(articleId);
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  test('should get requests with report data by articleId (any user)', async () => {
    const requests = await dbManager.getRequestsWithReportDataByArticleIdAnyUser(articleId);
    expect(requests.length).toBeGreaterThanOrEqual(1);
  });

  test('should delete a request by requestId', async () => {
    const result = await dbManager.deleteRequest(userName, articleId, 'req-002');
    expect(result.changes).toBe(1);
  });

  test('should return null for deleted request', async () => {
    const request = await dbManager.getRequestByRequestId('req-002');
    expect(request).toBeNull();
  });
});

describe('Editorial Manager Submissions', () => {
  const requestId = 'em-req-001';

  test('should store a new EM submission', async () => {
    const id = await dbManager.storeEmSubmission(requestId, 'service-1', 'PUB-001', 'DOC-001');
    expect(id).toBeGreaterThan(0);
  });

  test('should retrieve EM submission by requestId', async () => {
    const submission = await dbManager.getEmSubmissionByRequestId(requestId);
    expect(submission).not.toBeNull();
    expect(submission.service_id).toBe('service-1');
    expect(submission.publication_code).toBe('PUB-001');
    expect(submission.document_id).toBe('DOC-001');
  });

  test('should cancel EM submission', async () => {
    const canceled = await dbManager.cancelEmSubmission(requestId);
    expect(canceled).toBe(true);

    const submission = await dbManager.getEmSubmissionByRequestId(requestId);
    expect(submission.canceled_at).not.toBeNull();
  });

  test('should delete EM submission by requestId', async () => {
    const result = await dbManager.deleteEmSubmissionByRequestId(requestId);
    expect(result.changes).toBe(1);

    const submission = await dbManager.getEmSubmissionByRequestId(requestId);
    expect(submission).toBeNull();
  });
});

describe('ScholarOne Submissions', () => {
  const requestId = 'so-req-001';
  const submissionId = 'SUB-001';

  test('should store a new ScholarOne submission', async () => {
    const id = await dbManager.storeScholaroneSubmission(requestId, 'site-1', submissionId);
    expect(id).toBeGreaterThan(0);
  });

  test('should retrieve ScholarOne submission by requestId', async () => {
    const submission = await dbManager.getScholaroneSubmissionByRequestId(requestId);
    expect(submission).not.toBeNull();
    expect(submission.site_name).toBe('site-1');
    expect(submission.submission_id).toBe(submissionId);
  });

  test('should retrieve ScholarOne submission by submissionId', async () => {
    const submission = await dbManager.getScholaroneSubmissionBySubmissionId(submissionId);
    expect(submission).not.toBeNull();
    expect(submission.request_id).toBe(requestId);
  });

  test('should cancel ScholarOne submission', async () => {
    const canceled = await dbManager.cancelScholaroneSubmission(requestId);
    expect(canceled).toBe(true);

    const submission = await dbManager.getScholaroneSubmissionByRequestId(requestId);
    expect(submission.canceled_at).not.toBeNull();
  });

  test('should delete ScholarOne submission by requestId', async () => {
    const result = await dbManager.deleteScholaroneSubmissionByRequestId(requestId);
    expect(result.changes).toBe(1);
  });
});

describe('ScholarOne Notifications', () => {
  const messageUUID = 'uuid-001';
  const submissionId = 'NOTIF-SUB-001';

  test('should insert a notification', async () => {
    const id = await dbManager.insertScholaroneNotification({
      messageUUID,
      notificationServiceVersion: '1.0',
      siteName: 'site-1',
      journalName: 'Test Journal',
      eventDate: '2026-01-01',
      subscriptionId: 1,
      subscriptionName: 'sub-1',
      subscriptionType: 'manuscript_submission',
      documentId: 123,
      submissionId,
      documentStatusName: 'submitted',
      submissionTitle: 'Test Paper',
      systemEventName: 'Author_Submit_Manuscript_Orig',
      requestId: null,
      processed: false,
      processedAt: null,
      payload: JSON.stringify({ test: true })
    });
    expect(id).toBeGreaterThan(0);
  });

  test('should retrieve notification by messageUUID', async () => {
    const notification = await dbManager.getScholaroneNotificationByMessageUUID(messageUUID);
    expect(notification).not.toBeNull();
    expect(notification.site_name).toBe('site-1');
    expect(notification.processed).toBe(0);
  });

  test('should update notification processed status', async () => {
    await dbManager.updateScholaroneNotificationProcessed(messageUUID, true, 'notif-req-001');

    const notification = await dbManager.getScholaroneNotificationByMessageUUID(messageUUID);
    expect(notification.processed).toBe(1);
    expect(notification.request_id).toBe('notif-req-001');
    expect(notification.processed_at).not.toBeNull();
  });

  test('should get notifications by submissionId', async () => {
    const notifications = await dbManager.getScholaroneNotificationsBySubmissionId(submissionId);
    expect(notifications.length).toBe(1);
    expect(notifications[0].message_uuid).toBe(messageUUID);
  });

  test('should delete notifications by requestId', async () => {
    const result = await dbManager.deleteScholaroneNotificationsByRequestId('notif-req-001');
    expect(result.changes).toBe(1);
  });
});

describe('Snapshot Mails Submissions', () => {
  const requestId = 'sm-req-001';

  test('should store a new Snapshot Mails submission', async () => {
    const id = await dbManager.storeSnapshotMailsSubmission(requestId, 'sender@test.com', 'paper.pdf');
    expect(id).toBeGreaterThan(0);
  });

  test('should retrieve submission by requestId', async () => {
    const submission = await dbManager.getSnapshotMailsSubmissionByRequestId(requestId);
    expect(submission).not.toBeNull();
    expect(submission.sender_email).toBe('sender@test.com');
    expect(submission.filename).toBe('paper.pdf');
  });

  test('should cancel submission', async () => {
    const canceled = await dbManager.cancelSnapshotMailsSubmission(requestId);
    expect(canceled).toBe(true);

    const submission = await dbManager.getSnapshotMailsSubmissionByRequestId(requestId);
    expect(submission.canceled_at).not.toBeNull();
  });

  test('should delete submission by requestId', async () => {
    const result = await dbManager.deleteSnapshotMailsSubmissionByRequestId(requestId);
    expect(result.changes).toBe(1);

    const submission = await dbManager.getSnapshotMailsSubmissionByRequestId(requestId);
    expect(submission).toBeNull();
  });
});

describe('Queue Management', () => {
  const requestId = 'queue-req-001';
  const jobData = { userId: 'testuser', articleId: 'ART-001' };

  test('should add a job to the queue', async () => {
    const job = await dbManager.addJobToQueue(requestId, 'genshare_submission', jobData, 3, 5);
    expect(job).not.toBeNull();
    expect(job.request_id).toBe(requestId);
    expect(job.status).toBe('pending');
    expect(job.priority).toBe(5);
    expect(JSON.parse(job.data)).toEqual(jobData);
  });

  test('should get job by requestId', async () => {
    const job = await dbManager.getJobByRequestId(requestId);
    expect(job).not.toBeNull();
    expect(job.status).toBe('pending');
  });

  test('should get next pending job (priority order)', async () => {
    // Add a higher priority job
    await dbManager.addJobToQueue('queue-req-002', 'genshare_submission', jobData, 3, 10);

    const next = await dbManager.getNextPendingJob();
    expect(next).not.toBeNull();
    expect(next.request_id).toBe('queue-req-002'); // Higher priority
  });

  test('should update job status to processing', async () => {
    const updated = await dbManager.updateJobStatus(requestId, 'processing');
    expect(updated).toBe(true);

    const job = await dbManager.getJobByRequestId(requestId);
    expect(job.status).toBe('processing');
  });

  test('should update job status to completed with completion data', async () => {
    const completionData = { result: 'success', score: 0.95 };
    const updated = await dbManager.updateJobStatus(requestId, 'completed', null, completionData);
    expect(updated).toBe(true);

    const job = await dbManager.getJobByRequestId(requestId);
    expect(job.status).toBe('completed');
    expect(JSON.parse(job.completion_data)).toEqual(completionData);
  });

  test('should update job status to failed with error message', async () => {
    await dbManager.updateJobStatus('queue-req-002', 'failed', 'Test error');

    const job = await dbManager.getJobByRequestId('queue-req-002');
    expect(job.status).toBe('failed');
    expect(job.error_message).toBe('Test error');
  });

  test('should increment job retries', async () => {
    const incremented = await dbManager.incrementJobRetries('queue-req-002');
    expect(incremented).toBe(true);

    const job = await dbManager.getJobByRequestId('queue-req-002');
    expect(job.retries).toBe(1);
  });

  test('should reset failed job for retry', async () => {
    const reset = await dbManager.resetJobForRetry('queue-req-002');
    expect(reset).toBe(true);

    const job = await dbManager.getJobByRequestId('queue-req-002');
    expect(job.status).toBe('pending');
    expect(job.error_message).toBeNull();
  });

  test('should get all jobs', async () => {
    const jobs = await dbManager.getAllJobs();
    expect(jobs.length).toBeGreaterThanOrEqual(2);
  });

  test('should get all jobs filtered by status', async () => {
    const completedJobs = await dbManager.getAllJobs('completed');
    expect(completedJobs.length).toBeGreaterThanOrEqual(1);
    completedJobs.forEach(job => expect(job.status).toBe('completed'));
  });

  test('should delete job by requestId', async () => {
    const result = await dbManager.deleteJobByRequestId(requestId);
    expect(result.changes).toBe(1);

    const job = await dbManager.getJobByRequestId(requestId);
    expect(job).toBeNull();
  });

  test('should delete remaining test job', async () => {
    const result = await dbManager.deleteJobByRequestId('queue-req-002');
    expect(result.changes).toBe(1);
  });
});
