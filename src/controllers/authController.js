// File: src/controllers/authController.js (Updated)
const config = require('../config');
const { validateClientCredentials } = require('../utils/userManager');
const { checkUserPermission } = require('../utils/permissionsManager');
const jwtManager = require('../utils/jwtManager');

/**
 * Generic authentication function that can be customized for different auth systems
 * 
 * @param {Object} options - Configuration options
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} - Handles response directly
 */
const authenticate = async (options, req, res) => {
  try {
    const {
      clientIdField = 'client_id',                 // Field name for client ID
      clientSecretField = 'client_secret',         // Field name for client secret
      grantTypeField = 'grant_type',               // Field name for grant type
      grantTypeValue = 'password',                 // Expected grant type value
      additionalValidation = null,                 // Function for additional validation
      additionalFields = {},                       // Additional required fields
      tokenExpirationOverride = null,              // Override token expiration
      responseTransform = null                     // Function to transform response
    } = options;

    // Extract credentials from request body
    const clientId = req.body[clientIdField];
    const clientSecret = req.body[clientSecretField];
    const grantType = req.body[grantTypeField];

    // Extract additional fields if any
    const extraFields = {};
    for (const [key, fieldName] of Object.entries(additionalFields)) {
      extraFields[key] = req.body[fieldName];
    }

    // Validate required parameters
    if (!clientId || !clientSecret || !grantType) {
      return res.status(400).json({ 
        error: 'invalid_request', 
        error_description: 'Missing required parameters' 
      });
    }

    // Validate grant type
    if (grantType !== grantTypeValue) {
      return res.status(400).json({ 
        error: 'unsupported_grant_type', 
        error_description: `Only ${grantTypeValue} grant type is supported` 
      });
    }

    // Validate client credentials against users.json
    const isValid = validateClientCredentials(clientId, clientSecret);
    if (!isValid) {
      return res.status(401).json({ 
        error: 'invalid_client', 
        error_description: 'Invalid client credentials' 
      });
    }
    
    // Check if the user has permission to use this endpoint
    const permissionCheck = checkUserPermission(
      clientId, 
      req.path, 
      req.method
    );
    
    if (!permissionCheck.isAllowed) {
      return res.status(403).json({ 
        error: 'access_denied', 
        error_description: permissionCheck.message 
      });
    }

    // Run additional validation if provided
    if (additionalValidation) {
      const validationResult = await additionalValidation(clientId, extraFields, req);
      if (!validationResult.isValid) {
        return res.status(validationResult.status || 400).json({ 
          error: validationResult.error || 'invalid_request', 
          error_description: validationResult.message 
        });
      }
    }

    // Generate or retrieve token
    const tokenExpiration = tokenExpirationOverride || config.tokenExpiration;
    const tokenData = await jwtManager.generateTemporaryToken(clientId, tokenExpiration);

    // Prepare standard response
    let response = {
      access_token: tokenData.token,
      token_type: 'bearer',
      expires_in: Math.floor((tokenData.expiresAt - new Date()) / 1000) // Remaining seconds
    };

    // Apply response transformation if provided
    if (responseTransform) {
      response = responseTransform(response, tokenData, extraFields);
    }

    // Return the token response
    return res.json(response);
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({ 
      error: 'server_error', 
      error_description: 'An error occurred during authentication' 
    });
  }
};

/**
 * Generic token revocation function
 * 
 * @param {Object} options - Configuration options
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {Promise<void>} - Handles response directly
 */
const revokeToken = async (options, req, res) => {
  try {
    const {
      tokenField = 'token',                         // Field name for token
      clientIdField = 'client_id',                  // Field name for client ID
      clientSecretField = 'client_secret',          // Field name for client secret
      additionalValidation = null,                  // Function for additional validation
      responseTransform = null                      // Function to transform response
    } = options;

    // Extract fields from request body
    const token = req.body[tokenField];
    const clientId = req.body[clientIdField];
    const clientSecret = req.body[clientSecretField];
    
    // Validate required parameters
    if (!token) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Token parameter is required'
      });
    }
    
    // Extract any additional fields for validation
    const extraFields = {};
    for (const key in req.body) {
      if (key !== tokenField && key !== clientIdField && key !== clientSecretField) {
        extraFields[key] = req.body[key];
      }
    }
    
    // If client credentials provided, validate them
    if (clientId && clientSecret) {
      const isValid = validateClientCredentials(clientId, clientSecret);
      if (!isValid) {
        return res.status(401).json({ 
          error: 'invalid_client', 
          error_description: 'Invalid client credentials' 
        });
      }
      
      // Check if the user has permission to use this endpoint
      const permissionCheck = checkUserPermission(
        clientId, 
        req.path, 
        req.method
      );
      
      if (!permissionCheck.isAllowed) {
        return res.status(403).json({ 
          error: 'access_denied', 
          error_description: permissionCheck.message 
        });
      }
      
      // Run additional validation if provided
      if (additionalValidation) {
        const validationResult = await additionalValidation(clientId, token, extraFields, req);
        if (!validationResult.isValid) {
          return res.status(validationResult.status || 400).json({ 
            error: validationResult.error || 'invalid_request', 
            error_description: validationResult.message 
          });
        }
      }
    } else {
      // If no client credentials, we need to validate the token itself
      try {
        const decoded = await jwtManager.verifyToken(token);
        
        // Check if the token owner has permission to use this endpoint
        const permissionCheck = checkUserPermission(
          decoded.id, 
          req.path, 
          req.method
        );
        
        if (!permissionCheck.isAllowed) {
          return res.status(403).json({ 
            error: 'access_denied', 
            error_description: permissionCheck.message 
          });
        }
        
        // Run additional validation if provided
        if (additionalValidation) {
          const validationResult = await additionalValidation(
            decoded.id, token, extraFields, req, true
          );
          if (!validationResult.isValid) {
            return res.status(validationResult.status || 400).json({ 
              error: validationResult.error || 'invalid_request', 
              error_description: validationResult.message 
            });
          }
        }
      } catch (error) {
        return res.status(401).json({
          error: 'invalid_token',
          error_description: 'Invalid token'
        });
      }
    }
    
    const success = await jwtManager.revokeToken(token);
    
    // Prepare standard response
    let response = { 
      message: 'Token revoked successfully' 
    };
    
    // Apply response transformation if provided
    if (responseTransform) {
      response = responseTransform(response, success, extraFields);
    }
    
    if (success) {
      return res.json(response);
    } else {
      return res.status(400).json({
        error: 'invalid_token',
        error_description: 'Token could not be revoked or is not a temporary token'
      });
    }
  } catch (error) {
    console.error('Token revocation error:', error);
    return res.status(500).json({
      error: 'server_error',
      error_description: 'An error occurred while revoking the token'
    });
  }
};

/**
 * Handles temporary token authentication for Editorial Manager
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const authenticateEditorialManager = async (req, res) => {
  // Configuration for Editorial Manager authentication
  const options = {
    clientIdField: 'client_id',
    clientSecretField: 'client_secret',
    grantTypeField: 'grant_type',
    grantTypeValue: 'password',
    // No additional fields or validations needed for Editorial Manager
  };
  
  return authenticate(options, req, res);
};

/**
 * Handles token revocation for Editorial Manager
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const revokeTokenEditorialManager = async (req, res) => {
  // Configuration for Editorial Manager token revocation
  const options = {
    tokenField: 'token',
    clientIdField: 'client_id',
    clientSecretField: 'client_secret',
    // No additional validations or response transformations
  };
  
  return revokeToken(options, req, res);
};

module.exports = {
  // Generic functions
  authenticate,
  revokeToken,
  // Implementation specific handlers
  authenticateEditorialManager,
  revokeTokenEditorialManager
};
