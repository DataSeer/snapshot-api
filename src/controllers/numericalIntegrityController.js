// File: src/controllers/numericalIntegrityController.js
//
// Curation of the statistical checks behind a TNQ cache entry, under
// `/snapshot-s3-manager/cache/:cache_key/numerical-integrity/*` for the
// snapshot-s3-manager tool (and admins). The checks live on the Numerical
// Integrity service (the report id is in the cached response); this controller
// relays the curator's action to the service, asks genshare-service for the
// four statistical_* signals as they are now, writes them into the shared
// canonical response (patches.ndjson keeps the audit trail) and propagates to
// the chosen consumers, exactly like a hand patch from the cache page.
//
// Re-runs take minutes: POST .../rerun answers 202 once the service accepted
// the PDF (read from a consumer's request folder on S3); the page polls GET
// until the report has settled, then POST .../refresh writes the signals.

const cacheManager = require('../utils/cacheManager');
const dbManager = require('../utils/dbManager');
const ni = require('../utils/numericalIntegrityManager');
const { getFilesListFile, getFileMetadataFile, getFileBuffer, s3Config } = require('../utils/s3Storage');
const { watchConfig } = require('../utils/configWatcher');
const config = require('../config');
const { logger } = require('../utils/logger');

const genshareConfig = watchConfig(config.genshareConfigPath);

const fail = (res, status, error, extra = {}) => res.status(status).json({ success: false, error, ...extra });

/** The cache entry the route names: its meta, its canonical response and the report id in it. */
const loadEntry = async (req, res) => {
  if (!cacheManager.isCacheEnabled()) {
    fail(res, 503, 'Cache layer is disabled (genshare.cache.enabled === false)');
    return null;
  }
  if (!ni.isConfigured()) {
    fail(res, 503, 'Numerical Integrity is not configured on this snapshot-api (conf/numericalIntegrity.json)');
    return null;
  }
  const cacheKey = req.params.cache_key;
  if (!cacheKey) {
    fail(res, 400, 'cache_key is required');
    return null;
  }
  const [meta, response] = await Promise.all([cacheManager.readCacheMeta(cacheKey), cacheManager.readCacheResponseArray(cacheKey)]);
  if (!meta || !response) {
    fail(res, 404, 'Cache entry not found');
    return null;
  }
  const reportId = ni.reportIdOf(response);
  if (!reportId) {
    fail(res, 409, 'This cache entry carries no Numerical Integrity report (statistical_report_id): it was processed before the integration, or outside TNQ');
    return null;
  }
  return { cacheKey, meta, response, reportId };
};

/** Who acts: the snapshot-api user behind the token, and the person the tool names (X-Curator or body.curator). */
const whoIs = (req) => ({
  actor: req.user?.id || 'unknown',
  curator: String(req.body?.curator || req.headers['x-curator'] || '').slice(0, 200)
});

/** Pass the service's own status and message on; anything else is a 500 with the message logged. */
const onError = (res, where, error) => {
  if (error instanceof ni.NumericalIntegrityError) {
    logger.warn(`[NumericalIntegrity] ${where}: ${error.status} ${error.message}`);
    return fail(res, error.status, error.message);
  }
  logger.error(`[NumericalIntegrity] ${where} failed: ${error.message}`);
  return fail(res, 500, `${where} failed: ${error.message}`);
};

/** The genshare base URL and API key of the default version, for the signals refresh. */
const genshareTarget = () => {
  const versions = (genshareConfig && genshareConfig.versions) || {};
  const alias = genshareConfig && genshareConfig.defaultVersion;
  const version = (alias && versions[alias]) || Object.values(versions)[0];
  const processPdf = version && version.processPDF;
  if (!processPdf || !processPdf.url) throw new Error('No genshare processPDF URL in conf/genshare.json');
  return { baseUrl: ni.genshareBaseUrlOf(processPdf.url), apiKey: processPdf.apiKey || null };
};

/**
 * Rebuild the signals from the report as it is now and write them into the
 * canonical response, then propagate to the chosen consumers. Shared by every
 * curation action.
 */
const refreshIntoCache = async (entry, who, { reason = null, patch_reason: patchReason = null, propagate_to: propagateTo = [] } = {}, fallback = 'Numerical Integrity signals refreshed') => {
  // The report learns where it is curated (entries processed before the setting existed catch up here)
  const curationUrl = ni.curationUrlOf(entry.cacheKey);
  if (curationUrl) {
    await ni.setCurationUrl(entry.reportId, curationUrl).catch((error) => logger.warn(`[NumericalIntegrity] could not set the curation link of report ${entry.reportId}: ${error.message}`));
  }
  const target = genshareTarget();
  const signals = await ni.refreshSignals(target.baseUrl, target.apiKey, entry.reportId);
  const next = ni.applySignalsToResponse(entry.response, signals);
  await cacheManager.patchCacheResponse(entry.cacheKey, next, {
    actor: who.curator ? `${who.actor} (${who.curator})` : who.actor,
    // patch_reason is the cache page's reason; an override's own reason doubles as the patch reason when there is
    // none, and the action names itself when neither was given
    reason: patchReason || reason || fallback,
    propagated_to: Array.isArray(propagateTo) ? propagateTo : [],
    summary: { items: next.length, numerical_integrity: entry.reportId, signals: [...signals.positive, ...signals.negative].map((s) => `${s.id}:${s.severity}`) }
  });
  const skipped = [];
  for (const requestId of Array.isArray(propagateTo) ? propagateTo : []) {
    if (typeof requestId !== 'string' || !requestId) {
      skipped.push({ request_id: String(requestId), reason: 'invalid_request_id' });
      continue;
    }
    try {
      const owner = await dbManager.getCacheConsumerOwner(entry.cacheKey, requestId);
      if (!owner) {
        skipped.push({ request_id: requestId, reason: 'cache_key_mismatch_or_not_found' });
        continue;
      }
      await cacheManager.propagateResponseToRequest(owner, requestId, next);
    } catch (error) {
      logger.error(`[NumericalIntegrity] propagate to ${requestId} failed: ${error.message}`);
      skipped.push({ request_id: requestId, reason: error.message || 'propagation_failed' });
    }
  }
  logger.info(`[NumericalIntegrity] cache ${entry.cacheKey}: signals of report ${entry.reportId} written by ${who.actor}${who.curator ? ` (${who.curator})` : ''}: ${summaryOf(signals)}`);
  return { signals, response: next, skipped };
};

const summaryOf = (signals) => [...(signals.positive || []), ...(signals.negative || [])].map((s) => `${s.id}:${s.severity}`).join(', ') || 'no statistical signal';

/**
 * The PDF the cache entry was built from, read from the first consumer whose
 * main file still is on S3 with the entry's hash. The service keeps no PDF.
 */
const pdfOfEntry = async (entry) => {
  const consumers = await dbManager.listCacheConsumers(entry.cacheKey);
  for (const consumer of consumers) {
    const files = await getFilesListFile(consumer.user_name, consumer.request_id);
    if (!Array.isArray(files)) continue;
    const index = files.findIndex((f) => f && (f.fieldname || 'file') === 'file');
    if (index === -1) continue;
    const metadata = await getFileMetadataFile(consumer.user_name, consumer.request_id, index + 1);
    if (entry.meta.pdf_hash && metadata && metadata.sha256 && metadata.sha256 !== entry.meta.pdf_hash) {
      logger.warn(`[NumericalIntegrity] request ${consumer.request_id}: file hash differs from the cache entry's, skipping`);
      continue;
    }
    const extension = String(files[index].originalName || 'file.pdf').split('.').pop();
    const key = `${s3Config.s3Folder}/${consumer.user_name}/${consumer.request_id}/files/file_${index + 1}.${extension}`;
    try {
      return { buffer: await getFileBuffer(key), request_id: consumer.request_id };
    } catch (error) {
      logger.warn(`[NumericalIntegrity] could not read ${key}: ${error.message}`);
    }
  }
  return null;
};

/**
 * GET .../numerical-integrity
 * The report as the service holds it (model output, overrides, effective values, note, share state).
 */
const getNumericalIntegrity = async (req, res) => {
  const entry = await loadEntry(req, res);
  if (!entry) return;
  try {
    const report = await ni.getReport(entry.reportId);
    res.json({ success: true, report_id: entry.reportId, report });
  } catch (error) {
    onError(res, 'getNumericalIntegrity', error);
  }
};

/**
 * POST .../numerical-integrity/rerun
 * Body: { checks?: string[] (empty = the whole analysis), curator?: string }
 * Answers 202 once the service accepted the PDF; poll GET until status !== "running", then POST .../refresh.
 */
const rerunChecks = async (req, res) => {
  const entry = await loadEntry(req, res);
  if (!entry) return;
  const who = whoIs(req);
  const checks = Array.isArray(req.body?.checks) ? req.body.checks : [];
  try {
    const pdf = await pdfOfEntry(entry);
    if (!pdf) return fail(res, 409, 'No consumer of this cache entry still has the PDF on S3; the checks cannot be re-run');
    const accepted = await ni.rerun(entry.reportId, pdf.buffer, { checks, curator: who.curator });
    logger.info(`[NumericalIntegrity] cache ${entry.cacheKey}: re-run of ${checks.length ? checks.join(', ') : 'the whole analysis'} on report ${entry.reportId} by ${who.actor}${who.curator ? ` (${who.curator})` : ''}, PDF of request ${pdf.request_id}`);
    res.status(202).json({ success: true, report_id: entry.reportId, status: accepted.status || 'running', checks: accepted.checks || (checks.length ? checks : 'all'), pdf_request_id: pdf.request_id });
  } catch (error) {
    onError(res, 'rerunChecks', error);
  }
};

/**
 * POST .../numerical-integrity/refresh
 * Body: { reason?: string (or patch_reason), propagate_to?: string[], curator?: string }
 * Rebuild the signals from the report as it is now and write them into the cache. 409 while a re-run is running.
 */
const refreshSignals = async (req, res) => {
  const entry = await loadEntry(req, res);
  if (!entry) return;
  try {
    const report = await ni.getReport(entry.reportId);
    if (report.status === 'running') return fail(res, 409, 'The report is still running; refresh once it has settled', { status: 'running' });
    const result = await refreshIntoCache(entry, whoIs(req), req.body || {});
    res.json({ success: true, report_id: entry.reportId, status: report.status, signals: result.signals, skipped: result.skipped });
  } catch (error) {
    onError(res, 'refreshSignals', error);
  }
};

/** An action on the service followed by the refresh into the cache; `describe(req)` labels the patch when no reason was sent. */
const curate = (where, action, describe) => async (req, res) => {
  const entry = await loadEntry(req, res);
  if (!entry) return;
  const who = whoIs(req);
  try {
    const outcome = await action(entry, who, req);
    const result = await refreshIntoCache(entry, who, req.body || {}, describe ? describe(req) : undefined);
    res.json({ success: true, report_id: entry.reportId, ...outcome, signals: result.signals, skipped: result.skipped });
  } catch (error) {
    onError(res, where, error);
  }
};

/** PUT .../checks/:check/override  Body: { verdict?, recommendation?, summary?, reason, curator?, reason?, propagate_to? } */
const overrideCheck = curate('overrideCheck', async (entry, who, req) => ({
  override: (await ni.setOverride(entry.reportId, req.params.check, req.body || {}, who.curator)).override
}), (req) => `Override of ${req.params.check}`);

/** DELETE .../checks/:check/override */
const removeCheckOverride = curate('removeCheckOverride', async (entry, who, req) => {
  await ni.removeOverride(entry.reportId, req.params.check, who.curator);
  return { override: null };
}, (req) => `Override removed from ${req.params.check}`);

/** PUT .../note  Body: { note, curator? } */
const setReportNote = curate('setReportNote', async (entry, who, req) => ({
  note: (await ni.setNote(entry.reportId, req.body?.note, who.curator)).note
}), () => 'Report note updated');

/** POST .../share/revoke: the share link stops working; the cached statistical_report_url becomes null. */
const revokeReportShare = curate('revokeReportShare', async (entry, who) => ({
  share_url: (await ni.revokeShare(entry.reportId, who.curator)).share_url
}), () => 'Share link revoked');

/** POST .../share/rotate: a new share link, written into the cache. */
const rotateReportShare = curate('rotateReportShare', async (entry, who) => ({
  share_url: (await ni.rotateShare(entry.reportId, who.curator)).share_url
}), () => 'Share link rotated');

module.exports = {
  getNumericalIntegrity,
  rerunChecks,
  refreshSignals,
  overrideCheck,
  removeCheckOverride,
  setReportNote,
  revokeReportShare,
  rotateReportShare
};
