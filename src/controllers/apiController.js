// File: src/controllers/apiController.js

// Import package.json to get the version
const packageJson = require('../../package.json');

exports.getApiRoutes = (req, res) => {
  const routes = [
    { method: 'GET', path: '/api', description: 'Get all available API routes' },
    { method: 'POST', path: '/api/processPDF', description: 'Process a PDF file' },
  ];

  res.json({
    message: 'Available API Routes',
    routes: routes,
    version: packageJson.version
  });
};
