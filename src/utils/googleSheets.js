// File: src/utils/googleSheets.js
const path = require('path');
const { google } = require('googleapis');
// eslint-disable-next-line node/no-unpublished-require
const config = require('../../conf/googleSheets.json');

// Initialize the Sheets API client
const auth = new google.auth.GoogleAuth({
  keyFile: path.join(__dirname, `../../conf/googleSheets.credentials.json`),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

async function appendToSheet(data) {
  try {
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range: config.sheetName,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'OVERWRITE',
      requestBody: {
        values: [data]
      }
    });

    return response.data;
  } catch (error) {
    console.error('Error appending to Google Sheet:', error);
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
