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
  searchRequest
} = require('../controllers/requestsController');
const { 
  authenticateEditorialManager, 
  revokeTokenEditorialManager,
  validateScholarOneWebhook
} = require('../controllers/authController');
const { 
  postSubmissions: emPostSubmissions,
  postCancelUpload: emPostCancelUpload,
  postReport: emPostReport,
  postReportLink: emPostReportLink,
  getJobStatus: emGetJobStatus,
  retryJob: emRetryJob
} = require('../controllers/emController');
const {
  postSubmissions: scholaronePostSubmissions,
  postCancelUpload: scholaronePostCancelUpload,
  getJobStatus: scholaroneGetJobStatus,
  retryJob: scholaroneRetryJob,
} = require('../controllers/scholaroneController');
const {
  receiveNotification: scholaroneReceiveNotification,
  getNotificationStatus: scholaroneGetNotificationStatus
} = require('../controllers/scholaroneNotificationsController');
const {
  postSubmissions: postMailSubmissions,
  getJobStatus: getMailJobStatus,
  retryJob: retryMailJob
} = require('../controllers/snapshotMailsController');
const { getGenshareData } = require('../controllers/snapshotReportsController');
const { authenticateToken } = require('../middleware/auth');
const { checkPermissions } = require('../middleware/permissions');
const rateLimiter = require('../utils/rateLimiter');

const unauthenticatedRouter = express.Router();

// Configure multer for file uploads
const upload = multer({ dest: 'tmp/' });

// Custom file validation middleware for supplementary files
const validateSupplementaryFiles = (req, res, next) => {
  if (req.files && req.files.supplementary_file) {
    // When using upload.fields(), req.files.supplementary_file is an array
    const supplementaryFiles = req.files.supplementary_file;
    const supplementaryFile = Array.isArray(supplementaryFiles) ? supplementaryFiles[0] : supplementaryFiles;
    
    if (supplementaryFile) {
      // Check if it's a ZIP file
      const isZip = supplementaryFile.mimetype === 'application/zip' || 
                   supplementaryFile.mimetype === 'application/x-zip-compressed' ||
                   supplementaryFile.originalname.toLowerCase().endsWith('.zip');
      
      if (!isZip) {
        return res.status(400).json({
          error: 'Invalid supplementary files format. Only ZIP files are supported.'
        });
      }
    }
  }
  next();
};

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

// Updated processPDF route to handle multiple files including supplementary_file
authenticatedRouter.post('/processPDF', 
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'supplementary_file', maxCount: 1 }
  ]), 
  validateSupplementaryFiles,
  processPDF
); 

// Health check endpoints
authenticatedRouter.get('/ping', getPing);
authenticatedRouter.get('/genshare/health', getGenShareHealth);
authenticatedRouter.get('/grobid/health', getGrobidHealth);
authenticatedRouter.get('/datastet/health', getDatastetHealth);

// Requests & Reports endpoints
authenticatedRouter.post('/requests/refresh', refreshRequests);
authenticatedRouter.get('/requests/search', searchRequest); // Available params: article_id & request_id

// Editorial Manager endpoints
authenticatedRouter.post('/editorial-manager/submissions', upload.any(), emPostSubmissions);
authenticatedRouter.post('/editorial-manager/cancel', emPostCancelUpload);
authenticatedRouter.post('/editorial-manager/reports', emPostReport);
authenticatedRouter.post('/editorial-manager/reportLink', upload.none(), emPostReportLink);
authenticatedRouter.get('/editorial-manager/jobs/:reportId', emGetJobStatus);
authenticatedRouter.post('/editorial-manager/retry/:reportId', emRetryJob);

// Snapshot Mails endpoints
authenticatedRouter.post('/snapshot-mails/submissions', upload.any(), postMailSubmissions);
authenticatedRouter.get('/snapshot-mails/jobs/:requestId', getMailJobStatus);
authenticatedRouter.post('/snapshot-mails/retry/:requestId', retryMailJob);

// ScholarOne endpoints
authenticatedRouter.post('/scholarone/submissions', scholaronePostSubmissions);
authenticatedRouter.post('/scholarone/cancel', scholaronePostCancelUpload);
authenticatedRouter.get('/scholarone/jobs/:requestId', scholaroneGetJobStatus);
authenticatedRouter.post('/scholarone/retry/:requestId', scholaroneRetryJob);

// ScholarOne Notifications webhook (uses special authentication)
unauthenticatedRouter.get(
  '/scholarone/notifications',
  validateScholarOneWebhook,
  scholaroneReceiveNotification
);

// ScholarOne Notifications status endpoint (uses normal authentication)
authenticatedRouter.get('/scholarone/notifications/status', scholaroneGetNotificationStatus);

// Snapshot Reports endpoints
authenticatedRouter.get('/snapshot-reports/:requestId/genshare', getGenshareData);

// Mount the authenticated router
unauthenticatedRouter.use('/', authenticatedRouter);

module.exports = unauthenticatedRouter;
