// File: src/utils/scholaroneManager.js
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs').promises;
const fsSync = require('fs'); // Add sync version for createWriteStream
const path = require('path');
const archiver = require('archiver');
const config = require('../config');
const genshareManager = require('./genshareManager');
const { ProcessingSession } = require('./s3Storage');
const queueManager = require('./queueManager');
const dbManager = require('./dbManager');
const requestsManager = require('./requestsManager');

// Load ScholarOne configuration
const scholaroneConfig = require(config.scholaroneConfigPath);

// Load the genshare configuration
const genshareConfig = require(config.genshareConfigPath);

// Define tmp directory path (project root tmp, not system /tmp)
const TMP_DIR = path.join(__dirname, '../../tmp');

/**
 * Get report value based on site name
 * @param {string} siteName - Site name from submission
 * @returns {string|null} - Report value to use or null if no configuration
 */
const getReportValue = (siteName) => {
  try {
    const siteConfig = scholaroneConfig.sites[siteName];
    if (!siteConfig?.report) {
      console.warn(`[ScholarOne] No report configuration found for site "${siteName}"`);
      return null;
    }
    
    if (!siteConfig.report.available || !Array.isArray(siteConfig.report.available) || siteConfig.report.available.length === 0) {
      console.warn(`[ScholarOne] No available report values found for site "${siteName}"`);
      return null;
    }
    
    let defaultValue;
    if (!siteConfig.report.default) {
      defaultValue = siteConfig.report.available[0];
      console.log(`[ScholarOne] No default report value set for site "${siteName}", using first available value: "${defaultValue}"`);
    } else {
      if (siteConfig.report.available.includes(siteConfig.report.default)) {
        defaultValue = siteConfig.report.default;
        console.log(`[ScholarOne] Using configured default report value for site "${siteName}": "${defaultValue}"`);
      } else {
        defaultValue = siteConfig.report.available[0];
        console.warn(`[ScholarOne] Configured default report value "${siteConfig.report.default}" not in available values for site "${siteName}", using first available: "${defaultValue}"`);
      }
    }
    
    return defaultValue;
  } catch (error) {
    console.error(`[ScholarOne] Error getting report value for site "${siteName}":`, error);
    return null;
  }
};

/**
 * Get graph value based on site name
 * @param {string} siteName - Site name from submission
 * @returns {string|null} - Graph value to use or null if no configuration
 */
const getGraphValue = (siteName) => {
  try {
    const siteConfig = scholaroneConfig.sites[siteName];
    if (!siteConfig?.graph) {
      console.warn(`[ScholarOne] No graph configuration found for site "${siteName}"`);
      return null;
    }
    
    if (!siteConfig.graph.available || !Array.isArray(siteConfig.graph.available) || siteConfig.graph.available.length === 0) {
      console.warn(`[ScholarOne] No available graph values found for site "${siteName}"`);
      return null;
    }
    
    let defaultValue;
    if (!siteConfig.graph.default) {
      defaultValue = siteConfig.graph.available[0];
      console.log(`[ScholarOne] No default graph value set for site "${siteName}", using first available value: "${defaultValue}"`);
    } else {
      if (siteConfig.graph.available.includes(siteConfig.graph.default)) {
        defaultValue = siteConfig.graph.default;
        console.log(`[ScholarOne] Using configured default graph value for site "${siteName}": "${defaultValue}"`);
      } else {
        defaultValue = siteConfig.graph.available[0];
        console.warn(`[ScholarOne] Configured default graph value "${siteConfig.graph.default}" not in available values for site "${siteName}", using first available: "${defaultValue}"`);
      }
    }
    
    return defaultValue;
  } catch (error) {
    console.error(`[ScholarOne] Error getting graph value for site "${siteName}":`, error);
    return null;
  }
};

/**
 * Create a ZIP file from supplementary files
 * @param {Array} supplementaryFiles - Array of file objects to zip
 * @param {string} outputPath - Path where to create the ZIP file
 * @returns {Promise<string>} - Path to the created ZIP file
 */
const createSupplementaryFilesZip = async (supplementaryFiles, outputPath) => {
  return new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    output.on('close', () => {
      console.log(`[ScholarOne] ZIP file created: ${archive.pointer()} total bytes`);
      resolve(outputPath);
    });

    output.on('end', () => {
      console.log('[ScholarOne] Data has been drained');
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('[ScholarOne] ZIP warning:', err);
      } else {
        reject(err);
      }
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    for (const file of supplementaryFiles) {
      archive.file(file.path, { name: file.originalname });
    }

    archive.finalize();
  });
};

/**
 * Create HTTP Digest Authentication header
 * @param {string} username - API username
 * @param {string} password - API password
 * @param {string} method - HTTP method
 * @param {string} uri - Request URI
 * @param {string} realm - Authentication realm
 * @param {string} nonce - Server nonce
 * @returns {string} - Authorization header value
 */
const createDigestAuthHeader = (username, password, method, uri, realm, nonce) => {
  const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
  const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');
  const response = crypto.createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');
  return `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
};

/**
 * Make authenticated request to ScholarOne API
 * @param {string} endpoint - API endpoint
 * @param {Object} params - Query parameters
 * @param {string} method - HTTP method
 * @returns {Promise<Object>} - API response data
 */
const makeAuthenticatedRequest = async (endpoint, params = {}, method = 'GET') => {
  const { baseURL, username, password, timeout = 30000 } = scholaroneConfig.api;
  const url = `${baseURL}${endpoint}`;
  
  try {
    let response;
    try {
      response = await axios({ method, url, params, timeout });
      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        const authHeader = error.response.headers['www-authenticate'];
        if (!authHeader?.startsWith('Digest')) {
          throw new Error('Server did not request Digest authentication');
        }
        
        const realm = authHeader.match(/realm="([^"]*)"/)?.[1];
        const nonce = authHeader.match(/nonce="([^"]*)"/)?.[1];
        
        if (!realm || !nonce) throw new Error('Could not parse authentication parameters');
        
        const urlObj = new URL(url);
        Object.keys(params).forEach(key => urlObj.searchParams.append(key, params[key]));
        const uri = urlObj.pathname + urlObj.search;
        
        const authorizationHeader = createDigestAuthHeader(username, password, method, uri, realm, nonce);
        
        response = await axios({
          method,
          url,
          params,
          headers: { 'Authorization': authorizationHeader },
          timeout
        });
        
        return response.data;
      } else {
        if (error.response?.data) return error.response.data;
        throw error;
      }
    }
  } catch (error) {
    console.error('[ScholarOne] API request failed:', error.message);
    throw error;
  }
};

/**
 * Get submission IDs by date range
 * @param {string} siteName - Site name
 * @param {string} fromTime - Start time (ISO format)
 * @param {string} toTime - End time (ISO format)
 * @returns {Promise<Array>} - Array of submissions
 */
const getSubmissionsByDateRange = async (siteName, fromTime, toTime) => {
  const endpoint = scholaroneConfig.api.endpoints.submissionsByDateRange;
  const params = {
    from_time: fromTime.replace(/\.\d{3}Z$/, 'Z'),
    to_time: toTime.replace(/\.\d{3}Z$/, 'Z'),
    site_name: siteName,
    _type: 'json'
  };
  
  const data = await makeAuthenticatedRequest(endpoint, params);
  
  if (data?.Response?.status === 'SUCCESS') {
    if (data.Response.result === '') {
       // case there is no submission returned
      return [];
    } else if (typeof data.Response.result.submission === 'object') {
      // case there is only one submission returned
      return [data.Response.result.submission];
    }
    else if (Array.isArray(data.Response.result.submission)) {
      // case there are more than one submissions returned
      return data.Response.result.submission;
    } else {
      // case not managed
      return [];
    }
  }
  
  if (data?.Response?.status === 'FAILURE') {
    throw new Error(`ScholarOne API error: ${data.Response.errorDetails?.userMessage}`);
  }
  
  throw new Error('Failed to retrieve submissions: Unexpected response format');
};

/**
 * Get full submission metadata
 * @param {string} siteName - Site name
 * @param {string} submissionId - Submission ID
 * @returns {Promise<Object>} - Submission metadata
 */
const getSubmissionFullMetadata = async (siteName, submissionId) => {
  const endpoint = scholaroneConfig.api.endpoints.submissionFullMetadata;
  const params = {
    site_name: siteName,
    ids: `'${submissionId}'`,
    _type: 'json'
  };
  
  const data = await makeAuthenticatedRequest(endpoint, params);
  
  if (data?.Response?.status === 'SUCCESS') {
    return data.Response.result;
  }
  
  if (data?.Response?.status === 'FAILURE') {
    throw new Error(`ScholarOne API error: ${data.Response.errorDetails?.userMessage}`);
  }
  
  throw new Error('Failed to retrieve submission metadata');
};

/**
 * Handle job completion - called when a job is marked as completed in the database
 * @param {string} requestId - Request ID of the completed job
 */
const handleProcessScholaroneSubmissionJobCompletion = async (requestId) => {
  try {
    console.log(`[ScholarOne] Job ${requestId} completed, executing post-completion tasks`);
    
    console.log(`[ScholarOne] Job ${requestId} completion handled successfully`);
    
  } catch (error) {
    console.error(`[ScholarOne] Error handling job completion for ${requestId}:`, error);
  }
};

/**
 * Handle job failure - called when a job fails permanently
 * @param {string} requestId - Request ID of the failed job
 * @param {Error} error - Error that caused the failure
 */
const handleProcessScholaroneSubmissionJobFailure = async (requestId) => {
  try {
    console.log(`[ScholarOne] Job ${requestId} failed permanently, executing cleanup tasks`);
     
    console.log(`[ScholarOne] Job ${requestId} failure handled successfully`);
    
  } catch (error) {
    console.error(`[ScholarOne] Error handling job failure for ${requestId}:`, error);
  }
};

/**
 * Process ScholarOne submission - prepares data and enqueues job
 * Controller calls this to enqueue the job
 * @param {Object} submissionData - Submission data from request
 * @param {string} userId - User ID
 * @param {ProcessingSession} session - Processing session from controller
 * @returns {Promise<Object>} - Result with status and request_id
 */
const processSubmission = async (submissionData, userId, session) => {
  // Ensure tmp directory exists
  await fs.mkdir(TMP_DIR, { recursive: true }).catch(() => {});

  try {
    const siteName = submissionData.siteName;
    const submissionId = submissionData.submissionId;
    const requestId = session.requestId; // Use the session's request ID
    
    session.addLog(`Processing ScholarOne submission for site: ${siteName}`);
    
    // Validate site configuration
    const siteConfig = scholaroneConfig.sites[siteName];
    if (!siteConfig?.enabled) {
      throw new Error(`Site ${siteName} is not configured or not enabled`);
    }
    
    session.addLog(`Site configuration validated for: ${siteName}`);
    
    // Store submission in database
    await dbManager.storeScholaroneSubmission(
      requestId,
      siteName,
      submissionId
    );
    
    session.addLog(`Submission stored in database with request ID: ${requestId}`);
    
    // Get report and graph values
    const reportValue = getReportValue(siteName);
    const graphValue = getGraphValue(siteName);
    
    session.addLog(`Report value: ${reportValue}, Graph value: ${graphValue}`);
    
    // Prepare queueData data
    const queueData = {
      requestId: requestId,
      siteName: siteName,
      submissionId: submissionId,
      userId: userId,
      reportValue: reportValue,
      graphValue: graphValue
    };


    // Define completion callback
    const onJobComplete = async (error) => {
      if (error) {
        await handleProcessScholaroneSubmissionJobCompletion(requestId, error);
      } else {
        await handleProcessScholaroneSubmissionJobFailure(requestId);
      }
    };
    
    // Pass the processScholaroneSubmissionJob as the processor function and completion callback
    await queueManager.enqueueJob(
      requestId,
      queueManager.JobType.SCHOLARONE_SUBMISSION, 
      queueData,
      undefined, // Use default max retries
      undefined, // Use default priority
      processScholaroneSubmissionJob, // Pass the job processor function
      onJobComplete // Pass the completion callback
    );
    
    // Return success response
    return {
      status: "Success",
      request_id: requestId
    };
    
  } catch (error) {
    session.addLog(`Error in processSubmission: ${error.message}`);
    throw error;
  }
};

/**
 * Process ScholarOne submission job - executed by queue processor
 * This is the actual background job that downloads files and processes them
 * @param {Object} job - Job record from database
 * @returns {Promise<Object>} - Processing result
 */
const processScholaroneSubmissionJob = async (job) => {
  // Parse the job data
  const data = JSON.parse(job.data);
  
  // Variables for summary logging
  let errorStatus = "No";
  let reportURL = "";
  let graphValue = data.graph_value || "";
  let reportVersion = data.report || "";

  let mainFile = {};
  
  // Create a new ProcessingSession with the existing request ID
  const session = new ProcessingSession(data.userId, job.request_id);
  session.setOrigin('external', 'scholarone');
  
  const tempFilePaths = [];
  
  try {
    session.addLog(`[Job] Starting ScholarOne submission job processing`);
    session.addLog(`[Job] Site: ${data.siteName}, Submission ID: ${data.submissionId}`);
    
    // Get submission full metadata from ScholarOne API
    session.addLog(`[Job] Fetching submission metadata from ScholarOne API`);
    const submissionsFullMetadata = await getSubmissionFullMetadata(data.siteName, data.submissionId);
    
    if (!submissionsFullMetadata) {
      throw new Error('No submission data returned from ScholarOne API');
    }
    
    session.addLog(`[Job] Metadata retrieved successfully`);

    let submissionFiles = [];
    if (Array.isArray(submissionsFullMetadata.submissionFiles)) {
      submissionFiles = submissionsFullMetadata.submissionFiles;
    } else if (typeof submissionsFullMetadata.submissionFiles === 'object') {
      submissionFiles = [submissionsFullMetadata.submissionFiles];
    }
    
    // Find the main document
    const mainDocument = submissionFiles?.find(
      doc => doc.fileDesignation === "Main Document" && doc.docLink 
    );
    
    if (!mainDocument) {
      throw new Error(`Main document not found in submission`);
    }
    
    session.addLog(`[Job] Main document found: ${mainDocument.systemFileName}`);
    
    // Download main document
    session.addLog(`[Job] Downloading main document from: ${mainDocument.docLink}`);
    const mainResponse = await axios.get(mainDocument.docLink, {
      responseType: 'arraybuffer',
      timeout: 120000
    });
    
    const mainBuffer = Buffer.from(mainResponse.data);
    const sanitizedFilename = mainDocument.systemFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const mainTempPath = path.join(TMP_DIR, `${job.request_id}_main_${sanitizedFilename}`);
    
    await fs.writeFile(mainTempPath, mainBuffer);
    tempFilePaths.push(mainTempPath);
    
    session.addLog(`[Job] Main document downloaded: ${mainBuffer.length} bytes`);
    
    mainFile = {
      path: mainTempPath,
      originalname: mainDocument.systemFileName,
      mimetype: mainDocument.mimeType || 'application/pdf',
      size: mainBuffer.length
    };
    
    session.addFile(mainFile, 'scholarone');
    
    // Download supplementary files
    const supplementaryFiles = [];
    const suppDocuments = submissionFiles?.filter(
      doc => doc.fileDesignation === "Supplementary File" && doc.docLink
    ) || [];
    
    session.addLog(`[Job] Found ${suppDocuments.length} supplementary document(s)`);
    
    for (const suppMetadata of suppDocuments) {
      try {
        session.addLog(`[Job] Downloading supplementary file: ${suppMetadata.systemFileName}`);
        
        const suppResponse = await axios.get(suppMetadata.docLink, {
          responseType: 'arraybuffer',
          timeout: 120000
        });
        
        const suppBuffer = Buffer.from(suppResponse.data);
        const sanitizedSuppFilename = suppMetadata.systemFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const suppTempPath = path.join(TMP_DIR, `${job.request_id}_supp_${sanitizedSuppFilename}`);
        
        await fs.writeFile(suppTempPath, suppBuffer);
        tempFilePaths.push(suppTempPath);
        
        session.addLog(`[Job] Supplementary file downloaded: ${suppBuffer.length} bytes`);
        
        const suppFile = {
          path: suppTempPath,
          originalname: suppMetadata.systemFileName,
          mimetype: suppMetadata.mimeType || 'application/octet-stream',
          size: suppBuffer.length
        };
        
        supplementaryFiles.push(suppFile);
        session.addFile(suppFile, 'scholarone');
      } catch (suppError) {
        session.addLog(`[Job] Error downloading supplementary file: ${suppError.message}`);
      }
    }
    
    // Create ZIP from supplementary files if any exist
    let supplementaryFilesZip = null;
    if (supplementaryFiles.length > 0) {
      const supplementaryZipPath = path.join(TMP_DIR, `supplementary_${job.request_id}.zip`);
      
      try {
        session.addLog(`[Job] Creating ZIP archive from ${supplementaryFiles.length} supplementary file(s)`);
        await createSupplementaryFilesZip(supplementaryFiles, supplementaryZipPath);
        
        supplementaryFilesZip = {
          path: supplementaryZipPath,
          originalname: `supplementary_files.zip`,
          mimetype: 'application/zip',
          size: (await fs.stat(supplementaryZipPath)).size
        };
        
        tempFilePaths.push(supplementaryZipPath);
        session.addFile(supplementaryFilesZip, 'scholarone');
        session.addLog(`[Job] ZIP archive created successfully: ${supplementaryFilesZip.size} bytes`);
      } catch (zipError) {
        session.addLog(`[Job] Error creating ZIP archive: ${zipError.message}`);
      }
    }
    
    // Prepare GenShare processing options
    const genshareOptions = {
      article_id: data.submissionId,
      document_type: submissionsFullMetadata.submissionType,
      journal_name: submissionsFullMetadata.journalName,
      abstract: submissionsFullMetadata.submissionTitle
    };
    
    if (data.graphValue) genshareOptions.graph = data.graphValue;
    if (data.reportValue) genshareOptions.report = data.reportValue;
    
    const genshareData = {
      file: mainFile,
      supplementary_file: supplementaryFilesZip,
      user: { id: data.userId },
      options: genshareOptions
    };
    
    session.addLog(`[Job] Starting GenShare processing`);
    
    let genshareResult = null;
    try {
      // Process the PDF with GenShare - DON'T log to summary here (pass false)
      genshareResult = await genshareManager.processPDF(genshareData, session, false);
      session.addLog(`GenShare processing completed with status: ${genshareResult.status}`);
      
      if (supplementaryFilesZip) {
        session.addLog(`GenShare processed main PDF with ${supplementaryFiles.length} supplementary files`);
      }
      
      // Extract values from GenShare result for summary
      reportURL = genshareResult.reportURL || "";
      graphValue = genshareResult.activeGenShareGraphValue || graphValue;
      reportVersion = genshareResult.activeReportVersion || reportVersion;
      
    } catch (genshareError) {
      session.addLog(`Error processing with GenShare: ${genshareError.message}`);
      errorStatus = `GenShare Error: ${genshareError.message}`;
      throw genshareError; // Re-throw to be caught by outer try/catch
    }
    
    session.addLog(`[Job] GenShare processing completed with status: ${genshareResult.status}`);
    
    // Save session data to S3
    await session.saveToS3();
    
    // Update database with report data if available
    if (session.report) {
      await dbManager.updateRequestReportData(job.request_id, session.report);
    }

    // Log to summary sheet ONCE at the end - SUCCESS case
    try {
      await genshareManager.appendToSummary({
        session,
        errorStatus,
        data: {
          file: mainFile?.originalname,
          user: { id: data.user_id }
        },
        genshareVersion: session.getGenshareVersion() || genshareConfig.defaultVersion,
        reportURL,
        graphValue,
        reportVersion
      });
    } catch (summaryError) {
      session.addLog(`Error logging to summary: ${summaryError.message}`);
      console.error(`[${job.request_id}] Error logging to summary:`, summaryError);
    }
    
    // Clean up temporary files
    if (tempFilePaths?.length) {
      for (const filePath of tempFilePaths) {
        await fs.unlink(filePath).catch(err => {
          console.error(`[ScholarOne] Error deleting temporary file ${filePath}:`, err.message);
        });
      }
    }
    
    session.addLog(`[Job] Job completed successfully`);
    
    return {
      status: 'Success',
      genshare_result: genshareResult
    };
    
  } catch (error) {
    // Log error
    session.addLog(`Error in background processing: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);
    
    // Set error status if not already set
    if (errorStatus === "No") {
      errorStatus = `Job Error: ${error.message}`;
    }
    
    // Log to summary sheet ONCE at the end - ERROR case
    try {
      await genshareManager.appendToSummary({
        session,
        errorStatus,
        data: {
          file: mainFile?.originalname,
          user: { id: data.user_id }
        },
        genshareVersion: session.getGenshareVersion() || genshareConfig.defaultVersion,
        reportURL,
        graphValue,
        reportVersion
      });
    } catch (summaryError) {
      session.addLog(`Error logging to summary: ${summaryError.message}`);
      console.error(`[${job.request_id}] Error logging to summary:`, summaryError);
    }
    
    // Clean up temporary files
    if (tempFilePaths?.length) {
      for (const filePath of tempFilePaths) {
        await fs.unlink(filePath).catch(err => {
          console.error(`[ScholarOne] Error deleting temporary file ${filePath}:`, err.message);
        });
      }
    }
    
    try {
      await session.saveToS3();
    } catch (s3Error) {
      console.error(`[ScholarOne] Error saving session data for ${job.request_id}:`, s3Error);
    }
    
    throw error;
  }
};

/**
 * Get job status
 * @param {string} requestId - Request ID
 * @returns {Promise<Object>} - Job status information
 */
const getJobStatus = async (requestId) => {
  try {
    const job = await queueManager.getJobByRequestId(requestId);
    
    if (!job) {
      return { 
        status: "Error", 
        error: "Job not found" 
      };
    }
    
    const response = {
      request_id: requestId,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
      retries: job.retries,
      max_retries: job.max_retries
    };
    
    if (job.status === queueManager.JobStatus.FAILED) {
      response.error_message = job.error_message;
    }
    
    if (job.status === queueManager.JobStatus.COMPLETED && job.completion_data) {
      try {
        const completionData = JSON.parse(job.completion_data);
        response.results = {
          genshare_status: completionData.genshare_result?.status || 'unknown'
        };
        
        // Try to get report data from database
        const jobData = JSON.parse(job.data);
        const reportData = await requestsManager.getRequestReport(jobData.userId, requestId);
        if (reportData) {
          response.report_url = await requestsManager.getRequestReportUrl(jobData.userId, requestId);
        }
      } catch (parseError) {
        response.results = { 
          error: 'Could not parse completion data' 
        };
      }
    }
    
    return response;
  } catch (error) {
    console.error(`[ScholarOne] Error getting job status for ${requestId}:`, error);
    return { 
      status: "Error", 
      error: error.message 
    };
  }
};

/**
 * Retry a failed job
 * @param {string} requestId - Request ID
 * @returns {Promise<Object>} - Retry result
 */
const retryJob = async (requestId) => {
  try {
    const job = await queueManager.getJobByRequestId(requestId);
    
    if (!job) {
      return { 
        status: "Error", 
        error: "Job not found" 
      };
    }
    
    if (job.status !== queueManager.JobStatus.FAILED) {
      return { 
        status: "Error", 
        error: `Cannot retry job with status '${job.status}'` 
      };
    }
    
    // Reset job status to pending
    await queueManager.updateJobStatus(requestId, queueManager.JobStatus.PENDING);
    
    // Trigger job processor
    queueManager.processNextJob();
    
    console.log(`[ScholarOne] Job ${requestId} queued for retry`);
    
    return {
      status: "Success",
      message: `Job ${requestId} has been queued for retry`,
      request_id: requestId
    };
  } catch (error) {
    console.error(`[ScholarOne] Error retrying job ${requestId}:`, error);
    return { 
      status: "Error", 
      error: error.message 
    };
  }
};

/**
 * Cancel an upload request
 * @param {string} requestId - Request ID
 * @returns {Promise<boolean>} - True if canceled, false otherwise
 */
const cancelUpload = async (requestId) => {
  try {
    const submission = await dbManager.getScholaroneSubmissionByRequestId(requestId);
    if (!submission) {
      return false;
    }
    
    const canceled = await dbManager.cancelScholaroneSubmission(requestId);
    
    const job = await queueManager.getJobByRequestId(requestId);
    if (job && job.status !== queueManager.JobStatus.COMPLETED && job.status !== queueManager.JobStatus.FAILED) {
      await queueManager.updateJobStatus(requestId, queueManager.JobStatus.FAILED, 'Canceled by user');
    }
    
    console.log(`[ScholarOne] Upload ${requestId} canceled successfully`);
    
    return canceled;
  } catch (error) {
    console.error(`[ScholarOne] Error canceling upload ${requestId}:`, error);
    return false;
  }
};

/**
 * Poll ScholarOne API for new submissions
 * @param {string} siteName - Site name to poll
 * @returns {Promise<Object>} - Polling result
 */
const pollForSubmissions = async (siteName) => {
  try {
    const siteConfig = scholaroneConfig.sites[siteName];
    if (!siteConfig?.enabled || !siteConfig.polling_enabled) {
      console.log(`[ScholarOne] Polling skipped for site ${siteName} (not enabled)`);
      return { 
        status: 'skipped', 
        message: 'Site not configured for polling' 
      };
    }
    
    console.log(`[ScholarOne] Starting polling for site: ${siteName}`);
    
    const daysBack = siteConfig.polling_days_back || 7;
    const toTime = new Date();
    const fromTime = new Date();
    fromTime.setDate(fromTime.getDate() - daysBack);
    
    console.log(`[ScholarOne] Polling submissions from ${fromTime.toISOString()} to ${toTime.toISOString()}`);
    
    const submissions = await getSubmissionsByDateRange(
      siteName, 
      fromTime.toISOString(), 
      toTime.toISOString()
    );
    
    console.log(`[ScholarOne] Found ${submissions.length} submission(s) for site ${siteName}`);
    
    let queuedCount = 0;
    let skippedCount = 0;
    
    for (const submission of submissions) {
      const existingRequest = await dbManager.getScholaroneSubmissionBySubmissionId(submission.submissionId);
      
      if (existingRequest) {
        skippedCount++;
        continue;
      }
      
      // Create a processing session for the polled submission
      const userId = scholaroneConfig.userId;
      const session = new ProcessingSession(userId);
      session.setOrigin('external', 'scholarone-polling');
      
      await processSubmission({ ...submission, siteName }, userId, session);
      queuedCount++;
    }
    
    console.log(`[ScholarOne] Polling completed for ${siteName}: ${queuedCount} queued, ${skippedCount} skipped`);
    
    return {
      status: 'completed',
      total_found: submissions.length,
      queued: queuedCount,
      skipped: skippedCount
    };
  } catch (error) {
    console.error(`[ScholarOne] Error polling site ${siteName}:`, error);
    return { 
      status: 'error', 
      error: error.message 
    };
  }
};

/**
 * Start periodic polling for all enabled sites
 */
const startPeriodicPolling = () => {
  const pollingSites = Object.entries(scholaroneConfig.sites)
    .filter(([_name, config]) => config.enabled && config.polling_enabled)
    .map(([name, config]) => ({ 
      name, 
      interval: config.polling_interval || 60 
    }));
  
  if (!pollingSites.length) {
    console.log('[ScholarOne] No sites configured for periodic polling');
    return;
  }
  
  console.log(`[ScholarOne] Starting periodic polling for ${pollingSites.length} site(s)`);
  
  pollingSites.forEach(site => {
    console.log(`[ScholarOne] Setting up polling for site ${site.name} every ${site.interval} minutes`);
    
    // Initial poll
    pollForSubmissions(site.name);
    
    // Set up interval
    setInterval(() => {
      pollForSubmissions(site.name);
    }, site.interval * 60 * 1000);
  });
};

module.exports = {
  makeAuthenticatedRequest,
  getSubmissionsByDateRange,
  getSubmissionFullMetadata,
  processSubmission,
  processScholaroneSubmissionJob,
  pollForSubmissions,
  startPeriodicPolling,
  getReportValue,
  getGraphValue,
  createSupplementaryFilesZip,
  handleProcessScholaroneSubmissionJobCompletion,
  handleProcessScholaroneSubmissionJobFailure,
  getJobStatus,
  retryJob,
  cancelUpload
};
