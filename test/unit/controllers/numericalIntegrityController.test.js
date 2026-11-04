/**
 * Unit tests for the Numerical Integrity curation controller: the cache entry
 * is read from the (mocked) cache layer, the service and genshare are mocked.
 */
const { createMockReq, createMockRes } = require('../../helpers/mockReqRes');

jest.mock('../../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../../../src/utils/configWatcher', () => ({
  watchConfig: jest.fn(() => ({ defaultVersion: 'latest', versions: { latest: { processPDF: { url: 'http://genshare:5000/snapshot', apiKey: 'k' } } } }))
}));
jest.mock('../../../src/utils/cacheManager', () => ({
  isCacheEnabled: jest.fn(() => true),
  readCacheMeta: jest.fn(),
  readCacheResponseArray: jest.fn(),
  patchCacheResponse: jest.fn().mockResolvedValue({}),
  propagateResponseToRequest: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../../src/utils/dbManager', () => ({
  listCacheConsumers: jest.fn(),
  getCacheConsumerOwner: jest.fn()
}));
jest.mock('../../../src/utils/s3Storage', () => ({
  getFilesListFile: jest.fn(),
  getFileMetadataFile: jest.fn(),
  getFileBuffer: jest.fn(),
  s3Config: { s3Folder: 'folder' }
}));
jest.mock('../../../src/utils/numericalIntegrityManager', () => {
  const actual = jest.requireActual('../../../src/utils/numericalIntegrityManager');
  return {
    ...actual,
    isConfigured: jest.fn(() => true),
    getReport: jest.fn(),
    rerun: jest.fn(),
    setOverride: jest.fn(),
    removeOverride: jest.fn(),
    setNote: jest.fn(),
    revokeShare: jest.fn(),
    rotateShare: jest.fn(),
    refreshSignals: jest.fn()
  };
});

const cacheManager = require('../../../src/utils/cacheManager');
const dbManager = require('../../../src/utils/dbManager');
const s3 = require('../../../src/utils/s3Storage');
const ni = require('../../../src/utils/numericalIntegrityManager');
const controller = require('../../../src/controllers/numericalIntegrityController');

const REPORT = '12345678-1234-4123-8123-123456789012';
const response = () => [
  { name: 'positive_signals__lm', value: [{ id: 'das_present', severity: 'weak' }, { id: 'statistical_consistency', severity: 'strong' }] },
  { name: 'negative_signals__lm', value: [] },
  { name: 'statistical_report_id__lm', value: REPORT },
  { name: 'statistical_report_url__lm', value: 'https://ni.example/r/x?k=old' },
  { name: 'statistical_checks__lm', value: [] }
];
const signals = {
  report_id: REPORT,
  report_url: 'https://ni.example/r/x?k=old',
  checks: [{ id: 'grim', name: 'GRIM', verdict: 'fail', advisory: false }],
  positive: [],
  negative: [{ id: 'statistical_inconsistencies', severity: 'weak' }]
};

const req = (overrides) => createMockReq({ params: { cache_key: 'key1' }, user: { id: 'snapshot-s3-manager' }, ...overrides });

beforeEach(() => {
  cacheManager.isCacheEnabled.mockReturnValue(true);
  ni.isConfigured.mockReturnValue(true);
  cacheManager.readCacheMeta.mockResolvedValue({ pdf_hash: 'abc', graph_slug: 'TNQ' });
  cacheManager.readCacheResponseArray.mockResolvedValue(response());
  ni.refreshSignals.mockResolvedValue(signals);
});

describe('entry lookup', () => {
  test('503 when the cache layer or the service is not configured', async () => {
    cacheManager.isCacheEnabled.mockReturnValue(false);
    let res = createMockRes();
    await controller.getNumericalIntegrity(req(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    cacheManager.isCacheEnabled.mockReturnValue(true);
    ni.isConfigured.mockReturnValue(false);
    res = createMockRes();
    await controller.getNumericalIntegrity(req(), res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  test('404 for an unknown entry, 409 for an entry without a report', async () => {
    cacheManager.readCacheMeta.mockResolvedValue(null);
    let res = createMockRes();
    await controller.getNumericalIntegrity(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    cacheManager.readCacheMeta.mockResolvedValue({});
    cacheManager.readCacheResponseArray.mockResolvedValue([{ name: 'article_id', value: 'A' }]);
    res = createMockRes();
    await controller.getNumericalIntegrity(req(), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('GET answers the service report', async () => {
    ni.getReport.mockResolvedValue({ id: REPORT, status: 'done' });
    const res = createMockRes();
    await controller.getNumericalIntegrity(req(), res);
    expect(ni.getReport).toHaveBeenCalledWith(REPORT);
    expect(res.json).toHaveBeenCalledWith({ success: true, report_id: REPORT, report: { id: REPORT, status: 'done' } });
  });

  test('the service status and message are passed on', async () => {
    ni.getReport.mockRejectedValue(new ni.NumericalIntegrityError(404, 'Numerical Integrity: No report with that id.'));
    const res = createMockRes();
    await controller.getNumericalIntegrity(req(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Numerical Integrity: No report with that id.' });
  });
});

describe('override, note and share actions refresh the cached signals', () => {
  test('PUT override calls the service, genshare, patches the cache and propagates', async () => {
    ni.setOverride.mockResolvedValue({ override: { verdict: 'fail', reason: 'by hand' } });
    dbManager.getCacheConsumerOwner.mockResolvedValueOnce('user1').mockResolvedValueOnce(null);
    const res = createMockRes();
    await controller.overrideCheck(
      req({ params: { cache_key: 'key1', check: 'grim' }, body: { verdict: 'fail', reason: 'by hand', curator: 'A Curator', propagate_to: ['r1', 'r2'], patch_reason: 'curation session' } }),
      res
    );
    expect(ni.setOverride).toHaveBeenCalledWith(REPORT, 'grim', expect.objectContaining({ verdict: 'fail', reason: 'by hand' }), 'A Curator');
    expect(ni.refreshSignals).toHaveBeenCalledWith('http://genshare:5000', 'k', REPORT);
    const [key, next, audit] = cacheManager.patchCacheResponse.mock.calls[0];
    expect(key).toBe('key1');
    const by = Object.fromEntries(next.map((f) => [f.name, f.value]));
    expect(by.positive_signals__lm.map((s) => s.id)).toEqual(['das_present']);
    expect(by.negative_signals__lm.map((s) => s.id)).toEqual(['statistical_inconsistencies']);
    expect(by.statistical_checks__lm).toEqual(signals.checks);
    expect(audit.actor).toBe('snapshot-s3-manager (A Curator)');
    expect(audit.reason).toBe('curation session');
    expect(audit.propagated_to).toEqual(['r1', 'r2']);
    expect(cacheManager.propagateResponseToRequest).toHaveBeenCalledWith('user1', 'r1', next);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.override.verdict).toBe('fail');
    expect(body.skipped).toEqual([{ request_id: 'r2', reason: 'cache_key_mismatch_or_not_found' }]);
  });

  test('revoke writes a null URL into the cache', async () => {
    ni.revokeShare.mockResolvedValue({ share_url: null, share_revoked: true });
    ni.refreshSignals.mockResolvedValue({ ...signals, report_url: null });
    const res = createMockRes();
    await controller.revokeReportShare(req({ headers: { 'x-curator': 'B' } }), res);
    expect(ni.revokeShare).toHaveBeenCalledWith(REPORT, 'B');
    const next = cacheManager.patchCacheResponse.mock.calls[0][1];
    expect(next.find((f) => f.name === 'statistical_report_url__lm').value).toBeNull();
    expect(res.json.mock.calls[0][0].share_url).toBeNull();
  });

  test('a genshare failure leaves the cache untouched and answers 502', async () => {
    ni.setNote.mockResolvedValue({ note: 'n' });
    ni.refreshSignals.mockRejectedValue(new ni.NumericalIntegrityError(502, 'genshare did not answer: refused'));
    const res = createMockRes();
    await controller.setReportNote(req({ body: { note: 'n' } }), res);
    expect(res.status).toHaveBeenCalledWith(502);
    expect(cacheManager.patchCacheResponse).not.toHaveBeenCalled();
  });
});

describe('re-run and refresh', () => {
  test('rerun reads the PDF of a consumer with the right hash and answers 202', async () => {
    dbManager.listCacheConsumers.mockResolvedValue([
      { request_id: 'r-old', user_name: 'u1' },
      { request_id: 'r-ok', user_name: 'u2' }
    ]);
    s3.getFilesListFile.mockImplementation(async (user) => (user === 'u1' ? null : [{ originalName: 'paper.pdf', fieldname: 'file' }]));
    s3.getFileMetadataFile.mockResolvedValue({ sha256: 'abc' });
    s3.getFileBuffer.mockResolvedValue(Buffer.from('%PDF-'));
    ni.rerun.mockResolvedValue({ status: 'running', checks: ['grim'] });
    const res = createMockRes();
    await controller.rerunChecks(req({ body: { checks: ['grim'], curator: 'C' } }), res);
    expect(s3.getFileBuffer).toHaveBeenCalledWith('folder/u2/r-ok/files/file_1.pdf');
    expect(ni.rerun).toHaveBeenCalledWith(REPORT, Buffer.from('%PDF-'), { checks: ['grim'], curator: 'C' });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, status: 'running', checks: ['grim'], pdf_request_id: 'r-ok' });
  });

  test('rerun answers 409 when no consumer still has the PDF, or its hash differs', async () => {
    dbManager.listCacheConsumers.mockResolvedValue([{ request_id: 'r1', user_name: 'u1' }]);
    s3.getFilesListFile.mockResolvedValue([{ originalName: 'paper.pdf', fieldname: 'file' }]);
    s3.getFileMetadataFile.mockResolvedValue({ sha256: 'other' });
    const res = createMockRes();
    await controller.rerunChecks(req({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(ni.rerun).not.toHaveBeenCalled();
  });

  test('refresh answers 409 while the report is running, writes the signals once settled', async () => {
    ni.getReport.mockResolvedValueOnce({ status: 'running' });
    let res = createMockRes();
    await controller.refreshSignals(req({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(cacheManager.patchCacheResponse).not.toHaveBeenCalled();

    ni.getReport.mockResolvedValueOnce({ status: 'done' });
    res = createMockRes();
    await controller.refreshSignals(req({ body: { reason: 'after re-run' } }), res);
    expect(cacheManager.patchCacheResponse).toHaveBeenCalledTimes(1);
    expect(cacheManager.patchCacheResponse.mock.calls[0][2].reason).toBe('after re-run');
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, status: 'done', signals });
  });
});
