// File: src/utils/numericalIntegrityManager.js
//
// Client of the Numerical Integrity service (DataSeer/forensic-checks), for the
// curation of the statistical checks behind the TNQ `statistical_*` signals.
//
// genshare-service runs the checks during /processPDF and puts the report's id
// and share URL in the TNQ response (statistical_report_id__lm,
// statistical_report_url__lm). A curator, from snapshot-s3-manager's cache page,
// may then re-run checks, override a result, set a note or revoke the share
// link: this module calls the service for that (its own API client, EdDSA
// tokens signed here with node:crypto, no dependency), asks genshare-service to
// rebuild the four signals from the report's effective verdicts, and
// `applySignalsToResponse` writes them into the cached genshare response.
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
      pollMs: Number(raw.pollMs) || 5000
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

/** Validate the override body before sending it: the service checks too, but a clear 400 is better here. */
const checkOverrideBody = (body) => {
  if (!body || typeof body !== 'object') throw new NumericalIntegrityError(400, 'Send a JSON object');
  const { verdict, recommendation, summary, reason } = body;
  if (verdict !== undefined && verdict !== null && !VERDICTS.includes(verdict)) {
    throw new NumericalIntegrityError(400, `verdict must be one of ${VERDICTS.join(', ')}`);
  }
  if ([recommendation, summary].some((v) => v !== undefined && v !== null && typeof v !== 'string')) {
    throw new NumericalIntegrityError(400, 'recommendation and summary must be strings');
  }
  if (typeof reason !== 'string' || !reason.trim()) throw new NumericalIntegrityError(400, 'A reason is required');
  if ((verdict === undefined || verdict === null) && !recommendation && !summary) {
    throw new NumericalIntegrityError(400, 'Give at least one of verdict, recommendation or summary');
  }
};

const setOverride = async (reportId, checkId, body, curator = '') => {
  assertReportId(reportId);
  if (!CHECK_ID.test(String(checkId || ''))) throw new NumericalIntegrityError(400, 'Malformed check id');
  checkOverrideBody(body);
  const { verdict = null, recommendation = null, summary = null, reason } = body;
  return call('PUT', `/api/reports/${reportId}/checks/${checkId}/override`, {
    body: { verdict, recommendation, summary, reason, curator },
    curator
  });
};

const removeOverride = async (reportId, checkId, curator = '') => {
  assertReportId(reportId);
  if (!CHECK_ID.test(String(checkId || ''))) throw new NumericalIntegrityError(400, 'Malformed check id');
  return call('DELETE', `/api/reports/${reportId}/checks/${checkId}/override`, { curator });
};

const setNote = async (reportId, note, curator = '') => {
  assertReportId(reportId);
  if (typeof note !== 'string') throw new NumericalIntegrityError(400, 'note must be a string');
  return call('PUT', `/api/reports/${reportId}/note`, { body: { note, curator }, curator });
};

/** Tell the service where the report is embedded (the snapshot report page), so its shared view can lead back there. */
const setBackUrl = async (reportId, url) => {
  assertReportId(reportId);
  if (typeof url !== 'string') throw new NumericalIntegrityError(400, 'url must be a string');
  return call('PUT', `/api/reports/${reportId}/back`, { body: { url } });
};

const revokeShare = async (reportId, curator = '') => {
  assertReportId(reportId);
  return call('POST', `/api/reports/${reportId}/share/revoke`, { curator });
};

const rotateShare = async (reportId, curator = '') => {
  assertReportId(reportId);
  return call('POST', `/api/reports/${reportId}/share/rotate`, { curator });
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
const applySignalsToResponse = (responseArray, signals) => {
  const items = JSON.parse(JSON.stringify(Array.isArray(responseArray) ? responseArray : []));
  const isStatistical = (signal) => signal && SIGNAL_IDS.includes(signal.id);
  const order = (list) => [...list].sort((a, b) => rank(a.severity) - rank(b.severity));
  const rank = (severity) => ({ strong: 0, moderate: 1, weak: 2 })[severity] ?? 3;

  const replace = (base, fresh) => {
    const field = findField(items, base);
    if (!field) return;
    const kept = (Array.isArray(field.value) ? field.value : []).filter((signal) => !isStatistical(signal));
    field.value = order([...kept, ...(Array.isArray(fresh) ? fresh : [])]);
  };
  replace('positive_signals', signals.positive);
  replace('negative_signals', signals.negative);

  const set = (base, value, description) => {
    const field = findField(items, base);
    if (field) field.value = value;
    else if (description) items.push({ name: `${base}__lm`, description, value });
  };
  set('statistical_checks', Array.isArray(signals.checks) ? signals.checks : [], 'The applicable statistical checks behind the statistical_* signals (id, name, verdict, advisory)');
  set('statistical_report_url', signals.report_url || null, 'Share URL of the Numerical Integrity report');
  if (signals.report_id) set('statistical_report_id', signals.report_id, 'Id of the Numerical Integrity report');
  return items;
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
  setOverride,
  removeOverride,
  setNote,
  setBackUrl,
  revokeShare,
  rotateShare,
  refreshSignals,
  genshareBaseUrlOf,
  findField,
  reportIdOf,
  applySignalsToResponse
};
