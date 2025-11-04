// File: src/controllers/snapshotReportsController.js
const { getGenshareResponseFile } = require('../utils/s3Storage');
const { filterAndSortResponseForUser } = require('../utils/genshareManager');
const { getUserById } = require('../utils/userManager');
const requestsManager = require('../utils/requestsManager');

/**
 * Get filtered GenShare response data for a specific request
 * This endpoint is designed to be used by the snapshot-reports service
 * to display data in a GUI with filters applied based on the original user's settings
 * 
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const getGenshareData = async (req, res) => {
  try {
    const { requestId } = req.params;
    const currentUserId = req.user?.id;

    // Validate authentication
    if (!currentUserId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    // Validate request_id format
    if (!/^[0-9a-f]{32}$/.test(requestId)) {
      return res.status(400).json({ 
        error: 'Invalid request ID format. Must be 32 hexadecimal characters.' 
      });
    }

    // First, find which user owns this request by searching across all users
    const searchResult = await requestsManager.searchRequests(null, null, requestId);
    
    if (!searchResult) {
      return res.status(404).json({ 
        error: 'Request not found',
        request_id: requestId,
        note: 'The request ID does not exist in the system'
      });
    }

    const originalUserId = searchResult.user_id;

    // Get the GenShare response file from S3
    const genshareResponseData = await getGenshareResponseFile(originalUserId, requestId);
    
    if (!genshareResponseData) {
      return res.status(404).json({ 
        error: 'GenShare response file not found',
        request_id: requestId,
        user_id: originalUserId,
        note: 'The GenShare response file does not exist for this request'
      });
    }

    // Get the original user's settings to apply proper filtering
    const originalUser = getUserById(originalUserId);
    
    if (!originalUser) {
      return res.status(404).json({ 
        error: 'Original user not found',
        request_id: requestId,
        user_id: originalUserId,
        note: 'Unable to find the user who made the original request'
      });
    }

    // Extract the response data from the GenShare response file
    // The file structure should contain: { status, headers, data: { response: [...] } }
    const responseData = genshareResponseData.data?.response;
    
    if (!responseData) {
      return res.status(404).json({ 
        error: 'No response data found in GenShare file',
        request_id: requestId,
        user_id: originalUserId,
        note: 'The GenShare response file exists but contains no response data'
      });
    }

    // Apply filtering based on the original user's permissions
    const filteredData = filterAndSortResponseForUser(responseData, originalUser);

    // Return the filtered data with metadata
    res.json({
      meta: {
        request_id: requestId,
        original_user_id: originalUserId,
        requesting_user_id: currentUserId,
        article_id: searchResult.article_id,
        has_filters_applied: !!(originalUser.genshare?.availableFields || originalUser.genshare?.restrictedFields),
        created_at: searchResult.meta.created_at,
        updated_at: searchResult.meta.updated_at
      },
      response: filteredData
    });

  } catch (error) {
    console.error('Error getting GenShare data for snapshot-reports:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: 'Failed to retrieve GenShare data'
    });
  }
};

module.exports = {
  getGenshareData
};
