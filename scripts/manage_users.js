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

function addUser(userId, rateLimit) {
  const users = loadUsers();
  if (users[userId]) {
    console.log(`User ${userId} already exists.`);
    return;
  }
  const token = generateToken(userId);
  users[userId] = {
    token,
    rateLimit: rateLimit || { max: 100, windowMs: 15 * 60 * 1000 }
  };
  saveUsers(users);
  console.log(`User ${userId} added with token: ${token}`);
  console.log(`Rate limit: ${JSON.stringify(users[userId].rateLimit)}`);
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

function listUsers() {
  const users = loadUsers();
  console.log('User List:');
  Object.entries(users).forEach(([userId, userData]) => {
    console.log(`- User ID: ${userId}`);
    console.log(`  Token: ${userData.token}`);
    console.log(`  Rate Limit: ${JSON.stringify(userData.rateLimit)}`);
    console.log('---');
  });
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const userId = args[1] || uuidv4();

  switch (command) {
    case 'add':
      const rateLimit = args[2] ? JSON.parse(args[2]) : undefined;
      addUser(userId, rateLimit);
      break;
    case 'remove':
      removeUser(userId);
      break;
    case 'refresh-token':
      refreshToken(userId);
      break;
    case 'update-limit':
      const newRateLimit = JSON.parse(args[2]);
      updateUserRateLimit(userId, newRateLimit);
      break;
    case 'list':
      listUsers();
      break;
    default:
      console.log('Usage: node manage_users.js <command> [userId] [options]');
      console.log('Commands:');
      console.log('  add [userId] [rateLimit]     Add a new user');
      console.log('  remove <userId>              Remove a user');
      console.log('  refresh-token <userId>       Refresh a user\'s token');
      console.log('  update-limit <userId> <rateLimit>  Update a user\'s rate limit');
      console.log('  list                         List all users');
      console.log('');
      console.log('Examples:');
      console.log('  node manage_users.js add user123 \'{"max": 200, "windowMs": 900000}\'');
      console.log('  node manage_users.js refresh-token user123');
      console.log('  node manage_users.js update-limit user123 \'{"max": 300}\'');
  }
}

main();
