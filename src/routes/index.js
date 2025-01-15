// File: src/routes/index.js
const express = require('express');
const multer = require('multer');
const { processPDF, getGenShareHealth } = require('../controllers/genshareController');
const { getGrobidHealth } = require('../controllers/grobidController');
const { getDatastetHealth } = require('../controllers/datastetController');
const { getPing } = require('../controllers/healthController');
const { getApiRoutes } = require('../controllers/apiController');
const { getVersions } = require('../controllers/versionController');
const rateLimiter = require('../utils/rateLimiter');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ dest: 'tmp/' });

router.get('/', rateLimiter, getApiRoutes);
router.get('/versions', rateLimiter, getVersions);
router.post('/processPDF', rateLimiter, upload.single('file'), processPDF);

// Health check endpoints
router.get('/ping', rateLimiter, getPing);
router.get('/genshare/health', rateLimiter, getGenShareHealth);
router.get('/grobid/health', rateLimiter, getGrobidHealth);
router.get('/datastet/health', rateLimiter, getDatastetHealth);

module.exports = router;
