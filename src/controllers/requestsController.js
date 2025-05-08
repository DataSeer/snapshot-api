// File: src/controllers/requestsController.js
const { refreshRequestsFromS3 } = require('../utils/requestsManager');

/**
 * Refresh requests from S3
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.refreshRequests = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    // Refresh requests from S3
    await refreshRequestsFromS3();

    res.json({ 
      message: 'Requests refreshed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error refreshing requests:', error);
    res.status(500).json({ error: 'Failed to refresh requests' });
  }
};
