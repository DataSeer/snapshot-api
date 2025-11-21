// File: src/config.js
const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'your_jwt_secret_key',
  tokenExpiration: process.env.TOKEN_EXPIRATION || 3600, // Default: 1 hour in seconds
  permissionsConfigPath: path.join(__dirname, '../conf/permissions.json'),
  genshareConfigPath: path.join(__dirname, '../conf/genshare.json'),
  grobidConfigPath: path.join(__dirname, '../conf/grobid.json'),
  datastetConfigPath: path.join(__dirname, '../conf/datastet.json'),
  reportsConfigPath: path.join(__dirname, '../conf/reports.json'),
  usersPath: path.join(__dirname, '../conf/users.json'),
  emConfigPath: path.join(__dirname, '../conf/em.json'),
  scholaroneConfigPath: path.join(__dirname, '../conf/scholarone.json'),
  snapshotMailsConfigPath: path.join(__dirname, '../conf/snapshotMails.json'),
  queueManagerConfigPath: path.join(__dirname, '../conf/queueManager.json')
};
