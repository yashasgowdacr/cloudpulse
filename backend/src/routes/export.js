const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
  exportVmInventory,
  exportActionHistory,
  exportCostData
} = require('../services/exportService');

const router = express.Router();

/**
 * GET /api/export/vms
 * Exports VM Inventory for authenticated user
 */
router.get('/vms', authenticateToken, async (req, res) => {
  try {
    const { connectionId, format = 'csv' } = req.query;
    const result = await exportVmInventory(req.user.id, connectionId, format);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.data);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: 'VM_EXPORT_FAILURE',
      message: error.message
    });
  }
});

/**
 * GET /api/export/actions
 * Exports Action History for authenticated user
 */
router.get('/actions', authenticateToken, async (req, res) => {
  try {
    const { format = 'csv' } = req.query;
    const result = await exportActionHistory(req.user.id, format);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.data);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: 'ACTIONS_EXPORT_FAILURE',
      message: error.message
    });
  }
});

/**
 * GET /api/export/costs
 * Exports Cost Data for authenticated user
 */
router.get('/costs', authenticateToken, async (req, res) => {
  try {
    const { connectionId, format = 'csv' } = req.query;
    const result = await exportCostData(req.user.id, connectionId, format);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.data);
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: 'COSTS_EXPORT_FAILURE',
      message: error.message
    });
  }
});

module.exports = router;
