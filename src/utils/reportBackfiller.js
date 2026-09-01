// File: src/utils/reportBackfiller.js
//
// On-demand generation of report URLs for requests that never got one.
//
// When snapshot-reports is unavailable, `snapshotReportsManager.createReport`
// throws and genshareManager swallows the error on purpose — a report failure
// must never fail the request itself. The consequence is a request with no
// report URL: `requests.report_data` stays NULL and the archived response
// carries no `report_link`.
//
// This module patches those requests after the fact. It is deliberately narrow:
//
//   - it only ever ADDS a missing report URL, never replaces an existing one;
//   - it re-runs nothing else — no genshare call, no re-analysis, no repair of
//     the request's content. Whether a given request *deserves* a report (is it
//     cached? a demo? stale?) is the operator's call, not this module's.
//
// For each patched request three artifacts are updated, mirroring what the
// normal processing path writes:
//   1. `requests.report_data`                          (SQLite)
//   2. `<user>/<request>/report/report.json`           (S3)
//   3. `report_link` injected into `<user>/<request>/response.json` (S3),
//      when that archived API response exists and lacks it.

const dbManager = require('./dbManager');
const requestsManager = require('./requestsManager');
const snapshotReportsManager = require('./snapshotReportsManager');
const userManager = require('./userManager');
const {
  getGenshareResponseFile,
  getApiResponseFile,
  uploadBatchToS3,
  s3Config
} = require('./s3Storage');
const { logger } = require('./logger');

/**
 * Outcome codes reported per request. Anything other than `created` (or
 * `would_create` in a dry run) left the request untouched.
 */
const Outcome = {
  CREATED: 'created',
  WOULD_CREATE: 'would_create',
  SKIPPED_HAS_REPORT: 'skipped_has_report',
  SKIPPED_NO_REPORT_KIND: 'skipped_no_report_kind',
  SKIPPED_UNKNOWN_USER: 'skipped_unknown_user',
  SKIPPED_NO_GENSHARE_RESPONSE: 'skipped_no_genshare_response',
  FAILED: 'failed'
};

/**
 * Extract the report URL already stored on a requests row, if any.
 * `report_data` is a JSON blob whose `report_link` key holds the URL.
 *
 * @param {string|null} reportData - raw `requests.report_data` column value
 * @returns {string|null} the stored URL, or null when there is none
 */
const readStoredReportUrl = (reportData) => {
  if (!reportData) return null;
  try {
    const parsed = JSON.parse(reportData);
    const url = parsed && parsed.report_link;
    return typeof url === 'string' && url ? url : null;
  } catch {
    // A malformed blob is treated as "no report URL" — the row gets rebuilt.
    return null;
  }
};

/**
 * Minimal stand-in for a ProcessingSession, good enough for the collaborators
 * used here (`snapshotReportsManager.createReport` only calls `addLog`).
 * Lines are collected so the caller can surface them per request.
 *
 * @param {string} requestId
 * @returns {{requestId: string, logs: Array<string>, addLog: Function}}
 */
const createLogCollector = (requestId) => {
  const logs = [];
  return {
    requestId,
    logs,
    addLog(message, level = 'INFO') {
      logs.push(`[${level}] ${message}`);
      if (level === 'ERROR') {
        logger.error(`[backfill][${requestId}] ${message}`);
      } else {
        logger.info(`[backfill][${requestId}] ${message}`);
      }
    }
  };
};

/**
 * Resolve which report kind to use for a request.
 * Mirrors the "client sent nothing" branch of genshareManager: the report kind
 * is the owning user's configured default. An explicit override wins, which is
 * how an operator patches requests whose owner has no default configured.
 *
 * @param {string} userId - owning user
 * @param {string|null} reportKindOverride - operator-supplied kind, or null
 * @returns {{reportKind: string|null, unknownUser: boolean}}
 */
const resolveReportKind = (userId, reportKindOverride) => {
  if (reportKindOverride) return { reportKind: reportKindOverride, unknownUser: false };

  let user;
  try {
    user = userManager.getUserById(userId);
  } catch {
    return { reportKind: null, unknownUser: true };
  }

  return { reportKind: user.reports?.defaultVersion || null, unknownUser: false };
};

/**
 * Add `report_link` to the archived API response so the stored snapshot
 * response matches what the client would have received. No-op when the file is
 * absent or already carries the field.
 *
 * @param {string} userId
 * @param {string} requestId
 * @param {string} reportUrl
 * @returns {Promise<boolean>} true when the archived response was rewritten
 */
const injectReportLinkIntoApiResponse = async (userId, requestId, reportUrl) => {
  const apiResponse = await getApiResponseFile(userId, requestId);
  if (!apiResponse || !Array.isArray(apiResponse.data)) return false;

  if (apiResponse.data.some((item) => item && item.name === 'report_link')) return false;

  apiResponse.data.push({
    name: 'report_link',
    description: 'Report link',
    value: reportUrl
  });

  await uploadBatchToS3([
    {
      key: `${s3Config.s3Folder}/${userId}/${requestId}/response.json`,
      data: JSON.stringify(apiResponse, null, 2),
      contentType: 'application/json'
    }
  ]);

  return true;
};

/**
 * Generate and persist the missing report URL for a single request row.
 *
 * @param {Object} row - a `requests` row (needs user_name, request_id, report_data)
 * @param {Object} options
 * @param {boolean} options.dryRun - when true, resolve eligibility but write nothing
 * @param {string|null} options.reportKindOverride
 * @returns {Promise<Object>} result descriptor for this request
 */
const backfillOne = async (row, { dryRun = true, reportKindOverride = null } = {}) => {
  const requestId = row.request_id;
  const userId = row.user_name;
  const base = { request_id: requestId, user_id: userId, article_id: row.article_id || '' };

  const existingUrl = readStoredReportUrl(row.report_data);
  if (existingUrl) {
    return { ...base, outcome: Outcome.SKIPPED_HAS_REPORT, report_url: existingUrl };
  }

  const { reportKind, unknownUser } = resolveReportKind(userId, reportKindOverride);
  if (unknownUser) {
    return {
      ...base,
      outcome: Outcome.SKIPPED_UNKNOWN_USER,
      reason: `User "${userId}" is not present in the users configuration`
    };
  }
  if (!reportKind) {
    return {
      ...base,
      outcome: Outcome.SKIPPED_NO_REPORT_KIND,
      reason: `User "${userId}" has no reports.defaultVersion; pass an explicit report kind to override`
    };
  }

  // The report JSON is built from the same genshare response the normal path
  // uses, so a backfilled report is identical to one created inline.
  const genshareResponse = await getGenshareResponseFile(userId, requestId);
  const responseArray = genshareResponse && genshareResponse.response;
  if (!Array.isArray(responseArray)) {
    return {
      ...base,
      outcome: Outcome.SKIPPED_NO_GENSHARE_RESPONSE,
      report_kind: reportKind,
      reason: 'genshare/response.json is missing or has no response[] array'
    };
  }

  if (dryRun) {
    return { ...base, outcome: Outcome.WOULD_CREATE, report_kind: reportKind };
  }

  const collector = createLogCollector(requestId);

  try {
    const report = await snapshotReportsManager.createReport(reportKind, requestId, collector);
    const reportUrl = report.url;

    // buildJSON signals an unknown report version by RETURNING an Error rather
    // than throwing — guard explicitly so a bad kind can't be stored as data.
    const reportData = requestsManager.buildJSON(reportKind, responseArray, reportUrl);
    if (reportData instanceof Error) throw reportData;

    await dbManager.updateRequestReportData(requestId, reportData);

    await uploadBatchToS3([
      {
        key: `${s3Config.s3Folder}/${userId}/${requestId}/report/report.json`,
        data: JSON.stringify(reportData, null, 2),
        contentType: 'application/json'
      }
    ]);

    const apiResponsePatched = await injectReportLinkIntoApiResponse(userId, requestId, reportUrl);

    return {
      ...base,
      outcome: Outcome.CREATED,
      report_kind: reportKind,
      report_url: reportUrl,
      was_new: report.is_new === true,
      api_response_patched: apiResponsePatched,
      logs: collector.logs
    };
  } catch (error) {
    logger.error(`[backfill][${requestId}] Failed: ${error.message}`);
    return {
      ...base,
      outcome: Outcome.FAILED,
      report_kind: reportKind,
      reason: error.message,
      logs: collector.logs
    };
  }
};

/**
 * Generate the missing report URLs over one of three scopes.
 *
 * Exactly one scope must be given:
 *   - `requestId` — a single request
 *   - `userId`    — every request owned by that user
 *   - `all: true` — every request, all users
 *
 * Requests are processed sequentially: this is an after-the-fact patch run, and
 * snapshot-reports has just come back from an outage — there is no reason to
 * hammer it.
 *
 * @param {Object} options
 * @param {string} [options.requestId]
 * @param {string} [options.userId]
 * @param {boolean} [options.all]
 * @param {boolean} [options.dryRun=true] - default is read-only
 * @param {number|null} [options.limit=null] - cap on requests processed
 * @param {string|null} [options.reportKind=null] - override the per-user default
 * @returns {Promise<Object>} summary + per-request results
 */
const backfillReportUrls = async ({
  requestId = null,
  userId = null,
  all = false,
  dryRun = true,
  limit = null,
  reportKind = null
} = {}) => {
  const scopes = [requestId && 'request', userId && 'user', all && 'all'].filter(Boolean);
  if (scopes.length !== 1) {
    throw new Error('Exactly one scope is required: requestId, userId, or all');
  }
  if (requestId && !/^[0-9a-f]{32}$/.test(requestId)) {
    throw new Error('Invalid request ID format. Must be 32 hexadecimal characters.');
  }

  const candidates = await dbManager.listRequestsWithoutReportUrl({ requestId, userId, limit });

  const results = [];
  for (const row of candidates) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await backfillOne(row, { dryRun, reportKindOverride: reportKind }));
  }

  const countBy = (outcome) => results.filter((r) => r.outcome === outcome).length;

  return {
    scope: scopes[0],
    dry_run: dryRun,
    scanned: candidates.length,
    created: countBy(Outcome.CREATED),
    would_create: countBy(Outcome.WOULD_CREATE),
    skipped:
      countBy(Outcome.SKIPPED_HAS_REPORT) +
      countBy(Outcome.SKIPPED_NO_REPORT_KIND) +
      countBy(Outcome.SKIPPED_UNKNOWN_USER) +
      countBy(Outcome.SKIPPED_NO_GENSHARE_RESPONSE),
    failed: countBy(Outcome.FAILED),
    results
  };
};

module.exports = {
  Outcome,
  readStoredReportUrl,
  backfillOne,
  backfillReportUrls
};
