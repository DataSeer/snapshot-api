// File: src/utils/emailAlertManager.js
const nodemailer = require('nodemailer');
const config = require('../config');
const { logger } = require('./logger');
const { watchConfig } = require('./configWatcher');

// Watch configs (auto-reloads on file change)
const emailAlertsConfig = watchConfig(config.emailAlertsConfigPath, { enabled: false });
const instanceConfig = watchConfig(config.instanceConfigPath, {});

// SMTP config: loaded once lazily (credentials rarely change, requires restart)
let smtpConfig = null;
let smtpConfigLoaded = false;
let transporter = null;

/**
 * Load SMTP config once (lazy, cached)
 * @returns {Object|null} - SMTP configuration or null if not found
 */
const loadSmtpConfig = () => {
  if (smtpConfigLoaded) {
    return smtpConfig;
  }

  try {
    delete require.cache[require.resolve(config.smtpConfigPath)];
    smtpConfig = require(config.smtpConfigPath);
    smtpConfigLoaded = true;
  } catch (error) {
    logger.warn('SMTP configuration not found, email alerts disabled');
    smtpConfig = null;
    smtpConfigLoaded = true;
  }

  return smtpConfig;
};

/**
 * Get or create the nodemailer transporter (lazy initialization)
 * @returns {Object|null} - Nodemailer transporter or null if SMTP not configured
 */
const getTransporter = () => {
  const smtp = loadSmtpConfig();
  if (!smtp) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport(smtp);
  }

  return transporter;
};

/**
 * Check if a user is watched for email alerts
 * @param {string} userId - User ID to check
 * @returns {boolean} - True if the user should trigger email alerts
 */
const isWatchedUser = (userId) => {
  if (emailAlertsConfig.watchAll) {
    return true;
  }

  return Array.isArray(emailAlertsConfig.watchedUsers) &&
    emailAlertsConfig.watchedUsers.includes(userId);
};

/**
 * Build the email subject for a genshare error alert
 * @param {Object} params - Alert parameters
 * @returns {string} - Email subject
 */
const buildSubject = ({ userId, instanceName, errorMessage }) => {
  return `[${instanceName}] GenShare error - ${userId}: ${errorMessage}`;
};

/**
 * Format session origin into a readable string
 * @param {Object|string} origin - Origin object { type, service } or string
 * @returns {string} - Formatted origin string
 */
const formatOrigin = (origin) => {
  if (!origin) return 'unknown';
  if (typeof origin === 'string') return origin;
  if (origin.service) return `${origin.type} (${origin.service})`;
  return origin.type || 'unknown';
};

/**
 * Build the email body for a genshare error alert
 * @param {Object} params - Alert parameters
 * @returns {string} - Email body (plain text)
 */
const buildBody = ({ instanceName, userId, requestId, origin, genshareVersion, articleId, errorMessage, requestUrl }) => {
  const lines = [
    `GenShare processing error on ${instanceName}`,
    '',
    `Instance:          ${instanceName}`,
    `User:              ${userId}`,
    `Request ID:        ${requestId}`,
    `Origin:            ${formatOrigin(origin)}`,
    `GenShare version:  ${genshareVersion || 'unknown'}`,
    `Article ID:        ${articleId || 'N/A'}`,
    '',
    `Error: ${errorMessage}`,
    '',
    `View request: ${requestUrl || 'N/A'}`
  ];

  return lines.join('\n');
};

/**
 * Send an email alert for a genshare processing error.
 * Fire-and-forget: this function never throws and never returns a meaningful value.
 * It should NOT be awaited by the caller.
 * @param {Object} params - Alert parameters
 * @param {Object} params.session - ProcessingSession instance
 * @param {Error} params.error - The error that occurred
 * @param {string} params.userId - User ID
 */
const notifyGenshareError = ({ session, error, userId }) => {
  // Wrap everything in a promise that catches its own errors
  Promise.resolve().then(async () => {
    if (!emailAlertsConfig.enabled) {
      return;
    }

    if (!isWatchedUser(userId)) {
      return;
    }

    const mailer = getTransporter();
    if (!mailer) {
      return;
    }

    const smtp = loadSmtpConfig();
    const instanceName = instanceConfig.name || 'unknown';
    const requestId = session?.requestId || 'unknown';
    const origin = session?.origin || null;
    const genshareVersion = session?.getGenshareVersion?.() || 'unknown';
    const articleId = session?.apiRequest?.body?.options?.article_id || 'N/A';

    // Build s3-manager request URL
    const s3ManagerUrl = instanceConfig.s3ManagerUrl;
    const requestUrl = s3ManagerUrl ? `${s3ManagerUrl.replace(/\/+$/, '')}/request/${requestId}` : null;

    const subject = buildSubject({
      userId,
      instanceName,
      errorMessage: error.message
    });

    const body = buildBody({
      instanceName,
      userId,
      requestId,
      origin,
      genshareVersion,
      articleId,
      errorMessage: error.message,
      requestUrl
    });

    await mailer.sendMail({
      from: smtp.from,
      to: emailAlertsConfig.recipients.join(', '),
      replyTo: smtp.replyTo,
      subject,
      text: body
    });

    logger.info(`[EmailAlert] Alert sent for request ${requestId} (user: ${userId})`);
  }).catch((emailError) => {
    logger.error(`[EmailAlert] Failed to send alert: ${emailError.message}`);
  });
};

module.exports = {
  notifyGenshareError,
  isWatchedUser
};
