// File: src/controllers/genshareController.js
const fs = require('fs').promises;
const genshareManager = require('../utils/genshareManager');
const { ProcessingSession } = require('../utils/s3Storage');
const { getUserById } = require('../utils/userManager');

/**
 * Add editorial_policy to options based on article_id prefix for specific users
 * @param {Object} options - Options object to modify
 * @param {string} userId - User ID
 * @param {ProcessingSession} session - Session for logging
 * @returns {Object} - Modified options object
 */
function addEditorialPolicyForUser(options, userId, session) {
  // Only apply for user "KWG"
  if (userId !== 'KWG') {
    return options;
  }

  // Check if article_id exists in options
  if (!options.article_id || typeof options.article_id !== 'string') {
    return options;
  }

  // Check if editorial_policy exists in options
  if (typeof options.editorial_policy === 'string' && options.editorial_policy) {
    return options;
  }

  const articleId = options.article_id;
  const prefix = articleId.substring(0, 4);

  // Determine editorial_policy based on prefix
  let editorialPolicy = null;
  
  if (prefix === 'QAEF') {
    editorialPolicy = 'SURR';
  } else if (prefix === 'QAEN') {
    editorialPolicy = 'TFOD';
  }

  // Add editorial_policy if determined
  if (editorialPolicy) {
    options.editorial_policy = editorialPolicy;
    session.addLog(`Added editorial_policy: ${editorialPolicy} based on article_id prefix: ${prefix}`);
  }

  return options;
}

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
      files: req.files ? Object.entries(req.files).flatMap(([fieldname, files]) => 
        files.map(file => ({
          fieldname: fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        }))
      ) : []
    });
    
    // Find the main PDF file and supplementary files
    let mainFile = null;
    let supplementaryFile = null;
    
    if (req.files) {
      // When using upload.fields(), files are in req.files object with field names as keys
      if (req.files.file && req.files.file.length > 0) {
        mainFile = req.files.file[0];
      }
      if (req.files.supplementary_file && req.files.supplementary_file.length > 0) {
        supplementaryFile = req.files.supplementary_file[0];
      }
    }
    
    // Add main file if present
    if (mainFile) {
      session.addFile(mainFile, 'api');
    }
    
    // Add supplementary file if present
    if (supplementaryFile) {
      // Validate that it's a ZIP file
      if (supplementaryFile.mimetype !== 'application/zip' && 
          supplementaryFile.mimetype !== 'application/x-zip-compressed' &&
          !supplementaryFile.originalname.toLowerCase().endsWith('.zip')) {
        // Clean up uploaded files before throwing error
        const filesToCleanup = [mainFile, supplementaryFile].filter(f => f && f.path);
        await Promise.all(filesToCleanup.map(file => 
          fs.unlink(file.path).catch(err => 
            console.error(`[${session.requestId}] Error cleaning up file:`, err)
          )
        ));
        
        return res.status(400).json({
          error: 'Invalid supplementary files format. Only ZIP files are supported.'
        });
      }
      
      session.addFile(supplementaryFile, 'api');
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
    
    // Add editorial_policy for specific users based on article_id
    parsedOptions = addEditorialPolicyForUser(parsedOptions, req.user.id, session);
    
    const processingData = {
      file: mainFile,
      supplementary_file: supplementaryFile,
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
    
    // Now that ALL processing is complete, we can safely clean up the temporary files
    const filesToCleanup = [mainFile, supplementaryFile].filter(f => f && f.path);
    await Promise.all(filesToCleanup.map(file => 
      fs.unlink(file.path).catch(err => 
        console.error(`[${session.requestId}] Error deleting temporary file:`, err)
      )
    ));

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

    // Append error to summary (Google Sheets logging)
    try {
      // Parse options to get article_id if available
      let parsedOptions = {};
      if (req.body.options) {
        try {
          parsedOptions = typeof req.body.options === 'string' 
            ? JSON.parse(req.body.options) 
            : req.body.options;
        } catch (parseError) {
          parsedOptions = {};
        }
      }
      
      await genshareManager.appendToSummary({
        session,
        errorStatus: error.message,
        data: {
          file: { originalname: "N/A" },
          user: { id: req.user.id }
        },
        genshareVersion: session.getGenshareVersion() || null,
        reportURL: "",
        graphValue: parsedOptions.editorial_policy || "",
        reportVersion: "",
        articleId: parsedOptions.article_id || ""
      });
    } catch (appendError) {
      session.addLog(`Error appending to summary: ${appendError.message}`);
      console.error(`[${session.requestId}] Error appending to summary:`, appendError);
    }

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

    // Clean up temporary files if they exist, but only after all processing, including error handling, is complete
    const filesToCleanup = [];
    if (req.files) {
      // With upload.fields(), files are organized by field name
      Object.values(req.files).forEach(fileArray => {
        fileArray.forEach(file => {
          if (file && file.path) {
            filesToCleanup.push(file);
          }
        });
      });
    }
    
    await Promise.all(filesToCleanup.map(file => 
      fs.unlink(file.path).catch(err => 
        console.error(`[${session.requestId}] Error deleting temporary file:`, err)
      )
    ));
    
    // Forward error response if available
    if (error.response) return res.status(error.response.status).send(error.message);
    return res.status(500).send('GenShare returned an error');
  }
};
