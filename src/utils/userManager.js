// File: src/utils/userManager.js
const fs = require('fs');
const config = require('../config');

/**
 * Get user by ID with all user data
 * @param {string} userId - The user ID to retrieve
 * @returns {Object} User object with user data
 */
const getUserById = (userId) => {
  const users = JSON.parse(fs.readFileSync(config.usersPath, 'utf8'));
  
  if (!users[userId]) {
    throw new Error(`User ${userId} not found`);
  }
  
  return { id: userId, ...users[userId] };
};

/**
 * Update user data
 * @param {string} userId - The user ID to update
 * @param {Object} userData - The user data to update
 */
const updateUser = (userId, userData) => {
  const users = JSON.parse(fs.readFileSync(config.usersPath, 'utf8'));
  
  if (!users[userId]) {
    throw new Error(`User ${userId} not found`);
  }
  
  users[userId] = { ...users[userId], ...userData };
  fs.writeFileSync(config.usersPath, JSON.stringify(users, null, 2));
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
 * Get user's response field restrictions
 * @param {string} userId - The user ID to check
 * @returns {Object} Object containing availableFields and restrictedFields arrays
 */
const getUserResponseFieldRestrictions = (userId) => {
  try {
    const user = getUserById(userId);
    return {
      availableFields: user.genshare?.availableFields || [],
      restrictedFields: user.genshare?.restrictedFields || []
    };
  } catch (error) {
    return { availableFields: [], restrictedFields: [] };
  }
};

module.exports = { 
  getUserById, 
  updateUser, 
  getUserGenShareVersions, 
  getUserDefaultGenShareVersion,
  getUserResponseFieldRestrictions
};
