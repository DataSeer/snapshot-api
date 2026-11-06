/**
 * Unit tests for the Numerical Integrity client: token signing, the pure
 * response helpers and the request shapes (axios mocked).
 */
const { generateKeyPairSync, verify } = require('crypto');

jest.mock('axios');
jest.mock('../../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const fs = require('fs');
const axios = require('axios');
const config = require('../../../src/config');
const ni = require('../../../src/utils/numericalIntegrityManager');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

const configure = (overrides = {}) => {
  jest.spyOn(fs, 'readFileSync').mockImplementation((path) => {
    if (path === config.numericalIntegrityConfigPath) {
      return JSON.stringify({ url: 'https://ni.example/', client: 'snapshot-api', privateKey: pem, pollMs: 1, deadlineMs: 50, ...overrides });
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  ni.resetConfig();
};

const b64 = (s) => Buffer.from(s, 'base64url');

afterEach(() => {
  jest.restoreAllMocks();
  ni.resetConfig();
});

describe('configuration and tokens', () => {
  test('is not configured without the file', () => {
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    ni.resetConfig();
    expect(ni.isConfigured()).toBe(false);
    return expect(ni.getReport('12345678-1234-4123-8123-123456789012')).rejects.toMatchObject({ status: 503 });
  });

  test('signs an EdDSA JWT with the client name that the public key verifies', async () => {
    configure();
    axios.mockResolvedValue({ status: 200, data: { id: 'r' } });
    await ni.getReport('12345678-1234-4123-8123-123456789012');
    const call = axios.mock.calls[0][0];
    expect(call.url).toBe('https://ni.example/api/reports/12345678-1234-4123-8123-123456789012');
    const [header, claims, signature] = call.headers.Authorization.replace('Bearer ', '').split('.');
    expect(JSON.parse(b64(header))).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: 'snapshot-api' });
    const body = JSON.parse(b64(claims));
    expect(body.exp - body.iat).toBe(300);
    expect(verify(null, Buffer.from(`${header}.${claims}`), publicKey, b64(signature))).toBe(true);
  });

  test('refuses a key that is not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    configure({ privateKey: rsa });
    expect(ni.isConfigured()).toBe(false);
  });
});

describe('calls to the service', () => {
  beforeEach(() => configure());

  test('passes the service status and message on', async () => {
    axios.mockResolvedValue({ status: 409, data: { error: 'The report is still running; wait for it to finish.' } });
    await expect(ni.rerun('12345678-1234-4123-8123-123456789012', Buffer.from('%PDF-'), { checks: ['grim'] })).rejects.toMatchObject({
      status: 409,
      message: 'Numerical Integrity: The report is still running; wait for it to finish.'
    });
    const call = axios.mock.calls[0][0];
    expect(call.url).toBe('https://ni.example/api/reports/12345678-1234-4123-8123-123456789012/run?checks=grim');
    expect(call.headers['Content-Type']).toBe('application/pdf');
  });

  test('validates ids before calling', async () => {
    await expect(ni.getReport('nope')).rejects.toMatchObject({ status: 400 });
    await expect(ni.rerun('12345678-1234-4123-8123-123456789012', Buffer.from(''), { checks: ['bad id'] })).rejects.toMatchObject({ status: 400 });
    await expect(ni.setBackUrl('nope', 'https://x')).rejects.toMatchObject({ status: 400 });
    expect(axios).not.toHaveBeenCalled();
  });

  test('the back and curation links are PUT to the service', async () => {
    axios.mockResolvedValue({ status: 200, data: { back_url: 'https://reports.example/r/t' } });
    await ni.setBackUrl('12345678-1234-4123-8123-123456789012', 'https://reports.example/r/t');
    const call = axios.mock.calls[0][0];
    expect(call.method).toBe('PUT');
    expect(call.url).toMatch(/\/api\/reports\/12345678-1234-4123-8123-123456789012\/back$/);
    expect(call.data).toEqual({ url: 'https://reports.example/r/t' });
  });

  test('waitForReport polls until the report has settled', async () => {
    axios
      .mockResolvedValueOnce({ status: 200, data: { status: 'running' } })
      .mockResolvedValueOnce({ status: 200, data: { status: 'running' } })
      .mockResolvedValueOnce({ status: 200, data: { status: 'done' } });
    const report = await ni.waitForReport('12345678-1234-4123-8123-123456789012');
    expect(report.status).toBe('done');
    expect(axios).toHaveBeenCalledTimes(3);
  });

  test('refreshSignals posts the report id to genshare with the API key', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { report_id: 'r', positive: [], negative: [] } });
    const out = await ni.refreshSignals('http://genshare:5000', 'key', '12345678-1234-4123-8123-123456789012');
    expect(out.report_id).toBe('r');
    expect(axios.post).toHaveBeenCalledWith('http://genshare:5000/numerical-integrity/signals', { report_id: '12345678-1234-4123-8123-123456789012' }, expect.objectContaining({ headers: { 'X-API-Key': 'key' } }));
    axios.post.mockResolvedValue({ status: 404, data: '<p>No report with that id.</p>' });
    await expect(ni.refreshSignals('http://genshare:5000', null, '12345678-1234-4123-8123-123456789012')).rejects.toMatchObject({ status: 404 });
  });

  test('genshareBaseUrlOf strips the path of the processPDF URL', () => {
    expect(ni.genshareBaseUrlOf('http://localhost:5000/snapshot')).toBe('http://localhost:5000');
    expect(ni.genshareBaseUrlOf('https://genshare.example/api/snapshot')).toBe('https://genshare.example');
  });
});

describe('applySignalsToResponse', () => {
  const response = [
    { name: 'article_id', description: '', value: 'A1' },
    { name: 'positive_signals__lm', description: '', value: [
      { id: 'das_present', label: 'DAS', severity: 'moderate' },
      { id: 'statistical_consistency', label: 'Consistent', severity: 'strong' }
    ] },
    { name: 'negative_signals__lm', description: '', value: [
      { id: 'broken_url', label: 'URL', severity: 'weak' }
    ] },
    { name: 'statistical_report_id__lm', description: '', value: '12345678-1234-4123-8123-123456789012' },
    { name: 'statistical_report_url__lm', description: '', value: 'https://ni.example/r/x?k=old' },
    { name: 'statistical_checks__lm', description: '', value: [{ id: 'grim', name: 'GRIM', verdict: 'pass', advisory: false }] }
  ];
  const signals = {
    report_id: '12345678-1234-4123-8123-123456789012',
    report_url: 'https://ni.example/r/x?k=new',
    checks: [{ id: 'grim', name: 'GRIM', verdict: 'fail', advisory: false }],
    positive: [],
    negative: [{ id: 'statistical_inconsistencies', label: 'Inconsistent', severity: 'strong', polarity: 'negative' }]
  };

  test('replaces the statistical signals, keeps the others, updates checks and URL, without touching the input', () => {
    const before = JSON.stringify(response);
    const out = ni.applySignalsToResponse(response, signals);
    expect(JSON.stringify(response)).toBe(before);
    const by = Object.fromEntries(out.map((f) => [f.name, f.value]));
    expect(by.positive_signals__lm.map((s) => s.id)).toEqual(['das_present']);
    expect(by.negative_signals__lm.map((s) => s.id)).toEqual(['statistical_inconsistencies', 'broken_url']); // strong before weak
    expect(by.statistical_checks__lm).toEqual(signals.checks);
    expect(by.statistical_report_url__lm).toBe('https://ni.example/r/x?k=new');
    expect(by.article_id).toBe('A1');
  });

  test('a revoked link gives a null URL; missing fields are added with the __lm suffix', () => {
    const out = ni.applySignalsToResponse([{ name: 'positive_signals__lm', value: [] }], { ...signals, report_url: null });
    const by = Object.fromEntries(out.map((f) => [f.name, f.value]));
    expect(by.statistical_report_url__lm).toBeNull();
    expect(by.statistical_report_id__lm).toBe(signals.report_id);
    expect(by.statistical_checks__lm).toEqual(signals.checks);
  });

  test('a selection publishes only the chosen changes', () => {
    const fresh = {
      ...signals,
      checks: [{ id: 'grim', name: 'GRIM', verdict: 'fail', advisory: false }, { id: 'sprite', name: 'SPRITE', verdict: 'pass', advisory: false }],
      positive: [{ id: 'statistical_consistency', label: 'Consistent', severity: 'moderate' }],
      negative: [{ id: 'statistical_inconsistencies', label: 'Inconsistent', severity: 'strong', polarity: 'negative' }]
    };
    const next = ni.applySignalsToResponse(response, fresh, ['check:sprite', 'signal:statistical_inconsistencies']);
    const by = Object.fromEntries(next.map((f) => [f.name, f.value]));
    // the chosen check is added, the other keeps its cached verdict; the chosen signal is added, the other keeps its cached severity
    expect(by.statistical_checks__lm).toEqual([{ id: 'grim', name: 'GRIM', verdict: 'pass', advisory: false }, { id: 'sprite', name: 'SPRITE', verdict: 'pass', advisory: false }]);
    expect(by.negative_signals__lm.map((x) => x.id)).toEqual(['statistical_inconsistencies', 'broken_url']);
    expect(by.positive_signals__lm.find((x) => x.id === 'statistical_consistency').severity).toBe('strong');
    expect(by.statistical_report_url__lm).toBe('https://ni.example/r/x?k=old');
  });

  test('diffSignals lists the share URL, each check and each statistical signal that differ', () => {
    const fresh = {
      ...signals,
      checks: [{ id: 'grim', name: 'GRIM', verdict: 'fail', advisory: false }, { id: 'sprite', name: 'SPRITE', verdict: 'pass', advisory: false }],
      positive: [],
      negative: [{ id: 'statistical_inconsistencies', label: 'Inconsistent', severity: 'strong', polarity: 'negative' }]
    };
    const keys = ni.diffSignals(response, fresh).map((c) => c.key);
    expect(keys).toEqual(['report_url', 'check:grim', 'check:sprite', 'signal:statistical_consistency', 'signal:statistical_inconsistencies']);
    const grim = ni.diffSignals(response, fresh).find((c) => c.key === 'check:grim');
    expect(grim.cached.verdict).toBe('pass');
    expect(grim.current.verdict).toBe('fail');
    expect(ni.diffSignals(ni.applySignalsToResponse(response, fresh), fresh)).toEqual([]);
  });

  test('diffSignals ignores the order of the keys', () => {
    const cached = [{ name: 'statistical_checks__lm', value: [{ id: 'grim', name: 'GRIM', verdict: 'pass', advisory: false }] }, { name: 'statistical_report_url__lm', value: 'u' }, { name: 'negative_signals__lm', value: [{ id: 'statistical_inconsistencies', severity: 'weak', label: 'L' }] }];
    const fresh = { report_url: 'u', checks: [{ advisory: false, verdict: 'pass', name: 'GRIM', id: 'grim' }], positive: [], negative: [{ label: 'L', severity: 'weak', id: 'statistical_inconsistencies' }] };
    expect(ni.diffSignals(cached, fresh)).toEqual([]);
  });

  test('reportIdOf reads the id with or without the suffix', () => {
    expect(ni.reportIdOf(response)).toBe('12345678-1234-4123-8123-123456789012');
    expect(ni.reportIdOf([{ name: 'statistical_report_id', value: '12345678-1234-4123-8123-123456789012' }])).toBe('12345678-1234-4123-8123-123456789012');
    expect(ni.reportIdOf([{ name: 'statistical_report_id__lm', value: 'nope' }])).toBeNull();
    expect(ni.reportIdOf([])).toBeNull();
  });
});

describe('the service refusing this instance', () => {
  test('a 401 or 403 from the service is a bad gateway that says what to check, never a 401', async () => {
    configure({ client: 'snapshot-api-dev' });
    for (const [status, error] of [[401, 'Unknown or disabled client.'], [403, 'Only API clients and admins may curate a report.']]) {
      axios.mockResolvedValue({ status, data: { error } });
      await expect(ni.getReport('12345678-1234-4123-8123-123456789012')).rejects.toMatchObject({
        status: 502,
        message: expect.stringContaining(`refused this instance's client 'snapshot-api-dev' (${error})`)
      });
    }
  });

  test('the other statuses of the service are passed on as they are', async () => {
    configure();
    axios.mockResolvedValue({ status: 404, data: { error: 'No report with that id.' } });
    await expect(ni.getReport('12345678-1234-4123-8123-123456789012')).rejects.toMatchObject({ status: 404, message: 'Numerical Integrity: No report with that id.' });
    axios.mockResolvedValue({ status: 409, data: { error: 'The report is still running; wait for it to finish.' } });
    await expect(ni.getReport('12345678-1234-4123-8123-123456789012')).rejects.toMatchObject({ status: 409 });
  });
});
