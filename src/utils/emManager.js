// File: src/utils/emManager.js
const axios = require('axios');
const dbManager = require('./dbManager');
const genshareManager = require('./genshareManager');
const config = require('../config');

// Load Editorial Manager configuration
const emConfig = require(config.emConfigPath);

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
    
    // Generate a unique report ID for this submission
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
    
    // Save files if any are included
    if (files && files.length > 0) {
      session.addLog(`Processing ${files.length} files`);
      
      // Find the Reviewer PDF file
      let reviewerPdfFile = null;
      let reviewerPdfMetadata = null;
      
      // First, find the file metadata for "Reviewer PDF"
      for (const fileData of fileDataArray) {
        if (fileData.file_description === "Reviewer PDF") {
          reviewerPdfMetadata = fileData;
          session.addLog(`Found Reviewer PDF metadata: ${fileData.file_name}`);
          break;
        }
      }
      
      // Then find the actual file based on the metadata
      if (reviewerPdfMetadata) {
        for (const file of files) {
          if (file.originalname === reviewerPdfMetadata.file_name ) {
            reviewerPdfFile = file;
            session.addLog(`Found matching Reviewer PDF file: ${file.originalname}`);
            break;
          }
        }
      }
      
      // Search for DAS trigger in custom questions
      const customQuestions = custom_questions || [];
      const dasTriggers = emConfig.das_triggers || [];
      
      let dasQuestion = null;
      let dasValue = "";
      
      // Look for any custom question containing a DAS trigger
      for (const question of customQuestions) {
        const questionName = question.custom_question_name.toLowerCase();
        for (const trigger of dasTriggers) {
          if (questionName.includes(trigger.toLowerCase())) {
            dasQuestion = question;
            dasValue = question.custom_question_value;
            session.addLog(`Found DAS question: "${question.custom_question_name}" with value: "${dasValue}"`);
            break;
          }
        }
        if (dasQuestion) break;
      }
      
      // If we have a reviewer PDF file, process it with GenShare
      if (reviewerPdfFile) {
        session.addLog('Processing reviewer PDF with GenShare');
        
        // Prepare data for GenShare processing
        const genshareData = {
          file: reviewerPdfFile,
          options: {
            article_id: document_id,
            document_type: document_type,
            article_title: article_title,
            das: dasValue,
          },
          user: {
            id: user_id
          }
        };
        
        try {
          // Process the PDF with GenShare
          const genshareResult = await genshareManager.processPDF(genshareData, session);
          session.addLog(`GenShare processing completed with status: ${genshareResult.status}`);
        } catch (genshareError) {
          session.addLog(`Error processing with GenShare: ${genshareError.message}`);
          // Continue processing even if GenShare fails
        }
      } else {
        session.addLog('No Reviewer PDF found for GenShare processing');
      }
    }
    
    // Create result
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
    return await dbManager.cancelEmSubmission(reportId);
  } catch (error) {
    console.error('Error canceling upload:', error);
    return false;
  }
};

/**
 * Get report for a submission
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
    
    // In a real implementation, you would generate or retrieve the report
    // For this example, we'll return a sample report with token and scores
    console.log(`Returning report for ID: ${reportId}`);
    
    const result = {
      report_token: `token-${reportId.substring(0, 8)}`,
      scores: "Quality score:85\nOriginality score: 75",
      flag: false
    };
    
    return result;
  } catch (error) {
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
    
    // Generate a URL for the report
    // In a real implementation, this would generate a specific URL for the user
    const result = {
      report_url: `https://api.yourservice.com/reports/${reportId}`
    };
    
    return result;
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
  sendReportCompleteNotification
};
