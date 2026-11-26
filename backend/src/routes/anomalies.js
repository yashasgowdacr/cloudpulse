const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { publicErrorMessage } = require('../utils/http');
const {
  getAnomalies,
  acknowledgeAnomaly,
  detectAnomaliesForUser
} = require('../services/anomalyDetectionService');

const router = express.Router();

/**
 * GET /api/anomalies
 * Retrieves detected cost anomalies for the authenticated tenant.
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Optionally trigger detection scan on fetch to ensure latest data
    await detectAnomaliesForUser(req.user.id);
    const anomalies = await getAnomalies(req.user.id, req.query);
    return res.json({ anomalies });
  } catch (error) {
    console.error('[ANOMALIES] Error listing anomalies:', error.message);
    return res.status(error.statusCode || 500).json({
      error: 'LIST_ANOMALIES_FAILED',
      message: publicErrorMessage(error, 'Unable to list cost anomalies.')
    });
  }
});

/**
 * POST /api/anomalies/:id/acknowledge
 * Acknowledges a detected cost anomaly.
 */
router.post('/:id/acknowledge', authenticateToken, async (req, res) => {
  try {
    const anomaly = await acknowledgeAnomaly(req.user.id, req.params.id);
    return res.json({
      message: 'Anomaly acknowledged successfully',
      anomaly
    });
  } catch (error) {
    console.error('[ANOMALIES] Error acknowledging anomaly:', error.message);
    return res.status(error.statusCode || 500).json({
      error: 'ACKNOWLEDGE_ANOMALY_FAILED',
      message: publicErrorMessage(error, 'Unable to acknowledge cost anomaly.')
    });
  }
});

module.exports = router;
