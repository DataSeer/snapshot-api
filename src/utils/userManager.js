// File: src/utils/userManager.js
const fs = require('fs');
const config = require('../config');

const getUserById = (userId) => {
  const users = JSON.parse(fs.readFileSync(config.usersPath, 'utf8'));
  return { id: userId, ...users[userId] };
};

const updateUser = (userId, userData) => {
  const users = JSON.parse(fs.readFileSync(config.usersPath, 'utf8'));
  users[userId] = { id: userId, ...users[userId], ...userData };
  fs.writeFileSync(config.usersPath, JSON.stringify(users, null, 2));
};

module.exports = { getUserById, updateUser };
