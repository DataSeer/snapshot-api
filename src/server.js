// File: src/server.js
const express = require('express');
const morgan = require('morgan');
const routes = require('./routes');
const { httpLogger, trackDuration } = require('./utils/logger');
const config = require('./config');
const { initDatabase, refreshRequestsFromS3 } = require('./utils/requestsManager');
const jwtManager = require('./utils/jwtManager');
const queueManager = require('./utils/queueManager');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Use the HTTP logger middleware
app.use(trackDuration);
app.use(httpLogger);

// Routes are handled in the routes file, including authentication and permissions
app.use('/', routes);

// Initialize the database and start the server
const startServer = async () => {
  try {
    console.log('Initializing databases...');
    
    // Initialize main database
    await initDatabase();
    console.log('Main database initialized successfully');
    
    // Initialize queue manager
    console.log('Initializing queue manager...');
    await queueManager.startJobProcessor();
    console.log('Queue manager initialized successfully');
    
    // Setup periodic token cleanup (every hour)
    setInterval(async () => {
      try {
        const deleted = await jwtManager.cleanupExpiredTokens();
        if (deleted > 0) {
          console.log(`Cleaned up ${deleted} expired tokens`);
        }
      } catch (error) {
        console.error('Error cleaning up tokens:', error);
      }
    }, 3600000); // 1 hour
    
    // Only refresh from S3 if NO_DB_REFRESH is not set to true
    if (process.env.NO_DB_REFRESH !== 'true') {
      console.log('Refreshing requests from S3...');
      await refreshRequestsFromS3();
      console.log('Requests refreshed successfully');
    } else {
      console.log('Skipping S3 refresh (NO_DB_REFRESH=true)');
    }
    
    // Start the server
    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port} in ${process.env.NODE_ENV || 'production'} mode`);
    });
  } catch (error) {
    console.error('Error during server startup:', error);
    throw new Error(`Server startup failed: ${error.message}`);
  }
};

// Start the initialization process and server
startServer();
