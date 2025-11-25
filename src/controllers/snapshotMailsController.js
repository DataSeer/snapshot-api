// File: src/controllers/snapshotMailsController.js
const fs = require('fs').promises;
const snapshotMailsManager = require('../utils/snapshotMailsManager');
const genshareManager = require('../utils/genshareManager');
const { ProcessingSession } = require('../utils/s3Storage');

/**
 * Handle POST /snapshot-mails/submissions
 * This endpoint handles PDF submissions from the snapshot-mails service
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.postSubmissions = async (req, res) => {
  // Initialize processing session
  const session = new ProcessingSession(req.user.id);
  
  try {
    // Set origin as external service (snapshot-mails)
    session.setOrigin('external', 'snapshot-mails');
    
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
        session.addFile(file, 'snapshot-mails');
      }
    }
    
    let submissionData = {};
    
    // Parse submission data from the request
    if (req.body.submission_data) {
      if (typeof req.body.submission_data === 'string') {
        submissionData = JSON.parse(req.body.submission_data);
      } else if (typeof req.body.submission_data === 'object') {
        submissionData = req.body.submission_data;
      }
    }
    
    // Validate required fields
    if (!submissionData.sender_email) {
      return res.status(400).json({
        status: "Error",
        error_message: "Missing required field: sender_email"
      });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: "Error", 
        error_message: "No PDF file attached"
      });
    }
    
    // Extract user parameters (if provided)
    const userParameters = submissionData.user_parameters || {};
    
    // Log user parameters for debugging
    session.addLog(`User parameters received: ${JSON.stringify(userParameters)}`);
    
    // Prepare data for snapshotMailsManager
    const mailSubmissionData = {
      sender_email: submissionData.sender_email,
      sender_name: submissionData.sender_name || 'Unknown',
      keywords: submissionData.keywords || {},
      filename: submissionData.filename || req.files[0].originalname,
      original_subject: submissionData.original_subject || 'Email Submission',
      user_id: req.user.id,
      files: req.files || [],
      user_parameters: userParameters // Pass user parameters to manager
    };

    // Process the mail submission
    const result = await snapshotMailsManager.processSubmission(mailSubmissionData, session);
    
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
        request_id: result.request_id
      });
    } else {
      return res.status(400).json({
        status: result.status,
        error_message: result.error_message
      });
    }
  } catch (error) {
    // Log error
    session.addLog(`Error processing mail submission: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);
    
    // Store error response
    session.setAPIResponse({
      status: "Error",
      error_message: error.message
    });
    
    // Append error to summary (Google Sheets logging)
    try {
      // Parse submission data to get article_id from user_parameters if available
      let submissionData = {};
      if (req.body.submission_data) {
        try {
          submissionData = typeof req.body.submission_data === 'string' 
            ? JSON.parse(req.body.submission_data) 
            : req.body.submission_data;
        } catch (parseError) {
          submissionData = {};
        }
      }
      
      const userParameters = submissionData.user_parameters || {};
      
      await genshareManager.appendToSummary({
        session,
        errorStatus: error.message,
        data: {
          file: { originalname: "N/A" },
          user: { id: req.user.id }
        },
        genshareVersion: session.getGenshareVersion() || null,
        reportURL: "",
        graphValue: userParameters.editorial_policy || "",
        reportVersion: "",
        articleId: userParameters.article_id || ""
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
 * Handle GET /snapshot-mails/jobs/:requestId
 * This endpoint allows checking the status of a background job for mail submissions
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.getJobStatus = async (req, res) => {
  try {
    const { requestId } = req.params;

    if (!requestId) {
      return res.status(400).json({
        status: "Error",
        error: "Missing required parameter: requestId"
      });
    }

    // Get job status through the manager
    const jobStatus = await snapshotMailsManager.getJobStatus(requestId);

    if (jobStatus.status === "Error") {
      return res.status(404).json(jobStatus);
    }

    return res.json(jobStatus);
  } catch (error) {
    console.error(`[${req.params.requestId}] Failed to retrieve job status`);
    return res.status(500).json({
      error: 'Failed to retrieve job status'
    });
  }
};

/**
 * Handle POST /snapshot-mails/retry/:requestId
 * This endpoint allows retrying a failed job for mail submissions
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.retryJob = async (req, res) => {
  try {
    const { requestId } = req.params;

    if (!requestId) {
      return res.status(400).json({
        status: "Error",
        error: "Missing required parameter: requestId"
      });
    }

    // Call the manager to handle the retry logic
    const result = await snapshotMailsManager.retryJob(requestId);
    
    return res.json(result);
  } catch (error) {
    console.error(`[${req.params.requestId}] Failed to retry job`);
    return res.status(500).json({
      error: 'Failed to retry job'
    });
  }
};

/**
 * Handle POST /snapshot-mails/test-notification
 * This endpoint allows testing the notification system
 * @param {Object} req - Express request  
 * @param {Object} res - Express response
 */
module.exports.postTestNotification = async (req, res) => {
  try {
    const { request_id, notification_url } = req.body;

    if (!request_id || !notification_url) {
      return res.status(400).json({
        error: 'Missing required parameters: request_id, notification_url'
      });
    }

    // Test the notification system
    const result = await snapshotMailsManager.testNotification(request_id, notification_url);
    
    return res.json(result);
  } catch (error) {
    console.error(`[${req.body.request_id}] Failed to test notification`);
    return res.status(500).json({
      error: 'Failed to test notification'
    });
  }
};
