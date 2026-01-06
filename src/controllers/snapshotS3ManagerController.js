// File: src/controllers/snapshotS3ManagerController.js
const fs = require('fs');
const axios = require('axios');
const config = require('../config');
const { getAllUsers, getUserById, updateUser } = require('../utils/userManager');

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
 * Get all users (admin endpoint)
 * GET /api/snapshot-s3-manager/users
 */
const getUsers = async (req, res) => {
  try {
    const users = getAllUsers();

    // Remove sensitive data (tokens, client_secrets)
    const safeUsers = Object.entries(users).map(([id, userData]) => ({
      id,
      rateLimit: userData.rateLimit,
      genshare: userData.genshare,
      reports: userData.reports,
      googleSheets: userData.googleSheets
    }));

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

    // Remove sensitive data
    const safeUser = {
      id: user.id,
      rateLimit: user.rateLimit,
      genshare: user.genshare,
      reports: user.reports,
      googleSheets: user.googleSheets
    };

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

    // Get current user to verify it exists
    const user = getUserById(userId);

    // Build the update object with only allowed fields
    const allowedUpdates = {};

    if (updates.rateLimit) {
      allowedUpdates.rateLimit = {
        ...user.rateLimit,
        ...updates.rateLimit
      };
    }

    if (updates.genshare) {
      allowedUpdates.genshare = {
        ...user.genshare,
        ...updates.genshare
      };
    }

    if (updates.reports) {
      allowedUpdates.reports = {
        ...user.reports,
        ...updates.reports
      };
    }

    // Update user with allowed fields only
    if (Object.keys(allowedUpdates).length > 0) {
      updateUser(userId, allowedUpdates);
    }

    // Get updated user data
    const updatedUser = getUserById(userId);

    return res.json({
      success: true,
      message: 'User updated successfully',
      data: {
        id: userId,
        rateLimit: updatedUser.rateLimit,
        genshare: updatedUser.genshare,
        reports: updatedUser.reports
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
      hasApiKey: !!versionConfig.processPDF?.apiKey,
      googleSheets: versionConfig.googleSheets
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
        googleSheets: versionConfig.googleSheets,
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

    if (updates.googleSheets) {
      currentConfig.googleSheets = {
        ...currentConfig.googleSheets,
        ...updates.googleSheets
      };
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
        healthUrl: currentConfig.health?.url,
        googleSheets: currentConfig.googleSheets
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

    const response = await axios({
      method: 'GET',
      url: `${baseUrl}/api/reports`,
      params: { limit, offset },
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

module.exports = {
  getUsers,
  getUser,
  updateUserComplete,
  updateUserGenshare,
  updateUserReports,
  getGenshareVersions,
  getGenshareVersion,
  updateGenshareVersion,
  setDefaultGenshareVersion,
  getReports,
  getReportKinds,
  updateReportKind
};
