const crypto = require('crypto');

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'secret',
  'clientsecret',
  'privatekey',
  'encryptionkey',
  'encrypted_client_secret',
  'encrypted_secret',
  'google_client_secret',
  'google_refresh_token',
  'auth_tag',
  'iv'
]);

/**
 * Recursively redacts sensitive values from objects or arrays.
 */
function redactSensitiveData(data, depth = 0) {
  if (depth > 6 || !data) return data;

  if (typeof data === 'string') {
    // Redact secret patterns in string queries if present
    return data.replace(/(clientSecret|password|token|secret)=[^&\s]+/gi, '$1=***');
  }

  if (Array.isArray(data)) {
    return data.map(item => redactSensitiveData(item, depth + 1));
  }

  if (typeof data === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (typeof value === 'object' && value !== null) {
        sanitized[key] = redactSensitiveData(value, depth + 1);
      } else if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes('secret') || lowerKey.includes('token') || lowerKey.includes('password') || lowerKey.includes('key')) {
        sanitized[key] = '***REDACTED***';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  return data;
}

/**
 * Standard structured logger outputting JSON.
 */
const logger = {
  info(message, context = {}) {
    const payload = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message,
      ...redactSensitiveData(context)
    };
    console.log(JSON.stringify(payload));
  },

  warn(message, context = {}) {
    const payload = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      message,
      ...redactSensitiveData(context)
    };
    console.warn(JSON.stringify(payload));
  },

  error(message, error = {}, context = {}) {
    const errorDetails = error instanceof Error
      ? { errorMessage: error.message, errorStack: error.stack, errorCode: error.code || error.statusCode }
      : { errorMessage: String(error) };

    const payload = {
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message,
      ...errorDetails,
      ...redactSensitiveData(context)
    };
    console.error(JSON.stringify(payload));
  }
};

/**
 * Express middleware for request correlation ID and structured request/response logging.
 */
function requestLoggerMiddleware(req, res, next) {
  const reqId = req.headers['x-request-id'] || crypto.randomUUID();
  req.id = reqId;
  res.setHeader('X-Request-Id', reqId);

  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const isError = res.statusCode >= 400;

    const logContext = {
      reqId,
      method: req.method,
      route: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs,
      userId: req.user ? req.user.id : null,
      ip: req.ip || req.headers['x-forwarded-for'] || null
    };

    if (isError) {
      logger.warn(`HTTP ${req.method} ${req.originalUrl} completed with ${res.statusCode}`, logContext);
    } else {
      logger.info(`HTTP ${req.method} ${req.originalUrl} completed with ${res.statusCode}`, logContext);
    }
  });

  next();
}

module.exports = {
  logger,
  redactSensitiveData,
  requestLoggerMiddleware
};
