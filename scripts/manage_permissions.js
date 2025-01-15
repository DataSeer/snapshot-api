// File: scripts/manage_permissions.js
const fs = require('fs');
const path = require('path');

const configPath = path.join(__dirname, '../src/config.js');
const config = require(configPath);

function loadPermissions() {
  try {
    return JSON.parse(fs.readFileSync(config.permissionsConfigPath, 'utf8'));
  } catch (error) {
    console.error('Error loading permissions:', error);
    return { routes: {} };
  }
}

function savePermissions(permissions) {
  fs.writeFileSync(config.permissionsConfigPath, JSON.stringify(permissions, null, 2));
}

function addRoute(path, method, allowed = [], blocked = []) {
  const permissions = loadPermissions();
  if (!permissions.routes[path]) {
    permissions.routes[path] = {};
  }
  if (permissions.routes[path][method]) {
    console.log(`Route ${path} [${method}] already exists.`);
    return;
  }
  permissions.routes[path][method] = { allowed, blocked };
  savePermissions(permissions);
  console.log(`Route ${path} [${method}] added with permissions:`);
  console.log(`Allowed users: ${allowed.length ? allowed.join(', ') : 'none'}`);
  console.log(`Blocked users: ${blocked.length ? blocked.join(', ') : 'none'}`);
}

function removeRoute(path, method) {
  const permissions = loadPermissions();
  if (!permissions.routes[path] || !permissions.routes[path][method]) {
    console.log(`Route ${path} [${method}] does not exist.`);
    return;
  }
  delete permissions.routes[path][method];
  if (Object.keys(permissions.routes[path]).length === 0) {
    delete permissions.routes[path];
  }
  savePermissions(permissions);
  console.log(`Route ${path} [${method}] removed.`);
}

function allowUser(path, method, userId) {
  const permissions = loadPermissions();
  if (!permissions.routes[path]?.[method]) {
    console.log(`Route ${path} [${method}] does not exist.`);
    return;
  }
  const route = permissions.routes[path][method];
  if (!route.allowed.includes(userId)) {
    route.allowed.push(userId);
  }
  if (route.blocked.includes(userId)) {
    route.blocked = route.blocked.filter(id => id !== userId);
  }
  savePermissions(permissions);
  console.log(`User ${userId} allowed on route ${path} [${method}]`);
}

function blockUser(path, method, userId) {
  const permissions = loadPermissions();
  if (!permissions.routes[path]?.[method]) {
    console.log(`Route ${path} [${method}] does not exist.`);
    return;
  }
  const route = permissions.routes[path][method];
  if (!route.blocked.includes(userId)) {
    route.blocked.push(userId);
  }
  if (route.allowed.includes(userId)) {
    route.allowed = route.allowed.filter(id => id !== userId);
  }
  savePermissions(permissions);
  console.log(`User ${userId} blocked from route ${path} [${method}]`);
}

function listRoutes() {
  const permissions = loadPermissions();
  console.log('Routes List:');
  Object.entries(permissions.routes).forEach(([path, methods]) => {
    console.log(`\nPath: ${path}`);
    Object.entries(methods).forEach(([method, perms]) => {
      console.log(`  Method: ${method}`);
      console.log(`  Allowed Users: ${perms.allowed.length ? perms.allowed.join(', ') : 'none'}`);
      console.log(`  Blocked Users: ${perms.blocked.length ? perms.blocked.join(', ') : 'none'}`);
      console.log('  ---');
    });
  });
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'add': {
      const [path, method] = args.slice(1, 3);
      const allowed = args[3] ? JSON.parse(args[3]) : [];
      const blocked = args[4] ? JSON.parse(args[4]) : [];
      addRoute(path, method, allowed, blocked);
      break;
    }
    case 'remove': {
      removeRoute(args[1], args[2]);
      break;
    }
    case 'allow': {
      allowUser(args[1], args[2], args[3]);
      break;
    }
    case 'block': {
      blockUser(args[1], args[2], args[3]);
      break;
    }
    case 'list': {
      listRoutes();
      break;
    }
    default: {
      console.log('Usage: node manage_permissions.js <command> [options]');
      console.log('Commands:');
      console.log('  add <path> <method> [allowed] [blocked]    Add a new route');
      console.log('  remove <path> <method>                     Remove a route');
      console.log('  allow <path> <method> <userId>             Allow user access to route');
      console.log('  block <path> <method> <userId>             Block user from route');
      console.log('  list                                       List all routes');
      console.log('');
      console.log('Examples:');
      console.log('  node manage_permissions.js add /api/data GET \'["user1","user2"]\' \'["user3"]\'');
      console.log('  node manage_permissions.js allow /api/data GET user4');
      console.log('  node manage_permissions.js block /api/data GET user5');
      console.log('  node manage_permissions.js remove /api/data GET');
    }
  }
}

main();
