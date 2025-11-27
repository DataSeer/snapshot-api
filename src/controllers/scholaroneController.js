// File: src/controllers/scholaroneController.js
const scholaroneManager = require('../utils/scholaroneManager');
const genshareManager = require('../utils/genshareManager');
const { ProcessingSession } = require('../utils/s3Storage');

/**
 * Handle POST /scholarone/submissions
 * This endpoint handles submissions from ScholarOne
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.postSubmissions = async (req, res) => {
  // Initialize processing session
  const session = new ProcessingSession(req.user.id);
  
  try {
    // Set origin as direct API request
    session.setOrigin('direct');
    
    // Store the request in the session
    session.setAPIRequest({
      method: req.method,
      path: req.path,
      body: req.body
    });
    
    // Validate required fields
    const siteName = req.body.site_name;
    const submissionId = req.body.submission_id;
    
    if (!siteName) {
      session.addLog('Error: Missing required field: site_name');
      session.setAPIResponse({
        status: 'Error',
        error_message: 'Missing required field: site_name'
      });
      await session.saveToS3();
      
      return res.status(400).json({
        status: 'Error',
        error_message: 'Missing required field: site_name'
      });
    }
    
    if (!submissionId) {
      session.addLog('Error: Missing required field: submission_id');
      session.setAPIResponse({
        status: 'Error',
        error_message: 'Missing required field: submission_id'
      });
      await session.saveToS3();
      
      return res.status(400).json({
        status: 'Error',
        error_message: 'Missing required field: submission_id'
      });
    }
    
    // Prepare data for scholaroneManager
    const submissionData = {
      site_name: siteName,
      submission_id: submissionId
    };

    // Process the submission - this enqueues the job
    const result = await scholaroneManager.processSubmission(submissionData, req.user.id, session);
    
    // Store the API response
    session.setAPIResponse(result);
    
    // Save all data to S3
    await session.saveToS3();
    
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
          file: { originalname: req.body.submission_id },
          user: { id: req.user.id }
        },
        genshareVersion: session.getGenshareVersion() || null,
        reportURL: "",
        graphValue: "",
        reportVersion: "",
        articleId: req.body.submission_id || ""
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
    
    return res.status(500).json({
      status: "Error",
      error_message: error.message
    });
  }
};

/**
 * Handle POST /scholarone/cancel
 * This endpoint cancels an in-process upload
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.postCancelUpload = async (req, res) => {
  try {
    const requestId = req.query.request_id || req.body.request_id;

    if (!requestId) {
      return res.status(400).json({
        error: 'Missing required parameter: request_id'
      });
    }

    // Cancel the upload - manager handles all queue interactions
    const success = await scholaroneManager.cancelUpload(requestId);

    if (success) {
      // Return success with an empty response (just HTTP code)
      return res.status(200).end();
    } else {
      // Return not found
      return res.status(404).end();
    }
  } catch (error) {
    console.error(`[${req.body.request_id}] Failed to cancel upload`);
    return res.status(500).json({
      error: 'Failed to cancel upload'
    });
  }
};

/**
 * Handle GET /scholarone/jobs/:requestId
 * This endpoint allows checking the status of a background job
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
    const jobStatus = await scholaroneManager.getJobStatus(requestId);

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
 * Handle POST /scholarone/retry/:requestId
 * This endpoint allows retrying a failed job
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
    const result = await scholaroneManager.retryJob(requestId);
    
    return res.json(result);
  } catch (error) {
    console.error(`[${req.params.requestId}] Failed to retry job`);
    return res.status(500).json({
      error: 'Failed to retry job'
    });
  }
};
