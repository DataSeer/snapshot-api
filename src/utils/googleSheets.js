// File: src/utils/googleSheets.js
const path = require('path');
const { google } = require('googleapis');
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
    
    // Return the Google Sheets DATE formula string
    return `=DATE(${year},${month},${day})`;
}

module.exports = { appendToSheet, convertToGoogleSheetsDate };
