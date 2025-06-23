// File: scripts/manage_users.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

// Since this is a script, we need to require paths differently
const configPath = path.join(__dirname, '../src/config.js');
const config = require(configPath);

// Import jwtManager from the correct relative path
const jwtManagerPath = path.join(__dirname, '../src/utils/jwtManager.js');
// We need to ensure the jwtManager can be loaded without database initialization
// So we'll temporarily override the module resolution for dbManager
const originalRequire = module.require;
module.require = function(id) {
  if (id === './dbManager') {
    // Return a mock dbManager with empty functions
    return {
      getValidToken: async () => null,
      storeToken: async () => null,
      revokeToken: async () => true,
      isTokenValid: async () => true,
      cleanupExpiredTokens: async () => 0
    };
  }
  return originalRequire.apply(this, arguments);
};

// Now load the jwtManager
const jwtManager = require(jwtManagerPath);

// Restore original require
module.require = originalRequire;

// Add a direct method to sign a token just for the scripts
jwtManager.signPermanentToken = function(userId) {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ id: userId }, config.jwtSecret);
};

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(config.usersPath, 'utf8'));
  } catch (error) {
    console.error('Error loading users:', error);
    return {};
  }
}

function saveUsers(users) {
  fs.writeFileSync(config.usersPath, JSON.stringify(users, null, 2));
}

function generateClientSecret() {
  return crypto.randomBytes(32).toString('hex');
}

function addUser(userId, rateLimit, genshareSettings = {}) {
  const users = loadUsers();
  if (users[userId]) {
    console.log(`User ${userId} already exists.`);
    return;
  }
  
  // Use jwtManager to generate a permanent token
  const token = jwtManager.signPermanentToken(userId);
  const clientSecret = generateClientSecret();
  
  users[userId] = {
    token,
    client_secret: clientSecret,
    rateLimit: rateLimit || { max: 100, windowMs: 15 * 60 * 1000 },
    genshare: {
      authorizedVersions: genshareSettings.authorizedVersions || ['default'],
      defaultVersion: genshareSettings.defaultVersion || 'default',
      availableFields: genshareSettings.availableFields || [],
      restrictedFields: genshareSettings.restrictedFields || []
    },
    reports: {
      authorizedVersions: [],
      defaultVersion: ''
    }
  };
  saveUsers(users);
  console.log(`User ${userId} added with token: ${token}`);
  console.log(`Client Secret: ${clientSecret}`);
  console.log(`Rate limit: ${JSON.stringify(users[userId].rateLimit)}`);
  console.log(`GenShare settings: ${JSON.stringify(users[userId].genshare)}`);
}

function removeUser(userId) {
  const users = loadUsers();
  if (!users[userId]) {
    console.log(`User ${userId} does not exist.`);
    return;
  }
  delete users[userId];
  saveUsers(users);
  console.log(`User ${userId} removed.`);
}

function refreshToken(userId) {
  const users = loadUsers();
  if (!users[userId]) {
    console.log(`User ${userId} does not exist.`);
    return;
  }
  
  // Use jwtManager to generate a new permanent token
  const newToken = jwtManager.signPermanentToken(userId);
  users[userId].token = newToken;
  saveUsers(users);
  console.log(`Token refreshed for user ${userId}. New token: ${newToken}`);
}

function refreshClientSecret(userId) {
  const users = loadUsers();
  if (!users[userId]) {
    console.log(`User ${userId} does not exist.`);
    return;
  }
  const newClientSecret = generateClientSecret();
  users[userId].client_secret = newClientSecret;
  saveUsers(users);
  console.log(`Client secret refreshed for user ${userId}. New client secret: ${newClientSecret}`);
  
  // Inform about updating the client in the external system that uses this credential
  console.log(`IMPORTANT: Remember to update this client secret in any external system using it.`);
}

function updateUserRateLimit(userId, rateLimit) {
  const users = loadUsers();
  if (!users[userId]) {
    console.log(`User ${userId} does not exist.`);
    return;
  }
  users[userId].rateLimit = { ...users[userId].rateLimit, ...rateLimit };
  saveUsers(users);
  console.log(`Rate limit updated for user ${userId}: ${JSON.stringify(users[userId].rateLimit)}`);
}

function updateUserGenShareSettings(userId, genshareSettings) {
  const users = loadUsers();
  if (!users[userId]) {
    console.log(`User ${userId} does not exist.`);
    return;
  }
  
  // Initialize genshare settings if they don't exist
  if (!users[userId].genshare) {
    users[userId].genshare = {
      authorizedVersions: ['default'],
      defaultVersion: 'default',
      availableFields: [],
      restrictedFields: []
    };
  }
  
  // Update with new settings
  users[userId].genshare = { ...users[userId].genshare, ...genshareSettings };
  
  saveUsers(users);
  console.log(`GenShare settings updated for user ${userId}: ${JSON.stringify(users[userId].genshare)}`);
}

function listUsers() {
  const users = loadUsers();
  console.log('User List:');
  Object.entries(users).forEach(([userId, userData]) => {
    console.log(`- User ID: ${userId}`);
    console.log(`  Token: ${userData.token}`);
    console.log(`  Client Secret: ${userData.client_secret || 'Not set'}`);
    console.log(`  Rate Limit: ${JSON.stringify(userData.rateLimit)}`);
    if (userData.genshare) {
      console.log(`  GenShare Settings:`);
      console.log(`    Versions: ${userData.genshare.authorizedVersions.join(', ')}`);
      console.log(`    Default Version: ${userData.genshare.defaultVersion}`);
      console.log(`    Available Fields: ${userData.genshare.availableFields.length ? userData.genshare.availableFields.join(', ') : 'all'}`);
      console.log(`    Restricted Fields: ${userData.genshare.restrictedFields.length ? userData.genshare.restrictedFields.join(', ') : 'none'}`);
    }
    console.log('---');
  });
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const userId = args[1] || uuidv4();

  switch (command) {
    case 'add': {
      const rateLimit = args[2] ? JSON.parse(args[2]) : undefined;
      const genshareSettings = args[3] ? JSON.parse(args[3]) : undefined;
      addUser(userId, rateLimit, genshareSettings);
      break;
    }
    case 'remove': {
      removeUser(userId);
      break;
    }
    case 'refresh-token': {
      refreshToken(userId);
      break;
    }
    case 'refresh-client-secret': {
      refreshClientSecret(userId);
      break;
    }
    case 'update-limit': {
      const newRateLimit = JSON.parse(args[2]);
      updateUserRateLimit(userId, newRateLimit);
      break;
    }
    case 'update-genshare': {
      const newGenShareSettings = JSON.parse(args[2]);
      updateUserGenShareSettings(userId, newGenShareSettings);
      break;
    }
    case 'list': {
      listUsers();
      break;
    }
    default: {
      console.log('Usage: node manage_users.js <command> [userId] [options]');
      console.log('Commands:');
      console.log('  add [userId] [rateLimit] [genshareSettings]   Add a new user');
      console.log('  remove <userId>                               Remove a user');
      console.log('  refresh-token <userId>                        Refresh a user\'s token');
      console.log('  refresh-client-secret <userId>                Refresh a user\'s client secret');
      console.log('  update-limit <userId> <rateLimit>             Update a user\'s rate limit');
      console.log('  update-genshare <userId> <genshareSettings>   Update a user\'s GenShare settings');
      console.log('  list                                          List all users');
      console.log('');
      console.log('Examples:');
      console.log('  node manage_users.js add user123 \'{"max": 200, "windowMs": 900000}\'');
      console.log('  node manage_users.js update-genshare user123 \'{"authorizedVersions": ["default", "v2"], "defaultVersion": "v2"}\'');
      console.log('  node manage_users.js update-genshare user123 \'{"availableFields": ["article_id", "das_presence", "data_url"]}\'');
      console.log('  node manage_users.js refresh-client-secret user123');
    }
  }
}

main();
