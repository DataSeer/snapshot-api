/**
 * Test helper for S3 integration tests
 * Provides safety checks and cleanup utilities for the test S3 prefix
 */

const crypto = require('crypto');

/**
 * Validate that the S3 config uses a test prefix
 * Prevents accidental operations on production data
 * @param {Object} s3Config - The S3 configuration object
 * @throws {Error} If s3Folder does not contain "test"
 */
function validateTestPrefix(s3Config) {
  if (!s3Config.s3Folder || !s3Config.s3Folder.toLowerCase().includes('test')) {
    throw new Error(
      `SAFETY CHECK FAILED: s3Folder "${s3Config.s3Folder}" does not contain "test". ` +
      'Integration tests must use a test-specific S3 prefix to prevent data loss. ' +
      'Set s3Folder to "snapshot-api-test" in conf/aws.s3.test.json.'
    );
  }
}

/**
 * Clean up all objects under the test prefix
 * @param {Function} deleteObjectsByPrefix - The S3 delete function
 * @param {string} prefix - The prefix to clean up
 * @returns {Promise<number>} Number of deleted objects
 */
async function cleanupTestPrefix(deleteObjectsByPrefix, prefix) {
  try {
    return await deleteObjectsByPrefix(prefix);
  } catch (error) {
    console.warn(`Warning: Failed to clean up test prefix "${prefix}":`, error.message);
    return 0;
  }
}

/**
 * Generate a unique test request ID to avoid collisions between test runs
 * @returns {string} A unique request ID prefixed with "test-"
 */
function generateTestRequestId() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  return `test-${timestamp}-${random}`;
}

module.exports = {
  validateTestPrefix,
  cleanupTestPrefix,
  generateTestRequestId
};
