// File: src/controllers/genshareController.js
const packageJson = require('../../package.json');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');
const { ProcessingSession } = require('../utils/s3Storage');
const { appendToSheet, convertToGoogleSheetsDate, convertToGoogleSheetsTime, convertToGoogleSheetsDuration } = require('../utils/googleSheets');
const { getUserById } = require('../utils/userManager');

// Load the genshare configuration
const genshareConfig = require(config.genshareConfigPath);

/**
 * Gets path data from response for Google Sheets integration
 * @param {Array} path - Path data from GenShare
 * @param {string} version - GenShare version to determine mapping
 * @returns {Array} - Formatted path data for Google Sheets
 */
const getPath = (path = [], version) => {
  // Get the mapping for the specific GenShare version
  const versionConfig = genshareConfig.versions[version] || genshareConfig.versions[genshareConfig.defaultVersion];
  const headers = versionConfig.responseMapping.getPath || [];
  
  // Create a default array filled with empty strings
  let defaultResult = Array(headers.length).fill('');
  
  if (!Array.isArray(path) || path.length !== 2) return defaultResult;
  
  let data = path[1];
  let result = data.split(',');
  
  // Convert "Score" to integer if possible
  if (result.length === headers.length) {
    for (let i = 0; i < headers.length; i++) {
      if (headers[i].indexOf("Score") > -1) {
        let parsedScore = parseInt(result[i]);
        if (!isNaN(parsedScore)) result[i] = parsedScore;
      }
    }
  }
  
  return result;
};

/**
 * Gets response data for Google Sheets integration
 * @param {Array} response - Response data from GenShare
 * @param {string} version - GenShare version to determine mapping
 * @returns {Array} - Formatted response data for Google Sheets
 */
const getResponse = (response = [], version) => {
  // Get the mapping for the specific GenShare version
  const versionConfig = genshareConfig.versions[version] || genshareConfig.versions[genshareConfig.defaultVersion];
  const mappingObj = versionConfig.responseMapping.getResponse || {};
  
  // Create a default array with appropriate length
  const mappingFields = Object.values(mappingObj);
  const maxIndex = mappingFields.length > 0 ? Math.max(...mappingFields) : 0;
  let defaultResult = Array(maxIndex + 1).fill("");
  
  if (!Array.isArray(response)) return defaultResult;
  
  let result = [...defaultResult];
  
  for (let i = 0; i < response.length; i++) {
    let item = response[i];
    let index;
    
    if (item && item.name) {
      index = mappingObj[item.name];
    }
    
    if (typeof index === "number") {
      // item.value can be an Array, Google Sheets require string
      if (Array.isArray(item.value)) {
        result[index] = item.value.join("\n");
      } else {
        result[index] = item.value.toString();
      }
    }
  }
  
  return result;
};

/**
 * Filter response data based on user's permissions
 * @param {Object} responseData - Full response from GenShare
 * @param {Object} user - User object with filter settings
 * @returns {Object} - Filtered response
 */
const filterResponseForUser = (responseData, user) => {
  // If no response data or no filter settings, return as is
  if (!responseData || !responseData.response || !user.genshare || !user.genshare.responseFilter) {
    return responseData;
  }

  const { availableFields, restrictedFields } = user.genshare.responseFilter;

  // If no filter restrictions, return full response
  if ((!availableFields || availableFields.length === 0) && 
      (!restrictedFields || restrictedFields.length === 0)) {
    return responseData;
  }

  // Create a deep copy to avoid modifying original
  const filteredResponse = JSON.parse(JSON.stringify(responseData));

  // Filter the response array
  if (Array.isArray(filteredResponse.response)) {
    if (availableFields && availableFields.length > 0) {
      // Include only available fields
      filteredResponse.response = filteredResponse.response.filter(item => 
        availableFields.includes(item.name)
      );
    } else if (restrictedFields && restrictedFields.length > 0) {
      // Exclude restricted fields
      filteredResponse.response = filteredResponse.response.filter(item => 
        !restrictedFields.includes(item.name)
      );
    }
  }

  return filteredResponse;
};

/**
 * Logs session data to Google Sheets
 * @param {Object} options - Options containing session, error status, and request
 * @returns {Promise<void>}
 */
const appendToSummary = async ({ session, errorStatus, req, version }) => {
    try {
      // Safely get the filename, defaulting to "No file" if not available
      const filename = req.file?.originalname || "N/A";
      
      // Get the response info
      let response = getResponse(session.response?.data?.response, version);
      
      // Get the Path info
      let path = getPath(session.response?.data?.path, version);
      
      // Current date
      const now = new Date();
      
      // Log to Google Sheets for this specific version
      await appendToSheet([
        `=HYPERLINK("${session.url}","${session.requestId}")`, // Query ID with S3 link
        session.getSnapshotAPIVersion(),                       // Snapshot API version
        session.getGenshareVersion(),                          // GenShare version
        errorStatus,                                           // Error status
        convertToGoogleSheetsDate(now),                        // Date
        convertToGoogleSheetsTime(now),                        // Time
        convertToGoogleSheetsDuration(session.duration),       // Session duration
        req.user.id,                                           // User ID
        filename                                               // PDF filename or "No file"
      ].concat(response).concat(path), version);
      
      session.addLog('Logged to Google Sheets successfully');
    } catch (sheetsError) {
      session.addLog(`Error logging to Google Sheets: ${sheetsError.message}`);
      console.error('Error logging to Google Sheets:', sheetsError);
    }
};

/**
 * Check health of all GenShare versions or a specific version
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.getGenShareHealth = async (req, res) => {
  try {
    const user = getUserById(req.user.id);
    let authorizedVersions = [];
    
    // Determine which versions to check based on user permissions
    if (user && user.genshare && user.genshare.authorizedVersions) {
      authorizedVersions = user.genshare.authorizedVersions;
    } else {
      // Default to all versions if user doesn't have specific permissions
      authorizedVersions = [genshareConfig.defaultVersion];
    }
    
    // If a specific version is requested in the query and user is authorized
    if (req.query.version && authorizedVersions.includes(req.query.version)) {
      authorizedVersions = [req.query.version];
    }
    
    // Check health for all authorized versions
    const healthResults = {};
    
    await Promise.all(authorizedVersions.map(async (version) => {
      try {
        const versionConfig = genshareConfig.versions[version];
        if (!versionConfig) {
          healthResults[version] = { error: `Version ${version} not found in configuration` };
          return;
        }
        
        const healthConfig = versionConfig.health;
        const response = await axios({
          method: healthConfig.method,
          url: healthConfig.url,
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        healthResults[version] = {
          status: response.status,
          data: response.data
        };
      } catch (error) {
        healthResults[version] = {
          error: error.message,
          status: error.response?.status || 500
        };
      }
    }));
    
    // Return health results for all checked versions
    res.json({
      status: Object.values(healthResults).every(r => r.status === 200) ? 'healthy' : 'partially healthy',
      versions: healthResults
    });
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
  // Get the user's full information
  const user = getUserById(req.user.id);
  
  // Determine which GenShare version to use
  let requestedVersion = req.body.genshareVersion;
  let activeVersion;
  
  // Check if the requested version is authorized for this user
  if (requestedVersion && 
      user.genshare && 
      user.genshare.authorizedVersions && 
      user.genshare.authorizedVersions.includes(requestedVersion)) {
    activeVersion = requestedVersion;
  } else {
    // First try user's default version if specified
    if (user.genshare?.defaultVersion) {
      activeVersion = user.genshare.defaultVersion;
    } 
    // If no user default is specified, use the global default from genshare config
    else {
      if (!user.genshare || !Array.isArray(user.genshare.authorizedVersions) || user.genshare.authorizedVersions.length <= 0) {
        activeVersion = genshareConfig.defaultVersion;
      } else {
        activeVersion = user.genshare.authorizedVersions[0];
      }
    }
  }
  
  // Check if version exists in configuration
  if (!genshareConfig.versions[activeVersion]) {
    return res.status(400).send(`Requested GenShare version '${activeVersion}' is not configured.`);
  }
  
  // Initialize processing session
  const session = new ProcessingSession(req.user.id, req.file);
  session.setSnapshotAPIVersion(`v${packageJson.version}`);
  let errorStatus = "No"; // Initialize error status
  
  try {
    // Input validation
    if (!req.file) {
      errorStatus = 'Input request error: Required "file" missing';
      session.addLog('Error: Required "file" missing');
      await session.saveToS3();
      await appendToSummary({ session, errorStatus, req, version: activeVersion });
      return res.status(400).send('Required "file" missing.');
    }

    if (req.file.mimetype !== "application/pdf") {
      errorStatus = 'Input request error: Invalid file type';
      session.addLog('Error: Invalid file type ' + req.file.mimetype);
      await session.saveToS3();
      await appendToSummary({ session, errorStatus, req, version: activeVersion });
      return res.status(400).send('Required "file" invalid. Must have mimetype "application/pdf"');
    }

    let options;
    try {
      options = JSON.parse(req.body.options);
      if (options === null) {
        errorStatus = 'Input request error: Required "options" missing';
        session.addLog('Error: Required "options" missing');
        await session.saveToS3();
        await appendToSummary({ session, errorStatus, req, version: activeVersion });
        return res.status(400).send('Required "options" missing. Must be a valid JSON object.');
      } else if (typeof options !== 'object' || Array.isArray(options)) {
        errorStatus = 'Input request error: Invalid options format';
        session.addLog('Error: Invalid options format');
        await session.saveToS3();
        await appendToSummary({ session, errorStatus, req, version: activeVersion });
        return res.status(400).send('Required "options" invalid. Must be a JSON object.');
      }
      session.options = options;
    } catch (error) {
      errorStatus = "Input request error: Error parsing options";
      session.addLog('Error parsing options: ' + error.message);
      await session.saveToS3();
      await appendToSummary({ session, errorStatus, req, version: activeVersion });
      return res.status(400).send('Required "options" invalid. Must be a valid JSON object.');
    }

    // Log initial request details
    session.addLog(`Request received from ${req.user.id}`);
    session.addLog(`Using GenShare version: ${activeVersion}`);

    // Get the configuration for the active version
    const versionConfig = genshareConfig.versions[activeVersion];
    const processPDFConfig = versionConfig.processPDF;

    const formData = new FormData();
    
    // Create read stream from the uploaded file
    const fileStream = fs.createReadStream(req.file.path);
    formData.append('file', fileStream, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });

    // Add options with decision_tree_path for the request only
    const requestOptions = {
      ...options,
      decision_tree_path: true,
      debug: true
    };
    formData.append('options', JSON.stringify(requestOptions));

    // Forward any additional form fields (except options and genshareVersion which we've already handled)
    Object.keys(req.body).forEach(key => {
      if (key !== 'options' && key !== 'genshareVersion') {
        formData.append(key, req.body[key]);
      }
    });

    // Log third-party service request
    session.addLog(`Sending request to GenShare service (${activeVersion})`);
    session.addLog(`URL: ${processPDFConfig.url}`);

    const response = await axios({
      method: processPDFConfig.method,
      url: processPDFConfig.url,
      data: formData,
      headers: {
        ...formData.getHeaders(),
        ...(processPDFConfig.apiKey ? { 'X-API-Key': processPDFConfig.apiKey } : {})
      },
      responseType: 'json',
      maxBodyLength: Infinity
    });

    // Check if response status is not 2xx or 3xx
    if (response.status >= 400) {
      errorStatus = `GenShare Error (HTTP ${response.status})`;
    }

    // Log successful response
    session.addLog(`Received response from GenShare service (${activeVersion})`);
    session.addLog(`Status: ${response.status}`);

    // Store complete response info before modification
    session.setResponse({
      status: response.status,
      headers: response.headers,
      data: { ...response.data }
    });

    // Set GenShare version in the processing session
    session.setGenshareVersion(`${activeVersion}`);

    // Save session data and clean up
    session.addLog('Response processing completed');
    await session.saveToS3();
    
    // Log to summary sheet before sending response
    await appendToSummary({ session, errorStatus, req, version: activeVersion });

    // Clean up temporary file
    await fs.promises.unlink(req.file.path).catch(err => {
      console.error('Error deleting temporary file:', err);
    });

    // Apply user-specific filtering to the response
    const filteredData = filterResponseForUser({ response: response.data.response }, user);

    // Forward modified response to client
    res.status(response.status);
    Object.entries(response.headers).forEach(([key, value]) => {
      res.set(key, value);
    });
    res.json(filteredData);

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
      // Log to summary sheet before sending error response
      await appendToSummary({ session, errorStatus, req, version: activeVersion });
    } catch (s3Error) {
      console.error('Error saving session data:', s3Error);
    }

    // Clean up temporary file if it exists
    if (req.file && req.file.path) {
      await fs.promises.unlink(req.file.path).catch(err => {
        console.error('Error deleting temporary file:', err);
      });
    }
    
    // Forward error response if available
    if (error.response) return res.status(error.response.status).send(error.message);
    return res.status(500).send('GenShare returned an error');
  }
};
