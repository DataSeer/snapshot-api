// File: src/routes/index.js
const express = require('express');
const genshareRoutes = require('./genshare');
const { getApiRoutes } = require('../controllers/apiController');

const router = express.Router();

router.get('/', getApiRoutes);
router.use('/processPDF', genshareRoutes);

module.exports = router;
