// File: scripts/manage_users.js
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const configPath = path.join(__dirname, '../src/config.js');
const config = require(configPath);

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

function generateToken(userId) {
  return jwt.sign({ id: userId }, config.jwtSecret);
}

function addUser(userId, rateLimit, genshareSettings = {}) {
  const users = loadUsers();
  if (users[userId]) {
    console.log(`User ${userId} already exists.`);
    return;
  }
  const token = generateToken(userId);
  users[userId] = {
    token,
    rateLimit: rateLimit || { max: 100, windowMs: 15 * 60 * 1000 },
    genshare: {
      authorizedVersions: genshareSettings.authorizedVersions || ['default'],
      defaultVersion: genshareSettings.defaultVersion || 'default',
      availableFields: genshareSettings.availableFields || [],
      restrictedFields: genshareSettings.restrictedFields || []
    }
  };
  saveUsers(users);
  console.log(`User ${userId} added with token: ${token}`);
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
  const newToken = generateToken(userId);
  users[userId].token = newToken;
  saveUsers(users);
  console.log(`Token refreshed for user ${userId}. New token: ${newToken}`);
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
      console.log('  update-limit <userId> <rateLimit>            Update a user\'s rate limit');
      console.log('  update-genshare <userId> <genshareSettings>  Update a user\'s GenShare settings');
      console.log('  list                                         List all users');
      console.log('');
      console.log('Examples:');
      console.log('  node manage_users.js add user123 \'{"max": 200, "windowMs": 900000}\'');
      console.log('  node manage_users.js update-genshare user123 \'{"authorizedVersions": ["default", "v2"], "defaultVersion": "v2"}\'');
      console.log('  node manage_users.js update-genshare user123 \'{"availableFields": ["article_id", "das_presence", "data_url"]}\'');
    }
  }
}

main();
