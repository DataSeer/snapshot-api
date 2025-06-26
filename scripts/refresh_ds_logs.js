// File: scripts/refresh_ds_logs.js
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const { getAllGenshareRequestsFiles, getGenshareResponseFile } = require('../src/utils/s3Storage');
const { getPath, getResponse } = require('../src/utils/genshareManager');
const { convertToGoogleSheetsDate, convertToGoogleSheetsTime, convertToGoogleSheetsDuration } = require('../src/utils/googleSheets');
const config = require('../src/config');

// Load the genshare configuration
const genshareConfig = require(config.genshareConfigPath);

/**
 * Process a single request and generate CSV row data
 * @param {Object} requestFile - Request file data from S3
 * @returns {Promise<Array>} - CSV row data
 */
const processRequestForCSV = async (requestFile) => {
  try {
    const { userId, requestId, content, lastModified } = requestFile;
    
    // Initialize default values
    let errorStatus = "No";
    let genshareVersion = "unknown";
    let filename = "N/A";
    let response = [];
    let path = [];
    let sessionDuration = 0;
    let snapshotAPIVersion = "";
    
    // Extract basic info from request content
    if (content) {
      filename = content.file?.originalname || content.filename || "N/A";
      genshareVersion = content.genshareVersion || genshareConfig.defaultVersion;
    }
    
    // Try to get GenShare response data
    try {
      const genshareResponse = await getGenshareResponseFile(userId, requestId);
      
      if (genshareResponse) {
        // Check if there was an error (non-2xx status code)
        if (genshareResponse.status && genshareResponse.status >= 400) {
          errorStatus = `GenShare Error (HTTP ${genshareResponse.status})`;
        }
        
        // Extract response data if available
        if (genshareResponse.data && genshareResponse.data.response) {
          const responseData = genshareResponse.data.response;
          const pathData = genshareResponse.data.path;
          const version = genshareResponse.data.version || genshareVersion;
          
          // Use existing functions to format data for Google Sheets
          response = getResponse(responseData, version);
          path = getPath(pathData, version);
          
          // Update version if we got it from response
          if (genshareResponse.data.version) {
            genshareVersion = genshareResponse.data.version;
          }
        } else {
          // No response data means there was likely an error
          errorStatus = "GenShare Error (No response data)";
        }
      } else {
        // No response file found - there was an error
        errorStatus = "Yes";
      }
    } catch (responseError) {
      // Error accessing response file
      errorStatus = "Yes";
      console.warn(`Could not access response file for ${requestId}: ${responseError.message}`);
    }
    
    // Calculate session info based on timestamps
    const requestDate = new Date(lastModified);
    
    // Generate S3 URL for the request
    const s3Url = `https://s3.console.aws.amazon.com/s3/buckets/${config.s3?.bucketName || 'snapshot-api-dev'}?region=${config.s3?.region || 'us-east-1'}&bucketType=general&prefix=${config.s3?.s3Folder || 'snapshot-api-dev'}/${userId}/${requestId}/`;
    
    // Create CSV row data with proper sanitization
    const csvRow = [
      `=HYPERLINK("${s3Url}","${requestId}")`, // Query ID with S3 link
      sanitizeCSVValue(snapshotAPIVersion),     // Snapshot API version
      sanitizeCSVValue(genshareVersion),        // GenShare version
      sanitizeCSVValue(errorStatus),            // Error status
      sanitizeCSVValue(convertToGoogleSheetsDate(requestDate)), // Date
      sanitizeCSVValue(convertToGoogleSheetsTime(requestDate)), // Time
      sanitizeCSVValue(convertToGoogleSheetsDuration(sessionDuration)), // Session duration
      sanitizeCSVValue(userId),                 // User ID
      sanitizeCSVValue(filename),               // PDF filename or "No file"
      sanitizeCSVValue("")                      // Report URL (empty for now)
    ].concat(response.map(sanitizeCSVValue)).concat(path.map(sanitizeCSVValue));
    
    return csvRow;
    
  } catch (error) {
    console.error(`Error processing request ${requestFile.requestId}:`, error);
    
    // Return error row with sanitization
    const requestDate = new Date(requestFile.lastModified);
    const s3Url = `https://s3.console.aws.amazon.com/s3/buckets/snapshot-api-dev?region=us-east-1&bucketType=general&prefix=snapshot-api-dev/${requestFile.userId}/${requestFile.requestId}/`;
    
    return [
      `=HYPERLINK("${s3Url}","${requestFile.requestId}")`,
      sanitizeCSVValue(""),
      sanitizeCSVValue("unknown"),
      sanitizeCSVValue("Processing Error"),
      sanitizeCSVValue(convertToGoogleSheetsDate(requestDate)),
      sanitizeCSVValue(convertToGoogleSheetsTime(requestDate)),
      sanitizeCSVValue("0"),
      sanitizeCSVValue(requestFile.userId),
      sanitizeCSVValue("N/A"),
      sanitizeCSVValue("")
    ];
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
 * Generate CSV headers based on GenShare version configuration
 * @param {string} version - GenShare version
 * @returns {Array} - CSV headers
 */
const generateCSVHeaders = (version) => {
  const versionConfig = genshareConfig.versions[version] || genshareConfig.versions[genshareConfig.defaultVersion];
  
  const baseHeaders = [
    "Query ID",
    "Snapshot API Version", 
    "GenShare Version",
    "Error",
    "Date",
    "Time", 
    "Duration",
    "User ID",
    "Filename",
    "Report URL"
  ];
  
  // Add response mapping headers
  const responseHeaders = Object.keys(versionConfig.responseMapping?.getResponse || {});
  const pathHeaders = versionConfig.responseMapping?.getPath || [];
  
  return baseHeaders.concat(responseHeaders).concat(pathHeaders);
};

/**
 * Convert array data to CSV format using Papa Parse
 * @param {Array} data - 2D array of data
 * @returns {string} - CSV string
 */
const arrayToCSV = (data) => {
  try {
    return Papa.unparse(data, {
      quotes: true,        // Always quote fields
      quoteChar: '"',      // Use double quotes
      escapeChar: '"',     // Escape quotes with double quotes
      delimiter: ",",      // Use comma as delimiter
      header: false,       // Don't add headers (we handle them manually)
      newline: "\n",       // Use \n for newlines
      skipEmptyLines: false // Keep empty lines
    });
  } catch (error) {
    console.error('Error converting to CSV:', error);
    // Fallback to manual CSV generation
    return data.map(row => 
      row.map(cell => {
        const cellStr = String(cell || "");
        // Always quote fields to be safe with special characters
        return `"${cellStr.replace(/"/g, '""')}"`;
      }).join(',')
    ).join('\n');
  }
};

/**
 * Main function to refresh DS logs from S3 data
 */
const refreshDSLogs = async () => {
  try {
    console.log('Starting DS logs refresh from S3...');
    
    // Get all GenShare request files from S3
    const requestFiles = await getAllGenshareRequestsFiles();
    console.log(`Found ${requestFiles.length} request files in S3`);
    
    if (requestFiles.length === 0) {
      console.log('No request files found. Exiting.');
      return;
    }
    
    // Generate headers (using default version for now)
    const headers = generateCSVHeaders(genshareConfig.defaultVersion);
    console.log(`Generated ${headers.length} CSV headers`);
    
    // Process each request file
    const csvData = [headers]; // Start with headers
    let processedCount = 0;
    let errorCount = 0;
    
    for (const requestFile of requestFiles) {
      try {
        const csvRow = await processRequestForCSV(requestFile);
        csvData.push(csvRow);
        processedCount++;
        
        // Log progress every 100 files
        if (processedCount % 100 === 0) {
          console.log(`Processed ${processedCount}/${requestFiles.length} files...`);
        }
      } catch (error) {
        errorCount++;
        console.error(`Failed to process ${requestFile.requestId}:`, error.message);
      }
    }
    
    console.log(`Processing complete. Processed: ${processedCount}, Errors: ${errorCount}`);
    
    // Convert to CSV format
    const csvContent = arrayToCSV(csvData);
    
    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    // Write CSV file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = path.join(outputDir, `ds_logs_${timestamp}.csv`);
    
    fs.writeFileSync(outputFile, csvContent, 'utf8');
    
    console.log(`CSV file generated successfully: ${outputFile}`);
    console.log(`Total rows: ${csvData.length} (including header)`);
    console.log(`File size: ${Math.round(fs.statSync(outputFile).size / 1024)} KB`);
    
    // Also create a summary file
    const summary = {
      generated_at: new Date().toISOString(),
      total_files_found: requestFiles.length,
      total_processed: processedCount,
      total_errors: errorCount,
      csv_file: path.basename(outputFile),
      csv_rows: csvData.length,
      csv_headers: headers
    };
    
    const summaryFile = path.join(outputDir, `ds_logs_summary_${timestamp}.json`);
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8');
    
    console.log(`Summary file generated: ${summaryFile}`);
    
  } catch (error) {
    console.error('Error refreshing DS logs:', error);
    throw error;
  }
};

// Export functions for testing
module.exports = {
  refreshDSLogs,
  processRequestForCSV,
  generateCSVHeaders,
  arrayToCSV,
  sanitizeCSVValue
};

// Run if called directly
if (require.main === module) {
  refreshDSLogs();
}
