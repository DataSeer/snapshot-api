// File: src/utils/googleSheets.js
const fs = require('fs');
const { google } = require('googleapis');
const config = require('../config');

// Initialize the Sheets API client
const auth = new google.auth.GoogleAuth({
  keyFile: config.googleSheetsCredentialsPath,
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
 * Persist the logs configuration to disk.
 * The configWatcher will auto-reload the proxy on file change.
 * @param {Object} updatedConfig - The full config object to write
 */
function saveLogsConfig(updatedConfig) {
  fs.writeFileSync(config.googleSheetsLogsConfigPath, JSON.stringify(updatedConfig, null, 2));
}

/**
 * Read the current logs config from disk (bypasses cache to avoid race conditions during writes)
 * @returns {Object} - The current config
 */
function readLogsConfigFromDisk() {
  delete require.cache[require.resolve(config.googleSheetsLogsConfigPath)];
  return require(config.googleSheetsLogsConfigPath);
}

/**
 * Create a Google Drive folder.
 * @param {string} name - Folder name
 * @param {string} parentFolderId - Parent folder ID
 * @returns {Promise<string>} - Google ID of the created folder
 */
async function createDriveFolder(name, parentFolderId) {
  const resource = {
    name,
    mimeType: 'application/vnd.google-apps.folder'
  };
  if (parentFolderId) {
    resource.parents = [parentFolderId];
  }

  const response = await driveService.files.create({
    resource,
    fields: 'id',
    supportsAllDrives: true
  });

  const folderId = response.data.id;

  // Set public reader permissions
  await driveService.permissions.create({
    fileId: folderId,
    supportsAllDrives: true,
    resource: { type: 'anyone', role: 'reader' }
  });

  console.log(`[Google Sheets] Created folder "${name}" (${folderId}) in parent ${parentFolderId || 'root'}`);
  return folderId;
}

/**
 * Ensure a user's Google Drive folder exists inside the main logs folder.
 * If the user has no folderId, creates a new folder and persists the ID.
 * @param {string} userId - The user ID
 * @returns {Promise<string>} - The folder ID
 */
async function ensureUserFolder(userId) {
  // Read from disk to avoid stale proxy data after recent writes
  const currentConfig = readLogsConfigFromDisk();
  if (currentConfig.users?.[userId]?.folderId) {
    return currentConfig.users[userId].folderId;
  }

  if (!currentConfig.folderId) {
    throw new Error(`Cannot create folder for user "${userId}": root folderId is not configured`);
  }

  const folderId = await createDriveFolder(userId, currentConfig.folderId);

  // Persist to config
  const diskConfig = readLogsConfigFromDisk();
  diskConfig.users = diskConfig.users || {};
  diskConfig.users[userId] = diskConfig.users[userId] || {};
  diskConfig.users[userId].folderId = folderId;
  saveLogsConfig(diskConfig);

  return folderId;
}

/**
 * Create a new blank log spreadsheet.
 * @param {string} name - Name for the new spreadsheet
 * @param {string} folderId - Google Drive folder ID to place the file in
 * @returns {Promise<string>} - Google ID of the newly created spreadsheet
 */
async function createLogSpreadsheet(name, folderId) {
  const resource = {
    name,
    mimeType: 'application/vnd.google-apps.spreadsheet'
  };
  if (folderId) {
    resource.parents = [folderId];
  }

  const response = await driveService.files.create({
    resource,
    fields: 'id',
    supportsAllDrives: true
  });

  const newId = response.data.id;

  // Set public writer permissions
  await driveService.permissions.create({
    fileId: newId,
    supportsAllDrives: true,
    resource: { type: 'anyone', role: 'writer' }
  });

  console.log(`[Google Sheets] Created log spreadsheet "${name}" (${newId}) in folder ${folderId || 'root'}`);
  return newId;
}

/**
 * Ensure the genshare log spreadsheet exists.
 * If genshare.spreadsheetId is missing, creates a new one from the template and persists the ID.
 * @returns {Promise<string>} - The spreadsheet ID
 */
async function ensureGenshareSpreadsheet() {
  // Read from disk to avoid stale proxy data after recent writes
  const currentConfig = readLogsConfigFromDisk();
  if (currentConfig.genshare?.spreadsheetId) {
    return currentConfig.genshare.spreadsheetId;
  }

  const name = `Snapshot Logs - Genshare`;
  const newId = await createLogSpreadsheet(name, currentConfig.folderId);

  // Persist to config
  const diskConfig = readLogsConfigFromDisk();
  diskConfig.genshare = diskConfig.genshare || {};
  diskConfig.genshare.spreadsheetId = newId;
  saveLogsConfig(diskConfig);

  return newId;
}

/**
 * Ensure a user's log spreadsheet exists.
 * If the user has no entry or no spreadsheetId, creates a new one from the template and persists the ID.
 * @param {string} userId - The user ID
 * @returns {Promise<string>} - The spreadsheet ID
 */
async function ensureUserSpreadsheet(userId) {
  // Read from disk to avoid stale proxy data after recent writes
  const currentConfig = readLogsConfigFromDisk();
  if (currentConfig.users?.[userId]?.spreadsheetId) {
    return currentConfig.users[userId].spreadsheetId;
  }

  // Ensure user has a folder (creates one inside the main folder if missing)
  const folderId = await ensureUserFolder(userId);
  const name = `Snapshot Logs - ${userId}`;
  const newId = await createLogSpreadsheet(name, folderId);

  // Persist to config
  const diskConfig = readLogsConfigFromDisk();
  diskConfig.users = diskConfig.users || {};
  diskConfig.users[userId] = diskConfig.users[userId] || {};
  diskConfig.users[userId].spreadsheetId = newId;
  saveLogsConfig(diskConfig);

  return newId;
}

/**
 * Get or create a sheet tab in a spreadsheet.
 * If a tab with the given name exists, returns immediately.
 * Otherwise, creates a new blank sheet and optionally writes a header row.
 * @param {string} spreadsheetId - The spreadsheet ID
 * @param {string} sheetName - Desired tab name
 * @param {Array} [headers] - Optional header row to write when creating a new tab
 * @returns {Promise<string>} - The sheet name (same as input)
 */
async function getOrCreateSheet(spreadsheetId, sheetName, headers) {
  // List existing sheets
  const spreadsheet = await sheetsService.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties'
  });

  const sheets = spreadsheet.data.sheets || [];

  // Check if target sheet already exists
  const existing = sheets.find(s => s.properties.title === sheetName);
  if (existing) {
    return sheetName;
  }

  // Create a new blank sheet
  try {
    await sheetsService.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          addSheet: {
            properties: { title: sheetName }
          }
        }]
      }
    });
  } catch (error) {
    // Handle race condition: another request may have created it concurrently
    if (error.message && error.message.includes('already exists')) {
      return sheetName;
    }
    throw error;
  }

  // Write header row if provided
  if (headers && headers.length > 0) {
    await sheetsService.spreadsheets.values.update({
      spreadsheetId,
      range: `'${sheetName}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] }
    });
  }

  return sheetName;
}

/**
 * Appends data to the admin/summary Google Sheet for a specific GenShare version.
 * Tab name is auto-generated: "SnapShot Response (v81.8.8)"
 * Creates the spreadsheet if it doesn't exist yet. Writes headers on new tabs.
 * @param {Array} data - Array of data to append to the sheet
 * @param {string} versionLabel - GenShare version label (e.g., "v81.7.1") used for the tab name
 * @param {Array} [headers] - Header row to write when creating a new tab
 * @returns {Promise<Object>} - Google Sheets API response
 */
async function appendToSheet(data, versionLabel, headers) {
  const spreadsheetId = await ensureGenshareSpreadsheet();

  try {
    // Compute tab name based on the actual GenShare version
    const tabName = `SnapShot Response (${versionLabel})`;

    // Ensure the tab exists (create if needed, write headers on new tabs)
    await getOrCreateSheet(spreadsheetId, tabName, headers);

    const response = await sheetsService.spreadsheets.values.append({
      spreadsheetId,
      range: tabName,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'OVERWRITE',
      requestBody: {
        values: [data]
      }
    });

    return response.data;
  } catch (error) {
    console.error(`Error appending to Google Sheet for version ${versionLabel}:`, error);
    throw error;
  }
}

/**
 * Appends data to a user-specific Google Sheet.
 * Tab name is auto-generated by month: "Snapshot Response - 01/2026"
 * Creates the spreadsheet if it doesn't exist yet. Writes headers on new tabs.
 * @param {Array} data - Array of data to append to the sheet
 * @param {string} userId - The user ID
 * @param {Array} [headers] - Header row to write when creating a new tab
 * @returns {Promise<Object>} - Google Sheets API response
 */
async function appendToUserSheet(data, userId, headers) {
  const spreadsheetId = await ensureUserSpreadsheet(userId);

  try {
    // Compute tab name based on current month
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const tabName = `Snapshot Response - ${month}/${year}`;

    // Ensure the tab exists (create if needed, write headers on new tabs)
    await getOrCreateSheet(spreadsheetId, tabName, headers);

    const response = await sheetsService.spreadsheets.values.append({
      spreadsheetId,
      range: tabName,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'OVERWRITE',
      requestBody: {
        values: [data]
      }
    });

    return response.data;
  } catch (error) {
    console.error(`Error appending to user Google Sheet for "${userId}":`, error);
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
  sheetsService,
  driveService,
  appendToSheet,
  appendToUserSheet,
  getOrCreateSheet,
  createReport,
  createDriveFolder,
  createLogSpreadsheet,
  ensureUserFolder,
  ensureGenshareSpreadsheet,
  ensureUserSpreadsheet,
  saveLogsConfig,
  readLogsConfigFromDisk,
  convertToGoogleSheetsDate,
  convertToGoogleSheetsTime,
  convertToGoogleSheetsDuration
};
