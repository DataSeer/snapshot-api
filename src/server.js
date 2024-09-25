// File: src/server.js
const express = require('express');
const morgan = require('morgan');
const routes = require('./routes');
const { authenticateToken } = require('./middleware/auth');
const customRateLimiter = require('./utils/rateLimiter');
const config = require('./config');

const app = express();

app.use(express.json());
app.use(morgan('combined'));

// Apply authentication to all routes except the root
app.use('/', (req, res, next) => {
  authenticateToken(req, res, next);
});

// Apply rate limiting after authentication
app.use(customRateLimiter);

app.use('/', routes);

app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
});
