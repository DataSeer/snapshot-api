// File: src/utils/requestsManager.js
const crypto = require('crypto');
const dbManager = require('./dbManager');
const {
  getAllGenshareRequestsFiles,
  getReportFile,
  getCacheRefFile,
  getFilesListFile,
  getFileMetadataFile,
  getFileBuffer,
  uploadBatchToS3,
  deleteObjectsByPrefix,
  s3Config
} = require('./s3Storage');
const config = require('../config');
const { watchConfig } = require('./configWatcher');

/**
 * Compute SHA-256 hex digest of a Buffer. Used by the refresh --rehash path
 * to regenerate a missing pdf_hash without touching the disk.
 */
const sha256OfBuffer = (buffer) => {
  const hash = crypto.createHash('sha256');
  hash.update(buffer);
  return hash.digest('hex');
};

/**
 * Rebuild the S3 key for a file inside a request folder.
 */
const requestFileKey = (userId, requestId, tail) =>
  `${s3Config.s3Folder}/${userId}/${requestId}/${tail}`;

/**
 * Try to rehash a single request: download PDF, compute SHA-256, rewrite the
 * metadata.json on S3 and update the DB row. Returns true on success, false
 * when the PDF can't be located / fetched. Never throws — the caller logs.
 */
const rehashRequestPdf = async (userId, requestId, filesList, metadata, pdfFileIndex) => {
  // Resolve the main file entry (non-supplementary).
  const mainFile = Array.isArray(filesList)
    ? filesList.find((f) => f.id === pdfFileIndex)
    : null;
  const originalName = mainFile?.originalName || metadata?.originalName;
  if (!originalName) {
    console.warn(`[rehash] ${requestId}: no originalName on file metadata, skipping`);
    return false;
  }
  const extension = originalName.split('.').pop();
  if (!extension) {
    console.warn(`[rehash] ${requestId}: could not derive extension from "${originalName}"`);
    return false;
  }
  const pdfKey = requestFileKey(userId, requestId, `files/file_${pdfFileIndex}.${extension}`);
  const metaKey = requestFileKey(userId, requestId, `files/file_${pdfFileIndex}.metadata.json`);

  // 1. Download the PDF into memory.
  let buffer;
  try {
    buffer = await getFileBuffer(pdfKey);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      console.warn(`[rehash] ${requestId}: PDF not found at ${pdfKey}`);
      return false;
    }
    console.error(`[rehash] ${requestId}: failed to download PDF: ${error.message}`);
    return false;
  }

  // 2. Compute SHA-256.
  const sha256 = sha256OfBuffer(buffer);

  // 3. Write an updated metadata.json back to S3 (preserving existing fields).
  const updatedMetadata = { ...(metadata || {}), sha256 };
  try {
    await uploadBatchToS3([
      {
        key: metaKey,
        data: JSON.stringify(updatedMetadata, null, 2),
        contentType: 'application/json'
      }
    ]);
  } catch (error) {
    console.error(`[rehash] ${requestId}: failed to update metadata.json: ${error.message}`);
    return false;
  }

  // 4. Update DB.
  try {
    await dbManager.setRequestPdfHash(requestId, sha256);
  } catch (error) {
    console.error(`[rehash] ${requestId}: failed to update DB pdf_hash: ${error.message}`);
    return false;
  }

  // 5. Drop the in-memory buffer (explicit hint to GC — user asked to "delete
  // the PDF" after hashing; we never touch disk, so this is all that's left).
  buffer = null;
  return true;
};

// Auto-reloads on file change
const reportsConfig = watchConfig(config.reportsConfigPath, { versions: {} });

/**
 * Initialize database
 * @returns {Promise<void>}
 */
const initDatabase = async () => {
  await dbManager.initDatabase();
};

/**
 * Refresh all requests from S3 and update report data.
 *
 * @param {Object} [options]
 * @param {boolean} [options.rehashMissing=false] When true, for any request
 *   whose per-file metadata.json is missing `sha256`, download the PDF,
 *   compute SHA-256, write the updated metadata back to S3, and update the
 *   DB's pdf_hash column. Slow (per-request PDF download) — only run on
 *   demand via the CLI flag or query param.
 * @returns {Promise<boolean>} - True if refresh successful
 */
const refreshRequestsFromS3 = async (options = {}) => {
  const rehashMissing = options.rehashMissing === true;
  try {
    console.log(
      `Starting refreshRequestsFromS3${rehashMissing ? ' (rehash missing SHA-256)' : ''}...`
    );
    
    // Get all options files from S3
    const requestsFiles = await getAllGenshareRequestsFiles();
    console.log(`Total S3 options files retrieved: ${requestsFiles.length}`);
    
    // Filter to files with valid content
    const validFiles = requestsFiles.filter(file => file.content);
    const withArticleId = validFiles.filter(file => file.content.article_id);
    console.log(`Files with valid content: ${validFiles.length} (${withArticleId.length} with article_id)`);

    // Check for duplicate request_ids
    const requestIds = validFiles.map(file => file.requestId);
    const uniqueRequestIds = new Set(requestIds);
    console.log(`Unique request_ids: ${uniqueRequestIds.size} out of ${requestIds.length}`);

    // Find duplicates
    const duplicateIds = requestIds.filter((id, index) => requestIds.indexOf(id) !== index);
    const uniqueDuplicateIds = [...new Set(duplicateIds)];
    console.log(`Number of duplicate request_ids: ${uniqueDuplicateIds.length}`);
    if (uniqueDuplicateIds.length > 0) {
      console.log(`First few duplicate IDs: ${uniqueDuplicateIds.slice(0, 5).join(', ')}`);
    }

    // Process each file (including those without article_id)
    let insertedCount = 0;
    let errorCount = 0;
    let reportUpdatedCount = 0;
    let reportErrorCount = 0;
    let pdfHashBackfilled = 0;
    let pdfHashRehashed = 0;
    let pdfHashRehashSkipped = 0;
    let cacheKeyBackfilled = 0;

    for (const file of requestsFiles) {
      if (file.content) {
        try {
          // Format the date for record
          const formattedDate = file.lastModified instanceof Date
            ? file.lastModified.toISOString().replace('T', ' ').split('.')[0]
            : new Date(file.lastModified).toISOString().replace('T', ' ').split('.')[0];

          // Try to get report data from S3
          let reportData = null;
          try {
            reportData = await getReportFile(file.userId, file.requestId);
            if (reportData) {
              reportUpdatedCount++;
            }
          } catch (reportError) {
            reportErrorCount++;
          }

          // Add/update request with report data if available. Use empty string
          // for missing article_id. Note: addOrUpdateRequest never clobbers
          // the is_demo flag — demo state survives a refresh untouched.
          await dbManager.addOrUpdateRequest(
            file.userId,
            file.content.article_id || '',
            file.requestId,
            reportData,
            formattedDate
          );

          // Backfill pdf_hash from the per-file metadata written at upload
          // time. Only the main PDF file (non-supplementary) carries the
          // hash the demo-bypass layer keys on.
          try {
            const filesList = await getFilesListFile(file.userId, file.requestId);
            let pdfFileIndex = null;
            if (Array.isArray(filesList) && filesList.length > 0) {
              const mainFile = filesList.find((f) => f.fieldname !== 'supplementary_file') || filesList[0];
              if (mainFile && typeof mainFile.id === 'number') {
                pdfFileIndex = mainFile.id;
              }
            }
            // Older sessions have no files.json; fall back to file_1.
            const resolvedIndex = pdfFileIndex || 1;
            const metadata = await getFileMetadataFile(
              file.userId,
              file.requestId,
              resolvedIndex
            );
            if (metadata && typeof metadata.sha256 === 'string' && metadata.sha256) {
              await dbManager.setRequestPdfHash(file.requestId, metadata.sha256);
              pdfHashBackfilled++;
            } else if (rehashMissing) {
              // Opt-in: download PDF, compute SHA-256, rewrite metadata.json
              // on S3, update DB.
              const rehashed = await rehashRequestPdf(
                file.userId,
                file.requestId,
                filesList,
                metadata,
                resolvedIndex
              );
              if (rehashed) {
                pdfHashRehashed++;
              } else {
                pdfHashRehashSkipped++;
              }
            }
          } catch (hashError) {
            console.error(`[refresh] Failed to backfill pdf_hash for ${file.requestId}:`, hashError.message);
          }

          // Backfill cache_key from cache-ref.json when the cache-substitution
          // layer ran for this request.
          try {
            const cacheRef = await getCacheRefFile(file.userId, file.requestId);
            if (cacheRef && typeof cacheRef.cache_key === 'string' && cacheRef.cache_key) {
              await dbManager.setRequestCacheKey(file.requestId, cacheRef.cache_key);
              cacheKeyBackfilled++;
            }
          } catch (cacheError) {
            console.error(`[refresh] Failed to backfill cache_key for ${file.requestId}:`, cacheError.message);
          }

          insertedCount++;
        } catch (error) {
          console.error(`Exception processing file ${file.requestId}:`, error);
          errorCount++;
        }
      }
    }

    const rehashSummary = rehashMissing
      ? `, ${pdfHashRehashed} rehashed, ${pdfHashRehashSkipped} rehash-skipped`
      : '';
    console.log(
      `S3 refresh complete: ${insertedCount} processed, ${reportUpdatedCount} reports found, ` +
      `${reportErrorCount} reports missing, ${pdfHashBackfilled} pdf_hash backfilled${rehashSummary}, ` +
      `${cacheKeyBackfilled} cache_key backfilled, ${errorCount} errors`
    );
    
    return true;
  } catch (error) {
    console.error('Error refreshing requests from S3:', error);
    throw error;
  }
};

/**
 * Search for requests by article_id or request_id (supports cross-user search)
 * @param {string|null} userId - User ID (if null, searches across all users)
 * @param {string} articleId - Article ID (optional)
 * @param {string} requestId - Request ID (optional)
 * @returns {Promise<Object|null>} - Search result with metadata or null if not found
 */
const searchRequests = async (userId = null, articleId = null, requestId = null) => {
  try {
    let finalRequestId = null;
    let associatedArticleId = null;
    let requestRecord = null;

    // If request_id is provided, try to find it first
    if (requestId) {
      if (userId) {
        // User-specific search
        requestRecord = await dbManager.getRequestWithReportData(userId, requestId);
      } else {
        // Cross-user search
        requestRecord = await dbManager.getRequestWithReportDataAnyUser(requestId);
      }
      
      if (requestRecord) {
        finalRequestId = requestId;
        associatedArticleId = requestRecord.article_id;
      }
    }

    // If no record found by request_id, try article_id
    if (!requestRecord && articleId) {
      // Get all requests for this article_id
      let allRequestsForArticle;
      if (userId) {
        // User-specific search
        allRequestsForArticle = await dbManager.getRequestsWithReportDataByArticleId(userId, articleId);
      } else {
        // Cross-user search
        allRequestsForArticle = await dbManager.getRequestsWithReportDataByArticleIdAnyUser(articleId);
      }
      
      if (allRequestsForArticle && allRequestsForArticle.length > 0) {
        // Return the most recent request (first in the sorted array)
        requestRecord = allRequestsForArticle[0];
        finalRequestId = requestRecord.request_id;
        associatedArticleId = articleId;
      }
    }

    // If still no record found
    if (!requestRecord) {
      return null;
    }

    // Return the search result with metadata
    return {
      meta: {
        found_by: finalRequestId === requestId ? 'request_id' : 'article_id',
        request_id: finalRequestId,
        article_id: associatedArticleId,
        user_id: requestRecord.user_name, // Use the actual user from the record
        search_used: {
          request_id: !!requestId,
          article_id: !!articleId,
          cross_user_search: !userId
        },
        has_report: !!requestRecord.report_data,
        created_at: requestRecord.created_at,
        updated_at: requestRecord.updated_at
      },
      request_id: finalRequestId,
      article_id: associatedArticleId,
      user_id: requestRecord.user_name, // Include the actual user who owns this request
      report_data: requestRecord.report_data
    };

  } catch (error) {
    console.error('Error searching requests:', error);
    throw error;
  }
};

/**
 * Get report data for a specific request (supports cross-user access)
 * @param {string} userId - User ID
 * @param {string} requestId - Request ID
 * @returns {Promise<Object|null>} - Complete report data with metadata or null if not found
 */
const getRequestReport = async (userId, requestId) => {
  try {
    // Get the request with report data
    // Note: userId here refers to the target user whose data we want to access
    const requestRecord = await dbManager.getRequestWithReportData(userId, requestId);
    
    if (!requestRecord || !requestRecord.report_data) {
      return null;
    }

    // Return complete report data with metadata
    return {
      meta: {
        request_id: requestId,
        article_id: requestRecord.article_id,
        user_id: userId,
        created_at: requestRecord.created_at,
        updated_at: requestRecord.updated_at
      },
      ...requestRecord.report_data
    };

  } catch (error) {
    console.error('Error getting request report:', error);
    throw error;
  }
};

/**
 * Get report URL for a specific request (supports cross-user access)
 * @param {string} userId - User ID
 * @param {string} requestId - Request ID
 * @returns {Promise<string|null>} - Report URL or null if not found
 */
const getRequestReportUrl = async (userId, requestId) => {
  try {
    // Get the request with report data
    // Note: userId here refers to the target user whose data we want to access
    const requestRecord = await dbManager.getRequestWithReportData(userId, requestId);
    
    if (!requestRecord || !requestRecord.report_data) {
      return null;
    }

    // Extract URL from report data
    const reportData = requestRecord.report_data;
    
    // Check for various possible URL field names
    if (reportData.report_link) {
      return reportData.report_link;
    }

    // If no URL found in report data
    return null;

  } catch (error) {
    console.error('Error getting request report URL:', error);
    throw error;
  }
};

/**
 * Add or update a request
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @param {string} requestId - The request ID
 * @param {string|Date|null} lastModified - Last modification date (optional)
 * @returns {Promise<Object>} - Result with changes count
 */
const addOrUpdateRequest = async (userName, articleId, requestId, lastModified = null) => {
  // Format the date if provided
  let formattedDate = null;
  if (lastModified) {
    formattedDate = lastModified instanceof Date
      ? lastModified.toISOString()
      : new Date(lastModified).toISOString();
  }
  
  return await dbManager.addOrUpdateRequest(userName, articleId, requestId, null, formattedDate);
};

/**
 * Add or update a request with report data
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @param {string} requestId - The request ID
 * @param {Object} reportData - The report data
 * @param {string|Date|null} lastModified - Last modification date (optional)
 * @returns {Promise<Object>} - Result with changes count
 */
const addOrUpdateRequestWithReport = async (userName, articleId, requestId, reportData, lastModified = null) => {
  // Format the date if provided
  let formattedDate = null;
  if (lastModified) {
    formattedDate = lastModified instanceof Date
      ? lastModified.toISOString()
      : new Date(lastModified).toISOString();
  }
  
  return await dbManager.addOrUpdateRequest(userName, articleId, requestId, reportData, formattedDate);
};

/**
 * Update report data for a request
 * @param {string} requestId - The request ID
 * @param {Object} reportData - The report data
 * @returns {Promise<boolean>} - True if update was successful
 */
const updateRequestReportData = async (requestId, reportData) => {
  return await dbManager.updateRequestReportData(requestId, reportData);
};

/**
 * Delete a request
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @param {string|null} requestId - The request ID (optional)
 * @returns {Promise<Object>} - Result with changes count
 */
const deleteRequest = async (userName, articleId, requestId = null) => {
  return await dbManager.deleteRequest(userName, articleId, requestId);
};

/**
 * Completely delete a request: S3 objects + all DB records
 * @param {string} requestId - The request ID to delete
 * @returns {Promise<Object>} - Deletion result with details
 */
const deleteRequestComplete = async (requestId) => {
  // Get request record to find user_name (needed for S3 path)
  const request = await dbManager.getRequestByRequestId(requestId);
  if (!request) {
    return null;
  }

  const userName = request.user_name;

  // Delete S3 objects under {s3Folder}/{userName}/{requestId}/
  const s3Prefix = `${s3Config.s3Folder}/${userName}/${requestId}/`;
  let s3DeletedCount = 0;
  try {
    s3DeletedCount = await deleteObjectsByPrefix(s3Prefix);
    console.log(`[RequestsManager] Deleted ${s3DeletedCount} S3 objects for request ${requestId}`);
  } catch (s3Error) {
    console.error(`[RequestsManager] Error deleting S3 objects for request ${requestId}:`, s3Error);
    // Continue with DB deletion even if S3 fails
  }

  // Delete DB record from requests table
  const dbResult = await dbManager.deleteRequest(userName, null, requestId);
  console.log(`[RequestsManager] Deleted ${dbResult.changes} request DB record(s) for ${requestId}`);

  // Delete DB record from processing_jobs table (if exists)
  const jobResult = await dbManager.deleteJobByRequestId(requestId);
  console.log(`[RequestsManager] Deleted ${jobResult.changes} job DB record(s) for ${requestId}`);

  // Delete DB record from editorial-manager-submissions table (if exists)
  const emResult = await dbManager.deleteEmSubmissionByRequestId(requestId);
  console.log(`[RequestsManager] Deleted ${emResult.changes} EM submission DB record(s) for ${requestId}`);

  // Delete DB record from scholarone-submissions table (if exists)
  const scholaroneResult = await dbManager.deleteScholaroneSubmissionByRequestId(requestId);
  console.log(`[RequestsManager] Deleted ${scholaroneResult.changes} ScholarOne submission DB record(s) for ${requestId}`);

  // Delete DB record from snapshot-mails-submissions table (if exists)
  const snapshotMailsResult = await dbManager.deleteSnapshotMailsSubmissionByRequestId(requestId);
  console.log(`[RequestsManager] Deleted ${snapshotMailsResult.changes} Snapshot Mails submission DB record(s) for ${requestId}`);

  // Delete DB records from scholarone-notifications table (if exists)
  const notificationsResult = await dbManager.deleteScholaroneNotificationsByRequestId(requestId);
  console.log(`[RequestsManager] Deleted ${notificationsResult.changes} ScholarOne notification DB record(s) for ${requestId}`);

  // Build response with only non-zero counts to avoid exposing irrelevant info
  const result = {
    request_id: requestId,
    user_name: userName
  };

  if (s3DeletedCount > 0) result.s3_objects_deleted = s3DeletedCount;
  if (dbResult.changes > 0) result.db_requests_deleted = dbResult.changes;
  if (jobResult.changes > 0) result.db_jobs_deleted = jobResult.changes;
  if (emResult.changes > 0) result.db_em_submissions_deleted = emResult.changes;
  if (scholaroneResult.changes > 0) result.db_scholarone_submissions_deleted = scholaroneResult.changes;
  if (snapshotMailsResult.changes > 0) result.db_snapshot_mails_submissions_deleted = snapshotMailsResult.changes;
  if (notificationsResult.changes > 0) result.db_scholarone_notifications_deleted = notificationsResult.changes;

  return result;
};

/**
 * Get request_id for a given article_id (return the newest one)
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @returns {Promise<string|null>} - The request ID or null if not found
 */
const getRequestIdByArticleId = async (userName, articleId) => {
  return await dbManager.getRequestIdByArticleId(userName, articleId);
};

/**
 * Get article_id for a given request_id
 * @param {string} userName - The user name
 * @param {string} requestId - The request ID
 * @returns {Promise<string|null>} - The article ID or null if not found
 */
const getArticleIdByRequestId = async (userName, requestId) => {
  return await dbManager.getArticleIdByRequestId(userName, requestId);
};

/**
 * Get all request_ids for a given article_id (ordered by newest first)
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @returns {Promise<string[]>} - Array of request IDs
 */
const getRequestIdsByArticleId = async (userName, articleId) => {
  return await dbManager.getRequestIdsByArticleId(userName, articleId);
};

/**
 * Get request with report data by request ID
 * @param {string} userName - The user name
 * @param {string} requestId - The request ID
 * @returns {Promise<Object|null>} - Request record with report data or null
 */
const getRequestWithReportData = async (userName, requestId) => {
  return await dbManager.getRequestWithReportData(userName, requestId);
};

/**
 * Get all requests with report data for a user and article
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @returns {Promise<Array>} - Array of request records
 */
const getRequestsWithReportDataByArticleId = async (userName, articleId) => {
  return await dbManager.getRequestsWithReportDataByArticleId(userName, articleId);
};

/*
 * REPORTS FUNCTIONALITY (consolidated from old reportsManager)
 */

/**
 * Build the JSON data based on report configuration, GenShare response data & report URL
 * @param {string} version - Version of the report
 * @param {Array} responseData - Array of response data from GenShare
 * @param {string} reportURL - URL of the report
 * @returns {Object} - Object containing the report JSON data
 */
const buildJSON = (version, responseData, reportURL) => {
  const versions = reportsConfig.versions || {};
  if (!versions[version]) {
    const known = Object.keys(versions);
    return new Error(
      `Report version '${version}' not found in conf/reports.json. ` +
        `Currently configured: ${known.length ? known.join(', ') : '(none)'}.`
    );
  }

  // Prepare JSON data based on JSON report available/restricted fields
  const result = {};

  const filteredResponseData = filterResponseForJSON(version, responseData);
  filteredResponseData.forEach(item => {
    result[item.name] = item.value;
  });

  // If there's a reportURL, set the value in the JSON if it's not already defined
  if (!!reportURL && !result["report_link"]) {
    result["report_link"] = reportURL;
  }

  return result;
};

/**
 * Filter GenShare response based on JSON report's permissions
 * @param {string} version - Report version
 * @param {Array} responseData - Response data from GenShare
 * @returns {Array} - Filtered response
 */
const filterResponseForJSON = (version, responseData) => {
  const versions = reportsConfig.versions || {};
  if (!version || !versions[version]) {
    const known = Object.keys(versions);
    return new Error(
      `Report version '${version}' not found in conf/reports.json. ` +
        `Currently configured: ${known.length ? known.join(', ') : '(none)'}.`
    );
  }

  // If no response data or no filter settings, return as is
  if (!responseData || !versions[version].JSON) {
    return responseData;
  }

  const { availableFields, restrictedFields } = versions[version].JSON;

  // If no filter restrictions, return full response
  if ((!availableFields || availableFields.length === 0) && 
      (!restrictedFields || restrictedFields.length === 0)) {
    return responseData;
  }

  // Create a deep copy to avoid modifying original
  let filteredResponse = JSON.parse(JSON.stringify(responseData));

  // Filter the response array
  if (Array.isArray(filteredResponse)) {
    if (availableFields && availableFields.length > 0) {
      // Include only available fields
      filteredResponse = filteredResponse.filter(item => 
        availableFields.includes(item.name)
      );
    } else if (restrictedFields && restrictedFields.length > 0) {
      // Exclude restricted fields
      filteredResponse = filteredResponse.filter(item => 
        !restrictedFields.includes(item.name)
      );
    }
  }

  return filteredResponse;
};

module.exports = {
  initDatabase,
  refreshRequestsFromS3,
  
  // New consolidated search/report methods (with cross-user support)
  searchRequests,
  getRequestReport,
  getRequestReportUrl,
  
  // Basic request management
  addOrUpdateRequest,
  addOrUpdateRequestWithReport,
  updateRequestReportData,
  deleteRequest,
  deleteRequestComplete,
  getRequestIdByArticleId,
  getArticleIdByRequestId,
  getRequestIdsByArticleId,
  getRequestWithReportData,
  getRequestsWithReportDataByArticleId,

  // Reports functionality
  buildJSON
};
