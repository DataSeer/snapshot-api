// File: src/controllers/genshareController.js
const packageJson = require('../../package.json');
const fs = require('fs').promises;
const genshareManager = require('../utils/genshareManager');
const config = require('../config');
const { ProcessingSession } = require('../utils/s3Storage');
const { getUserById } = require('../utils/userManager');

// Load the genshare configuration
const genshareConfig = require(config.genshareConfigPath);

/**
 * Check health of all GenShare versions or a specific version
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.getGenShareHealth = async (req, res) => {
  try {
    const user = getUserById(req.user.id);
    const requestedVersion = req.query.version || null;
    
    const healthResult = await genshareManager.getGenShareHealth(user, requestedVersion);
    
    // Return health results for all checked versions
    res.json(healthResult);
  } catch (error) {
    return res.status(500).send('GenShare health check failed: ' + error.message);
  }
};

/**
 * Process a PDF document using the appropriate GenShare version
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.processPDF = async (req, res) => {
  // Initialize processing session
  const session = new ProcessingSession(req.user.id);
  session.setSnapshotAPIVersion(`v${packageJson.version}`);
  let errorStatus = "No"; // Initialize error status
  
  try {
    // Prepare data object from request instead of passing req directly
    let parsedOptions = {};
    
    // Parse options if they exist
    if (req.body.options) {
      try {
        // This parsing is necessary when client sends multipart/form-data
        parsedOptions = JSON.parse(req.body.options);
      } catch (parseError) {
        // If parsing fails, check if options is already an object (could happen with application/json content type)
        parsedOptions = typeof req.body.options === 'object' && req.body.options !== null 
          ? req.body.options 
          : {};
        
        session.addLog(`Warning: Error parsing options: ${parseError.message}`);
      }
    }
    
    const processingData = {
      file: req.file,
      user: {
        id: req.user.id
      },
      options: parsedOptions
    };
    
    // Add any additional request body fields except 'options'
    Object.keys(req.body).forEach(key => {
      if (key !== 'options') {
        processingData[key] = req.body[key];
      }
    });
    
    // Process the PDF using the manager
    const result = await genshareManager.processPDF(processingData, session);
    errorStatus = result.errorStatus;
    
    // Save session data to S3
    await session.saveToS3();
    
    // Log to summary sheet before sending response
    await genshareManager.appendToSummary({ 
      session, 
      errorStatus, 
      data: processingData, 
      genshareVersion: result.activeGenShareVersion, 
      reportURL: result.reportURL
    });

    // Clean up temporary file
    await fs.unlink(req.file.path).catch(err => {
      console.error(`[${session.requestId}] Error deleting temporary file:`, err);
    });

    // Forward modified response to client
    res.status(result.status);
    Object.entries(result.headers).forEach(([key, value]) => {
      res.set(key, value);
    });
    res.json({ response: result.data });

  } catch (error) {
    // Set error status based on the type of error
    if (error.response) {
      errorStatus = `GenShare Error (HTTP ${error.response.status})`;
    } else {
      errorStatus = `${error.message}`;
    }

    // Log error
    session.addLog(`Error processing request: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);

    try {
      // Save session data with error information
      await session.saveToS3();
      
      // Create minimal data object for logging
      const errorData = {
        file: req.file,
        user: { id: req.user.id }
      };
      
      // Log to summary sheet before sending error response
      await genshareManager.appendToSummary({ 
        session, 
        errorStatus, 
        data: errorData, 
        genshareVersion: genshareConfig.defaultVersion
      });
    } catch (s3Error) {
      console.error(`[${session.requestId}] Error saving session data:`, s3Error);
    }

    // Clean up temporary file if it exists
    if (req.file && req.file.path) {
      await fs.unlink(req.file.path).catch(err => {
        console.error(`[${session.requestId}] Error deleting temporary file:`, err);
      });
    }
    
    // Forward error response if available
    if (error.response) return res.status(error.response.status).send(error.message);
    return res.status(500).send('GenShare returned an error');
  }
};
