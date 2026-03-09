/**
 * Shared test environment setup and config validation
 * Sets NODE_ENV and validates that test config files exist
 */

const fs = require('fs');
const path = require('path');

const CONF_DIR = path.join(__dirname, '../../conf');

/**
 * Required test config files for integration/E2E tests
 * Only S3, users, and permissions need test-specific variants.
 * All other configs use the real production JSON files.
 */
const REQUIRED_TEST_CONFIGS = [
  'aws.s3.test.json',
  'users.test.json',
  'permissions.test.json'
];

/**
 * Set up the test environment variables
 * Call this at the top of integration/E2E test files
 */
function setupTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.NO_DB_REFRESH = 'true';
}

/**
 * Validate that all required test config files exist
 * @param {string[]} [configFiles] - Specific config files to check (defaults to all)
 * @throws {Error} If any required config file is missing
 */
function validateTestConfigs(configFiles = REQUIRED_TEST_CONFIGS) {
  const missing = [];

  for (const file of configFiles) {
    const filePath = path.join(CONF_DIR, file);
    if (!fs.existsSync(filePath)) {
      missing.push(file);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing test config files:\n` +
      missing.map(f => `  - conf/${f}`).join('\n') +
      `\n\nCopy from defaults:\n` +
      missing.map(f => `  cp conf/${f}.default conf/${f}`).join('\n') +
      `\nThen fill in real credentials.`
    );
  }
}

module.exports = {
  CONF_DIR,
  REQUIRED_TEST_CONFIGS,
  setupTestEnv,
  validateTestConfigs
};
