// File: src/controllers/reportsController.js
const { getReportFile } = require('../utils/s3Storage');
const { getRequestIdByArticleId,
  getArticleIdByRequestId
} = require('../utils/requestsManager');

/**
 * Get report by either article_id or request_id
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
module.exports.getReport = async (req, res) => {
  try {
    const { article_id, request_id } = req.query;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User authentication required' });
    }

    // Check if at least one parameter is provided
    if (!article_id && !request_id) {
      return res.status(400).json({ 
        error: 'Either article_id or request_id query parameter is required'
      });
    }

    let finalRequestId = null;
    let associatedArticleId = null;
    let reportData = null;

    // If request_id is provided, try to find it first
    if (request_id) {
      // Validate request_id format (32 hex characters)
      if (!/^[0-9a-f]{32}$/.test(request_id)) {
        return res.status(400).json({ 
          error: 'Invalid request ID format. Must be 32 hexadecimal characters.' 
        });
      }

      // Get the article ID for this request ID
      associatedArticleId = await getArticleIdByRequestId(userId, request_id);
      
      // Try to get the report file
      reportData = await getReportFile(userId, request_id);
      
      if (reportData) {
        finalRequestId = request_id;
      }
    }

    // If no report found by request_id, try article_id
    if (!reportData && article_id) {
      finalRequestId = await getRequestIdByArticleId(userId, article_id);
      
      if (finalRequestId) {
        // Found a request_id for this article_id, try to get the report
        reportData = await getReportFile(userId, finalRequestId);
        associatedArticleId = article_id; // We already know the article_id
      }
    }

    // If still no report found
    if (!reportData) {
      const searchCriteria = [];
      if (request_id) searchCriteria.push(`request_id: ${request_id}`);
      if (article_id) searchCriteria.push(`article_id: ${article_id}`);
      
      return res.status(404).json({ 
        error: 'Report not found',
        searched_for: searchCriteria.join(' and '),
        note: 'Report may not exist or user may not have access'
      });
    }

    // Return the report with metadata
    res.json({
      meta: {
        found_by: finalRequestId === request_id ? 'request_id' : 'article_id',
        request_id: finalRequestId,
        article_id: associatedArticleId,
        user_id: userId,
        search_used: {
          request_id: !!request_id,
          article_id: !!article_id
        }
      },
      ...reportData
    });

  } catch (error) {
    console.error('Error getting report:', error);
    res.status(500).json({ error: 'Failed to get report' });
  }
};
