/**
 * Creates a minimal Express app for integration tests
 * Mocks authentication and permissions middleware, mounts the real routes
 */
const express = require('express');
const multer = require('multer');

/**
 * Build a test Express app with configurable middleware behavior
 * @param {Object} options - Configuration options
 * @param {Object} options.user - User object to set on req.user (null to skip auth)
 * @param {boolean} options.blockPermissions - If true, permissions middleware returns 403
 * @param {boolean} options.skipAuth - If true, auth middleware returns 401
 * @param {Function} options.controller - The controller function to mount
 * @param {string} options.method - HTTP method ('post', 'get', etc.)
 * @param {string} options.path - Route path
 * @param {boolean} options.useMulter - Whether to use multer for file uploads
 * @param {Function} options.validateSupplementaryFiles - Optional supplementary file validation middleware
 * @returns {express.Application}
 */
function createTestApp(options = {}) {
  const {
    user = { id: 'testuser' },
    blockPermissions = false,
    skipAuth = false,
    controller,
    method = 'post',
    path = '/processPDF',
    useMulter = true,
    validateSupplementaryFiles = null
  } = options;

  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Auth middleware
  const authMiddleware = (req, res, next) => {
    if (skipAuth) {
      return res.status(401).json({
        error: 'unauthorized',
        error_description: 'Authorization header missing'
      });
    }
    req.user = user;
    next();
  };

  // Permissions middleware
  const permissionsMiddleware = (req, res, next) => {
    if (blockPermissions) {
      return res.status(403).json({
        message: 'Your account is not allowed to access this resource'
      });
    }
    next();
  };

  // Build middleware chain
  const middlewares = [authMiddleware, permissionsMiddleware];

  if (useMulter) {
    const upload = multer({ dest: 'tmp/' });
    middlewares.push(
      upload.fields([
        { name: 'file', maxCount: 1 },
        { name: 'supplementary_file', maxCount: 1 }
      ])
    );
  }

  if (validateSupplementaryFiles) {
    middlewares.push(validateSupplementaryFiles);
  }

  middlewares.push(controller);

  app[method](path, ...middlewares);

  return app;
}

module.exports = { createTestApp };
