// File: src/utils/genshareManager.js
const packageJson = require('../../package.json');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');
const { appendToSheet, convertToGoogleSheetsDate, convertToGoogleSheetsTime, convertToGoogleSheetsDuration } = require('./googleSheets');
const { getUserById } = require('./userManager');
const requestsManager = require('./requestsManager');

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
 * Filter GenShare response based on user's permissions
 * @param {Object} responseData - Response property of the full GenShare response
 * @param {Object} user - User object with filter settings
 * @returns {Object} - Filtered response
 */
const filterResponseForUser = (responseData, user) => {
  // If no response data or no filter settings, return as is
  if (!responseData || !user.genshare) {
    return responseData;
  }

  const { availableFields, restrictedFields } = user.genshare;

  // If no filter restrictions, return full response
  if ((!availableFields || availableFields.length === 0) && 
      (!restrictedFields || restrictedFields.length === 0)) {
    return responseData;
  }

  // Create a deep copy to avoid modifying original
  let filteredResponse = JSON.parse(JSON.stringify(responseData));

  // Filter the response array
  if (Array.isArray(filteredResponse)) {
    if (availableFields && availableFields.length > 0) {
      // Include only available fields
      filteredResponse = filteredResponse.filter(item => 
        availableFields.includes(item.name)
      );
    } else if (restrictedFields && restrictedFields.length > 0) {
      // Exclude restricted fields
      filteredResponse = filteredResponse.filter(item => 
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
const appendToSummary = async ({ session, errorStatus, data, genshareVersion, reportURL }) => {
  try {
    // Safely get the filename, defaulting to "No file" if not available
    const filename = data.file?.originalname || "N/A";
    
    // Get the response info from the genshare response in the session
    const genshareResponse = session.genshare?.response;
    let response = getResponse(genshareResponse?.data?.response, genshareVersion);
    
    // Get the Path info
    let path = getPath(genshareResponse?.data?.path, genshareVersion);
    
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
      convertToGoogleSheetsDuration(session.getDuration()),  // Session duration
      data.user.id,                                          // User ID
      filename,                                              // PDF filename or "No file"
      reportURL                                              // Report URL
    ].concat(response).concat(path), genshareVersion);
    
    session.addLog('Logged to Google Sheets successfully');
  } catch (sheetsError) {
    session.addLog(`Error logging to Google Sheets: ${sheetsError.message}`);
    console.error(`[${session.requestId}] Error logging to Google Sheets:`, sheetsError);
  }
};

/**
 * Get health of GenShare versions
 * @param {Object} user - User object with permissions
 * @param {string|null} requestedVersion - Specific version requested (optional)
 * @returns {Promise<Object>} - Health status for requested versions
 */
const getGenShareHealth = async (user, requestedVersion) => {
  let authorizedVersions = [];
  
  // Determine which versions to check based on user permissions
  if (user && user.genshare && user.genshare.authorizedVersions) {
    authorizedVersions = user.genshare.authorizedVersions;
  } else {
    // Default to all versions if user doesn't have specific permissions
    authorizedVersions = [genshareConfig.defaultVersion];
  }
  
  // If a specific version is requested in the query and user is authorized
  if (requestedVersion && authorizedVersions.includes(requestedVersion)) {
    authorizedVersions = [requestedVersion];
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
  
  return {
    status: Object.values(healthResults).every(r => r.status === 200) ? 'healthy' : 'partially healthy',
    versions: healthResults
  };
};

/**
 * Process a PDF document using GenShare service
 * @param {Object} data - PDF and processing data 
 * @param {ProcessingSession} session - Processing session for logging
 * @returns {Promise<Object>} - Processing result
 */
const processPDF = async (data, session) => {
  // Get the user's full information
  const user = getUserById(data.user.id);
  
  session.setSnapshotAPIVersion(`v${packageJson.version}`);
  
  let reportURL = "";
  let errorStatus = "No"; // Initialize error status
  
  // Determine which GenShare version to use
  let requestedGenShareVersion = data.options?.genshareVersion;
  let activeGenShareVersion;
  
  // Check if the requested version is authorized for this user
  if (requestedGenShareVersion && 
      user.genshare && 
      user.genshare.authorizedVersions && 
      user.genshare.authorizedVersions.includes(requestedGenShareVersion)) {
    activeGenShareVersion = requestedGenShareVersion;
  } else {
    // First try user's default version if specified
    if (user.genshare?.defaultVersion) {
      activeGenShareVersion = user.genshare.defaultVersion;
    } 
    // If no user default is specified, use the global default from genshare config
    else {
      if (!user.genshare || !Array.isArray(user.genshare.authorizedVersions) || user.genshare.authorizedVersions.length <= 0) {
        activeGenShareVersion = genshareConfig.defaultVersion;
      } else {
        activeGenShareVersion = user.genshare.authorizedVersions[0];
      }
    }
  }

  // Check if version exists in configuration
  if (!genshareConfig.versions[activeGenShareVersion]) {
    throw new Error(`Requested GenShare version '${activeGenShareVersion}' is not configured.`);
  }

  // Determine which report to use
  let requestedReportVersion = data.options?.report;
  let activeReportVersion;

  // Check if the client sent a reportVersion
  if (requestedReportVersion) {
    // Check if the requested report is authorized for this user
    if (user.reports && 
        user.reports.authorizedVersions && 
        Array.isArray(user.reports.authorizedVersions) &&
        user.reports.authorizedVersions.includes(requestedReportVersion)) {
      // Case 1: Client sent a reportVersion and it's authorized
      activeReportVersion = requestedReportVersion;
    } else {
      // Case 1: Client sent a reportVersion but it's NOT authorized
      // Use the user's defaultVersion (which can be empty)
      activeReportVersion = user.reports?.defaultVersion || "";
    }
  } else {
    // Case 2: Client didn't send a reportVersion
    // Use the user's defaultVersion (which can be empty)
    activeReportVersion = user.reports?.defaultVersion || "";
  }
  
  // Input validation
  if (!data.file) {
    errorStatus = 'Input error: Required "file" missing';
    session.addLog('Error: Required "file" missing');
    throw new Error('Required "file" missing.');
  }

  // Initialize GenShare with the active version
  session.initGenShare(activeGenShareVersion);

  // Ensure options exist
  let options = data.options || {};

  // Log initial request details
  session.addLog(`Request received from ${data.user.id}`);
  session.addLog(`Using GenShare version: ${activeGenShareVersion}`);

  // Get the configuration for the active version
  const versionConfig = genshareConfig.versions[activeGenShareVersion];
  const processPDFConfig = versionConfig.processPDF;

  const formData = new FormData();
  
  // Create read stream from the uploaded file
  const fileStream = fs.createReadStream(data.file.path);
  formData.append('file', fileStream, {
    filename: data.file.originalname,
    contentType: data.file.mimetype
  });

  // Add options with decision_tree_path for the request only
  const requestOptions = {
    ...options,
    decision_tree_path: true,
    debug: true
  };
  formData.append('options', JSON.stringify(requestOptions));

  // Log third-party service request
  session.addLog(`Sending request to GenShare service (${activeGenShareVersion})`);
  session.addLog(`URL: ${processPDFConfig.url}`);

  // Store GenShare request data
  session.setGenshareRequest({
    ...requestOptions,
    file: {
      filename: data.file.originalname,
      contentType: data.file.mimetype
    }
  });

  try {
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
    let responseGenShareVersion = response?.data?.version;

    if (!responseGenShareVersion) {
      session.addLog(`GenShare version returned not found`);
    } else {
      session.addLog(`GenShare version returned found: ${responseGenShareVersion}`);
      if (activeGenShareVersion.indexOf(responseGenShareVersion) > -1) {
        session.addLog(`GenShare versions match: (${activeGenShareVersion} - ${responseGenShareVersion})`);
      } else {
        session.addLog(`GenShare versions don't match (${activeGenShareVersion} - ${responseGenShareVersion})`);
      }
    }

    session.addLog(`Received response from GenShare service with status: ${response.status}`);

    // Store complete response in the session
    session.setGenshareResponse({
      status: response.status,
      headers: response.headers,
      data: { ...response.data }
    });

    // Set GenShare version in the processing session
    session.setGenshareVersion(`${activeGenShareVersion}`);

    // If everything is fine (no error, activeReportVersion not empty and data available)
    // - create a the Google Sheets file
    // - create the JSON data
    if (errorStatus === "No" && !!activeReportVersion && response.data.response) {
      session.addLog(`Using report: ${activeReportVersion}`);
      try {
        // Create GoogleSheets Report using requestsManager (moved from reportsManager)
        const googleSheetsReport = await requestsManager.createGoogleSheets(activeReportVersion, response.data.response, session);
        reportURL = googleSheetsReport.url;

        // Build JSON Report
        const jsonReport = requestsManager.buildJSON(activeReportVersion, response.data.response, reportURL);

        // Store JSON Report
        session.setReport(jsonReport);

      } catch (sheetsCreationError) {
        session.addLog(`Error creating Google Sheets file: ${sheetsCreationError.message}`);
        console.error(`[${session.requestId}] Error creating Google Sheets file:`, sheetsCreationError);
        // Don't fail the request if sheets creation fails, just log it
      }
    }

    // Get the "article_id" value
    const articleId = response.data.response.filter((item) => {
      return item.name === "article_id";
    })[0]?.value;

    if (!articleId) {
      session.addLog('[DB] Error: "article_id" not found. Link "article_id <-> request_id" not created.');
      console.error(`[${session.requestId}] Error: "article_id" not found. Link "article_id <-> request_id" not created.`);
    } else {
      // Add the link between the "article_id" and the "request_id" with report data if available
      session.addLog('[DB] Link "article_id <-> request_id" created');
      if (session.report) {
        // Add request with report data
        await requestsManager.addOrUpdateRequestWithReport(user.id, articleId, session.requestId, session.report);
        session.addLog('[DB] Report data saved to database');
      } else {
        // Add request without report data (will be updated later if needed)
        await requestsManager.addOrUpdateRequest(user.id, articleId, session.requestId);
      }
    }

    // Session data preparation is complete
    session.addLog('Response processing completed');

    // Apply user-specific filtering to the response
    const filteredData = filterResponseForUser(response.data.response, user);

    // Add report_url if possible
    let finalData = filteredData;
    if (reportURL && Array.isArray(filteredData)) {
      finalData = [...filteredData];
      finalData.push({
        "name": "report_link",
        "description": "Report link",
        "value": reportURL
      });
    }

    // Log to summary sheet before returning the result
    try {
      await appendToSummary({
        session,
        errorStatus,
        data,
        genshareVersion: activeGenShareVersion,
        reportURL
      });
    } catch (summaryError) {
      session.addLog(`Error logging to summary: ${summaryError.message}`);
      console.error(`[${session.requestId}] Error logging to summary:`, summaryError);
      // Don't fail the process if summary logging fails
    }

    // Return the processing result
    return {
      status: response.status,
      headers: response.headers,
      data: finalData,
      errorStatus,
      activeGenShareVersion,
      reportURL
    };
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

    // Try to log to summary sheet even in case of error
    try {
      await appendToSummary({
        session,
        errorStatus,
        data,
        genshareVersion: activeGenShareVersion || genshareConfig.defaultVersion,
        reportURL: ""
      });
    } catch (summaryError) {
      session.addLog(`Error logging error to summary: ${summaryError.message}`);
      console.error(`[${session.requestId}] Error logging error to summary:`, summaryError);
    }

    // Re-throw the original error
    throw error;
  }
};

module.exports = {
  getGenShareHealth,
  processPDF,
  appendToSummary
};
