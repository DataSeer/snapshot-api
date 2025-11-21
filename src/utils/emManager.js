// File: src/utils/emManager.js
const fs = require('fs').promises;
const fsSync = require('fs'); // Add sync version for createWriteStream
const path = require('path');
const axios = require('axios');
const archiver = require('archiver');
const dbManager = require('./dbManager');
const genshareManager = require('./genshareManager');
const requestsManager = require('./requestsManager');
const config = require('../config');
const queueManager = require('./queueManager');
const { ProcessingSession } = require('./s3Storage');

// Load Editorial Manager configuration
const emConfig = require(config.emConfigPath);

// Load the genshare configuration
const genshareConfig = require(config.genshareConfigPath);

/**
 * Get report value based on publication code
 * @param {string} publicationCode - Publication code from submission
 * @returns {string|null} - Report value to use or null if no configuration
 */
const getReportValue = (publicationCode) => {
  try {
    // Check if report configuration exists
    if (!emConfig.report) {
      console.warn('[EM] No report configuration found in emConfig');
      return null;
    }

    // 1. Check if there are available values - if not, return null
    if (!emConfig.report.available || !Array.isArray(emConfig.report.available) || emConfig.report.available.length === 0) {
      console.warn('[EM] No available report values found in configuration');
      return null;
    }

    // 2. Determine the default value
    let defaultValue;
    if (!emConfig.report.default) {
      // If no default is set, use the first available value
      defaultValue = emConfig.report.available[0];
      console.log(`[EM] No default report value set, using first available value: "${defaultValue}"`);
    } else {
      // Check if the configured default value is in available values
      if (emConfig.report.available.includes(emConfig.report.default)) {
        defaultValue = emConfig.report.default;
        console.log(`[EM] Using configured default report value: "${defaultValue}"`);
      } else {
        // Default value is not available, use first available value
        defaultValue = emConfig.report.available[0];
        console.warn(`[EM] Configured default report value "${emConfig.report.default}" not in available values [${emConfig.report.available.join(', ')}], using first available: "${defaultValue}"`);
      }
    }

    // 3. Check for custom configuration for this publication code
    if (emConfig.report.custom && emConfig.report.custom[publicationCode]) {
      const customValue = emConfig.report.custom[publicationCode];
      
      // Validate that the custom value is in available values
      if (emConfig.report.available.includes(customValue)) {
        console.log(`[EM] Using custom report value "${customValue}" for publication code "${publicationCode}"`);
        return customValue;
      } else {
        console.warn(`[EM] Custom report value "${customValue}" for publication code "${publicationCode}" not in available values [${emConfig.report.available.join(', ')}], using default: "${defaultValue}"`);
        return defaultValue;
      }
    }

    // No custom configuration found, use default value
    console.log(`[EM] No custom report configuration for publication code "${publicationCode}", using default: "${defaultValue}"`);
    return defaultValue;

  } catch (error) {
    console.error(`[EM] Error getting report value for publication code "${publicationCode}":`, error);
    return null;
  }
};
/**
 * Get graph value based on publication code
 * @param {string} publicationCode - Publication code from submission
 * @returns {string|null} - Graph value to use or null if no configuration
 */
const getGraphValue = (publicationCode) => {
  try {
    // Check if graph configuration exists
    if (!emConfig.graph) {
      console.warn('[EM] No graph configuration found in emConfig');
      return null;
    }

    // 1. Check if there are available values - if not, return null
    if (!emConfig.graph.available || !Array.isArray(emConfig.graph.available) || emConfig.graph.available.length === 0) {
      console.warn('[EM] No available graph values found in configuration');
      return null;
    }

    // 2. Determine the default value
    let defaultValue;
    if (!emConfig.graph.default) {
      // If no default is set, use the first available value
      defaultValue = emConfig.graph.available[0];
      console.log(`[EM] No default graph value set, using first available value: "${defaultValue}"`);
    } else {
      // Check if the configured default value is in available values
      if (emConfig.graph.available.includes(emConfig.graph.default)) {
        defaultValue = emConfig.graph.default;
        console.log(`[EM] Using configured default graph value: "${defaultValue}"`);
      } else {
        // Default value is not available, use first available value
        defaultValue = emConfig.graph.available[0];
        console.warn(`[EM] Configured default graph value "${emConfig.graph.default}" not in available values [${emConfig.graph.available.join(', ')}], using first available: "${defaultValue}"`);
      }
    }

    // 3. Check for custom configuration for this publication code
    if (emConfig.graph.custom && emConfig.graph.custom[publicationCode]) {
      const customValue = emConfig.graph.custom[publicationCode];
      
      // Validate that the custom value is in available values
      if (emConfig.graph.available.includes(customValue)) {
        console.log(`[EM] Using custom graph value "${customValue}" for publication code "${publicationCode}"`);
        return customValue;
      } else {
        console.warn(`[EM] Custom graph value "${customValue}" for publication code "${publicationCode}" not in available values [${emConfig.graph.available.join(', ')}], using default: "${defaultValue}"`);
        return defaultValue;
      }
    }

    // No custom configuration found, use default value
    console.log(`[EM] No custom graph configuration for publication code "${publicationCode}", using default: "${defaultValue}"`);
    return defaultValue;

  } catch (error) {
    console.error(`[EM] Error getting graph value for publication code "${publicationCode}":`, error);
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
    const output = fsSync.createWriteStream(outputPath); // Use fsSync for createWriteStream
    const archive = archiver('zip', {
      zlib: { level: 9 } // Sets the compression level
    });

    output.on('close', () => {
      console.log(`[EM] ZIP file created: ${archive.pointer()} total bytes`);
      resolve(outputPath);
    });

    output.on('end', () => {
      console.log('[EM] Data has been drained');
    });

    archive.on('warning', (err) => {
      if (err.code === 'ENOENT') {
        console.warn('[EM] ZIP warning:', err);
      } else {
        reject(err);
      }
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Add files to the archive
    for (const file of supplementaryFiles) {
      archive.file(file.path, { name: file.originalname });
    }

    // Finalize the archive
    archive.finalize();
  });
};

/**
 * Handle job completion - called when a job is marked as completed in the database
 * @param {string} requestId - Request ID of the completed job
 */
const handleProcessEmSubmissionJobCompletion = async (requestId) => {
  try {
    console.log(`[EM] Job ${requestId} completed, executing post-completion tasks`);
    
    // Get the original job data to extract notification parameters
    const job = await queueManager.getJobByRequestId(requestId);
    if (!job) {
      console.error(`[EM] Could not find job data for ${requestId}`);
      return;
    }
    
    const jobData = JSON.parse(job.data);
    
    // Send notification to Editorial Manager about completion
    try {
      const notificationResult = await sendReportCompleteNotification({
        publication_code: jobData.publication_code,
        service_id: jobData.service_id,
        report_id: requestId,
        status: 'Success'
      });
      
      console.log(`[EM] Report completion notification sent for job ${requestId}:`, notificationResult.status);
    } catch (notificationError) {
      console.error(`[EM] Error sending completion notification for job ${requestId}:`, notificationError);
    }
    
    // You can add any other post-completion logic here, such as:
    // - Updating external systems
    // - Cleanup tasks
    // - Analytics/logging
    
    console.log(`[EM] Job ${requestId} completion handled successfully`);
    
  } catch (error) {
    console.error(`[EM] Error handling job completion for ${requestId}:`, error);
  }
};

/**
 * Handle job failure - called when a job fails permanently
 * @param {string} requestId - Request ID of the failed job
 * @param {Error} error - Error that caused the failure
 */
const handleProcessEmSubmissionJobFailure = async (requestId, error) => {
  try {
    console.log(`[EM] Job ${requestId} failed permanently, executing failure handling`);
    
    // Get the original job data to extract notification parameters
    const job = await queueManager.getJobByRequestId(requestId);
    if (!job) {
      console.error(`[EM] Could not find job data for ${requestId}`);
      return;
    }
    
    const jobData = JSON.parse(job.data);
    
    // Send error notification to Editorial Manager
    try {
      const notificationResult = await sendReportCompleteNotification({
        publication_code: jobData.publication_code,
        service_id: jobData.service_id,
        report_id: requestId,
        status: 'Error',
        error_message: error.message
      });
      
      console.log(`[EM] Error notification sent for job ${requestId}:`, notificationResult.status);
    } catch (notificationError) {
      console.error(`[EM] Error sending failure notification for job ${requestId}:`, notificationError);
    }
    
    // You can add other failure handling logic here, such as:
    // - Alerting administrators
    // - Additional cleanup tasks
    
    console.log(`[EM] Job ${requestId} failure handled`);
    
  } catch (handlingError) {
    console.error(`[EM] Error handling job failure for ${requestId}:`, handlingError);
  }
};

/**
 * Process a submission from Editorial Manager
 * @param {Object} data - Submission data and files
 * @param {ProcessingSession} session - Processing session for logging
 * @returns {Promise<Object>} - Processing result with report ID
 */
const processSubmission = async (data, session) => {
  try {
    const { service_id, publication_code, document_id, article_title, article_type, user_id, files, file_data, custom_questions } = data;

    let document_type = article_type;
    
    if (!service_id || !publication_code || !document_id) {
      throw new Error('Missing required fields: service_id, publication_code, or document_id');
    }
    
    // Generate a unique report ID for this submission (already done by the session)
    const reportId = session.requestId;
    
    // Store in database
    await dbManager.storeEmSubmission(reportId, service_id, publication_code, document_id);
    
    // Log submission details
    session.addLog(`Editorial Manager submission received from ${user_id}`);
    session.addLog(`Service ID: ${service_id}`);
    session.addLog(`Publication Code: ${publication_code}`);
    session.addLog(`Document ID: ${document_id}`);
    
    // Extract file data from the submission
    const fileDataArray = file_data || [];
    
    // Find the Reviewer PDF file and supplementary files for background processing
    let reviewerPdfFile = null;
    let reviewerPdfMetadata = null;
    let supplementaryFiles = [];
    let supplementaryFilesMetadata = [];
    let dasValue = "";
    
    // First, analyze file metadata to identify file types
    for (const fileData of fileDataArray) {
      if (fileData.file_description === "Reviewer PDF") {
        reviewerPdfMetadata = fileData;
        session.addLog(`Found Reviewer PDF metadata: ${fileData.file_name}`);
      } else if (fileData.file_item_type_family === "Supplemental") {
        supplementaryFilesMetadata.push(fileData);
        session.addLog(`Found supplementary file metadata: ${fileData.file_name} (${fileData.file_description})`);
      }
    }
    
    // Then find the actual files based on the metadata
    if (files && files.length > 0) {
      // Find reviewer PDF file
      if (reviewerPdfMetadata) {
        for (const file of files) {
          if (file.originalname === reviewerPdfMetadata.file_name) {
            reviewerPdfFile = file;
            session.addLog(`Found matching Reviewer PDF file: ${file.originalname}`);
            break;
          }
        }
      }
      
      // Find supplementary files
      for (const suppMetadata of supplementaryFilesMetadata) {
        for (const file of files) {
          if (file.originalname === suppMetadata.file_name) {
            supplementaryFiles.push(file);
            session.addLog(`Found matching supplementary file: ${file.originalname}`);
            break;
          }
        }
      }
    }
    
    session.addLog(`Found ${supplementaryFiles.length} supplementary files to include`);
    
    // Search for DAS trigger in custom questions
    const customQuestions = custom_questions || [];
    const dasTriggers = emConfig.das_triggers || [];
    
    // Look for any custom question containing a DAS trigger
    for (const question of customQuestions) {
      const questionName = question.custom_question_text.toLowerCase();
      for (const trigger of dasTriggers) {
        if (questionName.includes(trigger.toLowerCase())) {
          dasValue = question.custom_question_value;
          session.addLog(`Found DAS question: "${question.custom_question_name}" with value: "${dasValue}"`);
          break;
        }
      }
      if (dasValue) break;
    }
    
    // Get graph value based on publication code
    const graphValue = getGraphValue(publication_code);
    if (graphValue) {
      session.addLog(`Graph value for publication code "${publication_code}": "${graphValue}"`);
    }
    
    // Get report value based on publication code
    const reportValue = getReportValue(publication_code);
    if (reportValue) {
      session.addLog(`Graph value for publication code "${publication_code}": "${reportValue}"`);
    }
    
    // Create queue data for background processing
    const queueData = {
      service_id,
      publication_code,
      document_id,
      article_title,
      document_type,
      user_id,
      files,
      reviewerPdfFile,
      supplementaryFiles, // Include supplementary files in queue data
      das_value: dasValue,
      graph_value: graphValue, // Include graph value in queue data
      report: reportValue, // Include report value in queue data
      // Include any other data needed for processing
    };
    
    // Define completion callback
    const onJobComplete = async (error) => {
      if (error) {
        await handleProcessEmSubmissionJobFailure(reportId, error);
      } else {
        await handleProcessEmSubmissionJobCompletion(reportId);
      }
    };
    
    // Enqueue the job for background processing
    session.addLog(`Queuing submission for background processing with request_id: ${reportId}`);
    
    // Pass the processEmSubmissionJob as the processor function and completion callback
    await queueManager.enqueueJob(
      reportId,
      queueManager.JobType.EM_SUBMISSION,
      queueData,
      undefined, // Use default max retries
      undefined, // Use default priority
      processEmSubmissionJob, // Pass the job processor function
      onJobComplete // Pass the completion callback
    );
    
    // Create immediate result with report_id
    const result = {
      status: "Success",
      report_id: reportId
    };
    
    return result;
  } catch (error) {
    session.addLog(`Error processing submission: ${error.message}`);
    
    // Create error result
    const errorResult = {
      status: "Error",
      error_message: error.message
    };
    
    return errorResult;
  }
};

/**
 * Process Editorial Manager submission job (called by the queue manager)
 * @param {Object} job - Job record from database
 * @returns {Promise<Object>} - Processing result
 */
const processEmSubmissionJob = async (job) => {
  // Parse the job data
  const data = JSON.parse(job.data);
  
  // Create a new processing session for this job
  const session = new ProcessingSession(data.user_id, job.request_id); // Use the existing request ID
  
  // Track file paths for cleanup at the end
  const tempFilePaths = [];
  let supplementaryZipPath = null;
  
  // Variables for summary logging
  let errorStatus = "No";
  let reportURL = "";
  let graphValue = data.graph_value || "";
  let reportVersion = data.report || "";
  
  try {
    // Set origin as external service (Editorial Manager)
    session.setOrigin('external', 'editorial-manager');
    
    // Log that we're starting background processing
    session.addLog('Starting background processing of Editorial Manager submission');
    
    // Add files to the session if they exist - DO THIS EARLY
    if (data.files && data.files.length > 0) {
      for (const file of data.files) {
        session.addFile(file, 'editorial-manager');
        
        // Keep track of file paths for cleanup
        if (file.path) {
          tempFilePaths.push(file.path);
        }
      }
    }
    
    // Create ZIP file from supplementary files if any exist
    let supplementaryFilesZip = null;
    if (data.supplementaryFiles && data.supplementaryFiles.length > 0) {
      session.addLog(`Creating ZIP archive from ${data.supplementaryFiles.length} supplementary files`);
      
      // Create temporary ZIP file path
      supplementaryZipPath = path.join('tmp', `supplementary_${job.request_id}.zip`);
      
      try {
        // Create the ZIP file
        await createSupplementaryFilesZip(data.supplementaryFiles, supplementaryZipPath);
        
        // Create a file object for the ZIP that looks like a multer file
        supplementaryFilesZip = {
          path: supplementaryZipPath,
          originalname: `supplementary_file.zip`,
          mimetype: 'application/zip',
          size: (await fs.stat(supplementaryZipPath)).size,
          fieldname: 'supplementary_files'
        };
        
        // Add to session for S3 storage
        session.addFile(supplementaryFilesZip, 'editorial-manager');
        
        // Add to cleanup list
        tempFilePaths.push(supplementaryZipPath);
        
        session.addLog(`Supplementary files ZIP created: ${supplementaryFilesZip.originalname} (${supplementaryFilesZip.size} bytes)`);
        
      } catch (zipError) {
        session.addLog(`Error creating supplementary files ZIP: ${zipError.message}`);
        console.error(`[${job.request_id}] Error creating ZIP:`, zipError);
        // Continue processing without supplementary files rather than failing
      }
    }
    
    // Process with GenShare if applicable
    let genshareResult = null;
    
    if (data.reviewerPdfFile) {
      session.addLog('Processing reviewer PDF with GenShare in background');
      
      // Prepare options for GenShare processing
      const genshareOptions = {
        article_id: data.document_id,
        document_type: data.document_type,
        article_title: data.article_title,
        journal_name: data.publication_code, // "publication_code" from EM is the "journal_name" parameter in Snapshot
        das: data.das_value,
      };
      
      // Add graph value to options if available
      if (data.graph_value) {
        genshareOptions.editorial_policy = data.graph_value;
        session.addLog(`Including editorial_policy value in GenShare options: "${data.graph_value}"`);
      }
      
      // Add report value to options if available
      if (data.report) {
        genshareOptions.report = data.report;
        session.addLog(`Including report value in GenShare options: "${data.report}"`);
      }
      
      // Prepare data for GenShare processing
      const genshareData = {
        file: data.reviewerPdfFile,
        supplementary_file: supplementaryFilesZip, // Include the ZIP file if created
        options: genshareOptions,
        user: {
          id: data.user_id
        }
      };
      
      try {
        // Process the PDF with GenShare - DON'T log to summary here (pass false)
        genshareResult = await genshareManager.processPDF(genshareData, session, false);
        session.addLog(`GenShare processing completed with status: ${genshareResult.status}`);
        
        if (supplementaryFilesZip) {
          session.addLog(`GenShare processed main PDF with ${data.supplementaryFiles.length} supplementary files`);
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
    }
    
    // Save session to S3
    await session.saveToS3();
    
    // Update request with report data if available
    if (session.report) {
      try {
        await requestsManager.updateRequestReportData(job.request_id, session.report);
        session.addLog('Report data saved to database');
      } catch (dbError) {
        session.addLog(`Error saving report to database: ${dbError.message}`);
      }
    }
    
    // Log to summary sheet ONCE at the end - SUCCESS case
    try {
      await genshareManager.appendToSummary({
        session,
        errorStatus,
        data: {
          file: data.reviewerPdfFile,
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
    
    // NOTE: Notification will be sent in the completion callback
    // after the job is marked as completed in the database
    
    // Clean up temporary files ONLY AFTER FINAL processing is complete (no more retries)
    // Success means job completed - safe to delete files
    session.addLog('Job completed successfully - cleaning up temporary files');
    if (tempFilePaths.length > 0) {
      for (const filePath of tempFilePaths) {
        await fs.unlink(filePath).catch(err => {
          console.error(`[${job.request_id}] Error deleting temporary file:`, err);
        });
      }
    }
    
    // Return success result (notification result will be handled in callback)
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
          file: data.reviewerPdfFile,
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
    
    try {
      // Save session data with error information
      await session.saveToS3();
    } catch (saveError) {
      console.error(`[${job.request_id}] Error in error handling:`, saveError);
    }
    
    // Check if job will be retried before cleaning up files
    // Only delete files if this is the FINAL failure (no more retries)
    const willRetry = job.retries < job.max_retries;
    
    if (willRetry) {
      session.addLog(`Job will be retried (${job.retries + 1}/${job.max_retries}) - keeping temporary files for retry`);
      console.log(`[${job.request_id}] Keeping temporary files for retry attempt ${job.retries + 1}/${job.max_retries}`);
    } else {
      session.addLog('Job failed permanently - cleaning up temporary files');
      console.log(`[${job.request_id}] Job failed permanently - cleaning up temporary files`);
      
      // Clean up temporary files only after final failure
      if (tempFilePaths.length > 0) {
        for (const filePath of tempFilePaths) {
          await fs.unlink(filePath).catch(err => {
            console.error(`[${job.request_id}] Error deleting temporary file:`, err);
          });
        }
      }
    }
    
    throw error;
  }
};

/**
 * Get job status for a report
 * @param {string} reportId - Report ID to get status for
 * @returns {Promise<Object>} - Job status information
 */
const getJobStatus = async (reportId) => {
  try {
    // Get job details from queue manager
    const job = await queueManager.getJobByRequestId(reportId);
    
    if (!job) {
      return {
        status: "Error",
        error: "Job not found"
      };
    }
    
    // Format response based on job status
    const response = {
      report_id: reportId,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
      retries: job.retries,
      max_retries: job.max_retries
    };
    
    // Add error message if job failed
    if (job.status === queueManager.JobStatus.FAILED) {
      response.error_message = job.error_message;
    }
    
    // Add completion data if job completed
    if (job.status === queueManager.JobStatus.COMPLETED && job.completion_data) {
      try {
        // We don't want to include all the raw data from completion_data
        // Just include a summary of the results
        const completionData = JSON.parse(job.completion_data);
        response.results = {
          genshare_status: completionData.genshare_result?.status || 'unknown',
          notification_status: completionData.notification_result?.status || 'unknown'
        };
      } catch (error) {
        response.results = { error: 'Could not parse completion data' };
      }
    }
    
    return response;
  } catch (error) {
    console.error(`Error getting job status for ${reportId}:`, error);
    
    return {
      status: "Error",
      error: error.message
    };
  }
};

/**
 * Retry a failed job
 * @param {string} reportId - Report ID of the job to retry
 * @returns {Promise<Object>} - Retry result
 */
const retryJob = async (reportId) => {
  try {
    // Get job details
    const job = await queueManager.getJobByRequestId(reportId);
    
    if (!job) {
      return {
        status: "Error",
        error: "Job not found"
      };
    }
    
    // Only allow retrying failed jobs
    if (job.status !== queueManager.JobStatus.FAILED) {
      return {
        status: "Error",
        error: `Cannot retry job with status '${job.status}'`
      };
    }
    
    // Update job status to PENDING to trigger reprocessing
    await queueManager.updateJobStatus(reportId, queueManager.JobStatus.PENDING);
    
    // Trigger job processing
    queueManager.processNextJob();
    
    return {
      status: "Success",
      message: `Job ${reportId} has been queued for retry`,
      report_id: reportId
    };
  } catch (error) {
    console.error(`Error retrying job ${reportId}:`, error);
    
    return {
      status: "Error",
      error: error.message
    };
  }
};

/**
 * Cancel an upload request
 * @param {string} reportId - Report ID to cancel
 * @returns {Promise<boolean>} - True if cancellation was successful
 */
const cancelUpload = async (reportId) => {
  try {
    // Check if submission exists
    const submission = await dbManager.getEmSubmissionByRequestId(reportId);
    
    if (!submission) {
      return false;
    }
    
    // Update the canceled_at timestamp
    const canceled = await dbManager.cancelEmSubmission(reportId);
    
    // Also get job if it exists and update its status
    const job = await queueManager.getJobByRequestId(reportId);
    
    if (job) {
      // If job is not yet completed, mark as canceled (using FAILED status)
      if (job.status !== queueManager.JobStatus.COMPLETED) {
        await queueManager.updateJobStatus(reportId, queueManager.JobStatus.FAILED, 'Canceled by user');
      }
    }
    
    return canceled;
  } catch (error) {
    console.error('Error canceling upload:', error);
    return false;
  }
};

/**
 * Get report for a submission - now retrieves data from the database
 * @param {string} reportId - Report ID to retrieve
 * @returns {Promise<Object>} - Report data
 */
const getReport = async (reportId) => {
  try {
    // Check if submission exists
    const submission = await dbManager.getEmSubmissionByRequestId(reportId);
    
    if (!submission) {
      const errorResult = {
        status: "Error",
        error_message: "Report not found"
      };
      
      return errorResult;
    }
    
    // Check if report was canceled
    if (submission.canceled_at) {
      const errorResult = {
        status: "Error",
        error_message: "Report was canceled"
      };
      
      return errorResult;
    }
    
    // Check job status from queue
    const job = await queueManager.getJobByRequestId(reportId);
    
    // If job is failed, return error
    if (job && job.status === queueManager.JobStatus.FAILED) {
      const errorResult = {
        status: "Error",
        error_message: job.error_message || "Processing failed"
      };
      
      return errorResult;
    }
    
    // If job is pending or processing, return status
    if (job && (job.status === queueManager.JobStatus.PENDING || job.status === queueManager.JobStatus.PROCESSING)) {
      return {
        status: "Processing",
        report_token: `token-${reportId.substring(0, 8)}`
      };
    }
    
    // If job is completed, try to get report data from the database
    if (job && job.status === queueManager.JobStatus.COMPLETED) {
      try {
        // Extract userId from the job data to retrieve the report from database
        const jobData = JSON.parse(job.data);
        const userId = jobData.user_id;
        
        // Get report data from database using requestsManager
        const reportData = await requestsManager.getRequestReport(userId, reportId);
        
        if (!reportData) {
          // Report data not found in database
          return {
            status: "Error",
            error_message: "Report data not found in database"
          };
        }
        
        // Extract scores from report data - try to get action_required from GenShare response
        let scores = emConfig.reportCompleteNotification.params.scores; // Default fallback
        
        try {
          // Try to get action_required from job completion data
          if (job.completion_data) {
            const jobCompletionData = JSON.parse(job.completion_data);
            const genshareResult = jobCompletionData.genshare_result;
            
            if (genshareResult && genshareResult.data && Array.isArray(genshareResult.data)) {
              // Find the action_required field in the GenShare response
              const actionRequiredItem = genshareResult.data.find(item => 
                item.name === 'action_required'
              );
              
              if (actionRequiredItem && actionRequiredItem.value && actionRequiredItem.value.trim() !== '') {
                scores = actionRequiredItem.value;
              }
            }
          }
        } catch (parseError) {
          console.error(`[${reportId}] Error parsing completion data for action_required:`, parseError);
          // Keep the default scores value from config
        }
        
        return {
          report_token: `token-${reportId.substring(0, 8)}`,
          scores,
          flag: emConfig.reportCompleteNotification.params.flag
        };
        
      } catch (dbError) {
        console.error(`Error retrieving report from database for ${reportId}:`, dbError);
        return {
          status: "Error",
          error_message: "Report data not available"
        };
      }
    }
    
    // Default return for cases not handled above
    return {
      report_token: `token-${reportId.substring(0, 8)}`,
      scores: "Processing status unknown",
      flag: false
    };
  } catch (error) {
    console.error(`Error getting report for ${reportId}:`, error);
    
    const errorResult = {
      status: "Error",
      error_message: error.message
    };
    
    return errorResult;
  }
};

/**
 * Get report URL using token
 * @param {string} reportId - Report ID
 * @param {string} reportToken - Report token
 * @returns {Promise<Object>} - Object containing report URL
 */
const getReportUrl = async (reportId, reportToken) => {
  try {
    // Check if submission exists
    const submission = await dbManager.getEmSubmissionByRequestId(reportId);
    
    if (!submission) {
      const errorResult = {
        status: "Error",
        error_message: "Report not found"
      };
      
      return errorResult;
    }
    
    // Validate token (in a real implementation, you would validate the token)
    if (!reportToken || !reportToken.startsWith(`token-${reportId.substring(0, 8)}`)) {
      const errorResult = {
        status: "Error",
        error_message: "Invalid token"
      };
      
      return errorResult;
    }
    
    // Check job status
    const job = await queueManager.getJobByRequestId(reportId);
    
    if (!job || job.status !== queueManager.JobStatus.COMPLETED) {
      return {
        status: "Error",
        error_message: "Report not ready or not found"
      };
    }
    
    // Try to get the actual report URL from database report data
    try {
      const jobData = JSON.parse(job.data);
      const userId = jobData.user_id;
      
      // Get report URL from database using requestsManager
      const reportUrl = await requestsManager.getRequestReportUrl(userId, reportId);
      
      if (reportUrl) {
        // Return the actual report URL from database
        return {
          report_url: reportUrl
        };
      } else {
        return {
          status: "Error",
          error_message: "Report not found"
        };
      }
    } catch (dbError) {
      console.error(`Error retrieving report URL from database for ${reportId}:`, dbError);
    }
  } catch (error) {
    console.error('Error getting report URL:', error);
    
    const errorResult = {
      status: "Error",
      error_message: error.message
    };
    
    return errorResult;
  }
};

/**
 * Send report complete notification to Editorial Manager
 * @param {Object} notificationData - Notification data including publication_code, service_id, report_id, and status
 * @returns {Promise<Object>} - Response from EM notification endpoint
 */
const sendReportCompleteNotification = async (notificationData) => {
  try {
    const { publication_code, service_id, report_id, status, error_message } = notificationData;
    
    // Validate required fields
    if (!publication_code || !service_id || !report_id || !status) {
      throw new Error('Missing required notification fields');
    }

    if (emConfig.reportCompleteNotification.disabled) {
      return {
        status: 200,
        data: {
          err: false,
          res: "reportCompleteNotification process skipped"
        }
      };
    }

    // Construct the notification URL with the publication code
    const notificationUrl = emConfig.reportCompleteNotification.url.replace(
      '{publication_code}',
      publication_code
    );
    
    // Prepare the notification payload
    const payload = {
      publication_code,
      service_id,
      report_id,
      status
    };
    
    // Add error message if status is Error
    if (status === 'Error' && error_message) {
      payload.error_message = error_message;
    }
    
    // Send the notification to Editorial Manager
    const response = await axios.post(notificationUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const result = {
      status: response.status,
      data: response.data
    };
    
    return result;
  } catch (error) {
    console.error('Error sending report complete notification:', error);
    
    throw error;
  }
};

module.exports = {
  processSubmission,
  cancelUpload,
  getReport,
  getReportUrl,
  sendReportCompleteNotification,
  processEmSubmissionJob,
  getJobStatus,
  retryJob,
  handleProcessEmSubmissionJobCompletion,
  handleProcessEmSubmissionJobFailure,
  createSupplementaryFilesZip,
  getGraphValue
};
