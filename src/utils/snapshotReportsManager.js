// File: src/utils/snapshotReportsManager.js
const axios = require('axios');
const config = require('../config');
const { watchConfig } = require('./configWatcher');

// Auto-reloads on file change so edits to conf/reports.json don't require a
// server restart.
const reportsConfig = watchConfig(config.reportsConfigPath, { versions: {} });

/**
 * Create a report using the snapshot-reports service
 * @param {string} reportVersion - Version of the report to create
 * @param {string} requestId - The request ID to use as report_id
 * @param {Object} session - Processing session for logging
 * @returns {Promise<Object>} - Object containing report URL and metadata
 */
const createReport = async (reportVersion, requestId, session) => {
  try {
    const versions = reportsConfig.versions || {};

    if (!versions[reportVersion]) {
      const known = Object.keys(versions);
      throw new Error(
        `Report version '${reportVersion}' not found in conf/reports.json. ` +
          `Add an entry for it under "versions". ` +
          `Currently configured: ${known.length ? known.join(', ') : '(none)'}.`
      );
    }

    const versionConfig = versions[reportVersion];
    const snapshotReportsConfig = versionConfig['snapshot-reports'];

    if (!snapshotReportsConfig) {
      throw new Error(`snapshot-reports configuration not found for version '${reportVersion}'`);
    }

    // Prepare the request payload
    const payload = {
      report_id: requestId,
      report_kind: reportVersion
    };

    session.addLog(`[Reports] Creating snapshot-reports report with kind: ${reportVersion}`);
    session.addLog(`[Reports] URL: ${snapshotReportsConfig.url}`);

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
    session.addLog(`[Reports] Report created successfully: ${reportData.url}`);

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
    session.addLog(`[Reports] Error creating snapshot-reports report: ${error.message}`, 'ERROR');
    console.error('Error creating snapshot-reports report:', error);
    throw error;
  }
};

module.exports = {
  createReport
};
