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
  console.log(`Default version: ${genshareConfig.defaultVersion || 'Not set'}`);
  console.log('Available versions:');
  
  if (!genshareConfig.versions || Object.keys(genshareConfig.versions).length === 0) {
    console.log('  No versions configured');
    return;
  }
  
  Object.entries(genshareConfig.versions).forEach(([version, config]) => {
    console.log(`\n- Version: ${version}`);
    console.log(`  Process PDF URL: ${config.processPDF?.url || 'Not set'}`);
    console.log(`  Health URL: ${config.health?.url || 'Not set'}`);
    console.log(`  Google Sheets spreadsheetId: ${config.googleSheets?.spreadsheetId || 'Not set'}`);
    console.log(`  Google Sheets sheetName: ${config.googleSheets?.sheetName || 'Not set'}`);
  });
}

/**
 * Set default GenShare version
 * @param {string} version - Version to set as default
 */
function setDefaultVersion(version) {
  const genshareConfig = loadGenShareConfig();
  
  if (!genshareConfig.versions[version]) {
    console.error(`Version ${version} is not configured. Please add it first.`);
    return;
  }
  
  genshareConfig.defaultVersion = version;
  saveGenShareConfig(genshareConfig);
  console.log(`Default GenShare version set to ${version}`);
}

/**
 * Add a new GenShare version
 * @param {string} version - Version identifier (e.g., v1.0.0)
 * @param {string} processPdfUrl - URL for processing PDFs
 * @param {string} healthUrl - URL for health check
 * @param {string} spreadsheetId - Google Sheets spreadsheet ID
 * @param {string} sheetName - Google Sheets sheet name
 * @param {string} apiKey - API key for GenShare (optional)
 */
function addVersion(version, processPdfUrl, healthUrl, spreadsheetId, sheetName, apiKey = '') {
  if (!isValidVersion(version)) {
    console.error(`Invalid version format: ${version}. Should be in format v1.0.0`);
    return;
  }
  
  const genshareConfig = loadGenShareConfig();
  
  // Check if version already exists
  if (genshareConfig.versions[version]) {
    console.error(`Version ${version} already exists. Use 'update' to modify it.`);
    return;
  }
  
  // Create the base structure for this version
  genshareConfig.versions[version] = {
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
    genshareConfig.defaultVersion = version;
    console.log(`Setting ${version} as the default version.`);
  }
  
  saveGenShareConfig(genshareConfig);
  console.log(`Added GenShare version ${version}`);
}

/**
 * Update an existing GenShare version
 * @param {string} version - Version identifier to update
 * @param {Object} updates - Key-value pairs of properties to update
 */
function updateVersion(version, updates) {
  const genshareConfig = loadGenShareConfig();
  
  if (!genshareConfig.versions[version]) {
    console.error(`Version ${version} does not exist. Use 'add' to create it.`);
    return;
  }
  
  const versionConfig = genshareConfig.versions[version];
  
  // Apply updates
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
  console.log(`Updated GenShare version ${version}`);
}

/**
 * Remove a GenShare version
 * @param {string} version - Version identifier to remove
 */
function removeVersion(version) {
  const genshareConfig = loadGenShareConfig();
  
  if (!genshareConfig.versions[version]) {
    console.error(`Version ${version} does not exist.`);
    return;
  }
  
  // Check if trying to remove the default version
  if (genshareConfig.defaultVersion === version) {
    console.error(`Cannot remove default version. Set a new default version first.`);
    return;
  }
  
  delete genshareConfig.versions[version];
  saveGenShareConfig(genshareConfig);
  console.log(`Removed GenShare version ${version}`);
}

/**
 * Update response mapping for a specific version
 * @param {string} version - Version identifier
 * @param {string} mappingType - Either 'getPath' or 'getResponse'
 * @param {Object} mapping - Mapping object or array
 */
function updateResponseMapping(version, mappingType, mapping) {
  const genshareConfig = loadGenShareConfig();
  
  if (!genshareConfig.versions[version]) {
    console.error(`Version ${version} does not exist.`);
    return;
  }
  
  if (mappingType !== 'getPath' && mappingType !== 'getResponse') {
    console.error(`Invalid mapping type. Use 'getPath' or 'getResponse'.`);
    return;
  }
  
  // Ensure responseMapping object exists
  if (!genshareConfig.versions[version].responseMapping) {
    genshareConfig.versions[version].responseMapping = {};
  }
  
  genshareConfig.versions[version].responseMapping[mappingType] = mapping;
  saveGenShareConfig(genshareConfig);
  console.log(`Updated ${mappingType} mapping for version ${version}`);
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
      if (args.length < 6) {
        console.error('Missing required parameters');
        console.log('Usage: node manage_genshare_versions.js add <version> <processPdfUrl> <healthUrl> <spreadsheetId> <sheetName> [apiKey]');
        return;
      }
      addVersion(args[1], args[2], args[3], args[4], args[5], args[6]);
      break;
    }
      
    case 'update': {
      if (args.length < 3) {
        console.error('Missing required parameters');
        console.log('Usage: node manage_genshare_versions.js update <version> --<field> <value> [--<field> <value> ...]');
        return;
      }
      
      const version = args[1];
      const updates = {};
      
      for (let i = 2; i < args.length; i += 2) {
        if (args[i].startsWith('--')) {
          const field = args[i].substring(2);
          updates[field] = args[i + 1];
        }
      }
      
      updateVersion(version, updates);
      break;
    }
      
    case 'remove':{
      if (args.length < 2) {
        console.error('Missing version parameter');
        console.log('Usage: node manage_genshare_versions.js remove <version>');
        return;
      }
      removeVersion(args[1]);
      break;
    }
      
    case 'set-default': {
      if (args.length < 2) {
        console.error('Missing version parameter');
        console.log('Usage: node manage_genshare_versions.js set-default <version>');
        return;
      }
      setDefaultVersion(args[1]);
      break;
    }
      
    case 'update-mapping': {
      if (args.length < 4) {
        console.error('Missing required parameters');
        console.log('Usage: node manage_genshare_versions.js update-mapping <version> <getPath|getResponse> <jsonMapping>');
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
      console.log('  list                            List all GenShare versions');
      console.log('  add <version> <processPdfUrl> <healthUrl> <spreadsheetId> <sheetName> [apiKey]  Add a new version');
      console.log('  update <version> --<field> <value> [--<field> <value> ...]  Update an existing version');
      console.log('  remove <version>                Remove a version');
      console.log('  set-default <version>          Set the default version');
      console.log('  update-mapping <version> <getPath|getResponse> <jsonMapping>  Update response mapping');
      console.log('');
      console.log('Examples:');
      console.log('  node manage_genshare_versions.js add v2.0.0 "http://localhost:5001/process/pdf" "http://localhost:5001/health" "spreadsheet-id" "Sheet1" "api-key"');
      console.log('  node manage_genshare_versions.js update v2.0.0 --processPdfUrl "http://localhost:5002/process/pdf" --apiKey "new-key"');
      console.log('  node manage_genshare_versions.js set-default v2.0.0');
    }
  }
}

main();
