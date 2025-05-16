// File: src/controllers/emController.js
const fs = require('fs').promises;
const emManager = require('../utils/emManager.fake');
const { ProcessingSession } = require('../utils/s3Storage');

/**
 * Handle POST /editorial-manager/submissions
 * This endpoint handles submissions from Editorial Manager
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.postSubmissions = async (req, res) => {
  // Initialize processing session
  const session = new ProcessingSession(req.user.id, null);
  
  try {
    // Setup external service
    session.setExternalService('editorial-manager');
    
    // Store the request body as options
    session.setOptions(req.body);

    // Prepare data for emManager instead of passing entire req object
    const submissionData = {
      user_id: req.user.id,
      files: req.files || [],
      body: req.body
    };

    // Process the submission
    const result = await emManager.processSubmission(submissionData, session);
    
    // Store the result data in the external service section
    session.setExternalServiceData('submission', result);
    
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
  const session = new ProcessingSession(req.user.id, null);
  
  try {
    // Setup external service
    session.setExternalService('editorial-manager');
    
    const reportId = req.query.report_id;
    
    if (!reportId) {
      session.addLog('Missing required parameter: report_id', 'ERROR');
      return res.status(400).json({
        error: 'Missing required parameter: report_id'
      });
    }
    
    // Store the request in options
    session.setOptions({ report_id: reportId });
    
    // Cancel the upload
    const success = await emManager.cancelUpload(reportId);
    
    // Store the result in the external service data
    session.setExternalServiceData('cancel', {
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
  const session = new ProcessingSession(req.user.id, null);
  
  try {
    // Setup external service
    session.setExternalService('editorial-manager');
    
    const report_id = req.body.report_id || req.query.report_id;
    
    if (!report_id) {
      return res.status(400).json({
        error: 'Missing required parameter: report_id'
      });
    }
    
    // Store report request in options
    session.setOptions(req.body);
    
    // Get the report
    const reportData = await emManager.getReport(report_id, session);
    
    // Store the report data in the external service section
    session.setExternalServiceData('report', reportData);
    
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
  const session = new ProcessingSession(req.user.id, null);
  
  try {
    // Setup external service
    session.setExternalService('editorial-manager');
    
    const report_id = req.body.report_id || req.query.report_id;
    const report_token = req.body.report_token || req.query.report_token;
    
    if (!report_id || !report_token) {
      return res.status(400).json({
        error: 'Missing required parameters: report_id or report_token'
      });
    }
    
    // Store request in options
    session.setOptions(req.body);
    
    // Get the report URL
    const urlData = await emManager.getReportUrl(report_id, report_token);
    
    // Store the URL data in the external service section
    session.setExternalServiceData('reporturl', urlData);
    
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
