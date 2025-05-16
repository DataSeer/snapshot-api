// File: src/utils/emManager.js
const dbManager = require('./dbManager');

/**
 * Process a submission from Editorial Manager
 * @param {Object} data - Submission data and files
 * @param {ProcessingSession} session - Processing session for logging
 * @returns {Promise<Object>} - Processing result with report ID
 */
const processSubmission = async (data, session) => {
  try {
    const { user_id, files } = data;
    const publication_code = "publication_code";
    const document_id = "document_id";
    const service_id = "service_id";
    
    // Generate a unique report ID for this submission
    const reportId = session.requestId;
    
    // Store in database
    await dbManager.storeEmSubmission(reportId, service_id, publication_code, document_id);
    
    // Log submission details
    session.addLog(`Editorial Manager submission received from ${user_id}`);
    session.addLog(`Service ID: ${service_id}`);
    session.addLog(`Publication Code: ${publication_code}`);
    session.addLog(`Document ID: ${document_id}`);
    
    // Store request body in session
    session.addLog('Storing submission data');
    
    // Save files if any are included
    if (files && files.length > 0) {
      session.addLog(`Processing ${files.length} files`);
      
      // Process files
      for (const file of files) {
        // all files are stored as external files
        session.addExternalFile({
          path: file.path,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        });
        session.addLog(`Added external file: ${file.originalname}, size: ${file.size} bytes`);
      }
    }
    
    return {
      status: "Success",
      report_id: reportId
    };
  } catch (error) {
    session.addLog(`Error processing submission: ${error.message}`);
    return {
      status: "Error",
      error_message: error.message
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
    return await dbManager.cancelEmSubmission(reportId);
  } catch (error) {
    console.error('Error canceling upload:', error);
    return false;
  }
};

/**
 * Get report for a submission
 * @param {string} reportId - Report ID to retrieve
 * @param {ProcessingSession} session - Processing session for logging
 * @returns {Promise<Object>} - Report data
 */
const getReport = async (reportId, session) => {
  try {
    // Check if submission exists
    const submission = await dbManager.getEmSubmissionByRequestId(reportId);
    
    if (!submission) {
      session.addLog(`Report not found for ID: ${reportId}`);
      return {
        status: "Error",
        error_message: "Report not found"
      };
    }
    
    // Check if report was canceled
    if (submission.canceled_at) {
      session.addLog(`Report was canceled: ${reportId}`);
      return {
        status: "Error",
        error_message: "Report was canceled"
      };
    }
    
    // In a real implementation, you would generate or retrieve the report
    // For this example, we'll return a sample report with token and scores
    session.addLog(`Returning report for ID: ${reportId}`);
    
    return {
      report_token: `token-${reportId}`,
      scores: "scores",
      flag: false
    };
  } catch (error) {
    session.addLog(`Error getting report: ${error.message}`);
    return {
      status: "Error",
      error_message: error.message
    };
  }
};

/**
 * Get report URL using token
 * @param {string} reportId - Report ID
 * @param {string} reportToken - Report token
 * @returns {Promise<Object>} - Object containing report URL
 */
const getReportUrl = async (reportId, reportToken) => {
  return {
    report_url: `https://api.yourservice.com/reports/${reportId}?token=${reportToken}`
  };
};

module.exports = {
  processSubmission,
  cancelUpload,
  getReport,
  getReportUrl
};
