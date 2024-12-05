// middleware/permissions.js
const { getPermissions } = require('../utils/permissionsManager');

const normalizeUrl = (url) => {
    return url === '/' ? url : url.replace(/\/$/, '');
};

exports.checkPermissions = (req, res, next) => {
    const permissionsConfig = getPermissions();
    const path = normalizeUrl(req.path);
    const method = req.method;

    // Check if route exists in permissions config
    if (!permissionsConfig[path]) {
        // Try to find a matching route with path parameters
        const configuredRoutes = Object.keys(permissionsConfig);
        const matchingRoute = configuredRoutes.find(route => {
            const routeRegex = new RegExp('^' + route.replace(/:\w+/g, '[^/]+') + '$');
            return routeRegex.test(path);
        });

        if (!matchingRoute) {
            return res.sendStatus(404);
        }

        // Use the matching route configuration
        const routePermissions = permissionsConfig[matchingRoute][method];
        if (!routePermissions) {
            return res.sendStatus(405);
        }

        const { allowed, blocked } = routePermissions;
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Authentication required" });
        }

        if (blocked.includes(userId)) {
            return res.status(403).json({ message: "Your account is blocked from accessing this resource" });
        }

        if (allowed.length > 0 && !allowed.includes(userId)) {
            return res.status(403).json({ message: "Your account is not allowed to access this resource" });
        }

        return next();
    }

    // Direct route match found
    const routePermissions = permissionsConfig[path][method];
    
    if (!routePermissions) {
        return res.sendStatus(405);
    }

    const { allowed, blocked } = routePermissions;
    const userId = req.user?.id;

    if (!userId) {
        return res.status(401).json({ message: "Authentication required" });
    }

    if (blocked.includes(userId)) {
        return res.status(403).json({ message: "Your account is blocked from accessing this resource" });
    }

    if (allowed.length > 0 && !allowed.includes(userId)) {
        return res.status(403).json({ message: "Your account is not allowed to access this resource" });
    }

    next();
};
