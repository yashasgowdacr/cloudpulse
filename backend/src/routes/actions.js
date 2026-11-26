const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { getActions } = require('../services/actionHistoryService');
const { publicErrorMessage } = require('../utils/http');

const router = express.Router();

/**
 * GET /api/actions
 * Retrieves optimization and power management action audit logs for the authenticated tenant.
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const actions = await getActions(req.user.id);
    return res.json({
      count: actions.length,
      actions
    });
  } catch (error) {
    return res.status(500).json({
      error: 'ACTIONS_FETCH_FAILURE',
      message: publicErrorMessage(error, 'Unable to retrieve action history.')
    });
  }
});

/**
 * GET /api/actions/:vmName
 * Retrieves action audit logs filtered by VM name for the authenticated tenant.
 */
router.get('/:vmName', authenticateToken, async (req, res) => {
  const { vmName } = req.params;
  try {
    const actions = await getActions(req.user.id, vmName);
    return res.json({
      vmName,
      count: actions.length,
      actions
    });
  } catch (error) {
    return res.status(500).json({
      error: 'ACTIONS_FETCH_FAILURE',
      message: publicErrorMessage(error, 'Unable to retrieve action history.')
    });
  }
});

module.exports = router;
