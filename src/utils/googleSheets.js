// File: src/utils/googleSheets.js
const path = require('path');
const { google } = require('googleapis');
// Load Genshare configuration which now contains Google Sheets settings per version
const config = require('../config');

// Load the genshare configuration
const genshareConfig = require(config.genshareConfigPath);

// Initialize the Sheets API client
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, `../../conf/googleSheets.credentials.json`),
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file'
  ]
});

const sheetsService = google.sheets({ version: 'v4', auth });

// Initialize Google Drive API client for file operations
const driveService = google.drive({ version: 'v3', auth });

/**
 * Appends data to a specific version's Google Sheet
 * @param {Array} data - Array of data to append to the sheet
 * @param {string} version - GenShare version to determine which sheet to use
 * @returns {Promise<Object>} - Google Sheets API response
 */
async function appendToSheet(data, version) {
  try {
    // Get spreadsheet configuration for the specified version
    const versionConfig = genshareConfig.versions[version] || genshareConfig.versions[genshareConfig.defaultVersion];
    const sheetConfig = versionConfig.googleSheets;
    
    if (!sheetConfig || !sheetConfig.spreadsheetId || !sheetConfig.sheetName) {
      throw new Error(`No Google Sheets configuration found for GenShare version ${version}`);
    }

    const response = await sheetsService.spreadsheets.values.append({
      spreadsheetId: sheetConfig.spreadsheetId,
      range: sheetConfig.sheetName,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'OVERWRITE',
      requestBody: {
        values: [data]
      }
    });

    return response.data;
  } catch (error) {
    console.error(`Error appending to Google Sheet for version ${version}:`, error);
    throw error;
  }
}

/**
 * Creates a copy of a template file and fills it with provided data
 * @param {Object} options - Configuration options
 * @param {string} options.spreadsheetId - Google ID of the template file to copy
 * @param {string} options.name - Name for the new copied file
 * @param {Object} options.sheets - Object containing sheet names and cell data
 * @param {string} options.role - Permission role to grant (e.g., 'reader', 'writer', 'commenter')
 * @param {string} [options.folderId] - Optional Google ID of the destination folder
 * @param {Object} session - Processing session for logging
 * @returns {Promise<string>} - Google ID of the newly created file
 */
async function createReport(options, session) {
  const { spreadsheetId, name, sheets, role, folderId } = options;
  
  try {
    // Step 1: Copy the template file
    session.addLog(`[Google Sheets] Copying template file ${spreadsheetId} to create ${name}`);
    
    const copyResource = {
      name: name
    };
    
    // Add folder parent if specified
    if (folderId) {
      copyResource.parents = [folderId];
      session.addLog(`[Google Sheets] Setting parent folder to ${folderId}`);
    }
    
    const copyResponse = await driveService.files.copy({
      fileId: spreadsheetId,
      resource: copyResource
    });
    
    const newFileId = copyResponse.data.id;
    session.addLog(`[Google Sheets] Created new file with ID: ${newFileId}`);

    // Step 2: Set permissions for "anyone" with specified role
    session.addLog(`[Google Sheets] Setting permissions for file ${newFileId} with role: ${role}`);
    await driveService.permissions.create({
      fileId: newFileId,
      resource: {
        type: 'anyone',
        role: role
      }
    });
    session.addLog(`[Google Sheets] Successfully set permissions for file ${newFileId}`);

    // Step 3: Fill the sheets with data
    const updates = [];
    
    // Convert sheets data to batches for Google Sheets API
    for (const [sheetName, sheetData] of Object.entries(sheets)) {
      for (const [cellReference, cellValue] of Object.entries(sheetData.cells)) {
        updates.push({
          range: `${sheetName}!${cellReference}`,
          values: [[cellValue]]
        });
      }
    }

    // Update all cells at once using batch update
    if (updates.length > 0) {
      session.addLog(`[Google Sheets] Updating ${updates.length} cells across sheets`);
      const updateResponse = await sheetsService.spreadsheets.values.batchUpdate({
        spreadsheetId: newFileId,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data: updates
        }
      });
      session.addLog(`[Google Sheets] Successfully updated ${updateResponse.data.totalUpdatedCells} cells`);
    }

    // Step 4: Return the new file ID
    return newFileId;
  } catch (error) {
    console.error(`Error creating a report:`, error);
    throw error;
  }
}

function convertToGoogleSheetsDate(jsDate) {
    if (!(jsDate instanceof Date)) {
        throw new Error('Input must be a valid JavaScript Date object');
    }

    const year = jsDate.getFullYear();
    // getMonth() returns 0-11, but DATE() formula needs 1-12
    const month = jsDate.getMonth() + 1;
    const day = jsDate.getDate();

    // Return the Google Sheets DATE and TIME formula string
    return `=DATE(${year},${month},${day})`;
}

function convertToGoogleSheetsTime(jsDate) {
    if (!(jsDate instanceof Date)) {
        throw new Error('Input must be a valid JavaScript Date object');
    }

    const hours = jsDate.getHours();
    const minutes = jsDate.getMinutes();
    const seconds = jsDate.getSeconds();

    // Return the Google Sheets DATE and TIME formula string
    return `=TIME(${hours},${minutes},${seconds})`;
}

function convertToGoogleSheetsDuration(milliseconds) {
    if (typeof milliseconds !== 'number' || milliseconds < 0) {
        throw new Error('Input must be a non-negative number representing milliseconds');
    }

    // Convert milliseconds to hours, minutes, and seconds
    const hours = Math.floor(milliseconds / 3600000); // 1 hour = 3600000 milliseconds
    milliseconds %= 3600000;
    const minutes = Math.floor(milliseconds / 60000); // 1 minute = 60000 milliseconds
    milliseconds %= 60000;
    const seconds = Math.floor(milliseconds / 1000); // 1 second = 1000 milliseconds

    // Return the Google Sheets TIME formula string
    return `=TIME(${hours},${minutes},${seconds})`;
}

module.exports = { 
  appendToSheet, 
  createReport,
  convertToGoogleSheetsDate, 
  convertToGoogleSheetsTime, 
  convertToGoogleSheetsDuration 
};
