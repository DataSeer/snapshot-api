// File: src/controllers/requestsController.js
const requestsManager = require('../utils/requestsManager');

/**
 * Refresh requests from S3
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const refreshRequests = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    // Refresh requests from S3
    await requestsManager.refreshRequestsFromS3();

    res.json({ 
      message: 'Requests refreshed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error refreshing requests:', error);
    res.status(500).json({ error: 'Failed to refresh requests' });
  }
};

/**
 * Search for requests by article_id or request_id
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const searchRequest = async (req, res) => {
  try {
    const request_id = req.query.request_id || req.body.request_id;
    const article_id = req.query.article_id || req.body.article_id;
    const targetUser = req.query.user || req.body.user; // Optional user parameter
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    // Check if at least one parameter is provided
    if (!article_id && !request_id) {
      return res.status(400).json({ 
        error: 'Either article_id or request_id query parameter is required'
      });
    }

    // Validate request_id format if provided
    if (request_id && !/^[0-9a-f]{32}$/.test(request_id)) {
      return res.status(400).json({ 
        error: 'Invalid request ID format. Must be 32 hexadecimal characters.' 
      });
    }

    // Determine which user to search for
    // If targetUser is provided, search for that user's requests
    // If not provided, search for current user's requests
    const searchUserId = targetUser || currentUserId;

    // Search requests using requestsManager
    const searchResult = await requestsManager.searchRequests(searchUserId, article_id, request_id);

    if (!searchResult) {
      const searchCriteria = [];
      if (request_id) searchCriteria.push(`request_id: ${request_id}`);
      if (article_id) searchCriteria.push(`article_id: ${article_id}`);
      if (targetUser) searchCriteria.push(`user: ${targetUser}`);
      
      return res.status(404).json({ 
        error: 'Request not found',
        searched_for: searchCriteria.join(' and '),
        note: 'Request may not exist or user may not have access'
      });
    }

    // Return the search result
    res.json(searchResult);

  } catch (error) {
    console.error('Error searching requests:', error);
    res.status(500).json({ error: 'Failed to search requests' });
  }
};

/**
 * Get report for a specific request
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const getReportOfRequest = async (req, res) => {
  try {
    const { user: targetUser, requestId } = req.params;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    if (!targetUser) {
      return res.status(400).json({ error: 'User parameter is required' });
    }

    // Validate request_id format
    if (!/^[0-9a-f]{32}$/.test(requestId)) {
      return res.status(400).json({ 
        error: 'Invalid request ID format. Must be 32 hexadecimal characters.' 
      });
    }

    // Get report using requestsManager with the target user
    const reportData = await requestsManager.getRequestReport(targetUser, requestId);

    if (!reportData) {
      return res.status(404).json({ 
        error: 'Report not found',
        request_id: requestId,
        user: targetUser,
        note: 'Report may not exist or user may not have access'
      });
    }

    // Return the complete report data
    res.json(reportData);

  } catch (error) {
    console.error('Error getting report:', error);
    res.status(500).json({ error: 'Failed to get report' });
  }
};

/**
 * Get report URL for a specific request
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const getReportUrlOfRequest = async (req, res) => {
  try {
    const { user: targetUser, requestId } = req.params;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    if (!targetUser) {
      return res.status(400).json({ error: 'User parameter is required' });
    }

    // Validate request_id format
    if (!/^[0-9a-f]{32}$/.test(requestId)) {
      return res.status(400).json({ 
        error: 'Invalid request ID format. Must be 32 hexadecimal characters.' 
      });
    }

    // Get report URL using requestsManager with the target user
    const reportUrl = await requestsManager.getRequestReportUrl(targetUser, requestId);

    if (!reportUrl) {
      return res.status(404).json({ 
        error: 'Report URL not found',
        request_id: requestId,
        user: targetUser,
        note: 'Report may not exist, may not have a URL, or user may not have access'
      });
    }

    // Return only the URL part
    res.json({ 
      report_url: reportUrl,
      request_id: requestId,
      user: targetUser
    });

  } catch (error) {
    console.error('Error getting report URL:', error);
    res.status(500).json({ error: 'Failed to get report URL' });
  }
};

module.exports = {
  refreshRequests,
  searchRequest,
  getReportOfRequest,
  getReportUrlOfRequest
};
