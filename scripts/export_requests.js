// File: scripts/export_requests.js
const fs = require('fs');
const path = require('path');
const { listObjects, getFile, s3Config } = require('../src/utils/s3Storage');

const OUTPUT_DIR = path.join(__dirname, '../output/');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'requests_export.csv');
const CONCURRENCY = 10;

/**
 * Extract unique request folder prefixes from S3 object keys.
 * Path format: {s3Folder}/{userId}/{requestId}/...
 * Returns an array of { userId, requestId, basePath } objects.
 */
const extractRequestFolders = (objects) => {
  const seen = new Set();
  const folders = [];
  const prefixDepth = s3Config.s3Folder.split('/').length;

  for (const obj of objects) {
    const parts = obj.Key.split('/');
    // We need at least: s3Folder / userId / requestId / <file>
    if (parts.length < prefixDepth + 3) continue;

    const userId = parts[prefixDepth];
    const requestId = parts[prefixDepth + 1];
    const key = `${userId}/${requestId}`;

    if (!seen.has(key)) {
      seen.add(key);
      folders.push({
        userId,
        requestId,
        basePath: `${s3Config.s3Folder}/${userId}/${requestId}`
      });
    }
  }

  return folders;
};

/**
 * Fetch and parse a JSON file from S3. Returns null if not found or on error.
 */
const fetchJsonFile = async (key) => {
  try {
    const content = await getFile(key);
    return JSON.parse(content);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    console.error(`Error fetching ${key}:`, error.message);
    return null;
  }
};

/**
 * Process a single request folder: fetch the 3 JSON files and extract CSV row data.
 */
const processRequestFolder = async (folder) => {
  const [requestData, processData, responseData] = await Promise.all([
    fetchJsonFile(`${folder.basePath}/request.json`),
    fetchJsonFile(`${folder.basePath}/process.json`),
    fetchJsonFile(`${folder.basePath}/response.json`)
  ]);

  // Skip if no request.json — no usable data
  if (!requestData) return null;

  const apiEndpoint = `${requestData.method || 'UNKNOWN'} ${requestData.path || 'UNKNOWN'}`;
  const apiVersion = processData?.snapshotAPIVersion || 'unknown';
  const jsonBody = JSON.stringify(requestData);
  const responseStatus = responseData ? (responseData.status || 'unknown') : 'failed';

  return {
    userId: folder.userId,
    apiEndpoint,
    apiVersion,
    jsonBody,
    responseStatus: String(responseStatus)
  };
};

/**
 * Escape a value for CSV: wrap in double quotes and escape inner double quotes.
 */
const escapeCsvValue = (value) => {
  return `"${value.replace(/"/g, '""')}"`;
};

/**
 * Process folders in batches with controlled concurrency.
 */
const processBatches = async (folders) => {
  const rows = [];
  let processed = 0;

  for (let i = 0; i < folders.length; i += CONCURRENCY) {
    const batch = folders.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(processRequestFolder));

    for (const result of results) {
      if (result) rows.push(result);
    }

    processed += batch.length;
    console.log(`Processed ${processed}/${folders.length} requests (${rows.length} valid rows so far)`);
  }

  return rows;
};

/**
 * Write rows to CSV file.
 */
const writeCsv = (rows) => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const headers = 'USER_ID,API_ENDPOINT,API_VERSION,JSON_BODY,RESPONSE_STATUS';
  const lines = rows.map((row) =>
    [
      escapeCsvValue(row.userId),
      escapeCsvValue(row.apiEndpoint),
      escapeCsvValue(row.apiVersion),
      escapeCsvValue(row.jsonBody),
      escapeCsvValue(row.responseStatus)
    ].join(',')
  );

  const csvContent = [headers, ...lines].join('\n');
  fs.writeFileSync(OUTPUT_FILE, csvContent, 'utf-8');
};

/**
 * Main entry point.
 */
const main = async () => {
  console.log('Starting S3 request export...');
  console.log(`Bucket: ${s3Config.bucketName}`);
  console.log(`Prefix: ${s3Config.s3Folder}/`);

  // Step 1: List all S3 objects
  console.log('\nListing all S3 objects...');
  const objects = await listObjects(`${s3Config.s3Folder}/`);
  console.log(`Total objects found: ${objects.length}`);

  // Step 2: Extract unique request folders
  const folders = extractRequestFolders(objects);
  console.log(`Unique request folders found: ${folders.length}`);

  if (folders.length === 0) {
    console.log('No request folders found. Exiting.');
    return;
  }

  // Step 3: Fetch data for each request folder
  console.log(`\nFetching request data (concurrency: ${CONCURRENCY})...`);
  const rows = await processBatches(folders);

  // Step 4: Write CSV
  console.log(`\nWriting ${rows.length} rows to CSV...`);
  writeCsv(rows);
  console.log(`CSV exported to: ${OUTPUT_FILE}`);
};

main().catch((error) => {
  console.error('Export failed:', error);
  process.exitCode = 1;
});
