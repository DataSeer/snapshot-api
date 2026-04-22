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
const emailAlertManager = require('./emailAlertManager');
const snapshotReportsManager = require('./snapshotReportsManager');
const cacheManager = require('./cacheManager');
const dbManager = require('./dbManager');
const { calculateSHA256 } = require('./s3Storage');

// Load the genshare configuration (auto-reloads on file change)
const { watchConfig } = require('./configWatcher');
const genshareConfig = watchConfig(config.genshareConfigPath);
const instanceConfig = watchConfig(config.instanceConfigPath, {});

/**
 * Get version configuration by alias (e.g., "latest", "previous")
 * @param {string} versionAlias - The version alias to look up
 * @returns {Object|null} - The version configuration object or null if not found
 */
const getVersionConfig = (versionAlias) => {
  return genshareConfig.versions[versionAlias] || null;
};

/**
 * Get the actual version number from an alias
 * @param {string} versionAlias - The version alias (e.g., "latest")
 * @returns {string} - The actual version number (e.g., "v81.3.0") or the alias if no version property exists
 */
const getActualVersion = (versionAlias) => {
  const config = getVersionConfig(versionAlias);
  return config?.version || versionAlias;
};

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
const getPath = (path = [], versionAlias) => {
  // Get the mapping for the specific GenShare version alias
  const versionConfig = getVersionConfig(versionAlias) || getVersionConfig(genshareConfig.defaultVersion);
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
const getResponse = (response = [], versionAlias) => {
  // Get the mapping for the specific GenShare version alias
  const versionConfig = getVersionConfig(versionAlias) || getVersionConfig(genshareConfig.defaultVersion);
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
      // item.value can be an Array, undefined, or null — Google Sheets requires string
      if (item.value == null) {
        result[index] = "";
      } else if (Array.isArray(item.value)) {
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
        session.addLog(`[GenShare] Option "${optionKey}" with value "${value}" is not available; default value "${config.default}" will be used instead`);
      }
    } else {
      // If the option is not provided and there's a default, set it
      if (config.default) {
        filteredOptions[optionKey] = config.default;
        session.addLog(`[GenShare] Option "${optionKey}" not provided; default value "${config.default}" will be used instead`);
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
 * @param {string} options.genshareVersion - GenShare version returned by genshare (for display in logs)
 * @param {string} options.genshareVersionAlias - GenShare version alias for internal config lookups only (e.g., "latest") - NOT included in row data
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
 * @returns {Array} - CSV row data array (contains only genshareVersion, not alias)
 */
const buildSummaryRowData = (options) => {
  const {
    requestId,
    s3Url,
    snapshotAPIVersion = "",
    genshareVersion,
    genshareVersionAlias,
    errorStatus = "No",
    date,
    duration = 0,
    userId,
    filename = "N/A",
    reportVersion = "",
    reportURL = "",
    graphValue = "",
    articleId = "",
    responseData = []
  } = options;

  // Format response data using existing function (use alias for config lookup)
  const response = getResponse(responseData, genshareVersionAlias);

  // Build the row data
  const rowData = [
    s3Url ? `=HYPERLINK("${s3Url}","${requestId}")` : requestId, // Query ID with S3 link
    snapshotAPIVersion,                          // Snapshot API version
    genshareVersion || "",                       // GenShare version (returned by genshare)
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
  ].concat(response);

  return rowData;
};

/**
 * Generate CSV headers for the main summary sheet
 * @param {string} version - GenShare version
 * @returns {Array} - CSV headers array
 */
const getSummaryHeaders = (versionAlias) => {
  const versionConfig = getVersionConfig(versionAlias) || getVersionConfig(genshareConfig.defaultVersion);

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
    "Graph Value",
    "Article ID"
  ];

  // Add getResponse field headers
  const responseHeaders = Object.keys(versionConfig.responseMapping?.getResponse || {});

  return baseHeaders.concat(responseHeaders);
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
    duration = 0,
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
    convertToGoogleSheetsDuration(duration),     // Duration
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
        const value = item.value == null ? "" : (typeof item.value === "string" ? item.value : JSON.stringify(item.value, null, 2));
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
    "Duration",
    "Filename",
    "GenShare Version",
    "Report Version",
    "Report URL",
    "Graph Value",
    "Article ID"
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
 * @param {string} options.genshareVersionAlias - GenShare version alias for internal config lookups (e.g., "latest") - NOT logged, only used to find correct Google Sheets config
 * @returns {Promise<void>}
 */
const appendToSummary = async ({ session, errorStatus, data, genshareVersionAlias, reportURL, graphValue, reportVersion, articleId }) => {
  try {
    // Safely get the filename, defaulting to "N/A" if not available
    const filename = data.file?.originalname || "N/A";

    // Get the response info from the genshare response in the session
    const genshareResponse = session.genshare?.response;

    // Use session start time (when API received the request)
    const date = session.startTime || new Date();

    // Build s3-manager request URL for the hyperlink
    const s3ManagerUrl = (instanceConfig.s3ManagerUrl || '').replace(/\/+$/, '');
    const requestUrl = s3ManagerUrl ? `${s3ManagerUrl}/request/${session.requestId}` : null;

    // Build the row data using the centralized function
    const rowData = buildSummaryRowData({
      requestId: session.requestId,
      s3Url: requestUrl,
      snapshotAPIVersion: session.getSnapshotAPIVersion(),
      genshareVersion: session.getGenshareVersion() || getActualVersion(genshareVersionAlias),  // Version returned by genshare (stored in session)
      genshareVersionAlias,  // Alias for config lookups
      errorStatus,
      date,
      duration: session.getDuration(),
      userId: data.user.id,
      filename,
      reportVersion: reportVersion || "",
      reportURL: reportURL || "",
      graphValue: graphValue || "",
      articleId: articleId || "",
      responseData: genshareResponse?.data?.response
    });

    // Log to Google Sheets using the actual version label for the tab name
    const versionLabel = session.getGenshareVersion() || getActualVersion(genshareVersionAlias);
    const headers = getSummaryHeaders(genshareVersionAlias);
    await appendToSheet(rowData, versionLabel, headers);

    session.loggedToSummary = true;
    session.addLog('[Sheets] Logged to summary Google Sheet successfully');
  } catch (sheetsError) {
    session.addLog(`[Sheets] Error logging to summary Google Sheet: ${sheetsError.message}`, 'WARN');
    console.error(`[${session.requestId}] Error logging to Google Sheets:`, sheetsError);
  }
};

/**
 * Logs filtered response data to user-specific Google Sheets
 * @param {Object} options - Options containing session, user, and filtered data
 * @param {Object} options.session - Processing session for logging
 * @param {string} options.userId - User ID to look up in logsConfig.users
 * @param {Array} options.filteredData - Filtered response data array
 * @param {string} options.reportURL - Report URL (optional)
 * @param {string} options.filename - Original filename
 * @param {string} options.genshareVersionAlias - GenShare version alias for fallback (e.g., "latest")
 * @param {string} options.reportVersion - Report version used
 * @param {string} options.graphValue - Graph/editorial policy value
 * @returns {Promise<void>}
 */
const appendToUserLog = async ({ session, userId, filteredData, reportURL, filename, genshareVersionAlias, reportVersion, graphValue, articleId }) => {
  try {
    // Folder and spreadsheet are auto-created if the user doesn't exist in logsConfig yet

    // Use session start time (when API received the request)
    const date = session.startTime || new Date();

    // Build the row data using the centralized function
    const rowData = buildUserLogRowData({
      requestId: session.requestId,
      date,
      duration: session.getDuration(),
      filename: filename || "N/A",
      genshareVersion: session.getGenshareVersion() || getActualVersion(genshareVersionAlias),  // Version returned by genshare (stored in session)
      reportVersion: reportVersion || "",
      reportURL: reportURL || "",
      graphValue: graphValue || "",
      articleId: articleId || "",
      filteredData
    });

    // Append to user's Google Sheet
    const headers = getUserLogHeaders(filteredData);
    await appendToUserSheet(rowData, userId, headers);

    session.addLog(`[User Sheets] Logged to user Google Sheet successfully (${userId})`);
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
  
  await Promise.all(authorizedVersions.map(async (versionAlias) => {
    try {
      const versionConfig = getVersionConfig(versionAlias);
      if (!versionConfig) {
        healthResults[versionAlias] = { error: `Version alias "${versionAlias}" not found in configuration` };
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

      healthResults[versionAlias] = {
        status: response.status,
        data: response.data,
        version: getActualVersion(versionAlias)
      };
    } catch (error) {
      healthResults[versionAlias] = {
        error: error.message,
        status: error.response?.status || 500,
        version: getActualVersion(versionAlias)
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
  try {
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

  // Check if version alias exists in configuration
  if (!getVersionConfig(activeGenShareVersion)) {
    throw new Error(`Requested GenShare version alias "${activeGenShareVersion}" is not configured.`);
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
    session.addLog('[Input] Error: Required "file" missing', 'ERROR');
    throw new Error('Required "file" missing.');
  }

  // Validate PDF file
  session.addLog('[PDF] Validating PDF file...');
  const validationResult = await validatePDFFile(data.file);
  
  if (!validationResult.valid) {
    errorStatus = `File validation error: ${validationResult.reason}`;
    session.addLog(`[PDF] Validation failed: ${validationResult.reason}`, 'ERROR');
    
    // Log to summary sheet with error status
    try {
      await appendToSummary({
        session,
        errorStatus,
        data,
        genshareVersionAlias: activeGenShareVersion || genshareConfig.defaultVersion,
        reportURL: "",
        graphValue: "",
        reportVersion: "",
        articleId: data.options?.article_id || ""
      });
    } catch (summaryError) {
      session.addLog(`[Sheets] Error logging validation error to summary: ${summaryError.message}`, 'WARN');
      console.error(`[${session.requestId}] Error logging validation error to summary:`, summaryError);
    }

    const validationError = new Error(validationResult.reason);
    validationError.status = 400; // Bad Request
    throw validationError;
  }
  
  session.addLog('[PDF] File validation passed');

  // Compute the SHA-256 of the PDF once. Stored on the session so later
  // DB inserts can persist it on the requests row (enables the demo-bypass
  // lookup on future requests with the same PDF binary).
  try {
    session.pdfHash = await calculateSHA256(data.file.path);
    session.addLog(`[PDF] SHA-256: ${session.pdfHash}`);
  } catch (hashError) {
    session.addLog(`[PDF] Failed to compute SHA-256: ${hashError.message}`, 'WARN');
    session.pdfHash = null;
  }

  // Initialize GenShare with the active version
  session.initGenShare(activeGenShareVersion);

  // Ensure options exist
  let options = data.options || {};

  // Get the configuration for the active version alias
  const versionConfig = getVersionConfig(activeGenShareVersion);
  const processPDFConfig = versionConfig.processPDF;
  const actualVersion = getActualVersion(activeGenShareVersion);

  // Log initial request details
  session.addLog(`[API] Received from user ${data.user.id}`);
  session.addLog(`[GenShare] Using version: ${activeGenShareVersion} (${actualVersion})`);

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
    session.addLog(`[S3] Added supplementary file: ${data.supplementary_file.originalname} (${data.supplementary_file.size} bytes)`);
  }

  // Filter options sent by the user 
  const filteredOptions = filterOptions(options, user, session);

  // Add options with decision_tree_path for the request only
  const requestOptions = {
    ...filteredOptions,
    request_id: session.requestId,
    decision_tree_path: true,
    debug: true
  };
  formData.append('options', JSON.stringify(requestOptions));

  // Log third-party service request
  session.addLog(`[GenShare] Sending request to service: ${activeGenShareVersion} (${actualVersion})`);
  session.addLog(`[GenShare] URL: ${processPDFConfig.url}`);

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

  const genshareCallStart = new Date();

  // Record Snapshot API pre-GenShare processing time (always, even if GenShare fails)
  session.addTimelineEvent('snapshot-api-pre', session.startTime, genshareCallStart);

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
    const genshareCallEnd = new Date();

    // Record GenShare round-trip as meta event (not shown in chart, used for stats)
    session.timeline.push({
      id: 'genshare-call',
      start: genshareCallStart.toISOString(),
      end: genshareCallEnd.toISOString(),
      duration_ms: genshareCallEnd - genshareCallStart,
      source: 'snapshot-api',
      type: 'meta'
    });

    // Merge genshare timeline events into session timeline
    if (response.data && response.data.timeline && Array.isArray(response.data.timeline)) {
      response.data.timeline.forEach(event => {
        session.timeline.push({ ...event, source: event.source || 'genshare' });
      });
    }

    // Check if response status is not 2xx or 3xx
    if (response.status >= 400) {
      errorStatus = `GenShare Error (HTTP ${response.status})`;
    }

    // Log successful response
    let responseGenShareVersion = response?.data?.version;

    // Normalize the returned version (add 'v' prefix if missing)
    if (responseGenShareVersion && !responseGenShareVersion.startsWith('v')) {
      responseGenShareVersion = `v${responseGenShareVersion}`;
    }

    if (!responseGenShareVersion) {
      session.addLog(`[GenShare] Version not returned by service`, 'WARN');
    } else {
      session.addLog(`[GenShare] Version returned: ${responseGenShareVersion}`);
      // Compare the actual version (not the alias) with the response version
      if (actualVersion === responseGenShareVersion) {
        session.addLog(`[GenShare] Versions match: ${activeGenShareVersion} (${actualVersion}) - ${responseGenShareVersion}`);
      } else {
        session.addLog(`[GenShare] Versions don't match: ${activeGenShareVersion} (${actualVersion}) - ${responseGenShareVersion}`, 'WARN');
      }
    }

    // Log the graph value returned
    let responseGenShareGraphValue = response?.data?.graph_policy_traversal_data?.graph_type || "";

    if (!responseGenShareGraphValue) {
      session.addLog(`[GenShare] Graph value not returned by service`);
    } else {
      session.addLog(`[GenShare] Graph value returned: ${responseGenShareGraphValue}`);
      if (activeGenShareGraphValue.indexOf(responseGenShareGraphValue) > -1) {
        session.addLog(`[GenShare] Graph values match: (${activeGenShareGraphValue} - ${responseGenShareGraphValue})`);
      } else {
        session.addLog(`[GenShare] Graph values don't match: (${activeGenShareGraphValue} - ${responseGenShareGraphValue})`, 'WARN');
      }
    }

    activeGenShareGraphValue = responseGenShareGraphValue;

    session.addLog(`[GenShare] Received response with status: ${response.status}`);

    // Snapshot the immutable original genshare payload BEFORE any cache
    // substitution mutates the working copy. This is what will be written to
    // S3 at genshare/response.original.json.
    session.setGenshareOriginalResponse(response.data);

    // Apply the snapshot-api-side cache layer (if enabled). When a curator has
    // patched the canonical cached response for this cache_key, this call
    // substitutes `response.data.response` in place so every downstream
    // consumer (filter, Sheets log, snapshot-reports, saveToS3) sees the
    // patched array. No-op when cache is disabled or genshare provided no
    // cache block.
    try {
      // cacheManager emits its own session log lines ("[cache] …") so we
      // just need to stash the resulting cache-ref on the session.
      const cacheResult = await cacheManager.applyCacheToGenshareResponse(
        response.data,
        activeGenShareVersion,
        session
      );
      if (cacheResult.applied && cacheResult.cacheKey) {
        session.cacheKey = cacheResult.cacheKey;
        session.setCacheRef(cacheResult.cacheRef);
      }
    } catch (cacheError) {
      // Cache must never break the main path — log and continue with the raw
      // genshare response.
      session.addLog(`[cache] Error applying cache layer: ${cacheError.message}`, 'WARN');
      console.error(`[${session.requestId}] [cache] Error applying cache layer:`, cacheError);
    }

    // Store complete response in the session (now carries the possibly-
    // substituted response array — originalResponse preserves the raw one).
    session.setGenshareResponse({
      status: response.status,
      headers: response.headers,
      data: { ...response.data }
    });

    // Set GenShare version in the processing session (use version returned by genshare, fallback to configured version)
    session.setGenshareVersion(responseGenShareVersion || actualVersion);

    // If everything is fine (no error, activeReportVersion not empty and data available)
    // - create a snapshot-reports report
    // - create the JSON data
    if (errorStatus === "No" && !!activeReportVersion && response.data.response) {
      session.addLog(`[Reports] Using report kind: ${activeReportVersion}`);
      try {
        // Create snapshot-reports Report
        const snapshotReport = await snapshotReportsManager.createReport(activeReportVersion, session.requestId, session);
        reportURL = snapshotReport.url;

        // Build JSON Report using requestsManager
        const jsonReport = requestsManager.buildJSON(activeReportVersion, response.data.response, reportURL);

        // Store JSON Report
        session.setReport(jsonReport);

      } catch (reportCreationError) {
        session.addLog(`[Reports] Error creating snapshot-reports report: ${reportCreationError.message}`, 'ERROR');
        console.error(`[${session.requestId}] Error creating snapshot-reports report:`, reportCreationError);
        // Don't fail the request if report creation fails, just log it
      }
    }

    // Get the "article_id" value
    const articleId = response.data.response.filter((item) => {
      return item.name === "article_id";
    })[0]?.value;

    if (!articleId) {
      session.addLog('[DB] Warning: "article_id" not found in response. Storing request with empty article_id.');
      console.warn(`[${session.requestId}] Warning: "article_id" not found. Storing request with empty article_id.`);
    } else {
      session.addLog('[DB] Link "article_id <-> request_id" created');
    }

    // Always store the request in DB (with or without article_id)
    const dbArticleId = articleId || '';
    if (session.report) {
      await requestsManager.addOrUpdateRequestWithReport(user.id, dbArticleId, session.requestId, session.report);
      session.addLog('[DB] Report data saved to database');
    } else {
      await requestsManager.addOrUpdateRequest(user.id, dbArticleId, session.requestId);
    }

    // If the cache layer attached a cache_key to this session, persist the
    // link on the requests row so GC and the cache API can enumerate consumers.
    if (session.cacheKey) {
      try {
        await dbManager.setRequestCacheKey(session.requestId, session.cacheKey);
        session.addLog(`[DB] cache_key set on request row: ${session.cacheKey}`);
      } catch (cacheDbError) {
        session.addLog(`[DB] Failed to set cache_key: ${cacheDbError.message}`, 'WARN');
        console.error(`[${session.requestId}] [DB] Failed to set cache_key:`, cacheDbError);
      }
    }

    // Persist the pdf_hash on every request so future /processPDF calls can
    // detect demo matches by PDF binary alone.
    if (session.pdfHash) {
      try {
        await dbManager.setRequestPdfHash(session.requestId, session.pdfHash);
        session.addLog('[DB] pdf_hash saved');
      } catch (hashDbError) {
        session.addLog(`[DB] Failed to set pdf_hash: ${hashDbError.message}`, 'WARN');
        console.error(`[${session.requestId}] [DB] Failed to set pdf_hash:`, hashDbError);
      }
    }

    // Curator-initiated requests are immediately flagged as demo.
    if (data.isCuratorDemo === true) {
      try {
        await dbManager.setRequestIsDemo(session.requestId, true);
        session.addLog('[DB] Request marked as demo (is_demo=1)');
      } catch (demoDbError) {
        session.addLog(`[DB] Failed to set is_demo: ${demoDbError.message}`, 'WARN');
        console.error(`[${session.requestId}] [DB] Failed to set is_demo:`, demoDbError);
      }
    }

    // Validate action_required field
    const actionRequiredItem = response.data.response.find(item => item.name === "action_required");
    if (actionRequiredItem && actionRequiredItem.value === "") {
      const validationError = new Error('Snapshot response contains invalid action_required value (empty string)');
      session.addLog('[Validation] action_required value is empty in Snapshot response', 'ERROR');
      errorStatus = 'Validation error: action_required is empty';
      
      // Log to summary sheet with error status
      try {
        await appendToSummary({
          session,
          errorStatus,
          data,
          genshareVersionAlias: activeGenShareVersion,
          reportURL,
          graphValue: activeGenShareGraphValue,
          reportVersion: activeReportVersion,
          articleId: articleId || ""
        });
      } catch (summaryError) {
        session.addLog(`[Sheets] Error logging validation error to summary: ${summaryError.message}`, 'WARN');
        console.error(`[${session.requestId}] Error logging validation error to summary:`, summaryError);
      }

      // Throw error with 500 status
      validationError.status = 500;
      throw validationError;
    }

    // Session data preparation is complete
    session.addLog('[API] Response processing completed');

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

    // Log to Google Sheets (summary + user-specific)
    const sheetsStart = new Date();

    // Log to genshare summary sheet
    try {
      await appendToSummary({
        session,
        errorStatus,
        data,
        genshareVersionAlias: activeGenShareVersion,
        reportURL,
        graphValue: activeGenShareGraphValue,
        reportVersion: activeReportVersion,
        articleId: articleId || ""
      });
    } catch (summaryError) {
      session.addLog(`[Sheets] Error logging to summary: ${summaryError.message}`, 'WARN');
      console.error(`[${session.requestId}] Error logging to summary:`, summaryError);
    }

    // Log to user-specific Google Sheet
    try {
      await appendToUserLog({
        session,
        userId: user.id,
        filteredData: finalData,
        reportURL,
        filename: data.file?.originalname,
        genshareVersionAlias: activeGenShareVersion,
        reportVersion: activeReportVersion,
        graphValue: activeGenShareGraphValue,
        articleId: articleId || ""
      });
    } catch (userLogError) {
      session.addLog(`[User Sheets] Error logging to user sheet: ${userLogError.message}`, 'WARN');
      console.error(`[${session.requestId}] Error logging to user sheet:`, userLogError);
    }

    const sheetsEnd = new Date();

    // Record GoogleSheets Logs sub-step
    if (sheetsEnd - sheetsStart > 0) {
      session.timeline.push({
        id: 'googlesheets-logs',
        start: sheetsStart.toISOString(),
        end: sheetsEnd.toISOString(),
        duration_ms: sheetsEnd - sheetsStart,
        source: 'snapshot-api',
        type: 'sub-step'
      });
    }

    // Record Snapshot API post-GenShare processing time
    session.addTimelineEvent('snapshot-api-post', genshareCallEnd, new Date());

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
    const genshareCallEnd = new Date();

    // Record GenShare call duration even on failure
    session.timeline.push({
      id: 'genshare-call',
      start: genshareCallStart.toISOString(),
      end: genshareCallEnd.toISOString(),
      duration_ms: genshareCallEnd - genshareCallStart,
      source: 'snapshot-api',
      type: 'meta'
    });

    // Merge genshare timeline events from error response if available
    if (error.response?.data?.timeline && Array.isArray(error.response.data.timeline)) {
      error.response.data.timeline.forEach(event => {
        session.timeline.push({ ...event, source: event.source || 'genshare' });
      });
    }

    // Record post-GenShare processing time
    session.addTimelineEvent('snapshot-api-post', genshareCallEnd, new Date());

    // Set error status based on the type of error
    if (error.response) {
      errorStatus = `GenShare Error (HTTP ${error.response.status})`;
    } else {
      errorStatus = `${error.message}`;
    }

    // Log error
    session.addLog(`[API] Error processing request: ${error.message}`, 'ERROR');
    session.addLog(`[API] Stack: ${error.stack}`, 'ERROR');

    // Store failed request in DB so it appears in s3-manager logs
    try {
      const errorArticleId = data.options?.article_id || '';
      await requestsManager.addOrUpdateRequest(user.id, errorArticleId, session.requestId);
      session.addLog('[DB] Failed request stored in database');
    } catch (dbError) {
      session.addLog(`[DB] Error storing failed request: ${dbError.message}`);
      console.error(`[${session.requestId}] Error storing failed request in DB:`, dbError);
    }

    // Log to genshare summary sheet even in case of error
    try {
      await appendToSummary({
        session,
        errorStatus,
        data,
        genshareVersionAlias: activeGenShareVersion || genshareConfig.defaultVersion,
        reportURL: "",
        graphValue: activeGenShareGraphValue,
        reportVersion: activeReportVersion,
        articleId: data.options?.article_id || ""
      });
    } catch (summaryError) {
      session.addLog(`[Sheets] Error logging error to summary: ${summaryError.message}`, 'WARN');
      console.error(`[${session.requestId}] Error logging error to summary:`, summaryError);
    }

    // Log to user-specific Google Sheet even in case of error
    try {
      await appendToUserLog({
        session,
        userId: user.id,
        filteredData: [],
        reportURL: "",
        filename: data.file?.originalname,
        genshareVersionAlias: activeGenShareVersion || genshareConfig.defaultVersion,
        reportVersion: activeReportVersion,
        graphValue: activeGenShareGraphValue,
        articleId: data.options?.article_id || ""
      });
    } catch (userLogError) {
      session.addLog(`[User Sheets] Error logging error to user sheet: ${userLogError.message}`, 'WARN');
      console.error(`[${session.requestId}] Error logging error to user sheet:`, userLogError);
    }

    // Re-throw the original error
    throw error;
  }
  } catch (error) {
    // Fire-and-forget email alert for all genshare errors
    emailAlertManager.notifyGenshareError({ session, error, userId: data.user.id });
    throw error;
  }
};

// ============================================================================
// ASYNC JOB PROCESSING FUNCTIONS
// ============================================================================

const queueManager = require('./queueManager');
const { ProcessingSession } = require('./s3Storage');

/**
 * Process a GenShare submission job (called by the queue manager)
 * @param {Object} job - Job record from database
 * @returns {Promise<Object>} - Processing result
 */
const processGenshareSubmissionJob = async (job) => {
  const data = JSON.parse(job.data);

  // Create a new processing session reusing the original request ID
  const session = new ProcessingSession(data.user_id, job.request_id);
  session.setOrigin('direct');

  // Track file paths for cleanup
  const tempFilePaths = [];

  try {
    session.addLog('[API] Starting background processing of GenShare submission');

    // Reconstruct file objects from stored paths
    const mainFile = data.file || null;
    const supplementaryFile = data.supplementary_file || null;

    if (mainFile && mainFile.path) {
      session.addFile(mainFile, 'api');
      tempFilePaths.push(mainFile.path);
    }
    if (supplementaryFile && supplementaryFile.path) {
      session.addFile(supplementaryFile, 'api');
      tempFilePaths.push(supplementaryFile.path);
    }

    // Prepare processing data
    const processingData = {
      file: mainFile,
      supplementary_file: supplementaryFile,
      user: { id: data.user_id },
      options: data.options || {}
    };

    // Process the PDF
    const result = await processPDF(processingData, session);

    // Save session to S3
    session.setAPIResponse({
      status: result.status,
      data: result.data
    });
    await session.saveToS3();

    session.addLog('[API] Background GenShare processing completed');

    return {
      status: result.status,
      data: result.data,
      errorStatus: result.errorStatus
    };
  } catch (error) {
    session.addLog(`[API] Error in background processing: ${error.message}`, 'ERROR');

    try {
      session.setAPIResponse({
        status: 'error',
        error: error.message
      });
      await session.saveToS3();
    } catch (s3Error) {
      console.error(`[${job.request_id}] Error saving error session to S3:`, s3Error);
    }

    throw error;
  } finally {
    // Clean up temp files
    const fsPromises = require('fs').promises;
    for (const filePath of tempFilePaths) {
      try {
        await fsPromises.unlink(filePath);
      } catch (cleanupError) {
        console.error(`[${job.request_id}] Error cleaning up temp file ${filePath}:`, cleanupError);
      }
    }
  }
};

/**
 * Handle GenShare job completion - POST result to notification_url
 * @param {string} requestId - Request ID of the completed job
 */
const handleGenshareJobCompletion = async (requestId) => {
  try {
    console.log(`[GenShare] Job ${requestId} completed, sending notification`);

    const job = await queueManager.getJobByRequestId(requestId);
    if (!job) {
      console.error(`[GenShare] Could not find job data for ${requestId}`);
      return;
    }

    const jobData = JSON.parse(job.data);
    const notificationUrl = jobData.notification_url;

    if (!notificationUrl) {
      console.log(`[GenShare] No notification_url for job ${requestId}, skipping notification`);
      return;
    }

    let completionData = null;
    if (job.completion_data) {
      try {
        completionData = JSON.parse(job.completion_data);
      } catch (e) {
        console.error(`[GenShare] Error parsing completion_data for job ${requestId}:`, e);
      }
    }

    await axios.post(notificationUrl, {
      status: 'completed',
      request_id: requestId,
      response: completionData
    });

    console.log(`[GenShare] Notification sent for completed job ${requestId}`);
  } catch (error) {
    console.error(`[GenShare] Error sending completion notification for ${requestId}:`, error.message);
  }
};

/**
 * Handle GenShare job failure - POST error to notification_url
 * @param {string} requestId - Request ID of the failed job
 * @param {Error} error - Error that caused the failure
 */
const handleGenshareJobFailure = async (requestId, error) => {
  try {
    console.log(`[GenShare] Job ${requestId} failed, sending failure notification`);

    const job = await queueManager.getJobByRequestId(requestId);
    if (!job) {
      console.error(`[GenShare] Could not find job data for ${requestId}`);
      return;
    }

    const jobData = JSON.parse(job.data);
    const notificationUrl = jobData.notification_url;

    if (!notificationUrl) {
      console.log(`[GenShare] No notification_url for job ${requestId}, skipping notification`);
      return;
    }

    await axios.post(notificationUrl, {
      status: 'failed',
      request_id: requestId,
      error: error.message
    });

    console.log(`[GenShare] Failure notification sent for job ${requestId}`);
  } catch (notifError) {
    console.error(`[GenShare] Error sending failure notification for ${requestId}:`, notifError.message);
  }
};

/**
 * Get job status for a GenShare async job
 * @param {string} requestId - Request ID of the job
 * @returns {Promise<Object>} - Job status
 */
const getJobStatus = async (requestId) => {
  try {
    const job = await queueManager.getJobByRequestId(requestId);

    if (!job) {
      return {
        status: 'Error',
        error: 'Job not found'
      };
    }

    const response = {
      request_id: requestId,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
      retries: job.retries,
      max_retries: job.max_retries
    };

    if (job.status === queueManager.JobStatus.FAILED) {
      response.error_message = job.error_message;
    }

    if (job.status === queueManager.JobStatus.COMPLETED && job.completion_data) {
      try {
        response.results = JSON.parse(job.completion_data);
      } catch (e) {
        response.results = { error: 'Could not parse completion data' };
      }
    }

    return response;
  } catch (error) {
    console.error(`Error getting job status for ${requestId}:`, error);
    return {
      status: 'Error',
      error: error.message
    };
  }
};

module.exports = {
  // Main functions
  getGenShareHealth,
  processPDF,

  // Async job processing
  processGenshareSubmissionJob,
  handleGenshareJobCompletion,
  handleGenshareJobFailure,
  getJobStatus,

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

  // Version helpers
  getVersionConfig,
  getActualVersion,

  // Validation
  validatePDFFile
};
