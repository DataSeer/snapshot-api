// File: src/utils/requestsManager.js
const dbManager = require('./dbManager');
const { getAllRequestsFiles } = require('./s3Storage');

/**
 * Initialize database
 * @returns {Promise<void>}
 */
const initDatabase = async () => {
  await dbManager.initDatabase();
};

/**
 * Refresh all requests from S3
 * @returns {Promise<boolean>} - True if refresh successful
 */
const refreshRequestsFromS3 = async () => {
  try {
    console.log("Starting refreshRequestsFromS3...");
    
    // Get all options files from S3
    const requestsFiles = await getAllRequestsFiles();
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
    
    for (const file of requestsFiles) {
      if (file.content && file.content.article_id) {
        try {
          // Format the date for record
          const formattedDate = file.lastModified instanceof Date
            ? file.lastModified.toISOString().replace('T', ' ').split('.')[0]
            : new Date(file.lastModified).toISOString().replace('T', ' ').split('.')[0];
            
          // We'll add to the database without clearing it first
          // to preserve any tokens that might exist
          await dbManager.addOrUpdateRequest(
            file.userId, 
            file.content.article_id, 
            file.requestId,
            formattedDate
          );
          
          insertedCount++;
        } catch (error) {
          console.error(`Exception processing file ${file.requestId}:`, error);
          errorCount++;
        }
      }
    }
    
    console.log(`Inserted/updated ${insertedCount} records, Errors: ${errorCount}`);
    
    return true;
  } catch (error) {
    console.error('Error refreshing requests from S3:', error);
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
  
  return await dbManager.addOrUpdateRequest(userName, articleId, requestId, formattedDate);
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

module.exports = {
  initDatabase,
  refreshRequestsFromS3,
  addOrUpdateRequest,
  deleteRequest,
  getRequestIdByArticleId,
  getArticleIdByRequestId,
  getRequestIdsByArticleId
};
