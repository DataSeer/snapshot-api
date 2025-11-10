// File: src/utils/scholaroneNotificationsManager.js
const fs = require('fs');
const config = require('../config');
const dbManager = require('./dbManager');
const scholaroneManager = require('./scholaroneManager');

/**
 * Load ScholarOne notifications configuration
 * @returns {Object} The notifications configuration
 */
const loadNotificationsConfig = () => {
  try {
    const configPath = config.scholaroneConfigPath;
    const configData = fs.readFileSync(configPath, 'utf8');
    const scholaroneConfig = JSON.parse(configData);
    return scholaroneConfig.notifications || {};
  } catch (error) {
    console.error('Error loading ScholarOne notifications config:', error);
    return {};
  }
};

/**
 * Save ScholarOne notifications configuration
 * @param {Object} notificationsConfig - The notifications configuration to save
 */
const saveNotificationsConfig = (notificationsConfig) => {
  try {
    const configPath = config.scholaroneConfigPath;
    const configData = fs.readFileSync(configPath, 'utf8');
    const scholaroneConfig = JSON.parse(configData);
    
    scholaroneConfig.notifications = notificationsConfig;
    
    fs.writeFileSync(configPath, JSON.stringify(scholaroneConfig, null, 2), 'utf8');
    console.log('ScholarOne notifications configuration saved successfully');
  } catch (error) {
    console.error('Error saving ScholarOne notifications config:', error);
    throw error;
  }
};

/**
 * Check if the endpoint is on hold
 * @returns {boolean} True if endpoint is on hold
 */
const isEndpointOnHold = () => {
  const notificationsConfig = loadNotificationsConfig();
  return notificationsConfig.endpoint_on_hold === true;
};

/**
 * Toggle endpoint on-hold status
 * @param {boolean} onHold - True to put endpoint on hold, false to resume
 */
const toggleEndpointOnHold = (onHold) => {
  const notificationsConfig = loadNotificationsConfig();
  notificationsConfig.endpoint_on_hold = onHold;
  saveNotificationsConfig(notificationsConfig);
  
  console.log(`Endpoint on-hold status set to: ${onHold}`);
};

/**
 * Validate notification signature using shared secret
 * @param {Object} payload - The notification payload
 * @param {string} signature - The signature from request header
 * @returns {boolean} True if signature is valid
 */
const validateNotificationSignature = (payload, signature) => {
  const notificationsConfig = loadNotificationsConfig();
  const sharedSecret = notificationsConfig.shared_secret;
  
  if (!sharedSecret) {
    console.warn('No shared secret configured for notification validation');
    return true; // If no secret configured, skip validation
  }
  
  if (!signature) {
    return false;
  }
  
  const crypto = require('crypto');
  const payloadString = JSON.stringify(payload);
  const expectedSignature = crypto
    .createHmac('sha256', sharedSecret)
    .update(payloadString)
    .digest('hex');
  
  return signature === expectedSignature;
};

/**
 * Validate source IP address
 * @param {string} sourceIp - The source IP address
 * @returns {boolean} True if IP is allowed
 */
const validateSourceIp = (sourceIp) => {
  const notificationsConfig = loadNotificationsConfig();
  const allowedIps = notificationsConfig.allowed_ips || [];
  
  if (allowedIps.length === 0) {
    console.warn('No allowed IPs configured for notification validation');
    return true; // If no IPs configured, allow all
  }
  
  // Normalize IPv6 localhost
  const normalizedIp = sourceIp === '::ffff:127.0.0.1' ? '127.0.0.1' : sourceIp;
  
  return allowedIps.includes(normalizedIp);
};

/**
 * Get notification type configuration by system event name
 * @param {string} systemEventName - The system event name from ScholarOne
 * @returns {Object|null} The notification type config or null if not found
 */
const getNotificationTypeConfig = (systemEventName) => {
  const notificationsConfig = loadNotificationsConfig();
  const types = notificationsConfig.types || {};
  
  // Search through all notification types to find matching event
  for (const [typeName, typeConfig] of Object.entries(types)) {
    if (typeConfig.enabled && typeConfig.events.includes(systemEventName)) {
      return {
        name: typeName,
        ...typeConfig
      };
    }
  }
  
  return null;
};

/**
 * Check if notification should be processed based on duplicate rules
 * @param {string} messageUUID - The message UUID
 * @param {string} submissionId - The submission ID
 * @param {string} systemEventName - The system event name
 * @returns {Promise<Object>} Object with shouldProcess flag and reason
 */
const shouldProcessNotification = async (messageUUID, submissionId, systemEventName) => {
  // Check if this exact notification was already received
  const existingNotification = await dbManager.getScholaroneNotificationByMessageUUID(messageUUID);
  
  if (existingNotification) {
    return {
      shouldProcess: false,
      reason: 'duplicate_message_uuid',
      message: `Notification with messageUUID ${messageUUID} was already received`
    };
  }
  
  // Get notification type configuration
  const typeConfig = getNotificationTypeConfig(systemEventName);
  
  if (!typeConfig) {
    return {
      shouldProcess: false,
      reason: 'event_not_subscribed',
      message: `Event ${systemEventName} is not subscribed or enabled`
    };
  }
  
  // Check for duplicate submissions if retry is not allowed
  if (!typeConfig.allowRetryOnDuplicate && submissionId) {
    const previousNotifications = await dbManager.getScholaroneNotificationsBySubmissionId(submissionId);
    
    // Check if there's a processed notification for this submission with the same event type
    const alreadyProcessed = previousNotifications.some(n => 
      n.processed === 1 && n.system_event_name === systemEventName
    );
    
    if (alreadyProcessed) {
      return {
        shouldProcess: false,
        reason: 'duplicate_submission',
        message: `Submission ${submissionId} with event ${systemEventName} was already processed`
      };
    }
  }
  
  return {
    shouldProcess: true,
    reason: 'valid',
    message: 'Notification is valid and should be processed'
  };
};

/**
 * Parse ScholarOne notification query parameters
 * @param {Object} queryParams - The query parameters from the GET request
 * @returns {Object} Parsed notification data
 */
const parseNotificationPayload = (queryParams) => {
  return {
    messageUUID: queryParams.messageUUID,
    notificationServiceVersion: queryParams.notificationServiceVersion,
    siteName: queryParams.siteName,
    journalName: queryParams.journalName,
    eventDate: queryParams.eventDate,
    subscriptionId: parseInt(queryParams.subscriptionId),
    subscriptionName: queryParams.subscriptionName,
    subscriptionType: queryParams.subscriptionType,
    documentId: queryParams.documentId ? parseInt(queryParams.documentId) : null,
    submissionId: queryParams.submissionId || null,
    documentStatusName: queryParams.documentStatusName || null,
    submissionTitle: queryParams.submissionTitle || null,
    systemEventName: queryParams.systemEventName || null,
    // Store full payload as JSON string for debugging
    payload: JSON.stringify(queryParams)
  };
};

/**
 * Process a ScholarOne notification
 * @param {Object} notificationData - Parsed notification data
 * @param {string} userId - User ID for processing
 * @param {Object} session - Processing session (optional)
 * @returns {Promise<Object>} Processing result
 */
const processNotification = async (notificationData, userId, session = null) => {
  const { messageUUID, submissionId, siteName, systemEventName } = notificationData;
  
  console.log(`[${messageUUID}] Processing notification for submission ${submissionId} (event: ${systemEventName})`);
  
  // Check if notification should be processed FIRST (before inserting)
  const shouldProcess = await shouldProcessNotification(messageUUID, submissionId, systemEventName);
  
  if (!shouldProcess.shouldProcess) {
    console.log(`[${messageUUID}] Notification will not be processed: ${shouldProcess.reason}`);
    
    // Still store the notification for audit trail, but mark as not processed
    try {
      await dbManager.insertScholaroneNotification({
        ...notificationData,
        processed: false,
        processedAt: null,
        requestId: null
      });
      console.log(`[${messageUUID}] Notification stored in database (not processed)`);
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        console.log(`[${messageUUID}] Notification already exists in database`);
      } else {
        console.error(`[${messageUUID}] Error storing notification:`, error);
      }
    }
    
    return {
      success: true,
      processed: false,
      reason: shouldProcess.reason,
      message: shouldProcess.message
    };
  }
  
  // Store notification in database (only if it should be processed)
  try {
    await dbManager.insertScholaroneNotification({
      ...notificationData,
      processed: false,
      processedAt: null,
      requestId: null
    });
    console.log(`[${messageUUID}] Notification stored in database`);
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      console.log(`[${messageUUID}] Notification already exists in database (race condition)`);
      return {
        success: false,
        alreadyProcessed: true,
        reason: 'duplicate_message_uuid'
      };
    }
    throw error;
  }
  
  // Prepare submission data for scholaroneManager
  const submissionData = {
    site_name: siteName,
    submission_id: submissionId
  };
  
  // Process the submission through scholaroneManager
  try {
    const result = await scholaroneManager.processSubmission(submissionData, userId, session);
    
    // Update notification as processed
    await dbManager.updateScholaroneNotificationProcessed(
      messageUUID,
      true,
      result.request_id
    );
    
    console.log(`[${messageUUID}] Notification processed successfully. Request ID: ${result.request_id}`);
    
    return {
      success: true,
      processed: true,
      request_id: result.request_id,
      reason: 'processed'
    };
  } catch (error) {
    console.error(`[${messageUUID}] Error processing notification:`, error);
    
    // Keep processed = false (already set during insert)
    return {
      success: false,
      processed: false,
      reason: 'processing_error',
      error: error.message
    };
  }
};

module.exports = {
  loadNotificationsConfig,
  saveNotificationsConfig,
  isEndpointOnHold,
  toggleEndpointOnHold,
  validateNotificationSignature,
  validateSourceIp,
  getNotificationTypeConfig,
  shouldProcessNotification,
  parseNotificationPayload,
  processNotification
};
