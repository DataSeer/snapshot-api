// File: src/server.js
const express = require('express');
const morgan = require('morgan');
const routes = require('./routes');
const { authenticateToken } = require('./middleware/auth');
const { httpLogger } = require('./utils/logger');
const config = require('./config');

const app = express();

app.use(express.json());
app.use(morgan('combined'));

// Use the HTTP logger middleware
app.use(httpLogger);

// Apply authentication to all routes except the root
app.use('/', (req, res, next) => {
  authenticateToken(req, res, next);
});

app.use('/', routes);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
