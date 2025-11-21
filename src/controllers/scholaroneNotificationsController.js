// File: src/controllers/scholaroneNotificationsController.js
const scholaroneNotificationsManager = require('../utils/scholaroneNotificationsManager');
const { ProcessingSession } = require('../utils/s3Storage');

/**
 * Handle GET /scholarone/notifications
 * This endpoint receives webhook notifications from ScholarOne
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.receiveNotification = async (req, res) => {
  const queryParams = req.query;
  const messageUUID = queryParams.messageUUID;
  
  console.log(`[${messageUUID}] Received ScholarOne notification`);
  
  try {
    // Check if endpoint is on hold
    if (scholaroneNotificationsManager.isEndpointOnHold()) {
      console.log(`[${messageUUID}] Endpoint is on hold, notification will be queued by ScholarOne`);
      // Return 503 to trigger ScholarOne retry mechanism
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        message: 'Endpoint is on hold'
      });
    }
    
    // Validate required parameters
    if (!messageUUID) {
      console.error('Missing required parameter: messageUUID');
      return res.status(400).json({
        error: 'Missing required parameter: messageUUID'
      });
    }
    
    if (!queryParams.siteName) {
      console.error(`[${messageUUID}] Missing required parameter: siteName`);
      return res.status(400).json({
        error: 'Missing required parameter: siteName'
      });
    }
    
    if (!queryParams.submissionId) {
      console.error(`[${messageUUID}] Missing required parameters: submissionId`);
      return res.status(400).json({
        error: 'Missing required parameters: submissionId'
      });
    }
    
    if (!queryParams.systemEventName) {
      console.error(`[${messageUUID}] Missing required parameters: systemEventName`);
      return res.status(400).json({
        error: 'Missing required parameters: systemEventName'
      });
    }
    
    // Parse notification payload
    const notificationData = scholaroneNotificationsManager.parseNotificationPayload(queryParams);
    
    // Initialize processing session (optional, for logging)
    const session = new ProcessingSession(req.user?.id);
    session.setOrigin('scholarone-notification');
    session.setAPIRequest({
      method: req.method,
      path: req.path,
      query: req.query
    });
    
    // Process the notification
    const result = await scholaroneNotificationsManager.processNotification(
      notificationData,
      req.user?.id,
      session
    );
    
    // Save session data
    await session.saveToS3();
    
    // ScholarOne expects HTTP 200 for successful receipt
    // We return 200 even if we decided not to process (e.g., duplicate)
    // This prevents ScholarOne from retrying
    if (result.success || result.alreadyProcessed) {
      console.log(`[${messageUUID}] Notification handled successfully`);
      return res.status(200).json({
        message: 'Notification received',
        processed: result.processed,
        request_id: result.request_id,
        reason: result.reason
      });
    } else {
      // If there was an error processing, we still return 200 to prevent retry
      // but log the error for investigation
      console.error(`[${messageUUID}] Error processing notification:`, result.error);
      
      // Store error response in session
      session.setAPIResponse({
        status: 'Error',
        error_message: result.error,
        reason: result.reason
      });
      await session.saveToS3();
      
      return res.status(200).json({
        message: 'Notification received but processing failed',
        processed: false,
        reason: result.reason,
        error: result.error
      });
    }
  } catch (error) {
    console.error(`[${messageUUID}] Unexpected error handling notification:`, error);
    
    // Even on unexpected errors, return 200 to prevent endless retries
    // The error is logged for investigation
    return res.status(200).json({
      message: 'Notification received but unexpected error occurred',
      processed: false,
      error: error.message
    });
  }
};

/**
 * Handle GET /scholarone/notifications/status
 * Check the status of the notifications endpoint
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.getNotificationStatus = async (req, res) => {
  try {
    const notificationsConfig = scholaroneNotificationsManager.loadNotificationsConfig();
    
    return res.json({
      enabled: notificationsConfig.enabled || false,
      on_hold: notificationsConfig.endpoint_on_hold || false,
      types: Object.keys(notificationsConfig.types || {}).map(typeName => ({
        name: typeName,
        enabled: notificationsConfig.types[typeName].enabled,
        allowRetryOnDuplicate: notificationsConfig.types[typeName].allowRetryOnDuplicate
      }))
    });
  } catch (error) {
    console.error('Error getting notification status:', error);
    return res.status(500).json({
      error: 'Failed to get notification status'
    });
  }
};
