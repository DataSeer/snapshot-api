// File: src/routes/index.js
const express = require('express');
const genshareRoutes = require('./genshare');
const { getApiRoutes } = require('../controllers/apiController');
const rateLimiter = require('../utils/rateLimiter');

const router = express.Router();

router.get('/', rateLimiter, getApiRoutes);
router.use('/processPDF', rateLimiter, genshareRoutes);

module.exports = router;
