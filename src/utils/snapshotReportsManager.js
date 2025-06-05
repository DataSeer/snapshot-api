// File: src/utils/snapshotReportsManager.js
const axios = require('axios');
const config = require('../config');

/**
 * Create a report using the snapshot-reports service
 * @param {string} reportVersion - Version of the report to create
 * @param {string} requestId - The request ID to use as report_id
 * @param {Object} session - Processing session for logging
 * @returns {Promise<Object>} - Object containing report URL and metadata
 */
const createReport = async (reportVersion, requestId, session) => {
  try {
    // Load the reports configuration
    const reportsConfig = require(config.reportsConfigPath);
    
    if (!reportsConfig.versions[reportVersion]) {
      throw new Error(`Report version '${reportVersion}' not found in configuration`);
    }

    const versionConfig = reportsConfig.versions[reportVersion];
    const snapshotReportsConfig = versionConfig['snapshot-reports'];
    
    if (!snapshotReportsConfig) {
      throw new Error(`snapshot-reports configuration not found for version '${reportVersion}'`);
    }

    // Prepare the request payload
    const payload = {
      report_id: requestId,
      report_kind: reportVersion
    };

    session.addLog(`Creating snapshot-reports report with kind: ${reportVersion}`);
    session.addLog(`URL: ${snapshotReportsConfig.url}`);

    // Make the API call to snapshot-reports service
    const response = await axios({
      method: snapshotReportsConfig.method,
      url: snapshotReportsConfig.url,
      data: payload,
      headers: {
        'Content-Type': 'application/json',
        ...(snapshotReportsConfig.apiKey ? { 'Authorization': `Bearer ${snapshotReportsConfig.apiKey}` } : {})
      }
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`snapshot-reports service returned status ${response.status}`);
    }

    if (!response.data.success) {
      throw new Error(`snapshot-reports service returned error: ${response.data.message}`);
    }

    const reportData = response.data.data;
    session.addLog(`snapshot-reports report created successfully: ${reportData.url}`);

    return {
      url: reportData.url,
      token: reportData.token,
      report_id: reportData.report_id,
      report_kind: reportData.report_kind,
      created_at: reportData.created_at,
      expires_at: reportData.expires_at,
      is_new: reportData.is_new
    };

  } catch (error) {
    session.addLog(`Error creating snapshot-reports report: ${error.message}`);
    console.error('Error creating snapshot-reports report:', error);
    throw error;
  }
};

module.exports = {
  createReport
};
