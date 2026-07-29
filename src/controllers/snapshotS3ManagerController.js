// File: src/controllers/snapshotS3ManagerController.js
const fs = require('fs');
const axios = require('axios');
const config = require('../config');
const { getAllUsers, getUserById, updateUser, replaceUser } = require('../utils/userManager');

/**
 * User fields that must never be exposed over the admin API nor overwritten via
 * the full-document update endpoint. Reading these back would leak credentials;
 * the JWT token in particular must stay in sync with JWT_SECRET, so it is
 * managed only through the dedicated CLI refresh flows.
 */
const PROTECTED_USER_FIELDS = ['token', 'client_secret'];

/**
 * Build a client-safe copy of a user, omitting protected credential fields and
 * keeping every other field (rateLimit, genshare, reports, role, googleSheets,
 * and any future config keys) so the admin UI can display and edit them.
 * @param {string} id - The user ID
 * @param {Object} userData - The raw user object (may include protected fields)
 * @returns {Object} - Safe user object with `id` and all non-protected fields
 */
const toSafeUser = (id, userData) => {
  const safeUser = { id };
  Object.keys(userData).forEach((key) => {
    if (key === 'id' || PROTECTED_USER_FIELDS.includes(key)) {
      return;
    }
    safeUser[key] = userData[key];
  });
  return safeUser;
};

/**
 * Get snapshot-reports base URL and API key from reports config
 * Uses the first available version's config as they all point to the same service
 * @returns {Object} - { baseUrl, apiKey }
 */
const getSnapshotReportsConfig = () => {
  const reportsConfig = require(config.reportsConfigPath);
  const versions = Object.keys(reportsConfig.versions);

  if (versions.length === 0) {
    throw new Error('No report versions configured');
  }

  const firstVersion = reportsConfig.versions[versions[0]];
  const snapshotReportsConfig = firstVersion['snapshot-reports'];

  if (!snapshotReportsConfig) {
    throw new Error('snapshot-reports configuration not found');
  }

  // Extract base URL from the create-url endpoint
  const createUrl = snapshotReportsConfig.url;
  const baseUrl = createUrl.replace('/api/reports/create-url', '');

  return {
    baseUrl,
    apiKey: snapshotReportsConfig.apiKey
  };
};

/**
 * Reload genshare config from disk (to get fresh data)
 * @returns {Object} - Genshare configuration
 */
const loadGenshareConfig = () => {
  delete require.cache[require.resolve(config.genshareConfigPath)];
  return require(config.genshareConfigPath);
};

/**
 * Save genshare config to disk
 * @param {Object} genshareConfig - Configuration to save
 */
const saveGenshareConfig = (genshareConfig) => {
  fs.writeFileSync(config.genshareConfigPath, JSON.stringify(genshareConfig, null, 2));
};

/**
 * Reload email alerts config from disk (to get fresh data)
 * @returns {Object} - Email alerts configuration
 */
const loadEmailAlertsConfig = () => {
  delete require.cache[require.resolve(config.emailAlertsConfigPath)];
  return require(config.emailAlertsConfigPath);
};

/**
 * Save email alerts config to disk
 * @param {Object} emailAlertsConfig - Configuration to save
 */
const saveEmailAlertsConfig = (emailAlertsConfig) => {
  fs.writeFileSync(config.emailAlertsConfigPath, JSON.stringify(emailAlertsConfig, null, 2));
};

/**
 * Get all users (admin endpoint)
 * GET /api/snapshot-s3-manager/users
 */
const getUsers = async (req, res) => {
  try {
    const users = getAllUsers();

    // Expose every field except protected credentials so the admin UI can edit
    // the full configuration (role, googleSheets, custom keys, ...).
    const safeUsers = Object.entries(users).map(([id, userData]) => toSafeUser(id, userData));

    return res.json({
      success: true,
      data: safeUsers,
      count: safeUsers.length
    });
  } catch (error) {
    console.error('Error getting users:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to get users'
    });
  }
};

/**
 * Get a specific user by ID
 * GET /api/snapshot-s3-manager/users/:userId
 */
const getUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = getUserById(userId);

    // Expose every field except protected credentials.
    const safeUser = toSafeUser(userId, user);

    return res.json({
      success: true,
      data: safeUser
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `User ${req.params.userId} not found`
      });
    }

    console.error('Error getting user:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to get user'
    });
  }
};

/**
 * Update complete user data (rateLimit, genshare, reports)
 * PUT /api/snapshot-s3-manager/users/:userId
 */
const updateUserComplete = async (req, res) => {
  try {
    const { userId } = req.params;
    const updates = req.body;

    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({
        success: false,
        error: 'invalid_payload',
        message: 'Request body must be a user configuration object'
      });
    }

    // Get current user to verify it exists and to preserve protected fields
    const user = getUserById(userId);

    // Full-document replace: the submitted object becomes the new user config,
    // so removing a field in the editor removes it on disk. Protected
    // credentials are never accepted from the client and `id` is the map key,
    // not a stored property — strip them, then re-inject the stored secrets so
    // they are preserved untouched.
    const newUserData = { ...updates };
    delete newUserData.id;
    PROTECTED_USER_FIELDS.forEach((field) => {
      delete newUserData[field];
      if (user[field] !== undefined) {
        newUserData[field] = user[field];
      }
    });

    replaceUser(userId, newUserData);

    // Get updated user data
    const updatedUser = getUserById(userId);

    return res.json({
      success: true,
      message: 'User updated successfully',
      data: toSafeUser(userId, updatedUser)
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `User ${req.params.userId} not found`
      });
    }

    console.error('Error updating user:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to update user'
    });
  }
};

/**
 * Update a user's genshare settings
 * PATCH /api/snapshot-s3-manager/users/:userId/genshare
 */
const updateUserGenshare = async (req, res) => {
  try {
    const { userId } = req.params;
    const genshareUpdates = req.body;

    // Get current user
    const user = getUserById(userId);

    // Merge genshare settings
    const updatedGenshare = {
      ...user.genshare,
      ...genshareUpdates
    };

    // Update user
    updateUser(userId, { genshare: updatedGenshare });

    return res.json({
      success: true,
      message: 'User genshare settings updated successfully',
      data: {
        id: userId,
        genshare: updatedGenshare
      }
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `User ${req.params.userId} not found`
      });
    }

    console.error('Error updating user genshare:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to update user genshare settings'
    });
  }
};

/**
 * Update a user's reports settings
 * PATCH /api/snapshot-s3-manager/users/:userId/reports
 */
const updateUserReports = async (req, res) => {
  try {
    const { userId } = req.params;
    const reportsUpdates = req.body;

    // Get current user
    const user = getUserById(userId);

    // Merge reports settings
    const updatedReports = {
      ...user.reports,
      ...reportsUpdates
    };

    // Update user
    updateUser(userId, { reports: updatedReports });

    return res.json({
      success: true,
      message: 'User reports settings updated successfully',
      data: {
        id: userId,
        reports: updatedReports
      }
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `User ${req.params.userId} not found`
      });
    }

    console.error('Error updating user reports:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to update user reports settings'
    });
  }
};

/**
 * Get all genshare versions
 * GET /api/snapshot-s3-manager/genshare/versions
 */
const getGenshareVersions = async (req, res) => {
  try {
    const genshareConfig = loadGenshareConfig();

    const versions = Object.entries(genshareConfig.versions).map(([alias, versionConfig]) => ({
      alias,
      version: versionConfig.version,
      processPdfUrl: versionConfig.processPDF?.url,
      healthUrl: versionConfig.health?.url,
      hasApiKey: !!versionConfig.processPDF?.apiKey
    }));

    return res.json({
      success: true,
      data: {
        defaultVersion: genshareConfig.defaultVersion,
        versions
      }
    });
  } catch (error) {
    console.error('Error getting genshare versions:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to get genshare versions'
    });
  }
};

/**
 * Get a specific genshare version by alias
 * GET /api/snapshot-s3-manager/genshare/versions/:alias
 */
const getGenshareVersion = async (req, res) => {
  try {
    const { alias } = req.params;
    const genshareConfig = loadGenshareConfig();

    if (!genshareConfig.versions[alias]) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `Genshare version alias "${alias}" not found`
      });
    }

    const versionConfig = genshareConfig.versions[alias];

    return res.json({
      success: true,
      data: {
        alias,
        version: versionConfig.version,
        processPDF: {
          url: versionConfig.processPDF?.url,
          method: versionConfig.processPDF?.method,
          hasApiKey: !!versionConfig.processPDF?.apiKey
        },
        health: versionConfig.health,
        responseMapping: versionConfig.responseMapping
      }
    });
  } catch (error) {
    console.error('Error getting genshare version:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to get genshare version'
    });
  }
};

/**
 * Update a genshare version
 * PATCH /api/snapshot-s3-manager/genshare/versions/:alias
 */
const updateGenshareVersion = async (req, res) => {
  try {
    const { alias } = req.params;
    const updates = req.body;

    const genshareConfig = loadGenshareConfig();

    if (!genshareConfig.versions[alias]) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `Genshare version alias "${alias}" not found`
      });
    }

    const currentConfig = genshareConfig.versions[alias];

    // Apply updates carefully to preserve structure
    if (updates.version) {
      currentConfig.version = updates.version;
    }

    if (updates.processPdfUrl) {
      currentConfig.processPDF = currentConfig.processPDF || {};
      currentConfig.processPDF.url = updates.processPdfUrl;
    }

    if (updates.healthUrl) {
      currentConfig.health = currentConfig.health || {};
      currentConfig.health.url = updates.healthUrl;
    }

    if (updates.apiKey) {
      currentConfig.processPDF = currentConfig.processPDF || {};
      currentConfig.processPDF.apiKey = updates.apiKey;
    }

    // Save the updated config
    saveGenshareConfig(genshareConfig);

    return res.json({
      success: true,
      message: `Genshare version "${alias}" updated successfully`,
      data: {
        alias,
        version: currentConfig.version,
        processPdfUrl: currentConfig.processPDF?.url,
        healthUrl: currentConfig.health?.url
      }
    });
  } catch (error) {
    console.error('Error updating genshare version:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to update genshare version'
    });
  }
};

/**
 * Set default genshare version
 * PUT /api/snapshot-s3-manager/genshare/default
 */
const setDefaultGenshareVersion = async (req, res) => {
  try {
    const { alias } = req.body;

    if (!alias) {
      return res.status(400).json({
        success: false,
        error: 'validation_error',
        message: 'alias is required in request body'
      });
    }

    const genshareConfig = loadGenshareConfig();

    if (!genshareConfig.versions[alias]) {
      return res.status(404).json({
        success: false,
        error: 'not_found',
        message: `Genshare version alias "${alias}" not found`
      });
    }

    genshareConfig.defaultVersion = alias;
    saveGenshareConfig(genshareConfig);

    return res.json({
      success: true,
      message: `Default genshare version set to "${alias}"`,
      data: {
        defaultVersion: alias
      }
    });
  } catch (error) {
    console.error('Error setting default genshare version:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to set default genshare version'
    });
  }
};

// ============================================================================
// SNAPSHOT REPORTS PROXY FUNCTIONS
// ============================================================================

/**
 * Get all report URLs from snapshot-reports
 * GET /api/snapshot-s3-manager/reports
 */
const getReports = async (req, res) => {
  try {
    const { baseUrl, apiKey } = getSnapshotReportsConfig();
    const limit = req.query.limit || 50;
    const offset = req.query.offset || 0;
    const search = req.query.search || undefined;

    const params = { limit, offset };
    if (search) params.search = search;

    const response = await axios({
      method: 'GET',
      url: `${baseUrl}/api/reports`,
      params,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    return res.json(response.data);
  } catch (error) {
    console.error('Error getting reports:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      error: 'proxy_error',
      message: error.response?.data?.message || 'Failed to get reports from snapshot-reports'
    });
  }
};

/**
 * Get available report kinds from snapshot-reports
 * GET /api/snapshot-s3-manager/reports/kinds
 */
const getReportKinds = async (req, res) => {
  try {
    const { baseUrl, apiKey } = getSnapshotReportsConfig();

    const response = await axios({
      method: 'GET',
      url: `${baseUrl}/api/reports/kinds`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    return res.json(response.data);
  } catch (error) {
    console.error('Error getting report kinds:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      error: 'proxy_error',
      message: error.response?.data?.message || 'Failed to get report kinds from snapshot-reports'
    });
  }
};

/**
 * Update report kind for a specific report
 * PATCH /api/snapshot-s3-manager/reports/:reportId/kind
 */
const updateReportKind = async (req, res) => {
  try {
    const { reportId } = req.params;
    const { baseUrl, apiKey } = getSnapshotReportsConfig();

    const response = await axios({
      method: 'PATCH',
      url: `${baseUrl}/api/reports/${reportId}/kind`,
      data: req.body,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });

    return res.json(response.data);
  } catch (error) {
    console.error('Error updating report kind:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      error: 'proxy_error',
      message: error.response?.data?.message || 'Failed to update report kind'
    });
  }
};

// ============================================================================
// REQUESTS ENDPOINTS (for s3-manager sync)
// ============================================================================

const dbManager = require('../utils/dbManager');

/**
 * Search requests with flexible filters
 * GET /snapshot-s3-manager/requests?since=<ISO>&request_id=<id>&article_id=<id>&user_name=<name>&limit=<n>&offset=<n>
 */
const getRequests = async (req, res) => {
  try {
    const filters = {
      since: req.query.since || null,
      request_id: req.query.request_id || null,
      article_id: req.query.article_id || null,
      user_name: req.query.user_name || null,
      limit: Math.min(parseInt(req.query.limit) || 500, 1000),
      offset: parseInt(req.query.offset) || 0
    };

    const result = await dbManager.searchRequestsFiltered(filters);

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error searching requests for s3-manager:', error);
    res.status(500).json({ error: 'Failed to search requests' });
  }
};

/**
 * Get email alerts configuration
 * GET /api/snapshot-s3-manager/email-alerts
 */
const getEmailAlertsConfig = async (req, res) => {
  try {
    const emailAlertsConfig = loadEmailAlertsConfig();
    return res.json({
      success: true,
      data: emailAlertsConfig
    });
  } catch (error) {
    console.error('Error getting email alerts config:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to get email alerts configuration'
    });
  }
};

/**
 * Update email alerts configuration
 * PATCH /api/snapshot-s3-manager/email-alerts
 */
const updateEmailAlertsConfig = async (req, res) => {
  try {
    const currentConfig = loadEmailAlertsConfig();
    const updates = req.body;

    // Validate fields
    const allowedFields = ['enabled', 'recipients', 'watchedUsers', 'watchAll'];
    const invalidFields = Object.keys(updates).filter(key => !allowedFields.includes(key));
    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_fields',
        message: `Invalid fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`
      });
    }

    // Validate types
    if (updates.enabled !== undefined && typeof updates.enabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'validation_error', message: '"enabled" must be a boolean' });
    }
    if (updates.watchAll !== undefined && typeof updates.watchAll !== 'boolean') {
      return res.status(400).json({ success: false, error: 'validation_error', message: '"watchAll" must be a boolean' });
    }
    if (updates.recipients !== undefined && (!Array.isArray(updates.recipients) || !updates.recipients.every(r => typeof r === 'string'))) {
      return res.status(400).json({ success: false, error: 'validation_error', message: '"recipients" must be an array of strings' });
    }
    if (updates.watchedUsers !== undefined && (!Array.isArray(updates.watchedUsers) || !updates.watchedUsers.every(u => typeof u === 'string'))) {
      return res.status(400).json({ success: false, error: 'validation_error', message: '"watchedUsers" must be an array of strings' });
    }
    const updatedConfig = { ...currentConfig, ...updates };
    saveEmailAlertsConfig(updatedConfig);

    return res.json({
      success: true,
      data: updatedConfig,
      message: 'Email alerts configuration updated successfully'
    });
  } catch (error) {
    console.error('Error updating email alerts config:', error);
    return res.status(500).json({
      success: false,
      error: 'internal_error',
      message: 'Failed to update email alerts configuration'
    });
  }
};

/**
 * Get instance configuration
 * GET /api/snapshot-s3-manager/instance
 */
const getInstanceConfig = async (req, res) => {
  try {
    delete require.cache[require.resolve(config.instanceConfigPath)];
    const instanceConf = require(config.instanceConfigPath);
    return res.json({ success: true, data: instanceConf });
  } catch (error) {
    console.error('Error getting instance config:', error);
    return res.status(500).json({ success: false, error: 'internal_error', message: 'Failed to get instance configuration' });
  }
};

/**
 * Update instance configuration
 * PATCH /api/snapshot-s3-manager/instance
 */
const updateInstanceConfig = async (req, res) => {
  try {
    delete require.cache[require.resolve(config.instanceConfigPath)];
    const currentConfig = require(config.instanceConfigPath);
    const updates = req.body;

    const allowedFields = ['name', 's3ManagerUrl'];
    const invalidFields = Object.keys(updates).filter(key => !allowedFields.includes(key));
    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'invalid_fields',
        message: `Invalid fields: ${invalidFields.join(', ')}. Allowed: ${allowedFields.join(', ')}`
      });
    }

    const updatedConfig = { ...currentConfig, ...updates };
    fs.writeFileSync(config.instanceConfigPath, JSON.stringify(updatedConfig, null, 2));

    return res.json({ success: true, data: updatedConfig, message: 'Instance configuration updated successfully' });
  } catch (error) {
    console.error('Error updating instance config:', error);
    return res.status(500).json({ success: false, error: 'internal_error', message: 'Failed to update instance configuration' });
  }
};

/**
 * Get Google Sheets logs configuration
 * GET /api/snapshot-s3-manager/logs/config
 */
const getGoogleSheetsLogsConfig = async (req, res) => {
  try {
    delete require.cache[require.resolve(config.googleSheetsLogsConfigPath)];
    const logsConfig = require(config.googleSheetsLogsConfigPath);
    return res.json({ success: true, data: logsConfig });
  } catch (error) {
    console.error('Error getting Google Sheets logs config:', error);
    return res.status(500).json({ success: false, error: 'internal_error', message: 'Failed to get Google Sheets logs configuration' });
  }
};

/**
 * Rebuild admin Google Sheets logs into a new spreadsheet
 * POST /api/snapshot-s3-manager/logs/rebuild-admin
 */
const rebuildAdminLogs = async (req, res) => {
  try {
    const { rebuildAdminLogs: doRebuild } = require('../utils/googleSheetsRebuild');
    const result = await doRebuild();
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error rebuilding admin logs:', error);
    return res.status(500).json({ success: false, error: 'internal_error', message: error.message });
  }
};

/**
 * Rebuild user Google Sheets logs into a new spreadsheet
 * POST /api/snapshot-s3-manager/logs/rebuild-user
 */
const rebuildUserLogs = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }
    const { rebuildUserLogs: doRebuild } = require('../utils/googleSheetsRebuild');
    const result = await doRebuild(userId);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error rebuilding user logs:', error);
    return res.status(500).json({ success: false, error: 'internal_error', message: error.message });
  }
};

/**
 * Rebuild all Google Sheets logs (admin + all users)
 * POST /api/snapshot-s3-manager/logs/rebuild-all
 */
const rebuildAllLogs = async (req, res) => {
  try {
    const { rebuildAllLogs: doRebuildAll } = require('../utils/googleSheetsRebuild');
    const result = await doRebuildAll();
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error rebuilding all logs:', error);
    return res.status(500).json({ success: false, error: 'internal_error', message: error.message });
  }
};

module.exports = {
  getUsers,
  getUser,
  updateUserComplete,
  updateUserGenshare,
  updateUserReports,
  getInstanceConfig,
  updateInstanceConfig,
  getGenshareVersions,
  getGenshareVersion,
  updateGenshareVersion,
  setDefaultGenshareVersion,
  getReports,
  getReportKinds,
  updateReportKind,
  getRequests,
  getEmailAlertsConfig,
  updateEmailAlertsConfig,
  getGoogleSheetsLogsConfig,
  rebuildAdminLogs,
  rebuildUserLogs,
  rebuildAllLogs
};
