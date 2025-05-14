// File: src/routes/index.js
const express = require('express');
const multer = require('multer');
const { processPDF, getGenShareHealth } = require('../controllers/genshareController');
const { getGrobidHealth } = require('../controllers/grobidController');
const { getDatastetHealth } = require('../controllers/datastetController');
const { getPing } = require('../controllers/healthController');
const { getApiRoutes } = require('../controllers/apiController');
const { getVersions } = require('../controllers/versionsController');
const { refreshRequests } = require('../controllers/requestsController');
const { getReport } = require('../controllers/reportsController');
const { 
  authenticateEditorialManager, 
  revokeTokenEditorialManager
} = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { checkPermissions } = require('../middleware/permissions');
const rateLimiter = require('../utils/rateLimiter');

const unauthenticatedRouter = express.Router();

// Configure multer for file uploads
const upload = multer({ dest: 'tmp/' });

// Public authentication routes (no authentication required)
// These routes handle their own permission checks internally
unauthenticatedRouter.post('/editorial-manager/authenticate', authenticateEditorialManager);
unauthenticatedRouter.post('/editorial-manager/revokeToken', revokeTokenEditorialManager);

// Create a sub-router for authenticated routes
const authenticatedRouter = express.Router();

// Apply authentication to all routes in this sub-router
authenticatedRouter.use(authenticateToken);

// Apply permission checks AFTER authentication
authenticatedRouter.use(checkPermissions);

// Apply rate limiting to authenticated routes
authenticatedRouter.use(rateLimiter);

// Define authenticated routes
authenticatedRouter.get('/', getApiRoutes);
authenticatedRouter.get('/versions', getVersions);
authenticatedRouter.post('/processPDF', upload.single('file'), processPDF);

// Health check endpoints
authenticatedRouter.get('/ping', getPing);
authenticatedRouter.get('/genshare/health', getGenShareHealth);
authenticatedRouter.get('/grobid/health', getGrobidHealth);
authenticatedRouter.get('/datastet/health', getDatastetHealth);

// Reports endpoints
authenticatedRouter.get('/reports/search', getReport);

// Requests endpoints
authenticatedRouter.post('/requests/refresh', refreshRequests);

// Mount the authenticated router
unauthenticatedRouter.use('/', authenticatedRouter);

module.exports = unauthenticatedRouter;
