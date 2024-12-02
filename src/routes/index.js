// File: src/routes/index.js
const express = require('express');
const multer = require('multer');
const { processPDF, getGenShareHealth } = require('../controllers/genshareController');
const { getApiRoutes } = require('../controllers/apiController');
const rateLimiter = require('../utils/rateLimiter');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ dest: 'tmp/' });

router.get('/', rateLimiter, getApiRoutes);
router.post('/processPDF', rateLimiter, upload.single('file'), processPDF);
router.get('/health', rateLimiter, getGenShareHealth);

module.exports = router;
