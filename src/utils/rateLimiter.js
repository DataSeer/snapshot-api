// File: src/utils/rateLimiter.js
const rateLimit = require('express-rate-limit');
const { getUserById } = require('./userManager');

const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // Default window of 15 minutes
const DEFAULT_MAX = 100; // Default limit when the user has no `max` configured
const DEFAULT_MESSAGE = 'Too many requests, please try again later.';
const TOO_MANY_REQUESTS = 429;

/**
 * Read the rateLimit configuration of the authenticated user.
 * Never throws: an unauthenticated request, or a token whose user has been
 * removed from users.json, falls back to the default limits instead of a 500.
 * @param {Object} req - Express request
 * @returns {Object} The user's rateLimit object, or {} when unavailable
 */
const getUserRateLimit = (req) => {
  if (!req.user || !req.user.id) return {};

  try {
    return getUserById(req.user.id).rateLimit || {};
  } catch (error) {
    return {};
  }
};

/**
 * Resolve the max number of requests allowed for this request.
 * `max: 0` is a valid value meaning "no request allowed", so it must not be
 * confused with "not configured" — hence Number.isFinite() rather than `||`.
 * @param {Object} req - Express request
 * @returns {number} The max number of requests allowed in the window
 */
const resolveMax = (req) => {
  const { max } = getUserRateLimit(req);
  return Number.isFinite(max) ? max : DEFAULT_MAX;
};

/**
 * Rate limiting is disabled for the user (unlimited requests).
 * @param {Object} req - Express request
 * @returns {boolean} True when the user opted out of rate limiting
 */
const isRateLimitDisabled = (req) => getUserRateLimit(req).windowMs === 0;

/**
 * Resolve the message returned to the user when the limit is reached.
 * @param {Object} req - Express request
 * @param {string} fallback - Message to use when the user defines none
 * @returns {string} The message to send
 */
const resolveMessage = (req, fallback) => getUserRateLimit(req).message || fallback;

/**
 * Reject every request of a user configured with `max: 0`.
 *
 * express-rate-limit v5 skips its own limit check when max is falsy
 * (`if (max && current > max)`), so a max of 0 would let every request through.
 * This guard runs before the limiter and answers 429 itself, mirroring the
 * headers the limiter sets so both paths look identical to the client.
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 * @returns {*} Express response or next()
 */
const blockZeroMax = (req, res, next) => {
  if (isRateLimitDisabled(req)) return next();
  if (resolveMax(req) !== 0) return next();

  if (!res.headersSent) {
    const resetTime = new Date(Date.now() + DEFAULT_WINDOW_MS);
    res.setHeader('X-RateLimit-Limit', 0);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('Date', new Date().toUTCString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime.getTime() / 1000));
    res.setHeader('Retry-After', Math.ceil(DEFAULT_WINDOW_MS / 1000));
  }

  return res.status(TOO_MANY_REQUESTS).send(resolveMessage(req, DEFAULT_MESSAGE));
};

const limiter = rateLimit({
  windowMs: DEFAULT_WINDOW_MS,
  max: resolveMax,
  message: DEFAULT_MESSAGE,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user ? req.user.id : req.ip,
  handler: (req, res, next, options) => {
    res.status(options.statusCode).send(resolveMessage(req, options.message));
  },
  skip: isRateLimitDisabled
});

/**
 * Per-user rate limiter.
 * `windowMs: 0` disables rate limiting, `max: 0` blocks every request,
 * anything else is limited to `max` requests per window.
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next middleware
 * @returns {*} Express response or next()
 */
const customRateLimiter = (req, res, next) =>
  blockZeroMax(req, res, (error) => error ? next(error) : limiter(req, res, next));

module.exports = customRateLimiter;
