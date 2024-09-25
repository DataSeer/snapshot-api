// File: src/config.js
const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'your_jwt_secret_key',
  genshareConfigPath: path.join(__dirname, '../conf/genshare.json'),
  usersPath: path.join(__dirname, '../conf/users.json')
};
