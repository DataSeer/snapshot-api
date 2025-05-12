// File: src/utils/responses/reportManager.js
const config = require('../config');
const { createReport } = require('./googleSheets');

// Load the report configuration
const reportsConfig = require(config.reportsConfigPath);

/**
 * Creates a Google Sheets file based on report configuration and GenShare response data
 * @param {string} version - Version of the report
 * @param {Array} responseData - Array of response data from GenShare
 * @param {Object} session - Processing session for logging
 * @returns {Promise<Object>} - Object containing fileId and url of the created Google Sheets
 */
async function createGoogleSheets(version, responseData, session) {
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
}

/**
 * Build the JSON data based on report configuration, GenShare response data & report report URL
 * @param {string} version - Version of the report
 * @param {Array} responseData - Array of response data from GenShare
 * @param {strind} reportURL - URL of the report report
 * @returns {Object} - Object containing the report JSON data
 */
function buildJSON(version, responseData, reportURL) {

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
}

/**
 * Filter GenShare response based on JSON report's permissions
 * @param {Object} version - User object with filter settings
 * @param {Object} responseData - Response property of the full GenShare response
 * @returns {Object} - Filtered response
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
  createGoogleSheets,
  buildJSON
};
