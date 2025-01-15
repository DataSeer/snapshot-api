// File: src/utils/version.js
const semver = require('semver');

const VERSION_REGEX = /^v\d+\.\d+\.\d+$/;

/**
 * Validates a version string
 * @param {string} version - Version string to validate (with 'v' prefix)
 * @returns {boolean} - Whether the version is valid
 */
const isValidVersion = (version) => {
  if (!VERSION_REGEX.test(version)) return false;
  return semver.valid(version.substring(1)) !== null;
};

/**
 * Normalizes a version string by ensuring it has a 'v' prefix
 * @param {string} version - Version string to normalize
 * @returns {string} - Normalized version string
 */
const normalizeVersion = (version) => {
  if (!version) return '';
  version = version.trim();
  if (!version.startsWith('v')) {
    version = `v${version}`;
  }
  return isValidVersion(version) ? version : '';
};

/**
 * Compares two versions
 * @param {string} v1 - First version
 * @param {string} v2 - Second version
 * @returns {number} - -1 if v1 < v2, 0 if v1 = v2, 1 if v1 > v2
 */
const compareVersions = (v1, v2) => {
  if (!isValidVersion(v1) || !isValidVersion(v2)) return 0;
  return semver.compare(
    v1.substring(1),
    v2.substring(1)
  );
};

module.exports = {
  isValidVersion,
  normalizeVersion,
  compareVersions
};
