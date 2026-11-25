const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

function clientKey(req) {
  // Route limiters run after authenticateToken, so this prevents one tenant
  // from exhausting the provider allowance for every other tenant.
  return req.user?.id || ipKeyGenerator(req.ip);
}

function createLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    keyGenerator: clientKey,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'TOO_MANY_REQUESTS', message }
  });
}

const cloudReadLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many cloud-provider requests. Please wait a minute and try again.'
});

const cloudMutationLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many infrastructure actions. Please wait 15 minutes and try again.'
});

const connectionValidationLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many connection validation attempts. Please wait 15 minutes and try again.'
});

module.exports = {
  cloudReadLimiter,
  cloudMutationLimiter,
  connectionValidationLimiter
};
