// File: src/utils/permissionsManager.js
const fs = require('fs');
const config = require('../config');

/**
 * Get all route permissions
 * @returns {Object} Permissions configuration object
 */
const getPermissions = () => {
  const permissions = JSON.parse(fs.readFileSync(config.permissionsConfigPath, 'utf8'));
  return permissions.routes;
};

/**
 * Update permissions for a specific route and method
 * @param {string} path - The route path
 * @param {string} method - The HTTP method
 * @param {Object} permissionData - The permission data to set
 */
const updatePermissions = (path, method, permissionData) => {
  const permissions = JSON.parse(fs.readFileSync(config.permissionsConfigPath, 'utf8'));
  if (!permissions.routes[path]) {
    permissions.routes[path] = {};
  }
  permissions.routes[path][method] = permissionData;
  fs.writeFileSync(config.permissionsConfigPath, JSON.stringify(permissions, null, 2));
};

/**
 * Normalize URL by removing trailing slash
 * @param {string} url - URL to normalize
 * @returns {string} Normalized URL
 */
const normalizeUrl = (url) => {
  return url === '/' ? url : url.replace(/\/$/, '');
};

/**
 * Check if a user has permission to access a specific route
 * This is a helper function that can be used outside of middleware
 * @param {string} userId - The user ID
 * @param {string} path - The route path
 * @param {string} method - The HTTP method
 * @returns {Object} Result object with isAllowed flag and message
 */
const checkUserPermission = (userId, path, method) => {
  try {
    if (!userId) {
      return {
        isAllowed: false,
        message: "User ID is required"
      };
    }

    const permissionsConfig = getPermissions();
    const normalizedPath = normalizeUrl(path);
    
    // Try direct path match first
    if (permissionsConfig[normalizedPath] && permissionsConfig[normalizedPath][method]) {
      const { allowed, blocked } = permissionsConfig[normalizedPath][method];
      
      if (blocked.includes(userId)) {
        return {
          isAllowed: false,
          message: "Your account is blocked from accessing this resource"
        };
      }
      
      if (allowed.length > 0 && !allowed.includes(userId)) {
        return {
          isAllowed: false,
          message: "Your account is not allowed to access this resource"
        };
      }
      
      return {
        isAllowed: true,
        message: "Access allowed"
      };
    }
    
    // Try to find a matching route with path parameters
    const configuredRoutes = Object.keys(permissionsConfig);
    const matchingRoute = configuredRoutes.find(route => {
      const routeRegex = new RegExp('^' + route.replace(/:\w+/g, '[^/]+') + '$');
      return routeRegex.test(normalizedPath);
    });
    
    if (matchingRoute && permissionsConfig[matchingRoute][method]) {
      const { allowed, blocked } = permissionsConfig[matchingRoute][method];
      
      if (blocked.includes(userId)) {
        return {
          isAllowed: false,
          message: "Your account is blocked from accessing this resource"
        };
      }
      
      if (allowed.length > 0 && !allowed.includes(userId)) {
        return {
          isAllowed: false,
          message: "Your account is not allowed to access this resource"
        };
      }
      
      return {
        isAllowed: true,
        message: "Access allowed"
      };
    }
    
    // If route not found in permissions, we should deny by default
    return {
      isAllowed: false,
      message: "Route not found in permissions configuration"
    };
  } catch (error) {
    console.error('Error checking user permission:', error);
    return {
      isAllowed: false,
      message: "Error checking permissions"
    };
  }
};

module.exports = { 
  getPermissions, 
  updatePermissions,
  normalizeUrl,
  checkUserPermission
};
