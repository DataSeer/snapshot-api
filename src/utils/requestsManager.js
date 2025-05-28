// File: src/utils/requestsManager.js
const dbManager = require('./dbManager');
const { getAllGenshareRequestsFiles, getReportFile } = require('./s3Storage');
const { createReport } = require('./googleSheets');
const config = require('../config');

// Load the report configuration
const reportsConfig = require(config.reportsConfigPath);

/**
 * Initialize database
 * @returns {Promise<void>}
 */
const initDatabase = async () => {
  await dbManager.initDatabase();
};

/**
 * Refresh all requests from S3 and update report data
 * @returns {Promise<boolean>} - True if refresh successful
 */
const refreshRequestsFromS3 = async () => {
  try {
    console.log("Starting refreshRequestsFromS3...");
    
    // Get all options files from S3
    const requestsFiles = await getAllGenshareRequestsFiles();
    console.log(`Total S3 options files retrieved: ${requestsFiles.length}`);
    
    // Count how many have valid article_id
    const validFiles = requestsFiles.filter(file => file.content && file.content.article_id);
    console.log(`Files with valid article_id: ${validFiles.length}`);
    
    // Check for duplicate request_ids
    const requestIds = validFiles.map(file => file.requestId);
    const uniqueRequestIds = new Set(requestIds);
    console.log(`Unique request_ids: ${uniqueRequestIds.size} out of ${requestIds.length}`);
    
    // Find duplicates
    const duplicateIds = requestIds.filter((id, index) => requestIds.indexOf(id) !== index);
    const uniqueDuplicateIds = [...new Set(duplicateIds)];
    console.log(`Number of duplicate request_ids: ${uniqueDuplicateIds.length}`);
    if (uniqueDuplicateIds.length > 0) {
      console.log(`First few duplicate IDs: ${uniqueDuplicateIds.slice(0, 5).join(', ')}`);
    }
    
    // Process each file
    let insertedCount = 0;
    let errorCount = 0;
    let reportUpdatedCount = 0;
    
    for (const file of requestsFiles) {
      if (file.content && file.content.article_id) {
        try {
          // Format the date for record
          const formattedDate = file.lastModified instanceof Date
            ? file.lastModified.toISOString().replace('T', ' ').split('.')[0]
            : new Date(file.lastModified).toISOString().replace('T', ' ').split('.')[0];
          
          // Try to get report data from S3
          let reportData = null;
          try {
            reportData = await getReportFile(file.userId, file.requestId);
            if (reportData) {
              reportUpdatedCount++;
            }
          } catch (reportError) {
            // Report file doesn't exist, that's okay
            console.log(`No report file found for ${file.requestId}: ${reportError.message}`);
          }
          
          // Add/update request with report data if available
          await dbManager.addOrUpdateRequest(
            file.userId, 
            file.content.article_id, 
            file.requestId,
            reportData, // Include report data if available
            formattedDate
          );
          
          insertedCount++;
        } catch (error) {
          console.error(`Exception processing file ${file.requestId}:`, error);
          errorCount++;
        }
      }
    }
    
    console.log(`Inserted/updated ${insertedCount} records, Reports updated: ${reportUpdatedCount}, Errors: ${errorCount}`);
    
    return true;
  } catch (error) {
    console.error('Error refreshing requests from S3:', error);
    throw error;
  }
};

/**
 * Search for requests by article_id or request_id
 * @param {string} userId - User ID
 * @param {string} articleId - Article ID (optional)
 * @param {string} requestId - Request ID (optional)
 * @returns {Promise<Object|null>} - Search result with metadata or null if not found
 */
const searchRequests = async (userId, articleId = null, requestId = null) => {
  try {
    let finalRequestId = null;
    let associatedArticleId = null;
    let requestRecord = null;

    // If request_id is provided, try to find it first
    if (requestId) {
      requestRecord = await dbManager.getRequestWithReportData(userId, requestId);
      
      if (requestRecord) {
        finalRequestId = requestId;
        associatedArticleId = requestRecord.article_id;
      }
    }

    // If no record found by request_id, try article_id
    if (!requestRecord && articleId) {
      // Get all requests for this article_id
      const allRequestsForArticle = await dbManager.getRequestsWithReportDataByArticleId(userId, articleId);
      
      if (allRequestsForArticle && allRequestsForArticle.length > 0) {
        // Return the most recent request (first in the sorted array)
        requestRecord = allRequestsForArticle[0];
        finalRequestId = requestRecord.request_id;
        associatedArticleId = articleId;
      }
    }

    // If still no record found
    if (!requestRecord) {
      return null;
    }

    // Return the search result with metadata
    return {
      meta: {
        found_by: finalRequestId === requestId ? 'request_id' : 'article_id',
        request_id: finalRequestId,
        article_id: associatedArticleId,
        user_id: userId,
        search_used: {
          request_id: !!requestId,
          article_id: !!articleId
        },
        has_report: !!requestRecord.report_data,
        created_at: requestRecord.created_at,
        updated_at: requestRecord.updated_at
      },
      request_id: finalRequestId,
      article_id: associatedArticleId,
      report_data: requestRecord.report_data
    };

  } catch (error) {
    console.error('Error searching requests:', error);
    throw error;
  }
};

/**
 * Get report data for a specific request (optimized method that can be used by both report endpoints)
 * @param {string} userId - User ID
 * @param {string} requestId - Request ID
 * @returns {Promise<Object|null>} - Complete report data with metadata or null if not found
 */
const getRequestReport = async (userId, requestId) => {
  try {
    // Get the request with report data
    const requestRecord = await dbManager.getRequestWithReportData(userId, requestId);
    
    if (!requestRecord || !requestRecord.report_data) {
      return null;
    }

    // Return complete report data with metadata
    return {
      meta: {
        request_id: requestId,
        article_id: requestRecord.article_id,
        user_id: userId,
        created_at: requestRecord.created_at,
        updated_at: requestRecord.updated_at
      },
      ...requestRecord.report_data
    };

  } catch (error) {
    console.error('Error getting request report:', error);
    throw error;
  }
};

/**
 * Get report URL for a specific request (optimized method that extracts only URL)
 * @param {string} userId - User ID
 * @param {string} requestId - Request ID
 * @returns {Promise<string|null>} - Report URL or null if not found
 */
const getRequestReportUrl = async (userId, requestId) => {
  try {
    // Get the request with report data
    const requestRecord = await dbManager.getRequestWithReportData(userId, requestId);
    
    if (!requestRecord || !requestRecord.report_data) {
      return null;
    }

    // Extract URL from report data
    const reportData = requestRecord.report_data;
    
    // Check for various possible URL field names
    if (reportData.report_link) {
      return reportData.report_link;
    }

    // If no URL found in report data
    return null;

  } catch (error) {
    console.error('Error getting request report URL:', error);
    throw error;
  }
};

/**
 * Add or update a request
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @param {string} requestId - The request ID
 * @param {string|Date|null} lastModified - Last modification date (optional)
 * @returns {Promise<Object>} - Result with changes count
 */
const addOrUpdateRequest = async (userName, articleId, requestId, lastModified = null) => {
  // Format the date if provided
  let formattedDate = null;
  if (lastModified) {
    formattedDate = lastModified instanceof Date
      ? lastModified.toISOString()
      : new Date(lastModified).toISOString();
  }
  
  return await dbManager.addOrUpdateRequest(userName, articleId, requestId, null, formattedDate);
};

/**
 * Add or update a request with report data
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @param {string} requestId - The request ID
 * @param {Object} reportData - The report data
 * @param {string|Date|null} lastModified - Last modification date (optional)
 * @returns {Promise<Object>} - Result with changes count
 */
const addOrUpdateRequestWithReport = async (userName, articleId, requestId, reportData, lastModified = null) => {
  // Format the date if provided
  let formattedDate = null;
  if (lastModified) {
    formattedDate = lastModified instanceof Date
      ? lastModified.toISOString()
      : new Date(lastModified).toISOString();
  }
  
  return await dbManager.addOrUpdateRequest(userName, articleId, requestId, reportData, formattedDate);
};

/**
 * Update report data for a request
 * @param {string} requestId - The request ID
 * @param {Object} reportData - The report data
 * @returns {Promise<boolean>} - True if update was successful
 */
const updateRequestReportData = async (requestId, reportData) => {
  return await dbManager.updateRequestReportData(requestId, reportData);
};

/**
 * Delete a request
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @param {string|null} requestId - The request ID (optional)
 * @returns {Promise<Object>} - Result with changes count
 */
const deleteRequest = async (userName, articleId, requestId = null) => {
  return await dbManager.deleteRequest(userName, articleId, requestId);
};

/**
 * Get request_id for a given article_id (return the newest one)
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @returns {Promise<string|null>} - The request ID or null if not found
 */
const getRequestIdByArticleId = async (userName, articleId) => {
  return await dbManager.getRequestIdByArticleId(userName, articleId);
};

/**
 * Get article_id for a given request_id
 * @param {string} userName - The user name
 * @param {string} requestId - The request ID
 * @returns {Promise<string|null>} - The article ID or null if not found
 */
const getArticleIdByRequestId = async (userName, requestId) => {
  return await dbManager.getArticleIdByRequestId(userName, requestId);
};

/**
 * Get all request_ids for a given article_id (ordered by newest first)
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @returns {Promise<string[]>} - Array of request IDs
 */
const getRequestIdsByArticleId = async (userName, articleId) => {
  return await dbManager.getRequestIdsByArticleId(userName, articleId);
};

/**
 * Get request with report data by request ID
 * @param {string} userName - The user name
 * @param {string} requestId - The request ID
 * @returns {Promise<Object|null>} - Request record with report data or null
 */
const getRequestWithReportData = async (userName, requestId) => {
  return await dbManager.getRequestWithReportData(userName, requestId);
};

/**
 * Get all requests with report data for a user and article
 * @param {string} userName - The user name
 * @param {string} articleId - The article ID
 * @returns {Promise<Array>} - Array of request records
 */
const getRequestsWithReportDataByArticleId = async (userName, articleId) => {
  return await dbManager.getRequestsWithReportDataByArticleId(userName, articleId);
};

/*
 * REPORTS FUNCTIONALITY (consolidated from old reportsManager)
 */

/**
 * Creates a Google Sheets file based on report configuration and GenShare response data
 * @param {string} version - Version of the report
 * @param {Array} responseData - Array of response data from GenShare
 * @param {Object} session - Processing session for logging
 * @returns {Promise<Object>} - Object containing fileId and url of the created Google Sheets
 */
const createGoogleSheets = async (version, responseData, session) => {
  if (!reportsConfig.versions[version]) throw new Error(`Error requesting Report version: ${version}`);
  try {
    // Convert response array to object for easier access
    const responseObject = {};
    responseData.forEach(item => {
      responseObject[item.name] = item.value;
    });

    // Prepare sheets data based on reportsConfig.versions[version].googleSheets.sheets
    const sheetsData = {};
    
    // Loop through each sheet in reportsConfig.versions[version].googleSheets.sheets
    Object.keys(reportsConfig.versions[version].googleSheets.sheets).forEach(sheetName => {
      const sheetConfig = reportsConfig.versions[version].googleSheets.sheets[sheetName];
      if (sheetConfig.cells) {
        sheetsData[sheetName] = {
          cells: {}
        };
        
        // For each cell in the sheet
        Object.keys(sheetConfig.cells).forEach(cellReference => {
          const responseKey = sheetConfig.cells[cellReference];
          
          // Get the value from the response object
          let cellValue = '';
          if (responseKey && Object.prototype.hasOwnProperty.call(responseObject, responseKey)) {
            cellValue = responseObject[responseKey];
            
            // Handle array values by joining with newline
            if (Array.isArray(cellValue)) {
              cellValue = cellValue.join('\n');
            } 
            // Convert other non-string values to string
            else if (typeof cellValue !== 'string') {
              cellValue = cellValue.toString();
            }
          }
          
          sheetsData[sheetName].cells[cellReference] = cellValue;
        });
      }
    });

    // Create the Google Sheets file
    const fileId = await createReport({
      spreadsheetId: reportsConfig.versions[version].googleSheets.template.default,
      name: responseObject.article_id,
      sheets: sheetsData,
      role: reportsConfig.versions[version].googleSheets.permissions.default,
      folderId: reportsConfig.versions[version].googleSheets.folder.default
    }, session);

    session.addLog(`Google Sheets file created successfully with ID: ${fileId}`);
    
    const url = `https://docs.google.com/spreadsheets/d/${fileId}/edit`;
    
    return {
      id: fileId,
      url: url
    };
    
  } catch (error) {
    session.addLog(`Error creating Google Sheets file: ${error.message}`);
    console.error('Error creating Google Sheets file:', error);
    throw error;
  }
};

/**
 * Build the JSON data based on report configuration, GenShare response data & report URL
 * @param {string} version - Version of the report
 * @param {Array} responseData - Array of response data from GenShare
 * @param {string} reportURL - URL of the report
 * @returns {Object} - Object containing the report JSON data
 */
const buildJSON = (version, responseData, reportURL) => {
  if (!reportsConfig.versions[version]) return new Error(`Error requesting Report version: ${version}`);

  // Prepare JSON data based on JSON report available/restricted fields
  const result = {};

  const filteredResponseData = filterResponseForJSON(version, responseData);
  filteredResponseData.forEach(item => {
    result[item.name] = item.value;
  });

  // If there's a reportURL, set the value in the JSON if it's not already defined
  if (!!reportURL && !result["report_link"]) {
    result["report_link"] = reportURL;
  }

  return result;
};

/**
 * Filter GenShare response based on JSON report's permissions
 * @param {string} version - Report version
 * @param {Array} responseData - Response data from GenShare
 * @returns {Array} - Filtered response
 */
const filterResponseForJSON = (version, responseData) => {
  if (!version || !reportsConfig.versions[version]) return new Error(`Error requesting Report version: ${version}`);
  
  // If no response data or no filter settings, return as is
  if (!responseData || !reportsConfig.versions[version].JSON) {
    return responseData;
  }

  const { availableFields, restrictedFields } = reportsConfig.versions[version].JSON;

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

module.exports = {
  initDatabase,
  refreshRequestsFromS3,
  
  // New consolidated search/report methods
  searchRequests,
  getRequestReport,
  getRequestReportUrl,
  
  // Basic request management
  addOrUpdateRequest,
  addOrUpdateRequestWithReport,
  updateRequestReportData,
  deleteRequest,
  getRequestIdByArticleId,
  getArticleIdByRequestId,
  getRequestIdsByArticleId,
  getRequestWithReportData,
  getRequestsWithReportDataByArticleId,

  // Reports functionality
  createGoogleSheets,
  buildJSON
};
