// File: src/middleware/auth.js
const jwtManager = require('../utils/jwtManager');

/**
 * Authenticate users based on JWT token
 * Supports both permanent tokens from users.json and temporary tokens from the database
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
module.exports.authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'unauthorized',
      error_description: 'Authorization header missing'
    });
  }

  try {
    // Use JWT manager to verify the token (handles both permanent and temporary)
    const decoded = await jwtManager.verifyToken(token);
    
    // Set user info in request
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: 'Token has expired'
      });
    }
    
    console.error('Authentication error:', err);
    return res.status(403).json({
      error: 'invalid_token',
      error_description: 'Invalid token'
    });
  }
};
