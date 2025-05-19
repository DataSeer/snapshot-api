// File: src/controllers/emController.js
const fs = require('fs').promises;
const emManager = require('../utils/emManager');
const { ProcessingSession } = require('../utils/s3Storage');

/**
 * Handle POST /editorial-manager/submissions
 * This endpoint handles submissions from Editorial Manager
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.postSubmissions = async (req, res) => {
  // Initialize processing session
  const session = new ProcessingSession(req.user.id);
  
  try {
    // Set origin as external service (Editorial Manager)
    session.setOrigin('external', 'editorial-manager');
    
    // Store the request in the session
    session.setAPIRequest({
      method: req.method,
      path: req.path,
      body: req.body,
      files: req.files ? req.files.map(f => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size
      })) : []
    });
    
    // Add files to the session
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        session.addFile(file, 'editorial-manager');
      }
    }

    // Prepare data for emManager instead of passing entire req object
    const submissionData = {
      service_id: req.body.service_id,
      publication_code: req.body.publication_code,
      document_id: req.body.document_id,
      article_title: req.body.article_title,
      article_type: req.body.article_type,
      user_id: req.user.id,
      file_data: req.body.file_data,
      custom_questions: req.body.custom_questions,
      files: req.files || []
    };

    // Process the submission
    const result = await emManager.processSubmission(submissionData, session);
    
    // Store the API response
    session.setAPIResponse(result);
    
    // Save all data to S3
    await session.saveToS3();
    
    // Clean up any temporary files
    if (req.files) {
      for (const file of req.files) {
        await fs.unlink(file.path).catch(err => {
          console.error(`[${session.requestId}] Error deleting temporary file:`, err);
        });
      }
    }
    
    // Return the response
    if (result.status === "Success") {
      return res.json({
        status: result.status,
        report_id: result.report_id
      });
    } else {
      return res.status(400).json({
        status: result.status,
        error_message: result.error_message
      });
    }
  } catch (error) {
    // Log error
    session.addLog(`Error processing submission: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);
    
    // Store error response
    session.setAPIResponse({
      status: "Error",
      error_message: error.message
    });
    
    try {
      // Save session data with error information
      await session.saveToS3();
    } catch (s3Error) {
      console.error(`[${session.requestId}] Error saving session data:`, s3Error);
    }
    
    // Clean up any temporary files
    if (req.files) {
      for (const file of req.files) {
        await fs.unlink(file.path).catch(err => {
          console.error(`[${session.requestId}] Error deleting temporary file:`, err);
        });
      }
    }
    
    return res.status(500).json({
      status: "Error",
      error_message: error.message
    });
  }
};

/**
 * Handle POST /editorial-manager/cancel
 * This endpoint cancels an in-process upload
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.postCancelUpload = async (req, res) => {
  // Initialize processing session
  const session = new ProcessingSession(req.user.id);
  
  try {
    // Set origin as external service (Editorial Manager)
    session.setOrigin('external', 'editorial-manager');
    
    const reportId = req.query.report_id;
    
    if (!reportId) {
      session.addLog('Missing required parameter: report_id', 'ERROR');
      
      // Store error request and response
      session.setAPIRequest({ 
        action: 'cancel',
        error: 'Missing required parameter: report_id'
      });
      
      session.setAPIResponse({
        error: 'Missing required parameter: report_id'
      });
      
      await session.saveToS3();
      
      return res.status(400).json({
        error: 'Missing required parameter: report_id'
      });
    }
    
    // Store the request
    session.setAPIRequest({ 
      report_id: reportId,
      action: 'cancel'
    });
    
    // Cancel the upload
    const success = await emManager.cancelUpload(reportId);
    
    // Store the result
    session.setAPIResponse({
      report_id: reportId,
      success: success
    });
    
    // Save the session to S3
    await session.saveToS3();
    
    if (success) {
      // Return success with an empty response (just HTTP code per EM spec)
      return res.status(200).end();
    } else {
      // Return not found
      return res.status(404).end();
    }
  } catch (error) {
    // Log error
    session.addLog(`Error canceling upload: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);
    
    // Store error response
    session.setAPIResponse({
      status: "Error",
      error: error.message
    });
    
    try {
      // Save session data with error information
      await session.saveToS3();
    } catch (s3Error) {
      console.error(`[${session.requestId}] Error saving session data:`, s3Error);
    }
    
    return res.status(500).json({
      error: 'Failed to cancel upload'
    });
  }
};

/**
 * Handle POST /editorial-manager/reports
 * This endpoint retrieves a report package
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.postReport = async (req, res) => {
  // Initialize processing session
  const session = new ProcessingSession(req.user.id);
  
  try {
    // Set origin as external service (Editorial Manager)
    session.setOrigin('external', 'editorial-manager');
    
    const { report_id } = req.body;
    
    if (!report_id) {
      // Store error request and response
      session.setAPIRequest({
        action: 'get_report',
        error: 'Missing required parameter: report_id'
      });
      
      session.setAPIResponse({
        error: 'Missing required parameter: report_id'
      });
      
      await session.saveToS3();
      
      return res.status(400).json({
        error: 'Missing required parameter: report_id'
      });
    }
    
    // Store report request
    session.setAPIRequest({
      action: 'get_report',
      report_id: report_id
    });
    
    // Get the report
    const reportData = await emManager.getReport(report_id, session);
    
    // Store API response
    session.setAPIResponse(reportData);
    
    // Save session to S3
    await session.saveToS3();
    
    if (reportData.status === "Error") {
      return res.status(400).json(reportData);
    }
    
    // Return the report data
    return res.json(reportData);
  } catch (error) {
    // Log error
    session.addLog(`Error getting report: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);
    
    // Store error response
    session.setAPIResponse({
      status: "Error",
      error: error.message
    });
    
    try {
      // Save session data with error information
      await session.saveToS3();
    } catch (s3Error) {
      console.error(`[${session.requestId}] Error saving session data:`, s3Error);
    }
    
    return res.status(500).json({
      error: 'Failed to retrieve report'
    });
  }
};

/**
 * Handle POST /editorial-manager/reportlink
 * This endpoint exchanges a report token for a URL
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.postReportLink = async (req, res) => {
  // Initialize processing session
  const session = new ProcessingSession(req.user.id);
  
  try {
    // Set origin as external service (Editorial Manager)
    session.setOrigin('external', 'editorial-manager');
    
    const { report_id, report_token } = req.body;
    
    if (!report_id || !report_token) {
      // Store error request and response
      session.setAPIRequest({
        action: 'get_report_link',
        error: 'Missing required parameters: report_id or report_token'
      });
      
      session.setAPIResponse({
        error: 'Missing required parameters: report_id or report_token'
      });
      
      await session.saveToS3();
      
      return res.status(400).json({
        error: 'Missing required parameters: report_id or report_token'
      });
    }
    
    // Store request
    session.setAPIRequest({
      action: 'get_report_link',
      report_id,
      report_token
    });
    
    // Get the report URL
    const urlData = await emManager.getReportUrl(report_id, report_token, session);
    
    // Store API response
    session.setAPIResponse(urlData);
    
    // Save session to S3
    await session.saveToS3();
    
    if (urlData.status === "Error") {
      return res.status(400).json(urlData);
    }
    
    // Return the URL
    return res.json(urlData);
  } catch (error) {
    // Log error
    session.addLog(`Error getting report URL: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);
    
    // Store error response
    session.setAPIResponse({
      status: "Error",
      error: error.message
    });
    
    try {
      // Save session data with error information
      await session.saveToS3();
    } catch (s3Error) {
      console.error(`[${session.requestId}] Error saving session data:`, s3Error);
    }
    
    return res.status(500).json({
      error: 'Failed to retrieve report URL'
    });
  }
};

/**
 * Handle POST /editorial-manager/reportcomplete
 * This endpoint sends a report complete notification to Editorial Manager
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.postReportCompleteNotification = async (req, res) => {
  // Initialize processing session
  const session = new ProcessingSession(req.user.id);
  
  try {
    // Set origin as external service (Editorial Manager)
    session.setOrigin('external', 'editorial-manager');
    
    const { publication_code, service_id, report_id, status, error_message } = req.body;
    
    // Store request
    session.setAPIRequest({
      action: 'report_complete_notification',
      ...req.body
    });
    
    // Validate required fields
    if (!publication_code || !service_id || !report_id || !status) {
      session.addLog('Missing required parameters', 'ERROR');
      
      // Store error response
      session.setAPIResponse({
        error: 'Missing required parameters'
      });
      
      // Save session to S3
      await session.saveToS3();
      
      return res.status(400).json({
        error: 'Missing required parameters'
      });
    }
    
    // Send notification to Editorial Manager
    const result = await emManager.sendReportCompleteNotification({
      publication_code,
      service_id,
      report_id,
      status,
      error_message
    }, session);
    
    // Store API response
    session.setAPIResponse({
      status: 'success',
      message: 'Notification sent successfully',
      result
    });
    
    // Save session to S3
    await session.saveToS3();
    
    return res.json({
      status: 'success',
      message: 'Notification sent successfully',
      result
    });
  } catch (error) {
    // Log error
    session.addLog(`Error sending notification: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);
    
    // Store error response
    session.setAPIResponse({
      status: "Error",
      error: error.message
    });
    
    try {
      // Save session data with error information
      await session.saveToS3();
    } catch (s3Error) {
      console.error(`[${session.requestId}] Error saving session data:`, s3Error);
    }
    
    return res.status(500).json({
      error: 'Failed to send notification'
    });
  }
};
