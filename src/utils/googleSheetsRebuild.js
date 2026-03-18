// File: src/utils/googleSheetsRebuild.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const config = require('../config');
const { watchConfig } = require('./configWatcher');
const genshareConfig = watchConfig(config.genshareConfigPath);
const logsConfig = watchConfig(config.googleSheetsLogsConfigPath);
const instanceConfig = watchConfig(config.instanceConfigPath, {});

const {
  sheetsService,
  createLogSpreadsheet,
  ensureUserFolder
} = require('./googleSheets');

const {
  buildSummaryRowData,
  getSummaryHeaders,
  buildUserLogRowData,
  getUserLogHeaders
} = require('./genshareManager');

const { searchRequestsFiltered } = require('./dbManager');
const { getGenshareResponseFile, getProcessFile, getApiResponseFile, getFile, s3Config } = require('./s3Storage');
const { refreshRequestsFromS3 } = require('./requestsManager');

/** Max rows per Google Sheets API append call */
const CHUNK_SIZE = 5000;

/** S3 fetch parallelism */
const S3_BATCH_SIZE = 10;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const processBatches = async (items, batchSize, processFn) => {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processFn));
    results.push(...batchResults);
  }
  return results;
};

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-rebuild-'));

const cleanupTempDir = (dirPath) => {
  try {
    for (const file of fs.readdirSync(dirPath)) {
      fs.unlinkSync(path.join(dirPath, file));
    }
    fs.rmdirSync(dirPath);
  } catch {
    // Ignore cleanup errors
  }
};

const safeFilename = (name) => name.replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * Append a JSON line to a temp file (no sorting).
 */
const appendLineToFile = (filePath, data) => {
  fs.appendFileSync(filePath, JSON.stringify(data) + '\n');
};

/**
 * Append a row to a tab JSONL file with an ISO date prefix for chronological sorting.
 * Format: "ISO_DATE\tJSON_ROW_DATA\n"
 */
const appendSortableLineToFile = (filePath, date, data) => {
  fs.appendFileSync(filePath, `${date}\t${JSON.stringify(data)}\n`);
};

/**
 * Parse process.log content and extract metadata.
 * @param {string} content - Raw process.log content
 * @returns {Object} - { reportVersion, reportURL, graphValue, errorStatus, genshareVersion }
 */
const parseProcessLogContent = (content) => {
  const result = { reportVersion: '', reportURL: '', graphValue: '', errorStatus: '', genshareVersion: '' };
  if (!content) return result;

  const lines = content.split('\n');
  for (const line of lines) {
    if (!result.reportVersion) {
      const m = line.match(/Using report:\s*(.+)/);
      if (m) result.reportVersion = m[1].trim();
    }
    if (!result.reportURL) {
      const m = line.match(/report created successfully:\s*(https?:\/\/\S+)/);
      if (m) result.reportURL = m[1].trim();
    }
    if (!result.graphValue) {
      const m = line.match(/GenShare graph value returned found:\s*(.+)/);
      if (m) result.graphValue = m[1].trim();
    }
    if (!result.errorStatus) {
      const m = line.match(/Error processing request:\s*(.+)/);
      if (m) result.errorStatus = m[1].trim();
    }
    // Prefer the version returned by genshare (set after response)
    const setV = line.match(/Genshare Version set to:\s*(v?[\d.]+)/);
    if (setV) {
      result.genshareVersion = setV[1].startsWith('v') ? setV[1] : `v${setV[1]}`;
    }
    // Fallback for errors (genshare never responded)
    if (!result.genshareVersion) {
      const useV = line.match(/Using GenShare version:\s*(?:\S+\s+\()?(v[\d.]+)\)?/);
      if (useV) result.genshareVersion = useV[1].trim();
    }
  }
  return result;
};

// ============================================================================
// GOOGLE SHEETS UPLOAD HELPERS
// ============================================================================

/**
 * Read a tab JSONL file, sort rows chronologically (oldest first), then upload in chunks.
 * Each line has format: "ISO_DATE\tJSON_ROW_DATA"
 */
const uploadFileToSheet = async (spreadsheetId, tabName, filePath, headers) => {
  // Read all lines and sort by date prefix (oldest first)
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  const sortedLines = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    sortedLines.push(line);
  }
  sortedLines.sort(); // ISO date prefix ensures correct chronological sort

  // Upload in chunks
  let chunk = [headers];
  let totalRows = 0;
  let isFirstChunk = true;

  for (const line of sortedLines) {
    const tabIdx = line.indexOf('\t');
    const rowData = JSON.parse(line.substring(tabIdx + 1));
    chunk.push(rowData);
    totalRows++;

    if (chunk.length >= CHUNK_SIZE) {
      if (isFirstChunk) {
        await sheetsService.spreadsheets.values.update({
          spreadsheetId, range: `'${tabName}'!A1`, valueInputOption: 'USER_ENTERED',
          requestBody: { values: chunk }
        });
        isFirstChunk = false;
      } else {
        await sheetsService.spreadsheets.values.append({
          spreadsheetId, range: `'${tabName}'!A1`, valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS', requestBody: { values: chunk }
        });
      }
      chunk = [];
    }
  }

  if (chunk.length > 0) {
    if (isFirstChunk) {
      await sheetsService.spreadsheets.values.update({
        spreadsheetId, range: `'${tabName}'!A1`, valueInputOption: 'USER_ENTERED',
        requestBody: { values: chunk }
      });
    } else {
      await sheetsService.spreadsheets.values.append({
        spreadsheetId, range: `'${tabName}'!A1`, valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS', requestBody: { values: chunk }
      });
    }
  }

  return totalRows;
};

/**
 * Create all tabs in one batchUpdate and delete the default Sheet1.
 */
const createAllTabs = async (spreadsheetId, tabNames) => {
  if (tabNames.length === 0) return;

  const spreadsheet = await sheetsService.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const existingSheets = spreadsheet.data.sheets || [];
  const existingNames = new Set(existingSheets.map(s => s.properties.title));
  const defaultSheet = existingSheets.find(s => s.properties.title === 'Sheet1');

  const addRequests = tabNames
    .filter(name => !existingNames.has(name))
    .map(name => ({ addSheet: { properties: { title: name } } }));

  if (addRequests.length > 0) {
    await sheetsService.spreadsheets.batchUpdate({ spreadsheetId, resource: { requests: addRequests } });
  }

  if (defaultSheet && tabNames.length > 0) {
    try {
      await sheetsService.spreadsheets.batchUpdate({
        spreadsheetId, resource: { requests: [{ deleteSheet: { sheetId: defaultSheet.properties.sheetId } }] }
      });
    } catch {
      // Ignore
    }
  }
};

// ============================================================================
// S3 DATA EXTRACTION — SINGLE PASS CACHE
// ============================================================================

/**
 * Fetch all S3 data for all requests in one pass, write a unified JSONL cache file.
 * Each line contains all fields needed by both genshare and user rebuilds.
 * @param {Array} requests - DB request records
 * @param {string} cacheFilePath - Path to write the cache JSONL file
 * @returns {Promise<Object>} - { processedCount, skippedCount }
 */
const buildS3Cache = async (requests, cacheFilePath) => {
  let processedCount = 0;
  let skippedCount = 0;

  await processBatches(requests, S3_BATCH_SIZE, async (request) => {
    try {
      const userId = request.user_name;
      const requestId = request.request_id;

      // Fetch all 4 S3 files in parallel
      let processData, genshareResponse, apiResponse, logContent;
      try {
        [processData, genshareResponse, apiResponse, logContent] = await Promise.all([
          getProcessFile(userId, requestId),
          getGenshareResponseFile(userId, requestId),
          getApiResponseFile(userId, requestId),
          getFile(`${s3Config.s3Folder}/${userId}/${requestId}/process.log`).catch(() => null)
        ]);
      } catch {
        skippedCount++;
        return null;
      }

      const logData = parseProcessLogContent(logContent);

      if (!processData && !genshareResponse && !logData.errorStatus) {
        skippedCount++;
        return null;
      }

      // Extract all fields once
      const genshareVersion = processData?.genshareVersion || logData.genshareVersion || '';
      const snapshotAPIVersion = processData?.snapshotAPIVersion || '';

      let date;
      if (processData?.startDate) {
        date = new Date(processData.startDate).toISOString();
      } else if (request.created_at) {
        date = new Date(request.created_at).toISOString();
      } else {
        date = new Date().toISOString();
      }

      let duration = 0;
      if (processData?.duration) {
        duration = parseInt(processData.duration, 10) || 0;
      }

      let errorStatus = 'No';
      if (logData.errorStatus) {
        errorStatus = logData.errorStatus;
      } else if (genshareResponse && genshareResponse.status !== undefined && genshareResponse.status !== 200) {
        errorStatus = `Error (${genshareResponse.status})`;
      }

      const genshareResponseData = genshareResponse?.data?.response || [];
      const filteredData = apiResponse?.data || [];
      const filename = genshareResponse?.data?.filename || apiResponse?.filename || request.article_id || 'N/A';
      const reportURL = logData.reportURL || '';
      const reportVersion = logData.reportVersion || '';
      const graphValue = genshareResponse?.data?.graph_policy_traversal_data?.graph_type || logData.graphValue || '';

      // Write one cache line with everything
      appendLineToFile(cacheFilePath, {
        requestId,
        userId,
        articleId: request.article_id || '',
        date,
        snapshotAPIVersion,
        genshareVersion,
        duration,
        errorStatus,
        filename,
        reportVersion,
        reportURL,
        graphValue,
        genshareResponseData,
        filteredData
      });

      processedCount++;
      if (processedCount % 100 === 0) {
        console.log(`[S3 Cache] Processed ${processedCount}/${requests.length} requests`);
      }

      return true;
    } catch (error) {
      console.warn(`[S3 Cache] Error processing request ${request.request_id}: ${error.message}`);
      skippedCount++;
      return null;
    }
  });

  return { processedCount, skippedCount };
};

/**
 * Stream-read the cache file and yield parsed entries.
 * @param {string} cacheFilePath - Path to the cache JSONL file
 * @returns {AsyncIterable<Object>} - Cache entries
 */
const readCacheEntries = (cacheFilePath) => {
  return readline.createInterface({ input: fs.createReadStream(cacheFilePath), crlfDelay: Infinity });
};

// ============================================================================
// REBUILD FROM CACHE — GENSHARE
// ============================================================================

/**
 * Build genshare rebuild spreadsheet from a cache file.
 * @param {string} cacheFilePath - Path to the JSONL cache
 * @param {string} tempDir - Temp directory for tab data files
 * @returns {Promise<Object>} - Result
 */
const rebuildAdminFromCache = async (cacheFilePath, tempDir) => {
  const folderId = logsConfig.folderId;
  const s3ManagerUrl = (instanceConfig.s3ManagerUrl || '').replace(/\/+$/, '');
  const tabMeta = {}; // { tabName: { filePath, versionAlias, rowCount } }
  let processedCount = 0;

  // 1. Stream cache → build genshare rows → write to tab files
  const rl = readCacheEntries(cacheFilePath);
  for await (const line of rl) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);

    let genshareVersionAlias = 'latest';
    if (entry.genshareVersion) {
      for (const [alias, cfg] of Object.entries(genshareConfig.versions)) {
        if (cfg.version === entry.genshareVersion) {
          genshareVersionAlias = alias;
          break;
        }
      }
    }

    // Build s3-manager request URL for the hyperlink
    const requestUrl = s3ManagerUrl ? `${s3ManagerUrl}/request/${entry.requestId}` : null;

    const rowData = buildSummaryRowData({
      requestId: entry.requestId,
      s3Url: requestUrl,
      snapshotAPIVersion: entry.snapshotAPIVersion,
      genshareVersion: entry.genshareVersion,
      genshareVersionAlias,
      errorStatus: entry.errorStatus,
      date: new Date(entry.date),
      duration: entry.duration,
      userId: entry.userId,
      filename: entry.filename,
      reportVersion: entry.reportVersion,
      reportURL: entry.reportURL,
      graphValue: entry.graphValue,
      articleId: entry.articleId,
      responseData: entry.genshareResponseData
    });

    const tabVersion = entry.genshareVersion || 'unknown';
    const tabName = `SnapShot Response (${tabVersion})`;

    if (!tabMeta[tabName]) {
      const filePath = path.join(tempDir, `admin_${safeFilename(tabName)}.jsonl`);
      tabMeta[tabName] = { filePath, versionAlias: genshareVersionAlias, rowCount: 0 };
    }

    appendSortableLineToFile(tabMeta[tabName].filePath, entry.date, rowData);
    tabMeta[tabName].rowCount++;
    processedCount++;
  }

  if (processedCount === 0) {
    throw new Error('No requests found in cache for genshare rebuild');
  }

  // 2. Create spreadsheet and upload
  const dateStr = new Date().toISOString().slice(0, 10);
  const newName = `Snapshot Logs - Genshare (${dateStr})`;
  console.log(`[Rebuild Admin] Creating spreadsheet: ${newName} (${processedCount} rows)`);

  const newSpreadsheetId = await createLogSpreadsheet(newName, folderId);
  const tabNames = Object.keys(tabMeta);
  await createAllTabs(newSpreadsheetId, tabNames);

  for (const [tabName, meta] of Object.entries(tabMeta)) {
    console.log(`[Rebuild Admin] Uploading tab "${tabName}" (${meta.rowCount} rows)...`);
    const headers = getSummaryHeaders(meta.versionAlias);
    await uploadFileToSheet(newSpreadsheetId, tabName, meta.filePath, headers);
  }

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}`;
  console.log(`[Rebuild Admin] Complete. ${spreadsheetUrl}`);

  return { spreadsheetId: newSpreadsheetId, spreadsheetUrl, processedCount, tabs: tabNames };
};

// ============================================================================
// REBUILD FROM CACHE — USER
// ============================================================================

/**
 * Build a user rebuild spreadsheet from a cache file.
 * Reads only entries matching the given userId.
 * @param {string} userId - User ID to filter
 * @param {string} cacheFilePath - Path to the JSONL cache
 * @param {string} tempDir - Temp directory for tab data files
 * @returns {Promise<Object>} - Result
 */
const rebuildUserFromCache = async (userId, cacheFilePath, tempDir) => {
  const folderId = await ensureUserFolder(userId);
  const tabMeta = {}; // { tabName: { filePath, firstFilteredData, rowCount } }
  let processedCount = 0;

  // 1. Stream cache → filter by userId → build user rows → write to tab files
  const rl = readCacheEntries(cacheFilePath);
  for await (const line of rl) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);

    if (entry.userId !== userId) continue;

    const rowData = buildUserLogRowData({
      requestId: entry.requestId,
      date: new Date(entry.date),
      duration: entry.duration,
      filename: entry.filename,
      genshareVersion: entry.genshareVersion,
      reportVersion: entry.reportVersion,
      reportURL: entry.reportURL,
      graphValue: entry.graphValue,
      articleId: entry.articleId,
      filteredData: entry.filteredData
    });

    const date = new Date(entry.date);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const tabName = `Snapshot Response - ${month}/${year}`;

    if (!tabMeta[tabName]) {
      const filePath = path.join(tempDir, `user_${safeFilename(userId)}_${safeFilename(tabName)}.jsonl`);
      tabMeta[tabName] = { filePath, firstFilteredData: entry.filteredData, rowCount: 0 };
    }

    if ((!tabMeta[tabName].firstFilteredData || tabMeta[tabName].firstFilteredData.length === 0) && entry.filteredData.length > 0) {
      tabMeta[tabName].firstFilteredData = entry.filteredData;
    }

    appendSortableLineToFile(tabMeta[tabName].filePath, entry.date, rowData);
    tabMeta[tabName].rowCount++;
    processedCount++;
  }

  if (processedCount === 0) {
    console.log(`[Rebuild User] No requests found for user "${userId}" — skipping`);
    return { spreadsheetId: null, spreadsheetUrl: null, processedCount: 0, tabs: [] };
  }

  // 2. Create spreadsheet and upload
  const dateStr = new Date().toISOString().slice(0, 10);
  const newName = `Snapshot Logs - ${userId} (${dateStr})`;
  console.log(`[Rebuild User] Creating spreadsheet: ${newName} (${processedCount} rows)`);

  const newSpreadsheetId = await createLogSpreadsheet(newName, folderId);
  const tabNames = Object.keys(tabMeta);
  await createAllTabs(newSpreadsheetId, tabNames);

  for (const [tabName, meta] of Object.entries(tabMeta)) {
    console.log(`[Rebuild User] Uploading tab "${tabName}" (${meta.rowCount} rows)...`);
    const headers = getUserLogHeaders(meta.firstFilteredData);
    await uploadFileToSheet(newSpreadsheetId, tabName, meta.filePath, headers);
  }

  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${newSpreadsheetId}`;
  console.log(`[Rebuild User] Complete. ${spreadsheetUrl}`);

  return { spreadsheetId: newSpreadsheetId, spreadsheetUrl, processedCount, tabs: tabNames };
};

// ============================================================================
// PUBLIC API — STANDALONE REBUILDS (with their own S3 pass)
// ============================================================================

/**
 * Rebuild admin/genshare logs (standalone — does its own S3 pass).
 * @returns {Promise<Object>}
 */
const rebuildAdminLogs = async () => {
  console.log('[Rebuild Admin] Fetching all requests from database...');
  const { requests } = await searchRequestsFiltered({ limit: 100000, offset: 0 });
  console.log(`[Rebuild Admin] Found ${requests.length} requests`);

  if (requests.length === 0) {
    throw new Error('No requests found in database');
  }

  const tempDir = createTempDir();
  try {
    const cacheFilePath = path.join(tempDir, 'cache.jsonl');
    console.log('[Rebuild Admin] Building S3 cache...');
    const { processedCount, skippedCount } = await buildS3Cache(requests, cacheFilePath);
    console.log(`[Rebuild Admin] S3 cache: ${processedCount} processed, ${skippedCount} skipped`);

    return await rebuildAdminFromCache(cacheFilePath, tempDir);
  } finally {
    cleanupTempDir(tempDir);
  }
};

/**
 * Rebuild user logs (standalone — does its own S3 pass).
 * @param {string} userId - User ID
 * @returns {Promise<Object>}
 */
const rebuildUserLogs = async (userId) => {
  console.log(`[Rebuild User] Fetching requests for user "${userId}"...`);
  const { requests } = await searchRequestsFiltered({ user_name: userId, limit: 100000, offset: 0 });
  console.log(`[Rebuild User] Found ${requests.length} requests`);

  if (requests.length === 0) {
    throw new Error(`No requests found for user "${userId}"`);
  }

  const tempDir = createTempDir();
  try {
    const cacheFilePath = path.join(tempDir, 'cache.jsonl');
    console.log('[Rebuild User] Building S3 cache...');
    const { processedCount, skippedCount } = await buildS3Cache(requests, cacheFilePath);
    console.log(`[Rebuild User] S3 cache: ${processedCount} processed, ${skippedCount} skipped`);

    return await rebuildUserFromCache(userId, cacheFilePath, tempDir);
  } finally {
    cleanupTempDir(tempDir);
  }
};

// ============================================================================
// PUBLIC API — REBUILD ALL (single S3 pass, shared cache)
// ============================================================================

/**
 * Rebuild all Google Sheets logs (admin + all configured users).
 * Single S3 pass: fetches all data once, then rebuilds genshare + all users from cache.
 * @returns {Promise<Object>} - { admin, users }
 */
const rebuildAllLogs = async () => {
  // 1. Refresh database from S3
  console.log('[Rebuild All] Refreshing requests from S3...');
  await refreshRequestsFromS3();
  console.log('[Rebuild All] S3 refresh complete.\n');

  // 2. Query all requests
  console.log('[Rebuild All] Fetching all requests from database...');
  const { requests } = await searchRequestsFiltered({ limit: 100000, offset: 0 });
  console.log(`[Rebuild All] Found ${requests.length} requests`);

  if (requests.length === 0) {
    throw new Error('No requests found in database');
  }

  const tempDir = createTempDir();
  try {
    // 3. Single S3 pass — build unified cache
    const cacheFilePath = path.join(tempDir, 'cache.jsonl');
    console.log('[Rebuild All] Building S3 cache (single pass)...');
    const { processedCount, skippedCount } = await buildS3Cache(requests, cacheFilePath);
    console.log(`[Rebuild All] S3 cache: ${processedCount} processed, ${skippedCount} skipped\n`);

    // 4. Rebuild genshare from cache
    console.log('[Rebuild All] Rebuilding admin logs from cache...');
    const adminResult = await rebuildAdminFromCache(cacheFilePath, tempDir);

    // 5. Rebuild each user from the SAME cache
    const userResults = {};
    const userIds = Object.keys(logsConfig.users || {});
    console.log(`\n[Rebuild All] Rebuilding logs for ${userIds.length} users: ${userIds.join(', ')}`);

    for (const userId of userIds) {
      try {
        console.log(`\n[Rebuild All] Rebuilding logs for user "${userId}"...`);
        userResults[userId] = await rebuildUserFromCache(userId, cacheFilePath, tempDir);
      } catch (error) {
        console.error(`[Rebuild All] Error rebuilding logs for user "${userId}": ${error.message}`);
        userResults[userId] = { error: error.message };
      }
    }

    console.log('\n[Rebuild All] Complete.');
    return { admin: adminResult, users: userResults };
  } finally {
    cleanupTempDir(tempDir);
  }
};

module.exports = {
  rebuildAdminLogs,
  rebuildUserLogs,
  rebuildAllLogs
};
