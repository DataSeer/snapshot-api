// File: src/controllers/versionController.js
const packageJson = require('../../package.json');

/**
 * Get current version information
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 */
const getVersions = async (req, res) => {
  try {
    res.json({
      "snapshot-api": `v${packageJson.version}`
    });
  } catch (error) {
    console.error('Error getting version info:', error);
    res.status(500).send('Error retrieving version information');
  }
};

module.exports = {
  getVersions
};
