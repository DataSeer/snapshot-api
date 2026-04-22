// File: src/utils/demoBypassManager.js
//
// Pre-genshare bypass for "demo" PDFs.
//
// A curator runs a PDF through the dedicated /processPDF/demo endpoint and
// tags the resulting request as a demo via the s3-manager UI. Any future
// request whose PDF binary hashes to the same SHA-256 will short-circuit
// genshare entirely: snapshot-api reads the curator's patched
// `genshare/response.json`, filters it for the calling user, and returns
// it without creating a new session, DB row, Sheets entry, or snapshot-
// reports token.

const dbManager = require('./dbManager');
const { getFile, s3Config, calculateSHA256 } = require('./s3Storage');
const { filterAndSortResponseForUser } = require('./genshareManager');
const { logger } = require('./logger');

/**
 * Look up a demo-flagged request whose PDF binary matches `pdfHash` and
 * build a runtime response for the given caller.
 *
 * Returns `null` when nothing matches or the source request's S3 data is
 * unreachable — in both cases the caller should fall through to the
 * normal genshare flow.
 *
 * Returns `{ data, sourceRequestId, sourceUserId }` on hit. `data` is the
 * already-filtered `response[]` (with `report_link` appended when the
 * source request created one).
 */
const tryBypass = async (pdfHash, user) => {
  if (!pdfHash) return null;

  let row;
  try {
    row = await dbManager.findDemoRequestByPdfHash(pdfHash);
  } catch (error) {
    logger.error(`[demo] DB lookup failed: ${error.message}`);
    return null;
  }
  if (!row) return null;

  const key = `${s3Config.s3Folder}/${row.user_name}/${row.request_id}/genshare/response.json`;
  let slim;
  try {
    const raw = await getFile(key);
    slim = JSON.parse(raw);
  } catch (error) {
    logger.warn(
      `[demo] Source genshare/response.json missing for demo request ` +
        `${row.request_id} (pdf_hash=${pdfHash}): ${error.message} — falling back to normal flow`
    );
    return null;
  }

  // Accept both the new slim shape ({ response: [...] }) and the legacy
  // wrapped shape ({ status, headers, data: { response: [...] } }).
  const responseArray = Array.isArray(slim.response)
    ? slim.response
    : Array.isArray(slim.data?.response)
      ? slim.data.response
      : [];

  const filtered = filterAndSortResponseForUser(responseArray, user);

  let reportLink = null;
  if (row.report_data) {
    try {
      const report = JSON.parse(row.report_data);
      if (report && typeof report.report_link === 'string' && report.report_link) {
        reportLink = report.report_link;
      }
    } catch {
      /* ignore malformed JSON — proceed without report_link */
    }
  }

  const finalData = reportLink
    ? [
        ...(Array.isArray(filtered) ? filtered : []),
        { name: 'report_link', description: 'Report link', value: reportLink }
      ]
    : Array.isArray(filtered)
      ? filtered
      : [];

  return {
    data: finalData,
    sourceRequestId: row.request_id,
    sourceUserId: row.user_name,
    reportLink
  };
};

module.exports = {
  tryBypass,
  // Re-export for the controller so it doesn't need to pull calculateSHA256
  // out of s3Storage directly.
  calculateSHA256
};
