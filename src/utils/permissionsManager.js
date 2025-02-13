// File: src/utils/permissionsManager.js
const fs = require('fs');
const config = require('../config');

const getPermissions = () => {
  const permissions = JSON.parse(fs.readFileSync(config.permissionsConfigPath, 'utf8'));
  return permissions.routes;
};

const updatePermissions = (path, method, permissionData) => {
  const permissions = JSON.parse(fs.readFileSync(config.permissionsConfigPath, 'utf8'));
  if (!permissions.routes[path]) {
    permissions.routes[path] = {};
  }
  permissions.routes[path][method] = permissionData;
  fs.writeFileSync(config.permissionsConfigPath, JSON.stringify(permissions, null, 2));
};

module.exports = { getPermissions, updatePermissions };
