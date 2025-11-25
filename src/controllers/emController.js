// File: src/controllers/emController.js
const fs = require('fs').promises;
const emManager = require('../utils/emManager');
const genshareManager = require('../utils/genshareManager');
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
    
    let body = {};
    
    // Try to parse data from EM
    if (typeof req.body["application/json"] === "object") {
      body = req.body["application/json"];
    } else if (typeof req.body["application/json"] === "string") {
      body = JSON.parse(req.body["application/json"]);
    } else if (typeof req.body === "object") {
      body = req.body;
    }
    
    // Prepare data for emManager instead of passing entire req object
    const submissionData = {
      service_id: body.service_id,
      publication_code: body.publication_code,
      document_id: body.document_id,
      article_title: body.article_title,
      article_type: body.article_type,
      user_id: req.user.id,
      file_data: body.file_data,
      custom_questions: body.custom_questions,
      files: req.files || []
    };

    // Process the submission
    const result = await emManager.processSubmission(submissionData, session);
    
    // Store the API response
    session.setAPIResponse(result);
    
    // Save all data to S3
    await session.saveToS3();
    
    // IMPORTANT: DO NOT delete the temporary files here, as they will be
    // needed by the background job. The files will be handled by the job processor.
    
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
    
    // Append error to summary (Google Sheets logging)
    try {      
      await genshareManager.appendToSummary({
        session,
        errorStatus: error.message,
        data: {
          file: { originalname: "N/A" },
          user: { id: req.user.id }
        },
        genshareVersion: session.getGenshareVersion() || null,
        reportURL: "",
        graphValue: "",
        reportVersion: "",
        articleId: ""
      });
    } catch (appendError) {
      session.addLog(`Error appending to summary: ${appendError.message}`);
      console.error(`[${session.requestId}] Error appending to summary:`, appendError);
    }
    
    try {
      // Save session data with error information
      await session.saveToS3();
    } catch (s3Error) {
      console.error(`[${session.requestId}] Error saving session data:`, s3Error);
    }
    
    // In case of error during submission handling (before job is queued),
    // we can clean up the files as they won't be needed
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
  try {
    const report_id = req.query.report_id || req.body.report_id;

    if (!report_id) {
      return res.status(400).json({
        error: 'Missing required parameter: report_id'
      });
    }

    // Cancel the upload - manager handles all queue interactions
    const success = await emManager.cancelUpload(report_id);

    if (success) {
      // Return success with an empty response (just HTTP code per EM spec)
      return res.status(200).end();
    } else {
      // Return not found
      return res.status(404).end();
    }
  } catch (error) {
    console.error(`[${req.body.report_id}] Failed to cancel upload`);
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
  try {
    const report_id = req.query.report_id || req.body.report_id;

    if (!report_id) {
      return res.status(400).json({
        error: 'Missing required parameter: report_id'
      });
    }

    // Get the report through manager
    const reportData = await emManager.getReport(report_id);

    if (reportData.status === "Error") {
      return res.status(400).json(reportData);
    }

    // Return the report data
    return res.json(reportData);
  } catch (error) {
    console.error(`[${req.body.report_id}] Failed to retrieve report`);
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
  try {
    const report_id = req.query.report_id || req.body.report_id;
    const report_token = req.query.report_token || req.body.report_token;

    if (!report_id || !report_token) {
        return res.status(400).json({
        error: 'Missing required parameters: report_id or report_token'
      });
    }
    
    // Get the report URL through manager
    const urlData = await emManager.getReportUrl(report_id, report_token);
    
    if (urlData.status === "Error") {
      return res.status(400).json(urlData);
    }

    // Return the URL
    return res.json(urlData);
  } catch (error) {
    console.error(`[${req.body.report_id}] Failed to retrieve report URL`);
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
  try {
    const { publication_code, service_id, report_id, status, error_message } = req.body;

    // Validate required fields
    if (!publication_code || !service_id || !report_id || !status) {
      return res.status(400).json({
        error: 'Missing required parameters'
      });
    }
    
    // Send notification through manager
    const result = await emManager.sendReportCompleteNotification({
      publication_code,
      service_id,
      report_id,
      status,
      error_message
    });

    return res.json({
      status: 'success',
      message: 'Notification sent successfully',
      result
    });
  } catch (error) {
    console.error(`[${req.body.report_id}] Failed to send notification`);
    return res.status(500).json({
      error: 'Failed to send notification'
    });
  }
};

/**
 * Handle GET /editorial-manager/jobs/:reportId
 * This endpoint allows checking the status of a background job
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.getJobStatus = async (req, res) => {
  try {
    const { reportId } = req.params;

    if (!reportId) {
      return res.status(400).json({
        status: "Error",
        error: "Missing required parameter: reportId"
      });
    }

    // Get job status through the manager
    const jobStatus = await emManager.getJobStatus(reportId);

    if (jobStatus.status === "Error") {
      return res.status(404).json(jobStatus);
    }

    return res.json(jobStatus);
  } catch (error) {
    console.error(`[${req.params.reportId}] Failed to retrieve job status`);
    return res.status(500).json({
      error: 'Failed to retrieve job status'
    });
  }
};

/**
 * Handle POST /editorial-manager/retry/:reportId
 * This endpoint allows retrying a failed job
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.retryJob = async (req, res) => {
  try {
    const { reportId } = req.params;

    if (!reportId) {
      return res.status(400).json({
        status: "Error",
        error: "Missing required parameter: reportId"
      });
    }

    // Call the manager to handle the retry logic
    const result = await emManager.retryJob(reportId);
    
    return res.json(result);
  } catch (error) {
    console.error(`[${req.params.reportId}] Failed to retry job`);
    return res.status(500).json({
      error: 'Failed to retry job'
    });
  }
};
