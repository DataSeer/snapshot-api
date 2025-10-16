// File: src/utils/snapshotMailsManager.js
const fs = require('fs').promises;
const axios = require('axios');
const dbManager = require('./dbManager');
const genshareManager = require('./genshareManager');
const requestsManager = require('./requestsManager');
const config = require('../config');
const queueManager = require('./queueManager');
const { ProcessingSession } = require('./s3Storage');

// Load the genshare configuration
const genshareConfig = require(config.genshareConfigPath);
const snapshotMailsConfig = require(config.snapshotMailsConfigPath);

/**
 * Handle job completion - called when a job is marked as completed in the database
 * @param {string} requestId - Request ID of the completed job
 */
const handleProcessMailSubmissionJobCompletion = async (requestId) => {
  try {
    console.log(`[SM] Job ${requestId} completed, executing post-completion tasks`);
    
    // Get the original job data to extract notification parameters
    const job = await queueManager.getJobByRequestId(requestId);
    if (!job) {
      console.error(`[SM] Could not find job data for ${requestId}`);
      return;
    }
    
    const jobData = JSON.parse(job.completion_data);
    
    // Get mail submission data to include in notification
    const mailSubmission = await dbManager.getSnapshotMailsSubmissionByRequestId(requestId);
    
    // Send notification to snapshot-mails service about completion
    try {
      const notificationResult = await sendJobCompleteNotification({
        request_id: requestId,
        status: 'completed',
        results: jobData.genshare_result || {},
        mail_submission: mailSubmission // Include mail submission data
      });
      
      console.log(`[SM] Job completion notification sent for ${requestId}:`, notificationResult.status);
    } catch (notificationError) {
      console.error(`[SM] Error sending completion notification for job ${requestId}:`, notificationError);
    }
    
    console.log(`[SM] Job ${requestId} completion handled successfully`);
    
  } catch (error) {
    console.error(`[SM] Error handling job completion for ${requestId}:`, error);
  }
};

/**
 * Handle job failure - called when a job fails permanently
 * @param {string} requestId - Request ID of the failed job
 * @param {Error} error - Error that caused the failure
 */
const handleProcessMailSubmissionJobFailure = async (requestId, error) => {
  try {
    console.log(`[SM] Job ${requestId} failed permanently, executing failure handling`);
    
    // Get mail submission data
    const mailSubmission = await dbManager.getSnapshotMailsSubmissionByRequestId(requestId);
    
    // Send error notification to snapshot-mails service
    try {
      const notificationResult = await sendJobCompleteNotification({
        request_id: requestId,
        status: 'failed',
        error_message: error.message,
        mail_submission: mailSubmission // Include mail submission data
      });
      
      console.log(`[SM] Error notification sent for job ${requestId}:`, notificationResult.status);
    } catch (notificationError) {
      console.error(`[SM] Error sending failure notification for job ${requestId}:`, notificationError);
    }
    
    console.log(`[SM] Job ${requestId} failure handled`);
    
  } catch (handlingError) {
    console.error(`[SM] Error handling job failure for ${requestId}:`, handlingError);
  }
};

/**
 * Process a mail submission from snapshot-mails service
 * @param {Object} data - Submission data and files
 * @param {ProcessingSession} session - Processing session for logging
 * @returns {Promise<Object>} - Processing result with request ID
 */
const processSubmission = async (data, session) => {
  try {
    const { sender_email, sender_name, keywords, filename, original_subject, user_id, files, user_parameters } = data;
    
    if (!sender_email) {
      throw new Error('Missing required field: sender_email');
    }
    
    if (!files || files.length === 0) {
      throw new Error('No PDF file provided');
    }
    
    // Generate a unique request ID for this submission (already done by the session)
    const requestId = session.requestId;
    
    // Store in database with mail submissions table
    await dbManager.storeSnapshotMailsSubmission(requestId, sender_email, filename);
    
    // Log submission details
    session.addLog(`Snapshot-mails submission received from ${sender_email}`);
    session.addLog(`Sender Name: ${sender_name}`);
    session.addLog(`Original Subject: ${original_subject}`);
    session.addLog(`Keywords: ${JSON.stringify(keywords)}`);
    session.addLog(`User Parameters: ${JSON.stringify(user_parameters || {})}`);
    
    // Find the PDF file for background processing
    let pdfFile = null;
    
    if (files && files.length > 0) {
      // Use the first file (should be the PDF)
      pdfFile = files[0];
      session.addLog(`Processing PDF file: ${pdfFile.originalname}`);
    }
    
    if (!pdfFile) {
      throw new Error('No PDF file found in submission');
    }
    
    // Create queue data for background processing
    const queueData = {
      sender_email,
      sender_name,
      keywords,
      original_subject,
      user_id,
      files,
      pdfFile,
      user_parameters: user_parameters || {} // Include user parameters in queue data
    };
    
    // Define completion callback
    const onJobComplete = async (error) => {
      if (error) {
        await handleProcessMailSubmissionJobFailure(requestId, error);
      } else {
        await handleProcessMailSubmissionJobCompletion(requestId);
      }
    };
    
    // Enqueue the job for background processing
    session.addLog(`Queuing mail submission for background processing with request_id: ${requestId}`);
    
    // Pass the processMailSubmissionJob as the processor function and completion callback
    await queueManager.enqueueJob(
      requestId, 
      'mail_submission', 
      queueData,
      undefined, // Use default max retries
      undefined, // Use default priority
      processMailSubmissionJob, // Pass the job processor function
      onJobComplete // Pass the completion callback
    );
    
    // Create immediate result with request_id
    const result = {
      status: "Success",
      request_id: requestId
    };
    
    return result;
  } catch (error) {
    session.addLog(`Error processing mail submission: ${error.message}`);
    
    // Create error result
    const errorResult = {
      status: "Error",
      error_message: error.message
    };
    
    return errorResult;
  }
};

/**
 * Process mail submission job (called by the queue manager)
 * @param {Object} job - Job record from database
 * @returns {Promise<Object>} - Processing result
 */
const processMailSubmissionJob = async (job) => {
  // Parse the job data
  const data = JSON.parse(job.data);
  
  // Create a new processing session for this job
  const session = new ProcessingSession(data.user_id, job.request_id); // Use the existing request ID
  
  // Track file paths for cleanup at the end
  const tempFilePaths = [];
  
  // Variables for summary logging
  let errorStatus = "No";
  let reportURL = "";
  let graphValue = "";
  let reportVersion = "";
  
  try {
    // Set origin as external service (snapshot-mails)
    session.setOrigin('external', 'snapshot-mails');
    
    // Log that we're starting background processing
    session.addLog('Starting background processing of snapshot-mails submission');
    
    // Log user parameters
    const userParameters = data.user_parameters || {};
    session.addLog(`User parameters in job: ${JSON.stringify(userParameters)}`);
    
    // Add files to the session if they exist - DO THIS EARLY
    if (data.files && data.files.length > 0) {
      for (const file of data.files) {
        session.addFile(file, 'snapshot-mails');
        
        // Keep track of file paths for cleanup
        if (file.path) {
          tempFilePaths.push(file.path);
        }
      }
    }
    
    // Process with GenShare if applicable
    let genshareResult = null;
    
    if (data.pdfFile) {
      session.addLog('Processing PDF with GenShare in background');
      
      // Merge keywords with user parameters for GenShare options
      // User parameters take precedence over keywords
      const genshareOptions = {
        // Use email subject as article_id if not provided in keywords
        article_id: data.keywords.article_id || `email_${data.sender_email.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
        document_type: data.keywords.article_type || data.keywords.document_type || 'research',
        article_title: data.keywords.title || data.original_subject || 'Email Submission',
        // Add keywords
        ...data.keywords,
        // Add user-specific parameters (these override keywords if there are conflicts)
        ...userParameters
      };
      
      session.addLog(`GenShare options: ${JSON.stringify(genshareOptions)}`);
      
      // Prepare data for GenShare processing
      const genshareData = {
        file: data.pdfFile,
        options: genshareOptions,
        user: {
          id: data.user_id
        }
      };
      
      try {
        // Process the PDF with GenShare - DON'T log to summary here (pass false)
        genshareResult = await genshareManager.processPDF(genshareData, session, false);
        session.addLog(`GenShare processing completed with status: ${genshareResult.status}`);
        
        // Extract values from GenShare result for summary
        reportURL = genshareResult.reportURL || "";
        graphValue = genshareResult.activeGenShareGraphValue || "";
        reportVersion = genshareResult.activeReportVersion || "";
        
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
          file: data.pdfFile,
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
        try {
          await fs.unlink(filePath);
          session.addLog(`Cleaned up temporary file: ${filePath}`);
        } catch (unlinkError) {
          session.addLog(`Error deleting temporary file ${filePath}: ${unlinkError.message}`);
          console.error(`[${job.request_id}] Error deleting temporary file:`, unlinkError);
        }
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
          file: data.pdfFile,
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
          try {
            await fs.unlink(filePath);
          } catch (unlinkError) {
            console.error(`[${job.request_id}] Error deleting temporary file:`, unlinkError);
          }
        }
      }
    }
    
    throw error;
  }
};

/**
 * Get job status for a mail submission
 * @param {string} requestId - Request ID to get status for
 * @returns {Promise<Object>} - Job status information
 */
const getJobStatus = async (requestId) => {
  try {
    // Get job details from queue manager
    const job = await queueManager.getJobByRequestId(requestId);
    
    if (!job) {
      return {
        status: "Error",
        error: "Job not found"
      };
    }
    
    // Format response based on job status
    const response = {
      request_id: requestId,
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
        const completionData = JSON.parse(job.completion_data);
        response.results = {
          genshare_status: completionData.genshare_result?.status || 'unknown'
        };
      } catch (error) {
        response.results = { error: 'Could not parse completion data' };
      }
    }
    
    return response;
  } catch (error) {
    console.error(`Error getting job status for ${requestId}:`, error);
    
    return {
      status: "Error",
      error: error.message
    };
  }
};

/**
 * Retry a failed job
 * @param {string} requestId - Request ID of the job to retry
 * @returns {Promise<Object>} - Retry result
 */
const retryJob = async (requestId) => {
  try {
    // Get job details
    const job = await queueManager.getJobByRequestId(requestId);
    
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
    
    // Reset job for retry using queue manager
    const success = await queueManager.retryJob(requestId);
    
    if (success) {
      return {
        status: "Success",
        message: `Job ${requestId} has been queued for retry`,
        request_id: requestId
      };
    } else {
      return {
        status: "Error",
        error: "Failed to retry job"
      };
    }
  } catch (error) {
    console.error(`Error retrying job ${requestId}:`, error);
    
    return {
      status: "Error",
      error: error.message
    };
  }
};

/**
 * Send job complete notification to snapshot-mails service
 * @param {Object} notificationData - Notification data including request_id, status, results/error_message
 * @returns {Promise<Object>} - Response from snapshot-mails service
 */
const sendJobCompleteNotification = async (notificationData) => {
  try {
    const { request_id, status, results, error_message, mail_submission } = notificationData;
    
    // Validate required fields
    if (!request_id || !status) {
      throw new Error('Missing required notification fields');
    }

    // Construct the notification URL
    const notificationUrl = `http://${snapshotMailsConfig.server.host}:${snapshotMailsConfig.server.port}${snapshotMailsConfig.notifications.endpoint}`;
    
    // Prepare the notification payload
    const payload = {
      request_id,
      status
    };
    
    // Add results or error message based on status
    if (status === 'completed' && results) {
      payload.results = results;
    } else if (status === 'failed' && error_message) {
      payload.error_message = error_message;
    }
    
    // Add mail submission data if available (for additional context)
    if (mail_submission) {
      payload.mail_submission = mail_submission;
    }
    
    console.log(`[SM] Sending notification to ${notificationUrl} for job ${request_id} with status ${status}`);
    
    // Send the notification to snapshot-mails service
    const response = await axios.post(notificationUrl, payload, {
      timeout: snapshotMailsConfig.notifications.timeout || 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'snapshot-api/1.0.0'
      }
    });
    
    const result = {
      status: response.status,
      data: response.data
    };
    
    console.log(`[SM] Notification sent successfully for job ${request_id}: HTTP ${response.status}`);
    return result;
  } catch (error) {
    console.error(`[SM] Error sending job complete notification for ${notificationData.request_id}:`, error.message);
    
    // Log additional details for debugging
    if (error.response) {
      console.error(`[SM] Response status: ${error.response.status}`);
      console.error(`[SM] Response data:`, error.response.data);
    } else if (error.code === 'ECONNREFUSED') {
      console.error(`[SM] Connection refused - is snapshot-mails service running?`);
    }
    
    throw error;
  }
};

module.exports = {
  processSubmission,
  getJobStatus,
  retryJob,
  processMailSubmissionJob,
  sendJobCompleteNotification,
  handleProcessMailSubmissionJobCompletion,
  handleProcessMailSubmissionJobFailure
};
