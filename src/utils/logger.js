// File: src/utils/logger.js
const winston = require('winston');
const morgan = require('morgan');
const onHeaders = require('on-headers');

// Create a Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'log/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'log/combined.log' }),
  ],
});

// If we're not in production, log to the console as well
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

// Create a custom Morgan token for logging the user ID from the JWT
morgan.token('user', (req) => {
  if (req.user && req.user.id) {
    return req.user.id;
  }
  return 'unauthenticated';
});

// Create a custom token for request success
morgan.token('success', (req, res) => {
  return res.statusCode < 400 ? 'true' : 'false';
});

// Create a custom token for request duration
morgan.token('duration', (req, res) => {
  return res.locals.duration ? `${res.locals.duration}ms` : '0ms';
});

// Create a custom logging format with duration
const morganFormat = ':remote-addr - :user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :success :duration';

// Middleware to track request duration
const trackDuration = (req, res, next) => {
  const startTime = process.hrtime();
  
  onHeaders(res, () => {
    const diff = process.hrtime(startTime);
    // Convert to milliseconds (1 second = 1e9 nanoseconds)
    res.locals.duration = Math.round((diff[0] * 1e9 + diff[1]) / 1e6);
  });
  
  next();
};

// Create the Morgan middleware with custom logging logic
const httpLogger = morgan(morganFormat, {
  stream: {
    write: (message) => {
      const logObject = {};
      const parts = message.split(' ');
      
      logObject.ip = parts[0];
      logObject.user = parts[2];
      logObject.timestamp = parts[3].replace('[', '') + ' ' + parts[4].replace(']', '');
      logObject.method = parts[5].replace('"', '');
      logObject.url = parts[6];
      logObject.httpVersion = parts[7].replace('"', '');
      logObject.status = parseInt(parts[8]);
      logObject.responseSize = parts[9];
      logObject.referrer = parts[10] + ' ' + parts[11];
      logObject.userAgent = parts.slice(12, -2).join(' ');
      logObject.success = parts[parts.length - 2].trim() === 'true';
      logObject.duration = parts[parts.length - 1].trim();

      // Log all requests, including unauthorized ones
      logger.info('HTTP Request', logObject);
    },
  },
  // Log all requests, including those that may result in errors
  skip: () => false
});

module.exports = { logger, httpLogger, trackDuration };
