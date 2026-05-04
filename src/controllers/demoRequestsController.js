// File: src/controllers/demoRequestsController.js
//
// HTTP surface for managing demo-flagged requests. Exposed under
// /snapshot-s3-manager/demo-requests/* so the snapshot-s3-manager tool can
// browse, inspect, and toggle the is_demo flag on existing requests.
//
// The demo registry is just rows in the existing `requests` table whose
// `is_demo` column is 1. There is no separate storage or snapshot-reports
// token for demo entries — they reuse the curator's real request artifacts.

const dbManager = require('../utils/dbManager');
const { logger } = require('../utils/logger');
const { getFile, uploadBatchToS3, s3Config } = require('../utils/s3Storage');

/**
 * Merge `is_demo` into the request's process.json on S3 (non-destructively).
 * S3 is the source of truth that `refreshRequestsFromS3` reads from, so both
 * DB and S3 must stay in sync on every toggle.
 * Returns 'updated' | 'unchanged' | 'missing' | 'error'.
 */
const persistIsDemoToS3 = async (userName, requestId, isDemo) => {
  const key = `${s3Config.s3Folder}/${userName}/${requestId}/process.json`;
  let current;
  try {
    const raw = await getFile(key);
    if (!raw) return 'missing';
    current = JSON.parse(raw);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return 'missing';
    }
    logger.warn(`[demo] Failed to read process.json for ${requestId}: ${error.message}`);
    return 'error';
  }

  if (!current || typeof current !== 'object') return 'error';
  if (current.is_demo === !!isDemo) return 'unchanged';

  const next = { ...current, is_demo: !!isDemo };
  try {
    await uploadBatchToS3([
      {
        key,
        data: JSON.stringify(next, null, 2),
        contentType: 'application/json'
      }
    ]);
    return 'updated';
  } catch (error) {
    logger.warn(`[demo] Failed to write process.json for ${requestId}: ${error.message}`);
    return 'error';
  }
};

/**
 * Extract a `report_link` from a stored `report_data` JSON blob (best effort).
 */
const extractReportLink = (reportDataJson) => {
  if (!reportDataJson) return null;
  try {
    const obj = JSON.parse(reportDataJson);
    if (obj && typeof obj.report_link === 'string' && obj.report_link) return obj.report_link;
  } catch {
    /* ignore malformed JSON */
  }
  return null;
};

/**
 * Shape a DB row into the JSON the UI consumes.
 */
const shapeRow = (row) => ({
  request_id: row.request_id,
  user_name: row.user_name,
  article_id: row.article_id,
  pdf_hash: row.pdf_hash || null,
  is_demo: row.is_demo === 1,
  is_demo_bypass: row.is_demo_bypass === 1,
  bypass_source_request_id: row.bypass_source_request_id || null,
  report_link: extractReportLink(row.report_data),
  created_at: row.created_at,
  updated_at: row.updated_at
});

/**
 * GET /snapshot-s3-manager/demo-requests
 * List every request currently flagged as a demo.
 */
const listDemoRequests = async (req, res) => {
  try {
    const rows = await dbManager.listDemoRequests();
    res.json({
      success: true,
      entries: rows.map(shapeRow)
    });
  } catch (error) {
    logger.error(`[demo] listDemoRequests failed: ${error.message}`);
    res.status(500).json({ success: false, error: 'Failed to list demo requests' });
  }
};

/**
 * GET /snapshot-s3-manager/demo-requests/:request_id
 * Return the single requests-table row (or 404).
 */
const getDemoRequest = async (req, res) => {
  const { request_id: requestId } = req.params;
  if (!requestId) {
    return res.status(400).json({ success: false, error: 'request_id is required' });
  }
  try {
    const row = await dbManager.getRequestByRequestIdAnyUser(requestId);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }
    return res.json({ success: true, entry: shapeRow(row) });
  } catch (error) {
    logger.error(`[demo] getDemoRequest failed for ${requestId}: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to get request' });
  }
};

/**
 * PATCH /snapshot-s3-manager/demo-requests/:request_id
 * Body: { is_demo: boolean }
 * Toggles the is_demo flag on the target request. Used both from the s3-manager
 * list page and from the per-request detail page's "Mark as Demo" button.
 */
const patchDemoRequest = async (req, res) => {
  const { request_id: requestId } = req.params;
  if (!requestId) {
    return res.status(400).json({ success: false, error: 'request_id is required' });
  }

  const body = req.body || {};
  if (typeof body.is_demo !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'Body.is_demo must be a boolean'
    });
  }

  try {
    const row = await dbManager.getRequestByRequestIdAnyUser(requestId);
    if (!row) {
      return res.status(404).json({ success: false, error: 'Request not found' });
    }

    // Guardrail: if the request has no pdf_hash (legacy row predating the
    // feature), marking it as demo would never be hit by the runtime
    // bypass. Surface that clearly.
    if (body.is_demo === true && !row.pdf_hash) {
      return res.status(409).json({
        success: false,
        error: 'Cannot mark as demo: this request has no pdf_hash (legacy row). Re-run the PDF through /processPDF/demo first.'
      });
    }

    await dbManager.setRequestIsDemo(requestId, body.is_demo);
    logger.info(
      `[demo] Request ${body.is_demo ? 'marked' : 'unmarked'} as demo — ` +
        `request_id=${requestId} by=${req.user?.id || 'unknown'}`
    );

    // Mirror the flag into process.json on S3 so a DB rebuild via
    // refreshRequestsFromS3 keeps the demo state. Failure is non-fatal —
    // the DB is already updated — but we log it so operators can retry.
    const s3Status = await persistIsDemoToS3(row.user_name, requestId, body.is_demo);
    if (s3Status === 'error' || s3Status === 'missing') {
      logger.warn(
        `[demo] process.json is_demo mirror ${s3Status} for ${requestId} — ` +
          'DB is authoritative until next s3:refresh or manual sync'
      );
    }

    const updated = await dbManager.getRequestByRequestIdAnyUser(requestId);
    return res.json({ success: true, entry: shapeRow(updated), s3_sync: s3Status });
  } catch (error) {
    logger.error(`[demo] patchDemoRequest failed for ${requestId}: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Failed to update request' });
  }
};

module.exports = {
  listDemoRequests,
  getDemoRequest,
  patchDemoRequest
};
