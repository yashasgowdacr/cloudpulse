const express = require('express');

const router = express.Router();

/**
 * GET /health
 * Public health check endpoint for uptime monitoring and readiness probes.
 */
router.get('/', (req, res) => {
  return res.json({
    status: 'UP',
    message: 'CloudPulse API is running'
  });
});

module.exports = router;
