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
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

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

    const response = await sheets.spreadsheets.values.append({
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

module.exports = { appendToSheet, convertToGoogleSheetsDate, convertToGoogleSheetsTime, convertToGoogleSheetsDuration };
