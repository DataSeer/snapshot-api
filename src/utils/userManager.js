// File: src/utils/userManager.js
const fs = require('fs');
const config = require('../config');
const { watchConfig, reloadConfig } = require('./configWatcher');

// Watch users config (auto-reloads on file change)
const usersConfig = watchConfig(config.usersPath);

/**
 * Get all users from the configuration
 * @returns {Object} Object containing all users with their configurations
 */
const getAllUsers = () => {
  return usersConfig;
};

/**
 * Get user by ID with all user data
 * @param {string} userId - The user ID to retrieve
 * @returns {Object} User object with user data
 */
const getUserById = (userId) => {
  if (!usersConfig[userId]) {
    throw new Error(`User ${userId} not found`);
  }

  return { id: userId, ...usersConfig[userId] };
};

/**
 * Update user data
 * @param {string} userId - The user ID to update
 * @param {Object} userData - The user data to update
 */
const updateUser = (userId, userData) => {
  // Read fresh from disk for write operations to avoid race conditions
  const users = JSON.parse(fs.readFileSync(config.usersPath, 'utf8'));

  if (!users[userId]) {
    throw new Error(`User ${userId} not found`);
  }

  users[userId] = { ...users[userId], ...userData };
  fs.writeFileSync(config.usersPath, JSON.stringify(users, null, 2));
  // Refresh the in-memory copy synchronously so reads immediately after this
  // write are consistent (fs.watch fires async + debounced). The watcher still
  // catches external edits.
  reloadConfig(config.usersPath);
};

/**
 * Replace a user's full configuration.
 *
 * Unlike updateUser (a shallow merge), this overwrites the whole user object:
 * top-level keys absent from userData are removed. Use this for full-document
 * edits where the caller has already assembled the complete desired config
 * (e.g. the admin "Edit JSON" flow). Callers are responsible for carrying over
 * any protected fields (token, client_secret) they want preserved.
 * @param {string} userId - The user ID to replace
 * @param {Object} userData - The complete user object to store
 */
const replaceUser = (userId, userData) => {
  // Read fresh from disk for write operations to avoid race conditions
  const users = JSON.parse(fs.readFileSync(config.usersPath, 'utf8'));

  if (!users[userId]) {
    throw new Error(`User ${userId} not found`);
  }

  users[userId] = userData;
  fs.writeFileSync(config.usersPath, JSON.stringify(users, null, 2));
  // Refresh the in-memory copy synchronously so reads immediately after this
  // write are consistent (fs.watch fires async + debounced). The watcher still
  // catches external edits.
  reloadConfig(config.usersPath);
};

/**
 * Validate client credentials
 * @param {string} clientId - The client ID
 * @param {string} clientSecret - The client secret
 * @returns {boolean} True if credentials are valid
 */
const validateClientCredentials = (clientId, clientSecret) => {
  try {
    const user = getUserById(clientId);
    return user.client_secret === clientSecret;
  } catch (error) {
    return false;
  }
};

/**
 * Get user's authorized GenShare authorizedVersions
 * @param {string} userId - The user ID to check
 * @returns {Array} Array of authorized GenShare version names
 */
const getUserGenShareVersions = (userId) => {
  try {
    const user = getUserById(userId);
    return user.genshare?.authorizedVersions || ['default'];
  } catch (error) {
    return ['default'];
  }
};

/**
 * Get user's default GenShare version
 * @param {string} userId - The user ID to check
 * @returns {string} Default GenShare version name
 */
const getUserDefaultGenShareVersion = (userId) => {
  try {
    const user = getUserById(userId);
    return user.genshare?.defaultVersion || 'default';
  } catch (error) {
    return 'default';
  }
};

/**
 * Get user's response field configuration
 * @param {string} userId - The user ID to check
 * @returns {Object} Object containing availableFields, restrictedFields and
 *   returnedFields arrays. availableFields/restrictedFields govern data access
 *   (security); returnedFields is a presentation-only response-shaping filter.
 */
const getUserResponseFieldRestrictions = (userId) => {
  try {
    const user = getUserById(userId);
    return {
      availableFields: user.genshare?.availableFields || [],
      restrictedFields: user.genshare?.restrictedFields || [],
      returnedFields: user.genshare?.returnedFields || []
    };
  } catch (error) {
    return { availableFields: [], restrictedFields: [], returnedFields: [] };
  }
};

/**
 * Check if a user has admin role
 * @param {string} userId - The user ID to check
 * @returns {boolean} True if user has role "admin"
 */
const isAdmin = (userId) => {
  try {
    const user = getUserById(userId);
    return user.role === 'admin';
  } catch (error) {
    return false;
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  replaceUser,
  validateClientCredentials,
  getUserGenShareVersions,
  getUserDefaultGenShareVersion,
  getUserResponseFieldRestrictions,
  isAdmin
};
