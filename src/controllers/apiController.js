// File: src/controllers/apiController.js
const packageJson = require('../../package.json');
const { getPermissions } = require('../utils/permissionsManager');

module.exports.getApiRoutes = (req, res) => {
  const permissionsConfig = getPermissions();
  const userId = req.user?.id;

  // Convert permissions config into routes array
  const accessibleRoutes = Object.entries(permissionsConfig).flatMap(([path, methods]) => {
    return Object.entries(methods).map(([method, permissions]) => {
      const { allowed, blocked, description } = permissions;

      // Check if user has access
      if (blocked.includes(userId)) return null;
      if (allowed.length > 0 && !allowed.includes(userId)) return null;

      return {
        method,
        path,
        description: description || 'No description available'
      };
    });
  }).filter(route => route !== null);

  res.json({
    message: 'Available API Routes',
    routes: accessibleRoutes,
    version: packageJson.version
  });
};
