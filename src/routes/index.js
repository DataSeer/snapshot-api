// File: src/routes/index.js
const express = require('express');
const multer = require('multer');
const { processPDF, getGenShareHealth } = require('../controllers/genshareController');
const { getGrobidHealth } = require('../controllers/grobidController');
const { getDatastetHealth } = require('../controllers/datastetController');
const { getPing } = require('../controllers/healthController');
const { getApiRoutes } = require('../controllers/apiController');
const { getVersions } = require('../controllers/versionsController');
const {
  refreshRequests,
  searchRequest,
  getReportOfRequest,
  getReportUrlOfRequest,
} = require('../controllers/requestsController');
const { 
  authenticateEditorialManager, 
  revokeTokenEditorialManager
} = require('../controllers/authController');
const { 
  postSubmissions,
  postCancelUpload,
  postReport,
  postReportLink
} = require('../controllers/emController');
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

// Requests & Reports endpoints (new functionality under /requests/reports)
authenticatedRouter.post('/requests/refresh', refreshRequests);
authenticatedRouter.get('/requests/search', searchRequest); // Available params: article_id & request_id
authenticatedRouter.get('/requests/:requestId/report', getReportOfRequest);
authenticatedRouter.get('/requests/:requestId/report/url', getReportUrlOfRequest);

// Editorial Manager endpoints (keep unchanged as requested)
authenticatedRouter.post('/editorial-manager/submissions', upload.any(), postSubmissions);
authenticatedRouter.post('/editorial-manager/cancel', postCancelUpload); // return true
authenticatedRouter.post('/editorial-manager/reports', postReport); // return { "report_token": "", "scores": "", "flag": true }
authenticatedRouter.post('/editorial-manager/reportLink', postReportLink); // return { "report_url": "..." }

// Mount the authenticated router
unauthenticatedRouter.use('/', authenticatedRouter);

module.exports = unauthenticatedRouter;
