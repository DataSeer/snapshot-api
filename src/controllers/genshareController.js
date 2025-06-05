// File: src/controllers/genshareController.js
const fs = require('fs').promises;
const genshareManager = require('../utils/genshareManager');
const { ProcessingSession } = require('../utils/s3Storage');
const { getUserById } = require('../utils/userManager');

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
  
  // Set origin as direct API request
  session.setOrigin('direct');
  
  try {
    // Store API request
    session.setAPIRequest({
      method: req.method,
      path: req.path,
      query: req.query,
      body: req.body,
      file: req.file ? {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      } : null
    });
    
    // Add file if present
    if (req.file) {
      session.addFile(req.file, 'api');
    }
    
    // Parse options if they exist
    let parsedOptions = {};
    
    if (req.body.options) {
      try {
        // This parsing is necessary when client sends multipart/form-data
        parsedOptions = typeof req.body.options === 'string' 
          ? JSON.parse(req.body.options) 
          : req.body.options;
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
    
    // Process the PDF using the manager - this is synchronous processing
    const result = await genshareManager.processPDF(processingData, session);
    
    // Store API response
    session.setAPIResponse({
      status: result.status,
      data: result.data
    });
    
    // Save session data to S3
    await session.saveToS3();
    
    // Now that ALL processing is complete, we can safely clean up the temporary file
    if (req.file && req.file.path) {
      await fs.unlink(req.file.path).catch(err => {
        console.error(`[${session.requestId}] Error deleting temporary file:`, err);
      });
    }

    // Forward modified response to client
    res.status(result.status);
    Object.entries(result.headers).forEach(([key, value]) => {
      res.set(key, value);
    });
    res.json({ response: result.data });

  } catch (error) {
    // Log error
    session.addLog(`Error processing request: ${error.message}`);
    session.addLog(`Stack: ${error.stack}`);

    try {
      // Store error response
      session.setAPIResponse({
        status: 'error',
        error: error.message
      });
      
      // Save session data with error information
      await session.saveToS3();

    } catch (s3Error) {
      console.error(`[${session.requestId}] Error saving session data:`, s3Error);
    }

    // Clean up temporary file if it exists, but only after all processing, including error handling, is complete
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
