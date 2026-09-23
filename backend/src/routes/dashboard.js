const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
  getDashboardKpiMetrics,
  getCostTrends,
  getSavingsAnalytics
} = require('../services/dashboardAnalyticsService');

const router = express.Router();

/**
 * GET /api/dashboard/kpis
 * Returns dashboard KPI card data with distinct ACTUAL, ESTIMATED, POTENTIAL, and ESTIMATED AVOIDED COST labeling.
 */
router.get('/kpis', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;
  try {
    const data = await getDashboardKpiMetrics(req.user.id, connectionId, req.query);
    return res.json(data);
  } catch (error) {
    console.error('[DASHBOARD-KPIS] Error retrieving KPIs:', error.message);
    return res.status(500).json({
      error: 'DASHBOARD_KPIS_ERROR',
      message: 'Failed to retrieve dashboard KPI metrics',
      details: error.message
    });
  }
});

/**
 * GET /api/dashboard/trends
 * Returns cost trends across daily spend, subscriptions, and resource groups.
 */
router.get('/trends', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;
  try {
    const data = await getCostTrends(req.user.id, connectionId, req.query);
    return res.json(data);
  } catch (error) {
    console.error('[DASHBOARD-TRENDS] Error retrieving trends:', error.message);
    return res.status(500).json({
      error: 'DASHBOARD_TRENDS_ERROR',
      message: 'Failed to retrieve cost trends',
      details: error.message
    });
  }
});

/**
 * GET /api/dashboard/savings-analytics
 * Returns estimated avoided cost and savings breakdowns.
 */
router.get('/savings-analytics', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;
  try {
    const data = await getSavingsAnalytics(req.user.id, connectionId, req.query);
    return res.json(data);
  } catch (error) {
    console.error('[DASHBOARD-SAVINGS] Error retrieving savings analytics:', error.message);
    return res.status(500).json({
      error: 'SAVINGS_ANALYTICS_ERROR',
      message: 'Failed to retrieve savings analytics',
      details: error.message
    });
  }
});

module.exports = router;
