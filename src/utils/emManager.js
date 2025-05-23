// File: src/utils/emManager.js
const fs = require('fs').promises;
const axios = require('axios');
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
 * Process a submission from Editorial Manager
 * @param {Object} data - Submission data and files
 * @param {ProcessingSession} session - Processing session for logging
 * @returns {Promise<Object>} - Processing result with report ID
 */
const processSubmission = async (data, session) => {
  try {
    const { service_id, publication_code, document_id, article_title, article_type, user_id, files, file_data, custom_questions } = data;

    let document_type = article_type === "Original Article" ? "original_article" : "";
    
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
    
    // Find the Reviewer PDF file for background processing
    let reviewerPdfFile = null;
    let reviewerPdfMetadata = null;
    let dasValue = "";
    
    // First, find the file metadata for "Reviewer PDF"
    for (const fileData of fileDataArray) {
      if (fileData.file_description === "Reviewer PDF") {
        reviewerPdfMetadata = fileData;
        session.addLog(`Found Reviewer PDF metadata: ${fileData.file_name}`);
        break;
      }
    }
    
    // Then find the actual file based on the metadata
    if (reviewerPdfMetadata && files && files.length > 0) {
      for (const file of files) {
        if (file.originalname === reviewerPdfMetadata.file_name) {
          reviewerPdfFile = file;
          session.addLog(`Found matching Reviewer PDF file: ${file.originalname}`);
          break;
        }
      }
    }
    
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
      das_value: dasValue,
      // Include any other data needed for processing
    };
    
    // Enqueue the job for background processing
    session.addLog(`Queuing submission for background processing with request_id: ${reportId}`);
    
    // Pass the processEmSubmissionJob as the processor function
    await queueManager.enqueueJob(
      reportId, 
      'em_submission', 
      queueData,
      undefined, // Use default max retries
      undefined, // Use default priority
      processEmSubmissionJob // Pass the job processor function
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
    
    // Process with GenShare if applicable
    let genshareResult = null;
    
    if (data.reviewerPdfFile) {
      session.addLog('Processing reviewer PDF with GenShare in background');
      
      // Prepare data for GenShare processing
      const genshareData = {
        file: data.reviewerPdfFile,
        options: {
          article_id: data.document_id,
          document_type: data.document_type,
          article_title: data.article_title,
          das: data.das_value,
        },
        user: {
          id: data.user_id
        }
      };
      
      try {
        // Process the PDF with GenShare
        genshareResult = await genshareManager.processPDF(genshareData, session);
        session.addLog(`GenShare processing completed with status: ${genshareResult.status}`);
      } catch (genshareError) {
        session.addLog(`Error processing with GenShare: ${genshareError.message}`);
        
        // Still try to log to summary for GenShare errors
        try {
          await genshareManager.appendToSummary({
            session,
            errorStatus: `GenShare Error: ${genshareError.message}`,
            data: genshareData,
            genshareVersion: session.getGenshareVersion() || genshareConfig.defaultVersion,
            reportURL: ""
          });
        } catch (summaryError) {
          session.addLog(`Error logging to summary: ${summaryError.message}`);
        }
        
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
    
    // Send notification to Editorial Manager about completion
    const notificationResult = await sendReportCompleteNotification({
      publication_code: data.publication_code,
      service_id: data.service_id,
      report_id: job.request_id,
      status: 'Success'
    }, session);
    
    // Clean up temporary files ONLY AFTER processing is complete
    if (tempFilePaths.length > 0) {
      for (const filePath of tempFilePaths) {
        await fs.unlink(filePath).catch(err => {
          console.error(`[${job.request_id}] Error deleting temporary file:`, err);
        });
      }
    }
    
    // Return success result
    return {
      status: 'Success',
      genshare_result: genshareResult,
      notification_result: notificationResult
    };
  } catch (error) {
    // Log error
    session.addLog(`Error in background processing: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);
    
    // Ensure we log to summary even in top-level error cases
    try {
      // If we have a GenShare error, try to log to summary with the error status
      if (data.reviewerPdfFile) {
        await genshareManager.appendToSummary({
          session,
          errorStatus: `Job Error: ${error.message}`,
          data: {
            file: data.reviewerPdfFile,
            user: { id: data.user_id }
          },
          genshareVersion: session.getGenshareVersion() || genshareConfig.defaultVersion,
          reportURL: ""
        });
      }
    } catch (summaryError) {
      session.addLog(`Error logging to summary: ${summaryError.message}`);
      console.error(`[${job.request_id}] Error logging to summary:`, summaryError);
    }
    
    try {
      // Save session data with error information
      await session.saveToS3();
      
      // Try to send error notification to Editorial Manager
      await sendReportCompleteNotification({
        publication_code: data.publication_code,
        service_id: data.service_id,
        report_id: job.request_id,
        status: 'Error',
        error_message: error.message
      }, session);
    } catch (notifyError) {
      console.error(`[${job.request_id}] Error sending notification:`, notifyError);
    }
    
    // Clean up temporary files even in case of error, but only after all processing is done
    if (tempFilePaths.length > 0) {
      for (const filePath of tempFilePaths) {
        await fs.unlink(filePath).catch(err => {
          console.error(`[${job.request_id}] Error deleting temporary file:`, err);
        });
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
        
        // Extract scores from report data
        let scores = "Processing complete";

        // TO DO : by default, we return the cumulated_score in the "scores" key
        // Must be changed by the dedicated Genshare result key
        
        // Check if report has response data
        if (reportData && typeof reportData === 'object') {
          // Look for score-related fields in the report data
          const scoreFields = Object.keys(reportData).filter(key => 
            key.toLowerCase().includes('score')
          );
          
          if (scoreFields.length > 0) {
            scores = scoreFields.map(field => `${field}: ${reportData[field]}`).join("\n");
          } else {
            // If no specific score fields, provide a summary of available data
            const dataFields = Object.keys(reportData).filter(key => key !== 'meta');
            scores = `Report contains ${dataFields.length} data fields`;
          }
        }
        
        return {
          report_token: `token-${reportId.substring(0, 8)}`,
          scores,
          flag: false
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

    // Construct the notification URL with the publication code
    const notificationUrl = emConfig.reportCompleteNotificationUrl.replace(
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
  retryJob
};
