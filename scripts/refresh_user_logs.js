// File: scripts/refresh_user_logs.js
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { getAllGenshareRequestsFiles, getGenshareResponseFile } = require('../src/utils/s3Storage');
const { buildUserLogRowData, getUserLogHeaders, filterAndSortResponseForUser } = require('../src/utils/genshareManager');
const { getUserById, getAllUsers } = require('../src/utils/userManager');
const config = require('../src/config');

// Load the genshare configuration
const genshareConfig = require(config.genshareConfigPath);

/**
 * Process a single request and generate CSV row data for user-specific logs
 * @param {Object} requestFile - Request file data from S3
 * @param {Object} user - User object with configuration
 * @returns {Promise<Array|null>} - CSV row data or null if user sheets not enabled
 */
const processRequestForUserCSV = async (requestFile, user) => {
  try {
    const { userId, requestId, content, lastModified } = requestFile;
    
    // Check if this request belongs to the user we're processing
    if (userId !== user.id) {
      return null;
    }
    
    // Check if user has Google Sheets logging enabled
    if (!user.googleSheets || !user.googleSheets.enabled) {
      return null;
    }
    
    // Initialize default values
    let genshareVersion = "unknown";
    let filename = "N/A";
    let reportVersion = "";
    let graphValue = "";
    let reportURL = "";
    let filteredData = [];
    
    // Extract basic info from request content
    if (content) {
      filename = content.file?.originalname || content.filename || "N/A";
      genshareVersion = content.genshareVersion || genshareConfig.defaultVersion;
      reportVersion = content.report || "";
      graphValue = content.editorial_policy || "";
    }
    
    // Try to get GenShare response data
    try {
      const genshareResponse = await getGenshareResponseFile(userId, requestId);
      
      if (genshareResponse && genshareResponse.data && genshareResponse.data.response) {
        const responseData = genshareResponse.data.response;
        
        // Update version if we got it from response
        if (genshareResponse.data.version) {
          genshareVersion = genshareResponse.data.version;
        }
        
        // Get graph value from response if available
        if (genshareResponse.data.graph_policy_traversal_data?.graph_type) {
          graphValue = genshareResponse.data.graph_policy_traversal_data.graph_type;
        }
        
        // Apply user-specific filtering to the response using centralized function
        filteredData = filterAndSortResponseForUser(responseData, user);
        
        // Add report_link if available (check in response data)
        const reportLinkItem = responseData.find(item => item.name === "report_link");
        if (reportLinkItem) {
          reportURL = reportLinkItem.value || "";
        }
      }
    } catch (responseError) {
      console.warn(`Could not access response file for ${requestId}: ${responseError.message}`);
      // Continue with empty filtered data
    }
    
    // Calculate request date
    const requestDate = new Date(lastModified);
    
    // Use the centralized buildUserLogRowData function
    const csvRow = buildUserLogRowData({
      requestId,
      date: requestDate,
      filename,
      genshareVersion,
      reportVersion,
      reportURL,
      graphValue,
      filteredData
    });
    
    // Sanitize all values and return
    return {
      row: csvRow.map(sanitizeCSVValue),
      filteredData // Return filtered data for header generation
    };
    
  } catch (error) {
    console.error(`Error processing request ${requestFile.requestId} for user ${user.id}:`, error);
    
    // Return error row
    const requestDate = new Date(requestFile.lastModified);
    const errorRow = buildUserLogRowData({
      requestId: requestFile.requestId,
      date: requestDate,
      filename: "N/A",
      genshareVersion: "unknown",
      reportVersion: "",
      reportURL: "",
      graphValue: "",
      filteredData: []
    });
    
    return {
      row: errorRow.map(sanitizeCSVValue),
      filteredData: []
    };
  }
};

/**
 * Safely convert any value to a CSV-safe string
 * @param {any} value - Value to convert
 * @returns {string} - CSV-safe string
 */
const sanitizeCSVValue = (value) => {
  if (value === null || value === undefined) {
    return '';
  }
  
  // Convert to string
  let stringValue = String(value);
  
  // Handle arrays by joining with newlines
  if (Array.isArray(value)) {
    stringValue = value.map(item => String(item || '')).join('\n');
  }
  
  // Handle objects by converting to JSON string
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    try {
      stringValue = JSON.stringify(value);
    } catch (e) {
      stringValue = '[Object]';
    }
  }
  
  // Trim whitespace
  stringValue = stringValue.trim();
  
  return stringValue;
};

/**
 * Convert array data to CSV format using Papa Parse
 * @param {Array} data - 2D array of data
 * @returns {string} - CSV string
 */
const arrayToCSV = (data) => {
  try {
    return Papa.unparse(data, {
      quotes: true,
      quoteChar: '"',
      escapeChar: '"',
      delimiter: ",",
      header: false,
      newline: "\n",
      skipEmptyLines: false
    });
  } catch (error) {
    console.error('Error converting to CSV:', error);
    // Fallback to manual CSV generation
    return data.map(row => 
      row.map(cell => {
        const cellStr = String(cell || "");
        return `"${cellStr.replace(/"/g, '""')}"`;
      }).join(',')
    ).join('\n');
  }
};

/**
 * Get all users that have Google Sheets logging enabled
 * @returns {Array} - Array of user objects with Google Sheets enabled
 */
const getUsersWithSheetsEnabled = () => {
  const allUsers = getAllUsers();
  const enabledUsers = [];
  
  for (const [userId, userData] of Object.entries(allUsers)) {
    if (userData.googleSheets && userData.googleSheets.enabled) {
      enabledUsers.push({
        id: userId,
        ...userData
      });
    }
  }
  
  return enabledUsers;
};

/**
 * Refresh logs for a specific user
 * @param {Object} user - User object
 * @param {Array} requestFiles - All request files from S3
 * @param {string} outputDir - Output directory path
 * @returns {Promise<Object>} - Processing result
 */
const refreshLogsForUser = async (user, requestFiles, outputDir) => {
  console.log(`\nProcessing logs for user: ${user.id}`);
  
  // Filter request files for this user
  const userRequestFiles = requestFiles.filter(rf => rf.userId === user.id);
  console.log(`  Found ${userRequestFiles.length} request files for user ${user.id}`);
  
  if (userRequestFiles.length === 0) {
    console.log(`  No requests found for user ${user.id}. Skipping.`);
    return {
      userId: user.id,
      totalFiles: 0,
      processed: 0,
      errors: 0,
      skipped: true
    };
  }
  
  // Process each request file for this user
  const csvRows = [];
  let processedCount = 0;
  let errorCount = 0;
  let sampleFilteredData = null; // To generate headers
  
  for (const requestFile of userRequestFiles) {
    try {
      const result = await processRequestForUserCSV(requestFile, user);
      
      if (result) {
        csvRows.push(result.row);
        processedCount++;
        
        // Keep track of filtered data for header generation
        if (!sampleFilteredData && result.filteredData && result.filteredData.length > 0) {
          sampleFilteredData = result.filteredData;
        }
      }
      
      // Log progress every 50 files
      if (processedCount % 50 === 0) {
        console.log(`  Processed ${processedCount}/${userRequestFiles.length} files...`);
      }
    } catch (error) {
      errorCount++;
      console.error(`  Failed to process ${requestFile.requestId}:`, error.message);
    }
  }
  
  console.log(`  Processing complete. Processed: ${processedCount}, Errors: ${errorCount}`);
  
  if (csvRows.length === 0) {
    console.log(`  No data to export for user ${user.id}. Skipping CSV generation.`);
    return {
      userId: user.id,
      totalFiles: userRequestFiles.length,
      processed: processedCount,
      errors: errorCount,
      skipped: true
    };
  }
  
  // Generate headers using centralized function with sample filtered data
  const headers = getUserLogHeaders(sampleFilteredData);
  
  // Add headers to the beginning of data
  const csvData = [headers, ...csvRows];
  
  // Convert to CSV format
  const csvContent = arrayToCSV(csvData);
  
  // Create user-specific output directory
  const userOutputDir = path.join(outputDir, user.id);
  if (!fs.existsSync(userOutputDir)) {
    fs.mkdirSync(userOutputDir, { recursive: true });
  }
  
  // Write CSV file
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFile = path.join(userOutputDir, `user_logs_${user.id}_${timestamp}.csv`);
  
  fs.writeFileSync(outputFile, csvContent, 'utf8');
  
  console.log(`  CSV file generated: ${outputFile}`);
  console.log(`  Total rows: ${csvData.length} (including header)`);
  console.log(`  File size: ${Math.round(fs.statSync(outputFile).size / 1024)} KB`);
  
  return {
    userId: user.id,
    totalFiles: userRequestFiles.length,
    processed: processedCount,
    errors: errorCount,
    skipped: false,
    csvFile: outputFile,
    csvRows: csvData.length,
    sheetConfig: {
      spreadsheetId: user.googleSheets.spreadsheetId,
      sheetName: user.googleSheets.sheetName
    }
  };
};

/**
 * Main function to refresh user-specific logs from S3 data
 * @param {string|null} specificUserId - Optional specific user ID to process
 */
const refreshUserLogs = async (specificUserId = null) => {
  try {
    console.log('Starting user logs refresh from S3...');
    
    // Get users with Google Sheets enabled
    let usersToProcess;
    
    if (specificUserId) {
      const user = getUserById(specificUserId);
      if (!user) {
        console.error(`User "${specificUserId}" not found.`);
        return;
      }
      if (!user.googleSheets || !user.googleSheets.enabled) {
        console.error(`User "${specificUserId}" does not have Google Sheets logging enabled.`);
        return;
      }
      usersToProcess = [{ id: specificUserId, ...user }];
    } else {
      usersToProcess = getUsersWithSheetsEnabled();
    }
    
    console.log(`Found ${usersToProcess.length} user(s) with Google Sheets logging enabled`);
    
    if (usersToProcess.length === 0) {
      console.log('No users with Google Sheets logging enabled. Exiting.');
      return;
    }
    
    // Get all GenShare request files from S3
    const requestFiles = await getAllGenshareRequestsFiles();
    console.log(`Found ${requestFiles.length} total request files in S3`);
    
    if (requestFiles.length === 0) {
      console.log('No request files found. Exiting.');
      return;
    }
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, '../output/user_logs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Process logs for each user
    const results = [];
    
    for (const user of usersToProcess) {
      const result = await refreshLogsForUser(user, requestFiles, outputDir);
      results.push(result);
    }
    
    // Generate summary
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const summary = {
      generated_at: new Date().toISOString(),
      total_users_processed: usersToProcess.length,
      total_request_files_in_s3: requestFiles.length,
      user_results: results
    };
    
    const summaryFile = path.join(outputDir, `user_logs_summary_${timestamp}.json`);
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8');
    
    console.log('\n=== Summary ===');
    console.log(`Total users processed: ${results.length}`);
    console.log(`Summary file generated: ${summaryFile}`);
    
    // Print per-user summary
    for (const result of results) {
      if (result.skipped) {
        console.log(`  ${result.userId}: Skipped (no data)`);
      } else {
        console.log(`  ${result.userId}: ${result.processed} rows exported to ${result.csvFile}`);
      }
    }
    
  } catch (error) {
    console.error('Error refreshing user logs:', error);
    throw error;
  }
};

// Export functions for testing
module.exports = {
  refreshUserLogs,
  processRequestForUserCSV,
  getUsersWithSheetsEnabled,
  refreshLogsForUser,
  arrayToCSV,
  sanitizeCSVValue
};

// Run if called directly
if (require.main === module) {
  // Check for command line argument for specific user
  const args = process.argv.slice(2);
  const specificUserId = args[0] || null;
  
  if (specificUserId) {
    console.log(`Running for specific user: ${specificUserId}`);
  }
  
  refreshUserLogs(specificUserId);
}
