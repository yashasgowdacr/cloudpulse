const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
  createCloudConnection,
  getCloudConnections,
  deleteCloudConnection,
  discoverUnifiedVms
} = require('../services/cloudConnectionService');
const CloudProviderFactory = require('../services/cloud/CloudProviderFactory');

const router = express.Router();

/**
 * GET /api/cloud/providers
 * Returns supported cloud providers and their capabilities.
 */
router.get('/providers', authenticateToken, (req, res) => {
  const providers = CloudProviderFactory.listSupportedProviders();
  return res.json({ providers });
});

/**
 * GET /api/cloud/connections
 * Lists all cloud connections for authenticated user (Azure, AWS, GCP).
 */
router.get('/connections', authenticateToken, async (req, res) => {
  try {
    const connections = await getCloudConnections(req.user.id);
    return res.json({ connections });
  } catch (error) {
    console.error('[CLOUD-CONNECTIONS] Error listing connections:', error.message);
    return res.status(500).json({
      error: 'LIST_CLOUD_CONNECTIONS_FAILED',
      message: error.message
    });
  }
});

/**
 * POST /api/cloud/connections
 * Creates a new cloud connection with encrypted credentials.
 */
router.post('/connections', authenticateToken, async (req, res) => {
  try {
    const connection = await createCloudConnection(req.user.id, req.body);
    return res.status(201).json({
      message: 'Cloud connection created successfully',
      connection
    });
  } catch (error) {
    console.error('[CLOUD-CONNECTIONS] Error creating connection:', error.message);
    return res.status(error.statusCode || 500).json({
      error: 'CREATE_CLOUD_CONNECTION_FAILED',
      message: error.message
    });
  }
});

/**
 * DELETE /api/cloud/connections/:id
 * Deletes a cloud connection.
 */
router.delete('/connections/:id', authenticateToken, async (req, res) => {
  try {
    const result = await deleteCloudConnection(req.user.id, req.params.id);
    return res.json({
      message: 'Cloud connection deleted successfully',
      ...result
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: 'DELETE_CLOUD_CONNECTION_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/cloud/vms
 * Discovers unified virtual machines across all connected cloud providers.
 */
router.get('/vms', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;
  try {
    const vms = await discoverUnifiedVms(req.user.id, connectionId);
    return res.json({
      count: vms.length,
      vms
    });
  } catch (error) {
    console.error('[CLOUD-VMS] Error discovering unified VMs:', error.message);
    return res.status(500).json({
      error: 'DISCOVER_UNIFIED_VMS_FAILED',
      message: error.message
    });
  }
});

module.exports = router;
