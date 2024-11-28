// File: src/routes/genshare.js
const express = require('express');
const multer = require('multer');
const { processPDF } = require('../controllers/genshareController');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ dest: 'tmp/' });

// processPDF route at root level
router.post('/', upload.single('file'), processPDF);

module.exports = router;
