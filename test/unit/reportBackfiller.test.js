/**
 * Unit tests for the on-demand report URL backfill (reportBackfiller).
 */

// Mock modules that load conf/*.json at require-time
jest.mock('../../src/utils/dbManager', () => ({
  listRequestsWithoutReportUrl: jest.fn(),
  updateRequestReportData: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/utils/requestsManager', () => ({
  buildJSON: jest.fn()
}));

jest.mock('../../src/utils/snapshotReportsManager', () => ({
  createReport: jest.fn()
}));

jest.mock('../../src/utils/userManager', () => ({
  getUserById: jest.fn()
}));

jest.mock('../../src/utils/s3Storage', () => ({
  getGenshareResponseFile: jest.fn(),
  getApiResponseFile: jest.fn(),
  uploadBatchToS3: jest.fn().mockResolvedValue(undefined),
  s3Config: { s3Folder: 'snapshot' }
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));

const dbManager = require('../../src/utils/dbManager');
const requestsManager = require('../../src/utils/requestsManager');
const snapshotReportsManager = require('../../src/utils/snapshotReportsManager');
const userManager = require('../../src/utils/userManager');
const s3Storage = require('../../src/utils/s3Storage');

const {
  Outcome,
  readStoredReportUrl,
  backfillOne,
  backfillReportUrls
} = require('../../src/utils/reportBackfiller');

const REQUEST_ID = '16d2bb78c7901c527b8e1b43b8f38b5c';
const RESPONSE_ARRAY = [
  { name: 'article_id', description: 'Article ID', value: 'KWG1234' },
  { name: 'cumulated_score', description: 'Cumulated score from snapshot', value: 21 }
];

const makeRow = (overrides = {}) => ({
  user_name: 'acme',
  article_id: 'KWG1234',
  request_id: REQUEST_ID,
  report_data: null,
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();

  userManager.getUserById.mockReturnValue({
    id: 'acme',
    reports: { defaultVersion: 'v3' }
  });
  s3Storage.getGenshareResponseFile.mockResolvedValue({ response: RESPONSE_ARRAY });
  s3Storage.getApiResponseFile.mockResolvedValue(null);
  snapshotReportsManager.createReport.mockResolvedValue({
    url: 'https://snapshot-reports.dataseer.ai/r/abc',
    is_new: true
  });
  requestsManager.buildJSON.mockReturnValue({
    article_id: 'KWG1234',
    report_link: 'https://snapshot-reports.dataseer.ai/r/abc'
  });
});

describe('readStoredReportUrl', () => {
  it('returns null when there is no report_data', () => {
    expect(readStoredReportUrl(null)).toBeNull();
    expect(readStoredReportUrl('')).toBeNull();
  });

  it('returns null when the blob carries no report_link', () => {
    expect(readStoredReportUrl(JSON.stringify({ article_id: 'KWG1234' }))).toBeNull();
  });

  it('treats a malformed blob as "no report URL"', () => {
    expect(readStoredReportUrl('{not json')).toBeNull();
  });

  it('returns the stored URL when present', () => {
    const blob = JSON.stringify({ report_link: 'https://reports/r/x' });
    expect(readStoredReportUrl(blob)).toBe('https://reports/r/x');
  });
});

describe('backfillOne — dry run', () => {
  it('reports would_create and writes nothing', async () => {
    const result = await backfillOne(makeRow(), { dryRun: true });

    expect(result.outcome).toBe(Outcome.WOULD_CREATE);
    expect(result.report_kind).toBe('v3');
    expect(snapshotReportsManager.createReport).not.toHaveBeenCalled();
    expect(dbManager.updateRequestReportData).not.toHaveBeenCalled();
    expect(s3Storage.uploadBatchToS3).not.toHaveBeenCalled();
  });
});

describe('backfillOne — skips', () => {
  it('never replaces an existing report URL', async () => {
    const row = makeRow({
      report_data: JSON.stringify({ report_link: 'https://reports/r/existing' })
    });

    const result = await backfillOne(row, { dryRun: false });

    expect(result.outcome).toBe(Outcome.SKIPPED_HAS_REPORT);
    expect(result.report_url).toBe('https://reports/r/existing');
    expect(snapshotReportsManager.createReport).not.toHaveBeenCalled();
    expect(dbManager.updateRequestReportData).not.toHaveBeenCalled();
  });

  it('skips a user with no configured report kind', async () => {
    userManager.getUserById.mockReturnValue({ id: 'acme', reports: {} });

    const result = await backfillOne(makeRow(), { dryRun: false });

    expect(result.outcome).toBe(Outcome.SKIPPED_NO_REPORT_KIND);
    expect(snapshotReportsManager.createReport).not.toHaveBeenCalled();
  });

  it('skips a user missing from the users configuration', async () => {
    userManager.getUserById.mockImplementation(() => {
      throw new Error('User acme not found');
    });

    const result = await backfillOne(makeRow(), { dryRun: false });

    expect(result.outcome).toBe(Outcome.SKIPPED_UNKNOWN_USER);
  });

  it('skips when the genshare response is missing from S3', async () => {
    s3Storage.getGenshareResponseFile.mockResolvedValue(null);

    const result = await backfillOne(makeRow(), { dryRun: false });

    expect(result.outcome).toBe(Outcome.SKIPPED_NO_GENSHARE_RESPONSE);
    expect(snapshotReportsManager.createReport).not.toHaveBeenCalled();
  });

  it('uses the override kind for a user with no default', async () => {
    userManager.getUserById.mockReturnValue({ id: 'acme', reports: {} });

    const result = await backfillOne(makeRow(), {
      dryRun: false,
      reportKindOverride: 'v3'
    });

    expect(result.outcome).toBe(Outcome.CREATED);
    expect(snapshotReportsManager.createReport).toHaveBeenCalledWith(
      'v3',
      REQUEST_ID,
      expect.anything()
    );
  });
});

describe('backfillOne — apply', () => {
  it('creates the report and persists it to the DB and S3', async () => {
    const result = await backfillOne(makeRow(), { dryRun: false });

    expect(result.outcome).toBe(Outcome.CREATED);
    expect(result.report_url).toBe('https://snapshot-reports.dataseer.ai/r/abc');

    expect(requestsManager.buildJSON).toHaveBeenCalledWith(
      'v3',
      RESPONSE_ARRAY,
      'https://snapshot-reports.dataseer.ai/r/abc'
    );
    expect(dbManager.updateRequestReportData).toHaveBeenCalledWith(REQUEST_ID, {
      article_id: 'KWG1234',
      report_link: 'https://snapshot-reports.dataseer.ai/r/abc'
    });

    const uploadedKeys = s3Storage.uploadBatchToS3.mock.calls
      .flatMap(([files]) => files)
      .map((f) => f.key);
    expect(uploadedKeys).toContain(`snapshot/acme/${REQUEST_ID}/report/report.json`);
  });

  it('injects report_link into the archived API response when absent', async () => {
    s3Storage.getApiResponseFile.mockResolvedValue({
      status: 200,
      data: [{ name: 'article_id', description: 'Article ID', value: 'KWG1234' }]
    });

    const result = await backfillOne(makeRow(), { dryRun: false });

    expect(result.api_response_patched).toBe(true);

    const responseUpload = s3Storage.uploadBatchToS3.mock.calls
      .flatMap(([files]) => files)
      .find((f) => f.key === `snapshot/acme/${REQUEST_ID}/response.json`);
    expect(responseUpload).toBeDefined();

    const written = JSON.parse(responseUpload.data);
    expect(written.data).toContainEqual({
      name: 'report_link',
      description: 'Report link',
      value: 'https://snapshot-reports.dataseer.ai/r/abc'
    });
  });

  it('leaves an archived response that already has report_link untouched', async () => {
    s3Storage.getApiResponseFile.mockResolvedValue({
      status: 200,
      data: [{ name: 'report_link', description: 'Report link', value: 'https://reports/r/old' }]
    });

    const result = await backfillOne(makeRow(), { dryRun: false });

    expect(result.api_response_patched).toBe(false);
    const keys = s3Storage.uploadBatchToS3.mock.calls
      .flatMap(([files]) => files)
      .map((f) => f.key);
    expect(keys).not.toContain(`snapshot/acme/${REQUEST_ID}/response.json`);
  });

  it('reports a failure when snapshot-reports is still down', async () => {
    snapshotReportsManager.createReport.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const result = await backfillOne(makeRow(), { dryRun: false });

    expect(result.outcome).toBe(Outcome.FAILED);
    expect(result.reason).toBe('connect ECONNREFUSED');
    expect(dbManager.updateRequestReportData).not.toHaveBeenCalled();
  });

  it('fails instead of storing an Error when buildJSON rejects the report kind', async () => {
    requestsManager.buildJSON.mockReturnValue(new Error("Report version 'v3' not found"));

    const result = await backfillOne(makeRow(), { dryRun: false });

    expect(result.outcome).toBe(Outcome.FAILED);
    expect(result.reason).toContain('not found');
    expect(dbManager.updateRequestReportData).not.toHaveBeenCalled();
  });
});

describe('backfillReportUrls — scopes', () => {
  it('requires exactly one scope', async () => {
    await expect(backfillReportUrls({})).rejects.toThrow('Exactly one scope');
    await expect(backfillReportUrls({ userId: 'acme', all: true })).rejects.toThrow(
      'Exactly one scope'
    );
  });

  it('rejects a malformed request id', async () => {
    await expect(backfillReportUrls({ requestId: 'nope' })).rejects.toThrow(
      'Invalid request ID format'
    );
  });

  it('summarises a mixed run', async () => {
    dbManager.listRequestsWithoutReportUrl.mockResolvedValue([
      makeRow(),
      makeRow({ request_id: 'a'.repeat(32), user_name: 'other' })
    ]);
    userManager.getUserById
      .mockReturnValueOnce({ id: 'acme', reports: { defaultVersion: 'v3' } })
      .mockReturnValueOnce({ id: 'other', reports: {} });

    const summary = await backfillReportUrls({ all: true, dryRun: false });

    expect(summary.scope).toBe('all');
    expect(summary.scanned).toBe(2);
    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('passes the scope through to the DB query', async () => {
    dbManager.listRequestsWithoutReportUrl.mockResolvedValue([]);

    await backfillReportUrls({ userId: 'acme', limit: 10 });

    expect(dbManager.listRequestsWithoutReportUrl).toHaveBeenCalledWith({
      requestId: null,
      userId: 'acme',
      limit: 10
    });
  });
});
