// File: src/utils/numericalIntegrityManager.js
//
// Client of the Numerical Integrity service (DataSeer/forensic-checks), for the
// curation of the statistical checks behind the TNQ `statistical_*` signals.
//
// genshare-service runs the checks during /processPDF and puts the report's id
// and share URL in the TNQ response (statistical_report_id__lm,
// statistical_report_url__lm). A curator, from snapshot-s3-manager's cache page,
// may then re-run checks, override a result, set a note or revoke the share
// link: this module reads the report from the service (its own API client, EdDSA
// tokens signed here with node:crypto, no dependency), asks genshare-service to
// rebuild the four signals from the report's effective verdicts, `diffSignals`
// compares them with the cached genshare response and `applySignalsToResponse`
// writes them into it, all of them or a selection. Curation itself (overrides,
// notes, share links) happens on the service; this side only publishes its state.
//
// Configuration: conf/numericalIntegrity.json (see .default). Without it, every
// call answers "not configured" and the controller returns 503.

const fs = require('fs');
const { createPrivateKey, sign } = require('crypto');
const axios = require('axios');
const config = require('../config');
const { logger } = require('./logger');

const TOKEN_LIFE_S = 300; // the service refuses tokens valid for more than 15 minutes
const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CHECK_ID = /^[a-z0-9_]{1,64}$/;
const VERDICTS = ['pass', 'minor', 'fail', 'inconclusive', 'not_applicable'];

// The signals genshare derives from the checks (llms/forensic_checks_lm.py build_signals).
const SIGNAL_IDS = [
  'statistical_consistency',
  'statistical_inconsistencies',
  'statistical_minor_discrepancies',
  'statistical_checks_inconclusive'
];

let cached = null;

/**
 * Load conf/numericalIntegrity.json once; null when absent or unusable.
 * @returns {{url:string, client:string, key:import('crypto').KeyObject, deadlineMs:number, pollMs:number}|null}
 */
const getConfig = () => {
  if (cached !== null) return cached || null;
  try {
    const raw = JSON.parse(fs.readFileSync(config.numericalIntegrityConfigPath, 'utf8'));
    const pem = raw.privateKey
      ? String(raw.privateKey).replace(/\\n/g, '\n')
      : raw.privateKeyFile && fs.existsSync(raw.privateKeyFile)
        ? fs.readFileSync(raw.privateKeyFile, 'utf8')
        : '';
    if (!raw.url || !raw.client || !pem) {
      logger.warn('[NumericalIntegrity] conf/numericalIntegrity.json needs url, client and privateKey or privateKeyFile; curation is off');
      cached = false;
      return null;
    }
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('the private key must be an Ed25519 key');
    cached = {
      url: String(raw.url).replace(/\/+$/, ''),
      client: String(raw.client),
      key,
      deadlineMs: Number(raw.deadlineMs) || 900000,
      pollMs: Number(raw.pollMs) || 5000,
      // Optional: where a cache entry is curated in snapshot-s3-manager, with {cache_key} standing for the key
      curationUrl: typeof raw.curationUrl === 'string' && raw.curationUrl.includes('{cache_key}') ? raw.curationUrl.trim() : ''
    };
    logger.info(`[NumericalIntegrity] client '${cached.client}' at ${cached.url}`);
    return cached;
  } catch (error) {
    if (error.code !== 'ENOENT') logger.warn(`[NumericalIntegrity] configuration unusable, curation is off: ${error.message}`);
    cached = false;
    return null;
  }
};

/** Forget the loaded configuration (tests). */
const resetConfig = () => {
  cached = null;
};

const isConfigured = () => Boolean(getConfig());

const b64url = (value) => Buffer.from(value).toString('base64url');

/** A fresh EdDSA JWT: header {alg, typ, kid = client name}, claims iat/exp, signed with the private key. */
const token = (conf) => {
  const now = Math.floor(Date.now() / 1000);
  const signed = `${b64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT', kid: conf.client }))}.${b64url(JSON.stringify({ iat: now, exp: now + TOKEN_LIFE_S }))}`;
  return `${signed}.${b64url(sign(null, Buffer.from(signed), conf.key))}`;
};

class NumericalIntegrityError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'NumericalIntegrityError';
    this.status = status;
  }
}

const requireConfig = () => {
  const conf = getConfig();
  if (!conf) throw new NumericalIntegrityError(503, 'Numerical Integrity is not configured (conf/numericalIntegrity.json)');
  return conf;
};

const assertReportId = (id) => {
  if (!REPORT_ID.test(String(id || ''))) throw new NumericalIntegrityError(400, 'Malformed Numerical Integrity report id');
};

/**
 * One call to the service. Answers the parsed JSON; a non-2xx answer becomes a
 * NumericalIntegrityError carrying the service's status and message, so the
 * controller can pass them on (404 unknown report, 409 still running, ...).
 */
const call = async (method, path, { body, headers = {}, curator = '', timeout = 60000 } = {}) => {
  const conf = requireConfig();
  try {
    const response = await axios({
      method,
      url: `${conf.url}${path}`,
      data: body,
      timeout,
      maxBodyLength: Infinity,
      headers: {
        Authorization: `Bearer ${token(conf)}`,
        ...(curator ? { 'X-Curator': String(curator).slice(0, 200) } : {}),
        ...headers
      },
      validateStatus: () => true
    });
    if (response.status >= 200 && response.status < 300) return response.data;
    const message = (response.data && response.data.error) || `HTTP ${response.status}`;
    throw new NumericalIntegrityError(response.status, `Numerical Integrity: ${message}`);
  } catch (error) {
    if (error instanceof NumericalIntegrityError) throw error;
    throw new NumericalIntegrityError(502, `Numerical Integrity did not answer: ${error.message}`);
  }
};

/** GET /api/reports/<id>: the report with the model's output, the overrides and the effective values. */
const getReport = async (reportId) => {
  assertReportId(reportId);
  return call('GET', `/api/reports/${reportId}`);
};

/**
 * POST /api/reports/<id>/run: re-run the chosen checks (or everything when `checks` is empty)
 * with the PDF attached. Answers 202 at once; poll getReport until status !== "running".
 */
const rerun = async (reportId, pdfBuffer, { checks = [], curator = '' } = {}) => {
  assertReportId(reportId);
  const ids = (Array.isArray(checks) ? checks : []).map(String);
  if (!ids.every((id) => CHECK_ID.test(id))) throw new NumericalIntegrityError(400, 'Malformed check id');
  const query = ids.length ? `?checks=${encodeURIComponent(ids.join(','))}` : '';
  return call('POST', `/api/reports/${reportId}/run${query}`, {
    body: pdfBuffer,
    headers: { 'Content-Type': 'application/pdf' },
    curator,
    timeout: 300000
  });
};

/** Poll the report until it has settled or the deadline has passed; answers the last report read. */
const waitForReport = async (reportId, { deadlineMs, pollMs } = {}) => {
  const conf = requireConfig();
  const deadline = Date.now() + (deadlineMs || conf.deadlineMs);
  const pause = pollMs || conf.pollMs;
  let report = await getReport(reportId);
  while (report.status === 'running' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pause));
    report = await getReport(reportId);
  }
  return report;
};

/** The s3-manager page of a cache entry, from the configured template; '' when none is configured. */
const curationUrlOf = (cacheKey) => {
  const conf = getConfig();
  if (!conf || !conf.curationUrl || !cacheKey) return '';
  return conf.curationUrl.replace('{cache_key}', encodeURIComponent(String(cacheKey)));
};

/** Tell the service where the report is curated on the snapshot side (the s3-manager cache entry). */
const setCurationUrl = async (reportId, url) => {
  assertReportId(reportId);
  if (typeof url !== 'string') throw new NumericalIntegrityError(400, 'url must be a string');
  return call('PUT', `/api/reports/${reportId}/curation`, { body: { url } });
};

/** Tell the service where the report is embedded (the snapshot report page), so its shared view can lead back there. */
const setBackUrl = async (reportId, url) => {
  assertReportId(reportId);
  if (typeof url !== 'string') throw new NumericalIntegrityError(400, 'url must be a string');
  return call('PUT', `/api/reports/${reportId}/back`, { body: { url } });
};

/**
 * Ask genshare-service for the four signals of a report as it is now
 * (POST /numerical-integrity/signals). `genshareBaseUrl` is the genshare
 * version's processPDF URL without its path.
 */
const refreshSignals = async (genshareBaseUrl, apiKey, reportId) => {
  assertReportId(reportId);
  try {
    const response = await axios.post(
      `${genshareBaseUrl}/numerical-integrity/signals`,
      { report_id: reportId },
      { timeout: 60000, headers: apiKey ? { 'X-API-Key': apiKey } : {}, validateStatus: () => true }
    );
    if (response.status >= 200 && response.status < 300) return response.data;
    const text = typeof response.data === 'string' ? response.data.replace(/<[^>]+>/g, '').trim().slice(0, 300) : JSON.stringify(response.data);
    throw new NumericalIntegrityError(response.status === 404 ? 404 : 502, `genshare /numerical-integrity/signals: HTTP ${response.status} ${text}`);
  } catch (error) {
    if (error instanceof NumericalIntegrityError) throw error;
    throw new NumericalIntegrityError(502, `genshare did not answer: ${error.message}`);
  }
};

/** The genshare base URL ("http://host:5000") from a version's processPDF URL ("http://host:5000/snapshot"). */
const genshareBaseUrlOf = (processPdfUrl) => {
  const url = new URL(processPdfUrl);
  return `${url.protocol}//${url.host}`;
};

// -------------------------------------------------------------------------
// Pure helpers on the cached genshare response (an array of {name, description, value})
// -------------------------------------------------------------------------

/** The field named `base` with or without an engine suffix (statistical_report_id__lm or statistical_report_id). */
const findField = (responseArray, base) =>
  (Array.isArray(responseArray) ? responseArray : []).find((item) => item && typeof item.name === 'string' && item.name.replace(/__.*$/, '') === base);

/** The Numerical Integrity report id a cached response points at, or null. */
const reportIdOf = (responseArray) => {
  const field = findField(responseArray, 'statistical_report_id');
  const value = field && field.value;
  return typeof value === 'string' && REPORT_ID.test(value) ? value : null;
};

/**
 * Write the rebuilt signals into a copy of the response: the four statistical_*
 * signals are replaced (or added) in positive_signals / negative_signals, the
 * other signals are kept in place; statistical_checks and
 * statistical_report_url follow the report as it is now. Pure.
 *
 * @param {Array} responseArray - the cached response items
 * @param {Object} signals - genshare's answer: {report_id, report_url, checks, positive, negative}
 * @returns {Array} a new array
 */
const applySignalsToResponse = (responseArray, signals, selection = null) => {
  const items = JSON.parse(JSON.stringify(Array.isArray(responseArray) ? responseArray : []));
  const wanted = Array.isArray(selection) ? new Set(selection.map(String)) : null;
  const take = (key) => !wanted || wanted.has(key);
  const isStatistical = (signal) => signal && SIGNAL_IDS.includes(signal.id);
  const rank = (severity) => ({ strong: 0, moderate: 1, weak: 2 })[severity] ?? 3;
  const order = (list) => [...list].sort((a, b) => rank(a.severity) - rank(b.severity));
  const fresh = { positive: Array.isArray(signals.positive) ? signals.positive : [], negative: Array.isArray(signals.negative) ? signals.negative : [] };

  // Signals: every statistical signal, or only the selected ids; a selected id absent from the fresh lists is removed
  for (const side of ['positive', 'negative']) {
    const field = findField(items, `${side}_signals`);
    if (!field) continue;
    const current = Array.isArray(field.value) ? field.value : [];
    const kept = current.filter((signal) => !isStatistical(signal) || !take(`signal:${signal.id}`));
    const added = fresh[side].filter((signal) => take(`signal:${signal.id}`));
    field.value = order([...kept, ...added]);
  }

  const set = (base, value, description) => {
    const field = findField(items, base);
    if (field) field.value = value;
    else if (description) items.push({ name: `${base}__lm`, description, value });
  };
  // Checks: the whole list, or the selected ids merged into the cached list
  const freshChecks = Array.isArray(signals.checks) ? signals.checks : [];
  if (!wanted) {
    set('statistical_checks', freshChecks, 'The applicable statistical checks behind the statistical_* signals (id, name, verdict, advisory)');
  } else {
    const field = findField(items, 'statistical_checks');
    const current = field && Array.isArray(field.value) ? field.value : [];
    const merged = current.filter((check) => !take(`check:${check.id}`));
    for (const check of freshChecks) if (take(`check:${check.id}`)) merged.push(check);
    const position = (check) => { const i = freshChecks.findIndex((c) => c.id === check.id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    set('statistical_checks', merged.sort((a, b) => position(a) - position(b)), 'The applicable statistical checks behind the statistical_* signals (id, name, verdict, advisory)');
  }
  if (take('report_url')) set('statistical_report_url', signals.report_url || null, 'Share URL of the Numerical Integrity report');
  if (signals.report_id && take('report_id')) set('statistical_report_id', signals.report_id, 'Id of the Numerical Integrity report');
  return items;
};

/**
 * What differs between the cached response and the signals genshare builds now: one entry per atomic change the
 * curator may take or leave (`key` is what `applySignalsToResponse` accepts in its selection).
 * @param {Array} responseArray - The cached genshare response items
 * @param {Object} signals - genshare's answer for the report as it is now
 * @returns {Array<{key:string, kind:string, id:string|null, label:string, cached:*, current:*}>}
 */
const diffSignals = (responseArray, signals) => {
  const items = Array.isArray(responseArray) ? responseArray : [];
  // Compared whatever the order of the keys: the pipeline and the signals endpoint do not serialise alike
  const canon = (value) => JSON.stringify(value ?? null, (key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));
  const same = (a, b) => canon(a) === canon(b);
  const changes = [];
  const value = (base) => findField(items, base)?.value;

  const cachedUrl = value('statistical_report_url') ?? null;
  const currentUrl = signals.report_url || null;
  if (!same(cachedUrl, currentUrl)) changes.push({ key: 'report_url', kind: 'report_url', id: null, label: 'Share URL of the report', cached: cachedUrl, current: currentUrl });
  const cachedId = value('statistical_report_id') ?? null;
  if (signals.report_id && !same(cachedId, signals.report_id)) changes.push({ key: 'report_id', kind: 'report_id', id: null, label: 'Report id', cached: cachedId, current: signals.report_id });

  const cachedChecks = Array.isArray(value('statistical_checks')) ? value('statistical_checks') : [];
  const currentChecks = Array.isArray(signals.checks) ? signals.checks : [];
  const ids = [...new Set([...currentChecks.map((c) => c.id), ...cachedChecks.map((c) => c.id)])];
  for (const id of ids) {
    const before = cachedChecks.find((c) => c.id === id) ?? null;
    const after = currentChecks.find((c) => c.id === id) ?? null;
    if (!same(before, after)) changes.push({ key: `check:${id}`, kind: 'check', id, label: (after ?? before).name || id, cached: before, current: after });
  }

  const statistical = (base) => (Array.isArray(value(base)) ? value(base) : []).filter((signal) => signal && SIGNAL_IDS.includes(signal.id));
  const cachedSignals = [...statistical('positive_signals').map((x) => ({ ...x, side: 'positive' })), ...statistical('negative_signals').map((x) => ({ ...x, side: 'negative' }))];
  const currentSignals = [
    ...(Array.isArray(signals.positive) ? signals.positive : []).map((x) => ({ ...x, side: 'positive' })),
    ...(Array.isArray(signals.negative) ? signals.negative : []).map((x) => ({ ...x, side: 'negative' }))
  ];
  for (const id of SIGNAL_IDS) {
    const before = cachedSignals.find((x) => x.id === id) ?? null;
    const after = currentSignals.find((x) => x.id === id) ?? null;
    if (!same(before, after)) changes.push({ key: `signal:${id}`, kind: 'signal', id, label: (after ?? before).label || id, cached: before, current: after });
  }
  return changes;
};

module.exports = {
  NumericalIntegrityError,
  SIGNAL_IDS,
  VERDICTS,
  getConfig,
  resetConfig,
  isConfigured,
  getReport,
  rerun,
  waitForReport,
  setBackUrl,
  curationUrlOf,
  setCurationUrl,
  refreshSignals,
  genshareBaseUrlOf,
  findField,
  reportIdOf,
  applySignalsToResponse,
  diffSignals
};
