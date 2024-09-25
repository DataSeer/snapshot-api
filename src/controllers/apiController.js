// File: src/controllers/apiController.js
exports.getApiRoutes = (req, res) => {
  const routes = [
    { method: 'GET', path: '/api', description: 'Get all available API routes' },
    { method: 'POST', path: '/api/processPDF', description: 'Process a PDF file' },
  ];

  res.json({
    message: 'Available API Routes',
    routes: routes
  });
};
