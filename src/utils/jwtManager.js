// File: src/utils/jwtManager.js
const jwt = require('jsonwebtoken');
const config = require('../config');
const dbManager = require('./dbManager');
const { getUserById } = require('./userManager');

/**
 * Sign a permanent JWT token
 * @param {string} userId - The user ID to include in the token
 * @returns {string} - Signed JWT token
 */
const signPermanentToken = (userId) => {
  return jwt.sign({ id: userId }, config.jwtSecret);
};

/**
 * Verify a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {Promise<Object>} - Decoded token payload
 * @throws {Error} - If token is invalid or verification fails
 */
const verifyToken = async (token) => {
  // First verify the token signature
  const decoded = jwt.verify(token, config.jwtSecret);
  
  // Check if this is a temporary token
  if (decoded.type === 'temporary') {
    // Verify the token is in the database and not revoked
    const isValid = await dbManager.isTokenValid(token);
    if (!isValid) {
      throw new Error('Token has been revoked or is invalid');
    }
  }
  // For permanent tokens, verify against users.json
  else {
    try {
      const user = getUserById(decoded.id);
      if (!user || user.token !== token) {
        throw new Error('Invalid permanent token');
      }
    } catch (error) {
      throw new Error('Invalid permanent token');
    }
  }
  
  return decoded;
};

/**
 * Generate a temporary JWT token
 * @param {string} clientId - The client ID
 * @param {number} expiresIn - Token expiration time in seconds
 * @returns {Promise<Object>} - Token object with token, expiresIn, and expiresAt
 */
const generateTemporaryToken = async (clientId, expiresIn = config.tokenExpiration) => {
  try {
    // Check if a valid token already exists
    const existingToken = await dbManager.getValidToken(clientId);
    if (existingToken) {
      // Calculate remaining time
      const now = new Date();
      const expiresAt = new Date(existingToken.expires_at);
      const remainingMs = expiresAt - now;
      const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));
      
      // If token has significant time left, return it
      if (remainingSeconds > 60) { // At least 1 minute remaining
        return {
          token: existingToken.token,
          expiresIn: remainingSeconds,
          expiresAt: expiresAt
        };
      }
    }
    
    // Generate a new token
    const accessToken = jwt.sign(
      { 
        id: clientId, 
        type: 'temporary',
        // Add any additional claims needed
      }, 
      config.jwtSecret, 
      { expiresIn }
    );
    
    // Calculate expiration date
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    
    // Store the token in database
    await dbManager.storeToken(clientId, accessToken, expiresAt);
    
    return {
      token: accessToken,
      expiresIn,
      expiresAt
    };
  } catch (error) {
    console.error('Error generating temporary token:', error);
    throw error;
  }
};

/**
 * Revoke a JWT token
 * @param {string} token - The token to revoke
 * @returns {Promise<boolean>} - True if token was revoked successfully
 */
const revokeToken = async (token) => {
  try {
    // First verify it's a temporary token
    const decoded = jwt.decode(token);
    if (!decoded || decoded.type !== 'temporary') {
      return false; // Not a temporary token, can't revoke
    }
    
    return await dbManager.revokeToken(token);
  } catch (error) {
    console.error('Error revoking token:', error);
    return false;
  }
};

/**
 * Clean up expired tokens
 * @returns {Promise<number>} - Number of deleted tokens
 */
const cleanupExpiredTokens = async () => {
  try {
    return await dbManager.cleanupExpiredTokens();
  } catch (error) {
    console.error('Error cleaning up expired tokens:', error);
    return 0;
  }
};

/**
 * Decode a JWT token without verification
 * @param {string} token - The JWT token to decode
 * @returns {Object|null} - Decoded token payload or null if invalid
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    console.error('Error decoding token:', error);
    return null;
  }
};

module.exports = {
  signPermanentToken,
  verifyToken,
  generateTemporaryToken,
  revokeToken,
  cleanupExpiredTokens,
  decodeToken
};
