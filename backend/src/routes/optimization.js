const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { runScheduledOptimization, runManualOptimizationForUser } = require('../services/schedulerService');
const { sendNotification } = require('../services/notificationService');

const router = express.Router();

/**
 * POST /api/optimization/run-now
 * Triggers an immediate optimization scan across all active Azure connections for the authenticated tenant.
 */
router.post('/optimization/run-now', authenticateToken, async (req, res) => {
  try {
    const result = await runManualOptimizationForUser(req.user.id);
    return res.json(result);
  } catch (error) {
    if (error.statusCode === 400 || error.code === 'NO_ACTIVE_CONNECTIONS') {
      return res.status(400).json({
        error: 'NO_ACTIVE_CONNECTIONS',
        message: error.message
      });
    }
    console.error('[MANUAL-OPTIMIZATION] Scan error:', error.message);
    return res.status(500).json({
      error: 'OPTIMIZATION_SCAN_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/scheduler/run-now
 * Triggers a global multi-tenant optimization scan protected by advisory locks (Admin restricted).
 */
router.get('/scheduler/run-now', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    console.log('[SCHEDULER] Manual optimization scan triggered via /api/scheduler/run-now');
    await runScheduledOptimization();
    return res.json({
      status: 'SUCCESS',
      message: 'Optimization scan executed successfully.',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      status: 'ERROR',
      message: 'Failed to execute manual optimization scan.',
      details: error.message
    });
  }
});

/**
 * GET /api/notifications/test
 * Sends a diagnostic test notification via Gmail API to the authenticated admin's email address.
 */
router.get('/notifications/test', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  const targetEmail = req.user && req.user.email ? req.user.email : null;

  if (!targetEmail) {
    return res.status(400).json({
      status: 'FAILED',
      message: 'Target recipient email address could not be resolved from authenticated user session.'
    });
  }

  const result = await sendNotification({
    recipientEmail: targetEmail,
    vmName: 'test-vm-diagnostics',
    action: 'START',
    status: 'SUCCESS',
    cpuAverage: null,
    reason: 'Manual admin test notification triggered via /api/notifications/test',
    timestamp: new Date().toISOString()
  });

  if (result.success) {
    return res.json({
      success: true,
      provider: 'gmail-api',
      message: `Test email notification sent successfully via Gmail API to ${targetEmail}.`,
      messageId: result.messageId,
      recipient: targetEmail,
      timestamp: new Date().toISOString()
    });
  } else {
    return res.status(500).json({
      status: 'FAILED',
      message: `Failed to send test email notification: ${result.error || result.reason}`,
      recipient: targetEmail
    });
  }
});

module.exports = router;
