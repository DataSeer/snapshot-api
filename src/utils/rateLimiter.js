// File: src/utils/rateLimiter.js
const rateLimit = require('express-rate-limit');
const { getUserById } = require('./userManager');

const customRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Default window of 15 minutes
  max: (req) => {
    if (req.user) {
      const user = getUserById(req.user.id);
      return user.rateLimit.max || 100; // Default to 100 if not specified
    }
    return 100; // Default limit for unauthenticated requests
  },
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user ? req.user.id : req.ip,
  handler: (req, res, next, options) => {
    if (req.user) {
      const user = getUserById(req.user.id);
      options.message = user.rateLimit.message || options.message;
    }
    res.status(options.statusCode).send(options.message);
  },
  skip: (req) => {
    if (req.user) {
      const user = getUserById(req.user.id);
      return user.rateLimit.windowMs === 0; // Skip rate limiting if windowMs is 0
    }
    return false;
  }
});

module.exports = customRateLimiter;
