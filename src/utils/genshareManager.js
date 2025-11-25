// File: src/utils/genshareManager.js
const packageJson = require('../../package.json');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');
const { appendToSheet, appendToUserSheet, convertToGoogleSheetsDate, convertToGoogleSheetsTime, convertToGoogleSheetsDuration } = require('./googleSheets');
const { getUserById } = require('./userManager');
const requestsManager = require('./requestsManager');
const snapshotReportsManager = require('./snapshotReportsManager');

// Load the genshare configuration
const genshareConfig = require(config.genshareConfigPath);

/**
 * Validates that a file is actually a PDF by checking its magic bytes
 * @param {Object} file - File object with path and originalname
 * @returns {Promise<Object>} - Validation result with valid flag and reason
 */
const validatePDFFile = async (file) => {
  // 1. Check file extension
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.pdf') {
    return {
      valid: false,
      reason: `Invalid file extension: "${ext}". Expected ".pdf"`
    };
  }
  
  // 2. Check actual file content (magic bytes)
  // PDFs must start with "%PDF-" (bytes: 25 50 44 46 2D)
  try {
    const buffer = await fs.promises.readFile(file.path);
    
    // Check if file is empty
    if (buffer.length === 0) {
      return {
        valid: false,
        reason: 'File is empty'
      };
    }
    
    // Check if file is too small to be a valid PDF (minimum is ~9 bytes for header)
    if (buffer.length < 5) {
      return {
        valid: false,
        reason: 'File is too small to be a valid PDF'
      };
    }
    
    // Read the first 5 bytes and convert to string
    const header = buffer.slice(0, 5).toString('ascii');
    
    if (!header.startsWith('%PDF-')) {
      return {
        valid: false,
        reason: `File does not appear to be a valid PDF (invalid file signature: "${header}")`
      };
    }
    
    // Optional: Check for PDF version (e.g., %PDF-1.4, %PDF-1.7, %PDF-2.0)
    const versionMatch = buffer.slice(0, 10).toString('ascii').match(/%PDF-(\d+\.\d+)/);
    if (!versionMatch) {
      return {
        valid: false,
        reason: 'File has PDF signature but missing valid version number'
      };
    }
    
  } catch (error) {
    return {
      valid: false,
      reason: `Could not read file: ${error.message}`
    };
  }
  
  return { 
    valid: true,
    reason: 'Valid PDF file'
  };
};

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
 * Sort response data based on user's configuration
 * @param {Array} responseData - Array of field objects to sort
 * @param {Array} fieldOrder - Array of field names (with suffix) in desired order
 * @returns {Array} - Sorted array
 */
function sortResponseData(responseData, fieldOrder) {
  // If no response data or no sort settings, return as is
  if (!responseData || !fieldOrder) {
    return responseData;
  }

  // Create a deep copy to avoid modifying original
  let data = JSON.parse(JSON.stringify(responseData));


  if (!fieldOrder || fieldOrder.length === 0) {
    return data;
  }

  // Create a map of field names to their order index
  const orderMap = new Map();
  fieldOrder.forEach((fieldName, index) => {
    orderMap.set(fieldName, index);
  });

  return data.sort((a, b) => {
    const orderA = orderMap.has(a.name) ? orderMap.get(a.name) : Infinity;
    const orderB = orderMap.has(b.name) ? orderMap.get(b.name) : Infinity;
    
    // If both have defined order, sort by order
    if (orderA !== Infinity && orderB !== Infinity) {
      return orderA - orderB;
    }
    
    // If only one has defined order, it comes first
    if (orderA !== Infinity) return -1;
    if (orderB !== Infinity) return 1;
    
    // If neither has defined order, maintain original order
    return 0;
  });
}

/**
 * Filter response data based on user's configuration
 * @param {Array} responseData - Array of field objects to filter
 * @param {Array} availableFields - Array of available field names (with suffix)
 * @param {Array} restrictedFields - Array of restricted field names (with suffix)
 * @returns {Array} - Filtered array
 */
function filterResponseData(responseData, availableFields, restrictedFields) {
  // If no response data return as is
  if (!responseData) {
    return responseData;
  }

  // If no filter restrictions, return full response
  if ((!availableFields || availableFields.length === 0) && 
      (!restrictedFields || restrictedFields.length === 0)) {
    return responseData;
  }

  // Create a deep copy to avoid modifying original
  let data = JSON.parse(JSON.stringify(responseData));

  // Filter the response array
  if (Array.isArray(data)) {
    if (availableFields && availableFields.length > 0) {
      // Include only available fields
      return data.filter(item => 
        availableFields.includes(item.name)
      );
    } else if (restrictedFields && restrictedFields.length > 0) {
      // Exclude restricted fields
      return data.filter(item => 
        !restrictedFields.includes(item.name)
      );
    }
  } else {
    return responseData;
  }
}

/**
 * Filter, sort and clean GenShare response based on user's permissions
 * @param {Object} responseData - Response property of the full GenShare response
 * @param {Object} user - User object with filter settings
 * @returns {Object} - Filtered response
 */
const filterAndSortResponseForUser = (responseData, user) => {
  // If no response data or no filter settings, return as is
  if (!responseData || !user.genshare) {
    return cleanSnapshotFieldsName(responseData);
  }

  const { availableFields, restrictedFields, fieldOrder } = user.genshare;

  // Filter data based on filter config
  const filteredResponse = filterResponseData(responseData, availableFields, restrictedFields);

  // Sort data based on field order
  const sortedAndFilteredResponse = sortResponseData(filteredResponse, fieldOrder);

  // Clean field names
  return cleanSnapshotFieldsName(sortedAndFilteredResponse);
};

/**
 * Remove suffix of all Snapshot response items
 * @param {Object} responseData - Response property of the full GenShare response
 * @returns {Object} - Filtered response
 */
const cleanSnapshotFieldsName = (responseData) => {
  // If no response data, return as is
  if (!responseData) {
    return responseData;
  }

  // Create a deep copy to avoid modifying original
  let filteredResponse = JSON.parse(JSON.stringify(responseData));

  // Filter the response array
  if (Array.isArray(filteredResponse)) {
    for (let i = 0; i < filteredResponse.length; i++) {
      let item = filteredResponse[i];
      if (item && item.name) item.name = item.name.replace(/__.*$/, '');
    }
  }

  return filteredResponse;
};

/**
 * Filter and validate options based on user's configuration
 * @param {Object} options - Options object to filter
 * @param {Object} user - User object with genshare configuration
 * @param {Object} session - Session object
 * @returns {Object} - Filtered options object
 */
function filterOptions(options, user, session) {
  // If no options or no user config, return options as is
  if (!options || !user?.genshare?.options) {
    return options;
  }

  // Create a copy to avoid modifying the original
  const filteredOptions = { ...options };

  // Get the options configuration from user
  const optionsConfig = user.genshare.options;

  // Iterate through each property in the options config
  Object.keys(optionsConfig).forEach(optionKey => {
    const config = optionsConfig[optionKey];
    
    // Skip if config doesn't have the required structure
    if (!config || !Array.isArray(config.available) || typeof config.default !== 'string') {
      return;
    }

    // Check if this option exists in the provided options
    if (optionKey in filteredOptions) {
      const value = filteredOptions[optionKey];
      
      // If the value is not in the available list, use the default
      if (!config.available.includes(value)) {
        filteredOptions[optionKey] = config.default;
        session.addLog(`GenShare options "${optionKey}" with value "${value}" is not available; default value: "${config.default}" will be used instead`);
      }
    } else {
      // If the option is not provided and there's a default, set it
      if (config.default) {
        filteredOptions[optionKey] = config.default;
        session.addLog(`GenShare options "${optionKey}" not provided; default value: "${config.default}" will be used instead`);
      }
    }
  });

  return filteredOptions;
}

// ============================================================================
// CSV DATA BUILDING FUNCTIONS
// ============================================================================

/**
 * Build CSV row data for the main summary sheet (appendToSheet)
 * @param {Object} options - Data options
 * @param {string} options.requestId - Request ID
 * @param {string} options.s3Url - S3 URL for the request
 * @param {string} options.snapshotAPIVersion - Snapshot API version
 * @param {string} options.genshareVersion - GenShare version
 * @param {string} options.errorStatus - Error status string
 * @param {Date} options.date - Date of the request
 * @param {number} options.duration - Session duration in milliseconds
 * @param {string} options.userId - User ID
 * @param {string} options.filename - PDF filename
 * @param {string} options.reportVersion - Report version
 * @param {string} options.reportURL - Report URL
 * @param {string} options.graphValue - Graph/editorial policy value
 * @param {string} options.articleId - Article ID
 * @param {Array} options.responseData - GenShare response data array
 * @param {Array} options.pathData - GenShare path data array
 * @returns {Array} - CSV row data array
 */
const buildSummaryRowData = (options) => {
  const {
    requestId,
    s3Url,
    snapshotAPIVersion = "",
    genshareVersion,
    errorStatus = "No",
    date,
    duration = 0,
    userId,
    filename = "N/A",
    reportVersion = "",
    reportURL = "",
    graphValue = "",
    articleId = "",
    responseData = [],
    pathData = []
  } = options;

  // Format response and path data using existing functions
  const response = getResponse(responseData, genshareVersion);
  const pathFormatted = getPath(pathData, genshareVersion);

  // Build the row data
  const rowData = [
    s3Url ? `=HYPERLINK("${s3Url}","${requestId}")` : requestId, // Query ID with S3 link
    snapshotAPIVersion,                          // Snapshot API version
    genshareVersion || "",                       // GenShare version
    errorStatus,                                 // Error status
    convertToGoogleSheetsDate(date),             // Date
    convertToGoogleSheetsTime(date),             // Time
    convertToGoogleSheetsDuration(duration),     // Session duration
    userId,                                      // User ID
    filename,                                    // PDF filename or "N/A"
    reportVersion,                               // Report version
    reportURL,                                   // Report URL
    graphValue,                                  // Graph value
    articleId                                    // Article ID
  ].concat(response).concat(pathFormatted);

  return rowData;
};

/**
 * Generate CSV headers for the main summary sheet
 * @param {string} version - GenShare version
 * @returns {Array} - CSV headers array
 */
const getSummaryHeaders = (version) => {
  const versionConfig = genshareConfig.versions[version] || genshareConfig.versions[genshareConfig.defaultVersion];
  
  const baseHeaders = [
    "Request ID",
    "Snapshot API Version", 
    "GenShare Version",
    "Error",
    "Date",
    "Time", 
    "Duration",
    "User ID",
    "Filename",
    "Report Version",
    "Report URL",
    "Graph Value"
  ];
  
  // Add response mapping headers
  const responseHeaders = Object.keys(versionConfig.responseMapping?.getResponse || {});
  const pathHeaders = versionConfig.responseMapping?.getPath || [];
  
  return baseHeaders.concat(responseHeaders).concat(pathHeaders);
};

/**
 * Build CSV row data for user-specific sheet (appendToUserSheet)
 * @param {Object} options - Data options
 * @param {string} options.requestId - Request ID
 * @param {Date} options.date - Date of the request
 * @param {string} options.filename - PDF filename
 * @param {string} options.genshareVersion - GenShare version
 * @param {string} options.reportVersion - Report version
 * @param {string} options.reportURL - Report URL
 * @param {string} options.graphValue - Graph/editorial policy value
 * @param {string} options.articleId - Article ID
 * @param {Array} options.filteredData - Filtered response data array (already filtered for user)
 * @returns {Array} - CSV row data array
 */
const buildUserLogRowData = (options) => {
  const {
    requestId,
    date,
    filename = "N/A",
    genshareVersion = "",
    reportVersion = "",
    reportURL = "",
    graphValue = "",
    articleId = "",
    filteredData = []
  } = options;

  // Build the base row data
  const rowData = [
    requestId,                                   // Request ID
    convertToGoogleSheetsDate(date),             // Date
    convertToGoogleSheetsTime(date),             // Time
    filename,                                    // PDF filename
    genshareVersion,                             // GenShare version
    reportVersion,                               // Report version
    reportURL,                                   // Report URL
    graphValue,                                  // Graph/editorial policy value
    articleId                                    // Article ID
  ];

  // Add filtered response field values only (not names)
  if (Array.isArray(filteredData)) {
    for (const item of filteredData) {
      if (item && item.name !== undefined && item.value !== undefined) {
        // Convert array values to string
        const value = typeof item.value === "string" ? item.value.toString() : JSON.stringify(item.value, null, 2);
        rowData.push(value);
      }
    }
  }

  return rowData;
};

/**
 * Generate CSV headers for user-specific sheet
 * @param {Array} filteredData - Sample filtered data to extract field names (optional)
 * @returns {Array} - CSV headers array
 */
const getUserLogHeaders = (filteredData = []) => {
  const baseHeaders = [
    "Request ID",
    "Date",
    "Time",
    "Filename",
    "GenShare Version",
    "Report Version",
    "Report URL",
    "Graph Value"
  ];

  // Add field names from filtered data if provided
  if (Array.isArray(filteredData) && filteredData.length > 0) {
    for (const item of filteredData) {
      if (item && item.name !== undefined) {
        baseHeaders.push(item.name);
      }
    }
  }

  return baseHeaders;
};

// ============================================================================
// LOGGING FUNCTIONS
// ============================================================================

/**
 * Logs session data to Google Sheets
 * @param {Object} options - Options containing session, error status, and request
 * @returns {Promise<void>}
 */
const appendToSummary = async ({ session, errorStatus, data, genshareVersion, reportURL, graphValue, reportVersion, articleId }) => {
  try {
    // Safely get the filename, defaulting to "N/A" if not available
    const filename = data.file?.originalname || "N/A";
    
    // Get the response info from the genshare response in the session
    const genshareResponse = session.genshare?.response;
    
    // Current date
    const now = new Date();
    
    // Build the row data using the centralized function
    const rowData = buildSummaryRowData({
      requestId: session.requestId,
      s3Url: session.url,
      snapshotAPIVersion: session.getSnapshotAPIVersion(),
      genshareVersion: session.getGenshareVersion() || genshareVersion,
      errorStatus,
      date: now,
      duration: session.getDuration(),
      userId: data.user.id,
      filename,
      reportVersion: reportVersion || "",
      reportURL: reportURL || "",
      graphValue: graphValue || "",
      articleId: articleId || "",
      responseData: genshareResponse?.data?.response,
      pathData: genshareResponse?.data?.path
    });
    
    // Log to Google Sheets for this specific version
    await appendToSheet(rowData, genshareVersion);
    
    session.addLog('Logged to Google Sheets successfully');
  } catch (sheetsError) {
    session.addLog(`Error logging to Google Sheets: ${sheetsError.message}`);
    console.error(`[${session.requestId}] Error logging to Google Sheets:`, sheetsError);
  }
};

/**
 * Logs filtered response data to user-specific Google Sheets
 * @param {Object} options - Options containing session, user, and filtered data
 * @param {Object} options.session - Processing session for logging
 * @param {Object} options.user - User object with googleSheets configuration
 * @param {Array} options.filteredData - Filtered response data array
 * @param {string} options.reportURL - Report URL (optional)
 * @param {string} options.filename - Original filename
 * @param {string} options.genshareVersion - GenShare version used
 * @param {string} options.reportVersion - Report version used
 * @param {string} options.graphValue - Graph/editorial policy value
 * @returns {Promise<void>}
 */
const appendToUserLog = async ({ session, user, filteredData, reportURL, filename, genshareVersion, reportVersion, graphValue, articleId }) => {
  try {
    // Check if user has Google Sheets logging enabled
    if (!user.googleSheets || !user.googleSheets.enabled) {
      session.addLog('[User Sheets] User Google Sheets logging is disabled or not configured');
      return;
    }

    const userSheetConfig = user.googleSheets;

    // Validate configuration
    if (!userSheetConfig.spreadsheetId || !userSheetConfig.sheetName) {
      session.addLog('[User Sheets] Invalid user Google Sheets configuration: missing spreadsheetId or sheetName');
      return;
    }

    // Current date
    const now = new Date();

    // Build the row data using the centralized function
    const rowData = buildUserLogRowData({
      requestId: session.requestId,
      date: now,
      filename: filename || "N/A",
      genshareVersion: genshareVersion || "",
      reportVersion: reportVersion || "",
      reportURL: reportURL || "",
      graphValue: graphValue || "",
      articleId: articleId || "",
      filteredData
    });

    // Append to user's Google Sheet
    await appendToUserSheet(rowData, userSheetConfig);

    session.addLog(`[User Sheets] Logged to user Google Sheet successfully (${userSheetConfig.spreadsheetId})`);
  } catch (sheetsError) {
    session.addLog(`[User Sheets] Error logging to user Google Sheet: ${sheetsError.message}`);
    console.error(`[${session.requestId}] Error logging to user Google Sheet:`, sheetsError);
    // Don't throw - user sheet logging failure shouldn't fail the request
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
 * @param {boolean} shouldLogToSummary - Whether to log to Google Sheets summary (default: true)
 * @returns {Promise<Object>} - Processing result
 */
const processPDF = async (data, session, shouldLogToSummary = true) => {
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

  let activeGenShareGraphValue = data.options?.editorial_policy || "";

  // Input validation
  if (!data.file) {
    errorStatus = 'Input error: Required "file" missing';
    session.addLog('Error: Required "file" missing');
    throw new Error('Required "file" missing.');
  }

  // Validate PDF file
  session.addLog('Validating PDF file...');
  const validationResult = await validatePDFFile(data.file);
  
  if (!validationResult.valid) {
    errorStatus = `File validation error: ${validationResult.reason}`;
    session.addLog(`Error: ${validationResult.reason}`);
    
    // Log to summary sheet with error status ONLY if shouldLogToSummary is true
    if (shouldLogToSummary) {
      try {
        await appendToSummary({
          session,
          errorStatus,
          data,
          genshareVersion: activeGenShareVersion || genshareConfig.defaultVersion,
          reportURL: "",
          graphValue: "",
          reportVersion: "",
          articleId: data.options?.article_id || ""
        });
      } catch (summaryError) {
        session.addLog(`Error logging validation error to summary: ${summaryError.message}`);
        console.error(`[${session.requestId}] Error logging validation error to summary:`, summaryError);
      }
    }
    
    const validationError = new Error(validationResult.reason);
    validationError.status = 400; // Bad Request
    throw validationError;
  }
  
  session.addLog('PDF file validation passed');

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

  // Add supplementary files if present
  if (data.supplementary_file) {
    const supplementaryStream = fs.createReadStream(data.supplementary_file.path);
    formData.append('supplementary_file', supplementaryStream, {
      filename: data.supplementary_file.originalname,
      contentType: data.supplementary_file.mimetype
    });
    session.addLog(`Added supplementary files: ${data.supplementary_file.originalname} (${data.supplementary_file.size} bytes)`);
  }

  // Filter options sent by the user 
  const filteredOptions = filterOptions(options, user, session);

  // Add options with decision_tree_path for the request only
  const requestOptions = {
    ...filteredOptions,
    decision_tree_path: true,
    debug: true
  };
  formData.append('options', JSON.stringify(requestOptions));

  // Log third-party service request
  session.addLog(`Sending request to GenShare service (${activeGenShareVersion})`);
  session.addLog(`URL: ${processPDFConfig.url}`);

  // Store GenShare request data
  const genshareRequestData = {
    ...requestOptions,
    file: {
      filename: data.file.originalname,
      contentType: data.file.mimetype
    }
  };

  // Add supplementary files info to request data if present
  if (data.supplementary_file) {
    genshareRequestData.supplementary_file = {
      filename: data.supplementary_file.originalname,
      contentType: data.supplementary_file.mimetype
    };
  }

  session.setGenshareRequest(genshareRequestData);

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

    // Log the graph value returned
    let responseGenShareGraphValue = response?.data?.graph_policy_traversal_data?.graph_type || "";

    if (!responseGenShareGraphValue) {
      session.addLog(`GenShare graph value returned not found`);
    } else {
      session.addLog(`GenShare graph value returned found: ${responseGenShareGraphValue}`);
      if (activeGenShareGraphValue.indexOf(responseGenShareGraphValue) > -1) {
        session.addLog(`GenShare graph values match: (${activeGenShareGraphValue} - ${responseGenShareGraphValue})`);
      } else {
        session.addLog(`GenShare graph values don't match (${activeGenShareGraphValue} - ${responseGenShareGraphValue})`);
      }
    }

    activeGenShareGraphValue = responseGenShareGraphValue;

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
    // - create a snapshot-reports report
    // - create the JSON data
    if (errorStatus === "No" && !!activeReportVersion && response.data.response) {
      session.addLog(`Using report: ${activeReportVersion}`);
      try {
        // Create snapshot-reports Report
        const snapshotReport = await snapshotReportsManager.createReport(activeReportVersion, session.requestId, session);
        reportURL = snapshotReport.url;

        // Build JSON Report using requestsManager
        const jsonReport = requestsManager.buildJSON(activeReportVersion, response.data.response, reportURL);

        // Store JSON Report
        session.setReport(jsonReport);

      } catch (reportCreationError) {
        session.addLog(`Error creating snapshot-reports report: ${reportCreationError.message}`);
        console.error(`[${session.requestId}] Error creating snapshot-reports report:`, reportCreationError);
        // Don't fail the request if report creation fails, just log it
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

    // Validate action_required field
    const actionRequiredItem = response.data.response.find(item => item.name === "action_required");
    if (actionRequiredItem && actionRequiredItem.value === "") {
      const validationError = new Error('Snapshot response contains invalid action_required value (empty string)');
      session.addLog('Error: action_required value is empty in Snapshot response');
      errorStatus = 'Validation error: action_required is empty';
      
      // Log to summary sheet with error status ONLY if shouldLogToSummary is true
      if (shouldLogToSummary) {
        try {
          await appendToSummary({
            session,
            errorStatus,
            data,
            genshareVersion: activeGenShareVersion,
            reportURL,
            graphValue: activeGenShareGraphValue,
            reportVersion: activeReportVersion,
            articleId: articleId || ""
          });
        } catch (summaryError) {
          session.addLog(`Error logging validation error to summary: ${summaryError.message}`);
          console.error(`[${session.requestId}] Error logging validation error to summary:`, summaryError);
        }
      }
      
      // Throw error with 500 status
      validationError.status = 500;
      throw validationError;
    }

    // Session data preparation is complete
    session.addLog('Response processing completed');

    // Apply user-specific filtering to the response
    const filteredData = filterAndSortResponseForUser(response.data.response, user);

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

    // Log to summary sheet before returning the result ONLY if shouldLogToSummary is true
    if (shouldLogToSummary) {
      try {
        await appendToSummary({
          session,
          errorStatus,
          data,
          genshareVersion: activeGenShareVersion,
          reportURL,
          graphValue: activeGenShareGraphValue,
          reportVersion: activeReportVersion,
          articleId: articleId || ""
        });
      } catch (summaryError) {
        session.addLog(`Error logging to summary: ${summaryError.message}`);
        console.error(`[${session.requestId}] Error logging to summary:`, summaryError);
        // Don't fail the process if summary logging fails
      }
    }

    // Log to user-specific Google Sheets (always attempt if configured)
    try {
      await appendToUserLog({
        session,
        user,
        filteredData: finalData,
        reportURL,
        filename: data.file?.originalname,
        genshareVersion: activeGenShareVersion,
        reportVersion: activeReportVersion,
        graphValue: activeGenShareGraphValue,
        articleId: articleId || ""
      });
    } catch (userLogError) {
      session.addLog(`Error logging to user sheet: ${userLogError.message}`);
      console.error(`[${session.requestId}] Error logging to user sheet:`, userLogError);
      // Don't fail the process if user sheet logging fails
    }

    // Return the processing result with additional metadata
    return {
      status: response.status,
      headers: response.headers,
      data: finalData,
      errorStatus,
      activeGenShareVersion,
      reportURL,
      activeGenShareGraphValue, // Add this for caller to use
      activeReportVersion       // Add this for caller to use
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

    // Log to summary sheet even in case of error ONLY if shouldLogToSummary is true
    if (shouldLogToSummary) {
      try {
        await appendToSummary({
          session,
          errorStatus,
          data,
          genshareVersion: activeGenShareVersion || genshareConfig.defaultVersion,
          reportURL: "",
          graphValue: activeGenShareGraphValue,
          reportVersion: activeReportVersion,
          articleId: data.options?.article_id || ""
        });
      } catch (summaryError) {
        session.addLog(`Error logging error to summary: ${summaryError.message}`);
        console.error(`[${session.requestId}] Error logging error to summary:`, summaryError);
      }
    }

    // Re-throw the original error
    throw error;
  }
};

module.exports = {
  // Main functions
  getGenShareHealth,
  processPDF,
  
  // Logging functions
  appendToSummary,
  appendToUserLog,
  
  // CSV data building functions (for scripts)
  buildSummaryRowData,
  getSummaryHeaders,
  buildUserLogRowData,
  getUserLogHeaders,
  
  // Data transformation functions
  filterAndSortResponseForUser,
  getPath,
  getResponse,
  
  // Validation
  validatePDFFile
};
