// File: scripts/manage_genshare_versions.js
const fs = require('fs');
const path = require('path');
const { isValidVersion } = require('../src/utils/versions');

const configPath = path.join(__dirname, '../src/config.js');
const config = require(configPath);

/**
 * Load GenShare configuration from file
 * @returns {Object} - GenShare configuration
 */
function loadGenShareConfig() {
  try {
    return JSON.parse(fs.readFileSync(config.genshareConfigPath, 'utf8'));
  } catch (error) {
    console.error('Error loading GenShare config:', error);
    return { defaultVersion: 'v1.0.0', versions: {} };
  }
}

/**
 * Save GenShare configuration to file
 * @param {Object} genshareConfig - GenShare configuration to save
 */
function saveGenShareConfig(genshareConfig) {
  fs.writeFileSync(config.genshareConfigPath, JSON.stringify(genshareConfig, null, 2));
}

/**
 * List all configured GenShare versions
 */
function listVersions() {
  const genshareConfig = loadGenShareConfig();
  console.log('GenShare Versions:');
  console.log(`Default version alias: ${genshareConfig.defaultVersion || 'Not set'}`);
  console.log('Available versions:');

  if (!genshareConfig.versions || Object.keys(genshareConfig.versions).length === 0) {
    console.log('  No versions configured');
    return;
  }

  Object.entries(genshareConfig.versions).forEach(([alias, config]) => {
    console.log(`\n- Alias: ${alias}`);
    console.log(`  Version: ${config.version || 'Not set'}`);
    console.log(`  Process PDF URL: ${config.processPDF?.url || 'Not set'}`);
    console.log(`  Health URL: ${config.health?.url || 'Not set'}`);
    console.log(`  Google Sheets spreadsheetId: ${config.googleSheets?.spreadsheetId || 'Not set'}`);
    console.log(`  Google Sheets sheetName: ${config.googleSheets?.sheetName || 'Not set'}`);
  });
}

/**
 * Set default GenShare version alias
 * @param {string} alias - Version alias to set as default (e.g., "latest")
 */
function setDefaultVersion(alias) {
  const genshareConfig = loadGenShareConfig();

  if (!genshareConfig.versions[alias]) {
    console.error(`Version alias "${alias}" is not configured. Please add it first.`);
    return;
  }

  genshareConfig.defaultVersion = alias;
  saveGenShareConfig(genshareConfig);
  console.log(`Default GenShare version alias set to "${alias}"`);
}

/**
 * Add a new GenShare version
 * @param {string} alias - Version alias (e.g., "latest", "previous")
 * @param {string} version - Actual version number (e.g., v1.0.0)
 * @param {string} processPdfUrl - URL for processing PDFs
 * @param {string} healthUrl - URL for health check
 * @param {string} spreadsheetId - Google Sheets spreadsheet ID
 * @param {string} sheetName - Google Sheets sheet name
 * @param {string} apiKey - API key for GenShare (optional)
 */
function addVersion(alias, version, processPdfUrl, healthUrl, spreadsheetId, sheetName, apiKey = '') {
  if (!isValidVersion(version)) {
    console.error(`Invalid version format: ${version}. Should be in format v1.0.0`);
    return;
  }

  const genshareConfig = loadGenShareConfig();

  // Check if alias already exists
  if (genshareConfig.versions[alias]) {
    console.error(`Alias "${alias}" already exists. Use 'update' to modify it.`);
    return;
  }

  // Create the base structure for this version alias
  genshareConfig.versions[alias] = {
    version,
    processPDF: {
      url: processPdfUrl,
      method: 'POST',
      ...(apiKey ? { apiKey } : {})
    },
    health: {
      url: healthUrl,
      method: 'GET'
    },
    googleSheets: {
      spreadsheetId,
      sheetName
    },
    // Copy response mapping from default version or create empty template
    responseMapping: {
      getPath: genshareConfig.versions[genshareConfig.defaultVersion]?.responseMapping?.getPath || [],
      getResponse: genshareConfig.versions[genshareConfig.defaultVersion]?.responseMapping?.getResponse || {}
    }
  };

  // If this is the first version, set it as default
  if (Object.keys(genshareConfig.versions).length === 1) {
    genshareConfig.defaultVersion = alias;
    console.log(`Setting "${alias}" as the default version alias.`);
  }

  saveGenShareConfig(genshareConfig);
  console.log(`Added GenShare version alias "${alias}" (${version})`);
}

/**
 * Update an existing GenShare version
 * @param {string} alias - Version alias to update (e.g., "latest")
 * @param {Object} updates - Key-value pairs of properties to update
 */
function updateVersion(alias, updates) {
  const genshareConfig = loadGenShareConfig();

  if (!genshareConfig.versions[alias]) {
    console.error(`Version alias "${alias}" does not exist. Use 'add' to create it.`);
    return;
  }

  const versionConfig = genshareConfig.versions[alias];

  // Apply updates
  if (updates.version) {
    versionConfig.version = updates.version;
  }

  if (updates.processPdfUrl) {
    versionConfig.processPDF.url = updates.processPdfUrl;
  }

  if (updates.healthUrl) {
    versionConfig.health.url = updates.healthUrl;
  }

  if (updates.apiKey) {
    versionConfig.processPDF.apiKey = updates.apiKey;
  }

  if (updates.spreadsheetId) {
    versionConfig.googleSheets.spreadsheetId = updates.spreadsheetId;
  }

  if (updates.sheetName) {
    versionConfig.googleSheets.sheetName = updates.sheetName;
  }

  saveGenShareConfig(genshareConfig);
  console.log(`Updated GenShare version alias "${alias}"`);
}

/**
 * Remove a GenShare version
 * @param {string} alias - Version alias to remove (e.g., "previous")
 */
function removeVersion(alias) {
  const genshareConfig = loadGenShareConfig();

  if (!genshareConfig.versions[alias]) {
    console.error(`Version alias "${alias}" does not exist.`);
    return;
  }

  // Check if trying to remove the default version
  if (genshareConfig.defaultVersion === alias) {
    console.error(`Cannot remove default version alias. Set a new default version alias first.`);
    return;
  }

  delete genshareConfig.versions[alias];
  saveGenShareConfig(genshareConfig);
  console.log(`Removed GenShare version alias "${alias}"`);
}

/**
 * Update response mapping for a specific version
 * @param {string} alias - Version alias (e.g., "latest")
 * @param {string} mappingType - Either 'getPath' or 'getResponse'
 * @param {Object} mapping - Mapping object or array
 */
function updateResponseMapping(alias, mappingType, mapping) {
  const genshareConfig = loadGenShareConfig();

  if (!genshareConfig.versions[alias]) {
    console.error(`Version alias "${alias}" does not exist.`);
    return;
  }

  if (mappingType !== 'getPath' && mappingType !== 'getResponse') {
    console.error(`Invalid mapping type. Use 'getPath' or 'getResponse'.`);
    return;
  }

  // Ensure responseMapping object exists
  if (!genshareConfig.versions[alias].responseMapping) {
    genshareConfig.versions[alias].responseMapping = {};
  }

  genshareConfig.versions[alias].responseMapping[mappingType] = mapping;
  saveGenShareConfig(genshareConfig);
  console.log(`Updated ${mappingType} mapping for version alias "${alias}"`);
}

/**
 * Main function to handle command line arguments
 */
function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'list':
      listVersions();
      break;

    case 'add': {
      if (args.length < 7) {
        console.error('Missing required parameters');
        console.log('Usage: node manage_genshare_versions.js add <alias> <version> <processPdfUrl> <healthUrl> <spreadsheetId> <sheetName> [apiKey]');
        return;
      }
      addVersion(args[1], args[2], args[3], args[4], args[5], args[6], args[7]);
      break;
    }

    case 'update': {
      if (args.length < 3) {
        console.error('Missing required parameters');
        console.log('Usage: node manage_genshare_versions.js update <alias> --<field> <value> [--<field> <value> ...]');
        return;
      }

      const alias = args[1];
      const updates = {};

      for (let i = 2; i < args.length; i += 2) {
        if (args[i].startsWith('--')) {
          const field = args[i].substring(2);
          updates[field] = args[i + 1];
        }
      }

      updateVersion(alias, updates);
      break;
    }

    case 'remove':{
      if (args.length < 2) {
        console.error('Missing alias parameter');
        console.log('Usage: node manage_genshare_versions.js remove <alias>');
        return;
      }
      removeVersion(args[1]);
      break;
    }

    case 'set-default': {
      if (args.length < 2) {
        console.error('Missing alias parameter');
        console.log('Usage: node manage_genshare_versions.js set-default <alias>');
        return;
      }
      setDefaultVersion(args[1]);
      break;
    }

    case 'update-mapping': {
      if (args.length < 4) {
        console.error('Missing required parameters');
        console.log('Usage: node manage_genshare_versions.js update-mapping <alias> <getPath|getResponse> <jsonMapping>');
        return;
      }
      try {
        const mapping = JSON.parse(args[3]);
        updateResponseMapping(args[1], args[2], mapping);
      } catch (error) {
        console.error('Invalid JSON mapping:', error.message);
      }
      break;
    }

    default: {
      console.log('Usage: node manage_genshare_versions.js <command> [options]');
      console.log('Commands:');
      console.log('  list                            List all GenShare version aliases');
      console.log('  add <alias> <version> <processPdfUrl> <healthUrl> <spreadsheetId> <sheetName> [apiKey]  Add a new version alias');
      console.log('  update <alias> --<field> <value> [--<field> <value> ...]  Update an existing version alias');
      console.log('  remove <alias>                  Remove a version alias');
      console.log('  set-default <alias>             Set the default version alias');
      console.log('  update-mapping <alias> <getPath|getResponse> <jsonMapping>  Update response mapping');
      console.log('');
      console.log('Fields for update: version, processPdfUrl, healthUrl, apiKey, spreadsheetId, sheetName');
      console.log('');
      console.log('Examples:');
      console.log('  node manage_genshare_versions.js add latest v2.0.0 "http://localhost:5001/process/pdf" "http://localhost:5001/health" "spreadsheet-id" "Sheet1" "api-key"');
      console.log('  node manage_genshare_versions.js update latest --version v2.1.0 --processPdfUrl "http://localhost:5002/process/pdf"');
      console.log('  node manage_genshare_versions.js set-default latest');
    }
  }
}

main();
