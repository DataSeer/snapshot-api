// File: src/utils/s3Storage.js
const {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectsCommand
} = require('@aws-sdk/client-s3');
const { createReadStream } = require('fs');
const crypto = require('crypto');
const fs = require('fs');

const { isValidVersion } = require('./versions');
const { logger } = require('./logger');

// Load S3 configuration from JSON file
const config = require('../config');
// eslint-disable-next-line node/no-unpublished-require
const s3Config = require(config.awsS3ConfigPath);

// Initialize S3 client
const s3Client = new S3Client({
  credentials: {
    accessKeyId: s3Config.accessKeyId,
    secretAccessKey: s3Config.secretAccessKey,
  },
  region: s3Config.region
});

// Generate S3 URL
const generateS3Url = (userId, requestId) => {
  return `https://s3.console.aws.amazon.com/s3/buckets/${s3Config.bucketName}?region=${s3Config.region}&bucketType=general&prefix=${s3Config.s3Folder}/${userId}/${requestId}/`;
}

// Generate unique request ID
const generateRequestId = () => {
  return crypto.randomBytes(16).toString('hex');
};

// Format date for logging
const formatLogDate = (date) => {
  return date.toISOString().replace('T', ' ').replace('Z', '');
};

// Calculate MD5 hash of a file
const calculateMD5 = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);

    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', error => reject(error));
  });
};

// Calculate SHA-256 hash of a file — matches genshare's cache.pdf_hash format
// so downstream demo-bypass lookups can match transparently.
const calculateSHA256 = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (error) => reject(error));
  });
};

// Store multiple files in S3 with a single batch
const uploadBatchToS3 = async (files) => {
  try {
    await Promise.all(files.map(async ({ key, data, contentType }) => {
      const params = {
        Bucket: s3Config.bucketName,
        Key: key,
        Body: data,
        ContentType: contentType
      };
      const command = new PutObjectCommand(params);
      return s3Client.send(command);
    }));
  } catch (error) {
    console.error('Error in batch upload:', error);
    throw error;
  }
};

// List all objects in a prefix with pagination
const listObjects = async (prefix) => {
  let allObjects = [];
  let continuationToken = undefined;
  
  do {
    const params = {
      Bucket: s3Config.bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken
    };
    
    const command = new ListObjectsV2Command(params);
    const response = await s3Client.send(command);
    allObjects = [...allObjects, ...(response.Contents || [])];
    continuationToken = response.NextContinuationToken;
    
    console.log(`Retrieved ${response.Contents?.length || 0} objects, ${allObjects.length} total so far.`);

  } while (continuationToken);
  
  return allObjects;
};

// Get file from S3
const getFile = async (key) => {
  try {
    const params = {
      Bucket: s3Config.bucketName,
      Key: key
    };
    
    const command = new GetObjectCommand(params);
    const response = await s3Client.send(command);
    
    // In v3, Body is a readable stream
    return await streamToString(response.Body);
  } catch (error) {
    console.error(`[S3] Error getting file ${key}: ${error.Code}`);
    logger.error(`[S3] Error getting file ${key}`, error);
    throw error;
  }
};

// Helper function to convert stream to string
const streamToString = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
};

// Get file from S3 as a raw Buffer (for binary content like PDFs). Throws on
// transport errors. Callers should handle 404/NoSuchKey themselves if they
// want graceful misses.
const getFileBuffer = async (key) => {
  const command = new GetObjectCommand({
    Bucket: s3Config.bucketName,
    Key: key
  });
  const response = await s3Client.send(command);
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

// Get all genshare request files from S3
const getAllGenshareRequestsFiles = async () => {
  try {
    console.log("Starting to fetch /genshare/request.json files from S3...");
    const prefix = `${s3Config.s3Folder}/`;
    console.log(`Using prefix: ${prefix}`);
    
    const objects = await listObjects(prefix);
    console.log(`Total objects retrieved from S3: ${objects.length}`);
    
    const requestFiles = objects.filter(obj => obj.Key.endsWith('/genshare/request.json'));
    console.log(`Total /genshare/request.json files found: ${requestFiles.length}`);
    
    const fileData = await Promise.all(requestFiles.map(async (file) => {
      try {
        const content = await getFile(file.Key);
        const pathParts = file.Key.split('/');
        
        // Extract userId and requestId from the path
        // Path format: snapshot-api-dev/userId/requestId/genshare/request.json
        const userId = pathParts[pathParts.length - 4];
        const requestId = pathParts[pathParts.length - 3];
        
        let parsedContent;
        try {
          parsedContent = JSON.parse(content);
        } catch (e) {
          console.error(`JSON parse error for ${file.Key}:`, e);
          parsedContent = null;
        }
        
        return {
          userId,
          requestId,
          content: parsedContent,
          lastModified: file.LastModified
        };
      } catch (error) {
        console.error(`Error processing file ${file.Key}:`, error);
        return null;
      }
    }));
    
    // Filter out any null entries from errors
    const validFileData = fileData.filter(file => file !== null);
    console.log(`Processed ${validFileData.length} valid files out of ${requestFiles.length}`);
    
    return validFileData;
  } catch (error) {
    console.error('Error getting genshare request files:', error);
    throw error;
  }
};

// Get report file from S3
const getReportFile = async (userId, requestId) => {
  try {
    const key = `${s3Config.s3Folder}/${userId}/${requestId}/report/report.json`;
    const content = await getFile(key);
    return JSON.parse(content);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    console.error('Error getting report file:', error);
    throw error;
  }
};

// Get cache-ref.json for a request. Present only when the cache-substitution
// layer ran. Returns the parsed object or null if missing/malformed.
const getCacheRefFile = async (userId, requestId) => {
  try {
    const key = `${s3Config.s3Folder}/${userId}/${requestId}/cache-ref.json`;
    const content = await getFile(key);
    return JSON.parse(content);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    console.error('Error getting cache-ref file:', error);
    return null;
  }
};

// Return the list of files.json entries for a request (or null on 404).
// Used by refreshRequestsFromS3 to locate the main PDF file's metadata.
const getFilesListFile = async (userId, requestId) => {
  try {
    const key = `${s3Config.s3Folder}/${userId}/${requestId}/files.json`;
    const content = await getFile(key);
    return JSON.parse(content);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    console.error('Error getting files.json:', error);
    return null;
  }
};

// Get a per-file metadata object (containing md5, sha256, originalName, …)
// for file index `fileIndex` (1-based). Returns null if missing.
const getFileMetadataFile = async (userId, requestId, fileIndex = 1) => {
  try {
    const key = `${s3Config.s3Folder}/${userId}/${requestId}/files/file_${fileIndex}.metadata.json`;
    const content = await getFile(key);
    return JSON.parse(content);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    console.error(`Error getting file_${fileIndex}.metadata.json:`, error);
    return null;
  }
};

// Get GenShare response file from S3
const getGenshareResponseFile = async (userId, requestId) => {
  try {
    const key = `${s3Config.s3Folder}/${userId}/${requestId}/genshare/response.json`;
    const content = await getFile(key);
    return JSON.parse(content);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    console.error('Error getting genshare response file:', error);
    throw error;
  }
};

// Get process.json file from S3
const getProcessFile = async (userId, requestId) => {
  try {
    const key = `${s3Config.s3Folder}/${userId}/${requestId}/process.json`;
    const content = await getFile(key);
    return JSON.parse(content);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    console.error('Error getting process file:', error);
    throw error;
  }
};

// Get API response.json file from S3
const getApiResponseFile = async (userId, requestId) => {
  try {
    const key = `${s3Config.s3Folder}/${userId}/${requestId}/response.json`;
    const content = await getFile(key);
    return JSON.parse(content);
  } catch (error) {
    if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') {
      return null;
    }
    console.error('Error getting API response file:', error);
    throw error;
  }
};

// Delete all objects under a given prefix
const deleteObjectsByPrefix = async (prefix) => {
  try {
    const objects = await listObjects(prefix);

    if (objects.length === 0) {
      console.log(`No objects found under prefix: ${prefix}`);
      return 0;
    }

    let deletedCount = 0;

    // DeleteObjectsCommand supports max 1000 objects per call
    for (let i = 0; i < objects.length; i += 1000) {
      const batch = objects.slice(i, i + 1000);
      const deleteParams = {
        Bucket: s3Config.bucketName,
        Delete: {
          Objects: batch.map(obj => ({ Key: obj.Key })),
          Quiet: true
        }
      };

      const command = new DeleteObjectsCommand(deleteParams);
      await s3Client.send(command);
      deletedCount += batch.length;
      console.log(`Deleted ${deletedCount}/${objects.length} objects under prefix: ${prefix}`);
    }

    return deletedCount;
  } catch (error) {
    console.error(`Error deleting objects by prefix ${prefix}:`, error);
    throw error;
  }
};

// Create a ProcessingSession class to handle the accumulation of data
class ProcessingSession {
  constructor(userId, requestId = null) {
    this.userId = userId;
    this.requestId = requestId ? requestId : generateRequestId();
    this.url = generateS3Url(this.userId, this.requestId);
    this.files = []; // Internal files tracking
    this.logs = [];
    
    // Origin information
    this.origin = {
      type: 'direct', // 'direct' or 'external'
      service: null   // External service name if applicable
    };
    
    // API request/response
    this.apiRequest = null;
    this.apiResponse = null;
    
    // Services data
    this.genshare = {
      isActive: false,
      version: null,
      request: null,
      response: null,
      // Full genshare payload (response.data) as originally returned, before any
      // cache substitution. Written to genshare/response.original.json. Immutable.
      originalResponse: null
    };

    // Cache-ref metadata set by cacheManager when the cache substitution layer
    // runs. Stored as-is in cache-ref.json on S3.
    this.cacheRef = null;

    // Terminal outcome of the request. Set by callers via setResult() before
    // saveToS3(). Written to process.json under `result`.
    //   { status: 'success', error: null }
    //   { status: 'error',   error: '<message>' }
    this.result = null;

    // Demo flag. Written to process.json under `is_demo`. Mirrors
    // requests.is_demo in the DB. Set via setIsDemo().
    this.isDemo = false;

    // Demo-bypass flag. Set via setIsDemoBypass() when this request was
    // served from a demo-flagged source PDF (genshare skipped, response
    // substituted). Written to process.json under `is_demo_bypass` and
    // mirrored to requests.is_demo_bypass in the DB. Orthogonal to isDemo —
    // a bypass-served request never itself becomes a demo source.
    this.isDemoBypass = false;

    // Pointer to the demo-flagged source request that supplied the response.
    // Set via setBypassSource(). Written to process.json under
    // `bypass_source` and the request_id mirrored to
    // requests.bypass_source_request_id in the DB.
    this.bypassSource = null;

    // Report data
    this.report = null;

    this.startTime = new Date();
    this.endTime = null;
    this.duration = -1;
    this.timeline = [];
    this.snapshotAPIVersion = "";
    this.genshareVersion = "";
    
    // Add initial log with session start
    this.addLog('[S3] Session started', 'INFO');
  }

  // Set request origin
  setOrigin(type, serviceName = null) {
    this.origin = {
      type: type,           // 'direct' or 'external'
      service: serviceName  // Service name if external
    };
    this.addLog(`[S3] Origin set: ${type}${serviceName ? ` (${serviceName})` : ''}`);
    return this;
  }

  // Version management methods
  getSnapshotAPIVersion() {
    return this.snapshotAPIVersion;
  }

  getGenshareVersion() {
    return this.genshareVersion;
  }

  setSnapshotAPIVersion(version) {
    if (!isValidVersion(version)) {
      this.snapshotAPIVersion = '';
      this.addLog(`[S3] Invalid Snapshot API Version format: ${version}. Setting empty string.`, 'WARN');
      return;
    }
    this.snapshotAPIVersion = version;
    this.addLog(`[S3] Snapshot API Version set to: ${version}`, 'INFO');
  }

  setGenshareVersion(version) {
    if (!isValidVersion(version)) {
      this.genshareVersion = '';
      this.addLog(`[S3] Invalid Genshare Version format: ${version}. Setting empty string.`, 'WARN');
      return;
    }
    this.genshareVersion = version;
    this.addLog(`[S3] Genshare Version set to: ${version}`, 'INFO');
  }
  
  // Store API request (from client)
  setAPIRequest(request) {
    this.apiRequest = request;
    this.addLog('[S3] API request stored', 'INFO');
    return this;
  }
  
  // Store API response (to client)
  setAPIResponse(response) {
    this.apiResponse = response;
    this.addLog('[S3] API response stored', 'INFO');
    return this;
  }

  // Record the terminal outcome of the request. Persisted to process.json.
  setResult(status, error = null) {
    this.result = {
      status: status || null,
      error: error || null
    };
    this.addLog(`[S3] Result set: ${status}${error ? ` — ${error}` : ''}`, 'INFO');
    return this;
  }

  // Mark the request as a demo (curator-initiated or operator-flagged).
  // Persisted to process.json under `is_demo` and mirrored to the DB
  // by refreshRequestsFromS3.
  setIsDemo(isDemo) {
    this.isDemo = isDemo === true;
    this.addLog(`[S3] is_demo set: ${this.isDemo}`, 'INFO');
    return this;
  }

  // Mark this request as having been served via demo-bypass (genshare was
  // skipped and the response was substituted from a demo-flagged source PDF).
  // Persisted to process.json under `is_demo_bypass`, mirrored to
  // requests.is_demo_bypass.
  setIsDemoBypass(isDemoBypass) {
    this.isDemoBypass = isDemoBypass === true;
    this.addLog(`[S3] is_demo_bypass set: ${this.isDemoBypass}`, 'INFO');
    return this;
  }

  // Record which demo-flagged source request supplied the bypass response.
  // Persisted to process.json under `bypass_source`. The request_id is also
  // mirrored to requests.bypass_source_request_id.
  setBypassSource({ user_name, request_id } = {}) {
    if (!request_id) {
      this.bypassSource = null;
    } else {
      this.bypassSource = { user_name: user_name || null, request_id };
    }
    this.addLog(
      `[S3] bypass_source set: ${this.bypassSource ? `${this.bypassSource.user_name}/${this.bypassSource.request_id}` : 'null'}`,
      'INFO'
    );
    return this;
  }

  // Initialize GenShare service
  initGenShare(version = null) {
    this.genshare.isActive = true;
    this.genshare.version = version;
    this.addLog(`[S3] GenShare service activated${version ? ` (version ${version})` : ''}`, 'INFO');
    return this;
  }

  // Path management
  getBasePath() {
    return `${s3Config.s3Folder}/${this.userId}/${this.requestId}`;
  }

  // Logging
  addLog(entry, level = 'INFO') {
    const timestamp = formatLogDate(new Date());
    this.logs.push(`[${timestamp}] [${level}] ${entry}`);
  }

  // Add a timeline event
  addTimelineEvent(id, start, end, source = 'snapshot-api') {
    this.timeline.push({
      id,
      start: start.toISOString(),
      end: end.toISOString(),
      duration_ms: end - start,
      source
    });
  }

  // Set Genshare request
  setGenshareRequest(request) {
    if (!this.genshare.isActive) {
      this.initGenShare();
    }
    this.genshare.request = request;
    this.addLog(`[S3] Genshare request setup`, 'INFO');
    return this;
  }

  // Set Genshare response
  setGenshareResponse(response) {
    if (!this.genshare.isActive) {
      this.initGenShare();
    }
    this.genshare.response = response;
    this.addLog(`[S3] Genshare response setup`, 'INFO');
    return this;
  }

  /**
   * Store an immutable deep-copy of the full genshare response.data payload
   * as it was received from genshare-service. saveToS3() writes it to
   * genshare/response.original.json. Must be called BEFORE any in-place
   * cache substitution mutates the working response.
   */
  setGenshareOriginalResponse(fullResponseData) {
    if (!this.genshare.isActive) {
      this.initGenShare();
    }
    try {
      this.genshare.originalResponse = JSON.parse(JSON.stringify(fullResponseData));
    } catch (error) {
      this.addLog(`[S3] Failed to snapshot original genshare response: ${error.message}`, 'WARN');
      this.genshare.originalResponse = fullResponseData;
    }
    this.addLog(`[S3] Genshare original response snapshotted`, 'INFO');
    return this;
  }

  /**
   * Attach the cache-ref object (produced by cacheManager.applyCacheToGenshareResponse).
   * Persisted to cache-ref.json only when non-null.
   */
  setCacheRef(cacheRef) {
    this.cacheRef = cacheRef;
    if (cacheRef && cacheRef.cache_key) {
      this.addLog(
        `[S3] Cache ref attached: key=${cacheRef.cache_key}, ` +
          `hit=${cacheRef.cache_hit}, substituted=${cacheRef.cache_substituted}`,
        'INFO'
      );
    }
    return this;
  }
  
  // Set report data
  setReport(reportData) {
    this.report = reportData;
    this.addLog(`[S3] Report data setup`, 'INFO');
    return this;
  }
  
  setServiceResponse(serviceName, response) {
    if (serviceName === 'genshare') {
      return this.setGenshareResponse(response);
    } else if (serviceName === 'editorial-manager') {
      this.setAPIResponse(response);
    }
    this.addLog(`[S3] ${serviceName} response setup`, 'INFO');
    return this;
  }
  
  // Add a file to the session
  addFile(file, origin = 'api') {
    if (!file) return this;
    
    // Add file with metadata including file type
    this.files.push({
      path: file.path,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      origin: origin,
      fieldname: file.fieldname || 'file' // Track which field this file came from
    });
    
    this.addLog(`[S3] Added file: ${file.originalname} (${file.size} bytes, origin: ${origin}, field: ${file.fieldname || 'file'})`, 'INFO');
    return this;
  }

  getDuration() {
    if (this.duration > 0) return this.duration;
    return new Date() - this.startTime;
  }

  async saveToS3() {
    try {
      // Add session end time to logs
      this.endTime = new Date();
      this.duration = this.endTime - this.startTime;
      this.addLog(`[S3] Session ended - Duration: ${this.duration}ms`, 'INFO');

      // Prepare files for batch upload
      const filesToUpload = [];

      // Prepare process metadata
      const processMetadata = {
        startDate: formatLogDate(this.startTime),
        endDate: formatLogDate(this.endTime),
        duration: `${this.duration}ms`,
        snapshotAPIVersion: this.snapshotAPIVersion,
        genshareVersion: this.genshareVersion,
        origin: this.origin,
        services: {
          genshare: this.genshare.isActive
        },
        timeline: this.timeline,
        hashes: {
          demo: this.pdfHash || null,
          cache: this.cacheKey || null
        },
        result: this.result || { status: null, error: null },
        is_demo: this.isDemo === true,
        is_demo_bypass: this.isDemoBypass === true,
        bypass_source: this.bypassSource || null
      };

      // Add process files
      filesToUpload.push(
        {
          key: `${this.getBasePath()}/process.json`,
          data: JSON.stringify(processMetadata, null, 2),
          contentType: 'application/json'
        },
        {
          key: `${this.getBasePath()}/process.log`,
          data: this.logs.join('\n'),
          contentType: 'text/plain'
        }
      );

      // Add API request/response
      if (this.apiRequest) {
        filesToUpload.push({
          key: `${this.getBasePath()}/request.json`,
          data: JSON.stringify(this.apiRequest, null, 2),
          contentType: 'application/json'
        });
      }
      
      if (this.apiResponse) {
        const apiResponseJson = JSON.stringify(this.apiResponse, null, 2);
        filesToUpload.push({
          key: `${this.getBasePath()}/response.json`,
          data: apiResponseJson,
          contentType: 'application/json'
        });
        // Immutable snapshot of the filtered response at request time.
        // For now it is a byte-for-byte copy of response.json — future flows
        // that rewrite response.json (e.g. admin tooling) will preserve the
        // original here.
        filesToUpload.push({
          key: `${this.getBasePath()}/response.original.json`,
          data: apiResponseJson,
          contentType: 'application/json'
        });
      }

      // Cache-ref metadata (only when the cache substitution layer ran)
      if (this.cacheRef) {
        filesToUpload.push({
          key: `${this.getBasePath()}/cache-ref.json`,
          data: JSON.stringify(this.cacheRef, null, 2),
          contentType: 'application/json'
        });
      }

      // Add report data if it exists
      if (this.report) {
        filesToUpload.push({
          key: `${this.getBasePath()}/report/report.json`,
          data: JSON.stringify(this.report, null, 2),
          contentType: 'application/json'
        });
      }

      // Process files
      if (this.files.length > 0) {
        const filesMetadata = this.files.map((file, index) => ({
          id: index + 1,
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype,
          origin: file.origin,
          fieldname: file.fieldname || 'file' // Include field name for supplementary files tracking
        }));
        
        filesToUpload.push({
          key: `${this.getBasePath()}/files.json`,
          data: JSON.stringify(filesMetadata, null, 2),
          contentType: 'application/json'
        });
        
        // Upload each file
        for (let i = 0; i < this.files.length; i++) {
          const file = this.files[i];
          const fileIndex = i + 1; // Start from 1
          const fileExtension = file.originalname.split('.').pop();

          // Calculate MD5 + SHA-256 for the file. SHA-256 matches genshare's
          // cache.pdf_hash format and is what the demo-bypass layer keys on,
          // so persisting it here lets refreshRequestsFromS3 backfill
          // requests.pdf_hash without re-downloading the PDF.
          const [md5Hash, sha256Hash] = await Promise.all([
            calculateMD5(file.path),
            calculateSHA256(file.path)
          ]);

          // Prepare file metadata
          const fileMetadata = {
            originalName: file.originalname,
            size: file.size,
            md5: md5Hash,
            sha256: sha256Hash,
            mimeType: file.mimetype,
            origin: file.origin,
            fieldname: file.fieldname || 'file'
          };
          
          // Add file metadata
          filesToUpload.push({
            key: `${this.getBasePath()}/files/file_${fileIndex}.metadata.json`,
            data: JSON.stringify(fileMetadata, null, 2),
            contentType: 'application/json'
          });
          
          // Add the actual file with descriptive naming
          const fileName = file.fieldname === 'supplementary_file' 
            ? `supplementary_file_${fileIndex}.${fileExtension}`
            : `file_${fileIndex}.${fileExtension}`;
          
          filesToUpload.push({
            key: `${this.getBasePath()}/files/${fileName}`,
            data: createReadStream(file.path),
            contentType: file.mimetype
          });
        }
      }

      // Process GenShare service
      if (this.genshare.isActive) {
        // Store GenShare metadata
        const genshareMetadata = {
          version: this.genshare.version,
          isActive: true
        };
        
        filesToUpload.push({
          key: `${this.getBasePath()}/genshare/metadata.json`,
          data: JSON.stringify(genshareMetadata, null, 2),
          contentType: 'application/json'
        });
        
        // Store request data if it exists
        if (this.genshare.request) {
          filesToUpload.push({
            key: `${this.getBasePath()}/genshare/request.json`,
            data: JSON.stringify(this.genshare.request, null, 2),
            contentType: 'application/json'
          });
        }
        
        // Store the slim, mutable, live view of the genshare response.
        // Shape: { response: [...] } — just the array consumed by snapshot-reports.
        // May be mutated later by cache-propagation or a per-request edit.
        if (this.genshare.response && this.genshare.response.data) {
          const liveResponse =
            Array.isArray(this.genshare.response.data.response)
              ? this.genshare.response.data.response
              : [];
          filesToUpload.push({
            key: `${this.getBasePath()}/genshare/response.json`,
            data: JSON.stringify({ response: liveResponse }, null, 2),
            contentType: 'application/json'
          });
        }

        // Store the full, immutable original genshare response payload
        // (response.data with all its top-level keys: response, version,
        // cache, timeline, score, graph_policy_traversal_data, etc.).
        if (this.genshare.originalResponse) {
          filesToUpload.push({
            key: `${this.getBasePath()}/genshare/response.original.json`,
            data: JSON.stringify(this.genshare.originalResponse, null, 2),
            contentType: 'application/json'
          });
        }
      }

      // Upload everything in a single batch
      await uploadBatchToS3(filesToUpload);

      return this.requestId;
    } catch (error) {
      console.error('Error saving processing session:', error);
      throw error;
    }
  }
}

module.exports = {
  ProcessingSession,
  getAllGenshareRequestsFiles,
  getReportFile,
  getCacheRefFile,
  getFilesListFile,
  getFileMetadataFile,
  getGenshareResponseFile,
  getProcessFile,
  getApiResponseFile,
  generateRequestId,
  uploadBatchToS3,
  deleteObjectsByPrefix,
  listObjects,
  getFile,
  getFileBuffer,
  calculateSHA256,
  s3Config
};
