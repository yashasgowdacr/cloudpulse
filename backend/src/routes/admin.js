const express = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth');
const {
  getPlatformMetrics,
  listTenants,
  getTenantDetails,
  updateTenantStatus
} = require('../services/adminService');

const router = express.Router();

// Strict authorization: All endpoints require valid JWT and ADMIN role
router.use(authenticateToken, requireRole('ADMIN'));

/**
 * GET /api/admin/metrics
 * Returns platform-wide aggregate metrics.
 */
router.get('/metrics', async (req, res) => {
  try {
    const metrics = await getPlatformMetrics();
    return res.json({ metrics });
  } catch (error) {
    console.error('[ADMIN] Error fetching platform metrics:', error.message);
    return res.status(500).json({
      error: 'ADMIN_METRICS_FAILURE',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/tenants
 * Lists tenants with pagination, search, and status filtering.
 */
router.get('/tenants', async (req, res) => {
  try {
    const result = await listTenants(req.query);
    return res.json(result);
  } catch (error) {
    console.error('[ADMIN] Error listing tenants:', error.message);
    return res.status(500).json({
      error: 'LIST_TENANTS_FAILURE',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/tenants/:id
 * Retrieves detailed tenant summary.
 */
router.get('/tenants/:id', async (req, res) => {
  try {
    const details = await getTenantDetails(req.params.id);
    return res.json(details);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: 'TENANT_DETAILS_FAILURE',
      message: error.message
    });
  }
});

/**
 * PATCH /api/admin/tenants/:id/status
 * Suspends or activates a tenant.
 */
router.patch('/tenants/:id/status', async (req, res) => {
  try {
    const updated = await updateTenantStatus(req.params.id, req.body.status, req.user.id);
    return res.json({
      message: `Tenant status successfully updated to ${updated.status}`,
      tenant: updated
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      error: 'UPDATE_STATUS_FAILURE',
      message: error.message
    });
  }
});

module.exports = router;
