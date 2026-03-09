/**
 * Integration tests for queueManager with real in-memory SQLite
 * Tests the queue lifecycle (enqueue, status transitions, retries)
 */

const { setupTestDb, initTestDb } = require('../../helpers/testDb');

// Set up in-memory DB and test env before requiring modules
setupTestDb();
process.env.NODE_ENV = 'test';

const dbManager = require('../../../src/utils/dbManager');

beforeAll(async () => {
  await initTestDb();
});

describe('Queue Manager - Job Lifecycle', () => {
  const baseRequestId = 'qm-lifecycle';

  test('should enqueue a job and create a pending record', async () => {
    const job = await dbManager.addJobToQueue(
      `${baseRequestId}-001`,
      'genshare_submission',
      { userId: 'testuser', articleId: 'ART-100', filePath: '/tmp/test.pdf' },
      3,
      5
    );

    expect(job).not.toBeNull();
    expect(job.status).toBe('pending');
    expect(job.request_id).toBe(`${baseRequestId}-001`);
    expect(job.job_type).toBe('genshare_submission');
    expect(job.retries).toBe(0);
    expect(job.max_retries).toBe(3);
  });

  test('should store job data as JSON', async () => {
    const job = await dbManager.getJobByRequestId(`${baseRequestId}-001`);
    const data = JSON.parse(job.data);
    expect(data).toEqual({
      userId: 'testuser',
      articleId: 'ART-100',
      filePath: '/tmp/test.pdf'
    });
  });

  test('should transition job from pending to processing', async () => {
    await dbManager.updateJobStatus(`${baseRequestId}-001`, 'processing');
    const job = await dbManager.getJobByRequestId(`${baseRequestId}-001`);
    expect(job.status).toBe('processing');
  });

  test('should transition job from processing to failed with error', async () => {
    await dbManager.updateJobStatus(`${baseRequestId}-001`, 'failed', 'GenShare timeout');
    const job = await dbManager.getJobByRequestId(`${baseRequestId}-001`);
    expect(job.status).toBe('failed');
    expect(job.error_message).toBe('GenShare timeout');
  });

  test('should reset failed job back to pending for retry', async () => {
    const reset = await dbManager.resetJobForRetry(`${baseRequestId}-001`);
    expect(reset).toBe(true);

    const job = await dbManager.getJobByRequestId(`${baseRequestId}-001`);
    expect(job.status).toBe('pending');
    expect(job.error_message).toBeNull();
  });

  test('should increment retry count', async () => {
    await dbManager.incrementJobRetries(`${baseRequestId}-001`);
    const job = await dbManager.getJobByRequestId(`${baseRequestId}-001`);
    expect(job.retries).toBe(1);
  });

  test('should complete job with completion data', async () => {
    await dbManager.updateJobStatus(`${baseRequestId}-001`, 'processing');
    const completionData = { s3Url: 'https://s3.example.com/result', score: 0.87 };
    await dbManager.updateJobStatus(`${baseRequestId}-001`, 'completed', null, completionData);

    const job = await dbManager.getJobByRequestId(`${baseRequestId}-001`);
    expect(job.status).toBe('completed');
    expect(JSON.parse(job.completion_data)).toEqual(completionData);
  });

  test('should respect priority ordering in next pending job', async () => {
    // Add low and high priority jobs
    await dbManager.addJobToQueue(`${baseRequestId}-low`, 'genshare_submission', {}, 3, 1);
    await dbManager.addJobToQueue(`${baseRequestId}-high`, 'genshare_submission', {}, 3, 20);

    const next = await dbManager.getNextPendingJob();
    expect(next).not.toBeNull();
    expect(next.request_id).toBe(`${baseRequestId}-high`);

    // Cleanup
    await dbManager.deleteJobByRequestId(`${baseRequestId}-low`);
    await dbManager.deleteJobByRequestId(`${baseRequestId}-high`);
    await dbManager.deleteJobByRequestId(`${baseRequestId}-001`);
  });
});
