// File: src/routes/genshare.js
const express = require('express');
const multer = require('multer');
const { processPDF } = require('../controllers/genshareController');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// processPDF route at root level
router.post('/', upload.single('input'), processPDF);

module.exports = router;
