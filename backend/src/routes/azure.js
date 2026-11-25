const express = require('express');
const { DefaultAzureCredential } = require('@azure/identity');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { cloudReadLimiter, cloudMutationLimiter } = require('../middleware/rateLimit');
const { getAzureCredentialForUser } = require('../services/azureConnectionResolver');
const {
  discoverAzureVms,
  fetchVmCpuMetrics,
  evaluateVmIdleStatus,
  evaluateShutdownPolicy,
  parseQueryOptions,
  executeVmShutdown,
  executeVmStart,
  executeBulkShutdown,
  executeBulkStart
} = require('../services/azureVmService');

const router = express.Router();

/**
 * GET /azure/health
 * Verifies Azure credential and subscription connectivity.
 */
router.get('/health', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

  if (!subscriptionId) {
    return res.status(500).json({
      status: 'DOWN',
      message: 'Azure health check is not configured.'
    });
  }

  try {
    const credential = new DefaultAzureCredential();
    const token = await credential.getToken('https://management.azure.com/.default');

    if (token) {
      return res.json({
        status: 'UP',
        message: 'Azure authentication successful'
      });
    } else {
      return res.status(500).json({
        status: 'DOWN',
        message: 'Failed to acquire Azure token'
      });
    }
  } catch (error) {
    return res.status(500).json({
      status: 'DOWN',
      message: 'Azure authentication failed',
      error: 'Azure health check failed.'
    });
  }
});

/**
 * GET /azure/vms
 * Discovers virtual machines across resource groups in the resolved Azure subscription.
 */
router.get('/vms', authenticateToken, cloudReadLimiter, async (req, res) => {
  const { connectionId } = req.query;

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const vms = await discoverAzureVms(resolved.subscriptionId, resolved.credential);
    const { resolveEffectivePolicy } = require('../services/optimizationPolicyService');

    const enrichedVms = await Promise.all(vms.map(async (vm) => {
      try {
        const policyRes = await resolveEffectivePolicy(req.user.id, vm, vm.tags);
        return {
          ...vm,
          isProtected: policyRes.isProtected,
          protectionReason: policyRes.protectionReason,
          policyExplanation: policyRes.explanation,
          sourceScope: policyRes.sourceScope
        };
      } catch (err) {
        return vm;
      }
    }));

    return res.json({
      count: enrichedVms.length,
      vms: enrichedVms
    });
  } catch (error) {
    if (error.message && error.message.includes('Multiple active Azure connections found')) {
      return res.status(400).json({
        error: 'MULTIPLE_CONNECTIONS_REQUIRED',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('not found') || error.message.includes('not active'))) {
      return res.status(404).json({
        error: 'CONNECTION_NOT_FOUND',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('Invalid Connection ID') || error.message.includes('Invalid User ID'))) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: error.message
      });
    }

    return res.status(500).json({
      error: 'VM_DISCOVERY_FAILURE',
      message: 'Failed to discover virtual machines.'
    });
  }
});

/**
 * GET /azure/vms/:resourceGroup/:vmName/metrics
 * Queries Azure Monitor for Percentage CPU metrics for a specific VM.
 */
router.get('/vms/:resourceGroup/:vmName/metrics', authenticateToken, cloudReadLimiter, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;
  const { timespan } = parseQueryOptions(req.query);

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const metricsData = await fetchVmCpuMetrics(resolved.subscriptionId, resourceGroup, vmName, timespan, resolved.credential);

    return res.json({
      resourceGroup,
      vmName,
      metricName: 'Percentage CPU',
      timespan,
      averageCpuPercentage: metricsData.averageCpuPercentage,
      dataPointsCount: metricsData.dataPointsCount,
      dataPoints: metricsData.dataPoints
    });
  } catch (error) {
    if (error.message && error.message.includes('Multiple active Azure connections found')) {
      return res.status(400).json({
        error: 'MULTIPLE_CONNECTIONS_REQUIRED',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('not found') || error.message.includes('not active'))) {
      return res.status(404).json({
        error: 'CONNECTION_NOT_FOUND',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('Invalid Connection ID') || error.message.includes('Invalid User ID'))) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: error.message
      });
    }

    return res.status(500).json({
      error: 'METRICS_QUERY_FAILURE',
      message: 'Failed to query virtual machine metrics.'
    });
  }
});

/**
 * GET /azure/vms/:resourceGroup/:vmName/idle
 * Evaluates whether a virtual machine is idle based on CPU metrics.
 */
router.get('/vms/:resourceGroup/:vmName/idle', authenticateToken, cloudReadLimiter, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;
  const { windowMinutes, threshold } = parseQueryOptions(req.query);

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const timespan = `PT${windowMinutes}M`;
    const metricsData = await fetchVmCpuMetrics(resolved.subscriptionId, resourceGroup, vmName, timespan, resolved.credential);
    const idleStatus = evaluateVmIdleStatus(vmName, metricsData, threshold, windowMinutes);

    return res.json(idleStatus);
  } catch (error) {
    if (error.message && error.message.includes('Multiple active Azure connections found')) {
      return res.status(400).json({
        error: 'MULTIPLE_CONNECTIONS_REQUIRED',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('not found') || error.message.includes('not active'))) {
      return res.status(404).json({
        error: 'CONNECTION_NOT_FOUND',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('Invalid Connection ID') || error.message.includes('Invalid User ID'))) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: error.message
      });
    }

    return res.status(500).json({
      error: 'IDLE_EVALUATION_FAILURE',
      message: 'Failed to evaluate idle status.'
    });
  }
});

/**
 * GET /azure/vms/:resourceGroup/:vmName/policy
 * Evaluates shutdown policy eligibility for a virtual machine.
 */
router.get('/vms/:resourceGroup/:vmName/policy', authenticateToken, cloudReadLimiter, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;
  const { windowMinutes, threshold, environment, autoShutdown } = parseQueryOptions(req.query);

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const timespan = `PT${windowMinutes}M`;
    const metricsData = await fetchVmCpuMetrics(resolved.subscriptionId, resourceGroup, vmName, timespan, resolved.credential);
    const idleStatus = evaluateVmIdleStatus(vmName, metricsData, threshold, windowMinutes);
    const policyResult = evaluateShutdownPolicy(vmName, idleStatus, environment, autoShutdown);

    return res.json(policyResult);
  } catch (error) {
    if (error.message && error.message.includes('Multiple active Azure connections found')) {
      return res.status(400).json({
        error: 'MULTIPLE_CONNECTIONS_REQUIRED',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('not found') || error.message.includes('not active'))) {
      return res.status(404).json({
        error: 'CONNECTION_NOT_FOUND',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('Invalid Connection ID') || error.message.includes('Invalid User ID'))) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: error.message
      });
    }

    return res.status(500).json({
      error: 'POLICY_EVALUATION_FAILURE',
      message: 'Failed to evaluate shutdown policy.'
    });
  }
});

/**
 * POST /azure/vms/:resourceGroup/:vmName/shutdown
 * Requests deallocation/shutdown of an idle virtual machine.
 */
router.post('/vms/:resourceGroup/:vmName/shutdown', authenticateToken, cloudMutationLimiter, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;
  const options = parseQueryOptions({ ...req.query, ...req.body });

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const result = await executeVmShutdown(resolved.subscriptionId, resourceGroup, vmName, options, resolved.credential, { userId: req.user.id, connectionId: resolved.connectionId });
    return res.json(result);
  } catch (error) {
    if (error.message && error.message.includes('Multiple active Azure connections found')) {
      return res.status(400).json({
        error: 'MULTIPLE_CONNECTIONS_REQUIRED',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('not found') || error.message.includes('not active'))) {
      return res.status(404).json({
        error: 'CONNECTION_NOT_FOUND',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('Invalid Connection ID') || error.message.includes('Invalid User ID'))) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: error.message
      });
    }

    return res.status(500).json({
      error: 'VM_SHUTDOWN_FAILURE',
      message: 'Failed to execute virtual machine shutdown.'
    });
  }
});

/**
 * POST /azure/vms/:resourceGroup/:vmName/start
 * Starts a stopped/deallocated virtual machine.
 */
router.post('/vms/:resourceGroup/:vmName/start', authenticateToken, cloudMutationLimiter, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const result = await executeVmStart(
      resolved.subscriptionId,
      resourceGroup,
      vmName,
      {},
      resolved.credential,
      { userId: req.user.id, connectionId: resolved.connectionId }
    );

    return res.json(result);
  } catch (error) {
    if (error.message && error.message.includes('Multiple active Azure connections found')) {
      return res.status(400).json({
        error: 'MULTIPLE_CONNECTIONS_REQUIRED',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('not found') || error.message.includes('not active'))) {
      return res.status(404).json({
        error: 'CONNECTION_NOT_FOUND',
        message: error.message
      });
    }

    if (error.message && (error.message.includes('Invalid Connection ID') || error.message.includes('Invalid User ID'))) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        message: error.message
      });
    }

    return res.status(500).json({
      error: 'VM_START_FAILURE',
      message: 'Failed to start virtual machine.'
    });
  }
});

/**
 * POST /azure/vms/bulk/deallocate
 * Bulk deallocates a list of virtual machines with per-VM safety evaluation and controlled concurrency.
 */
router.post('/vms/bulk/deallocate', authenticateToken, cloudMutationLimiter, async (req, res) => {
  const { connectionId, vms } = req.body;

  if (!Array.isArray(vms) || vms.length === 0 || vms.length > 25) {
    return res.status(400).json({ error: 'VM_BATCH_INVALID', message: 'Provide between 1 and 25 virtual machines.' });
  }

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);
    if (!resolved.subscriptionId) {
      return res.status(500).json({ error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables' });
    }

    const results = await executeBulkShutdown(
      resolved.subscriptionId,
      vms,
      {},
      resolved.credential,
      { userId: req.user.id, connectionId: resolved.connectionId }
    );

    return res.json(results);
  } catch (error) {
    console.error('[BULK-DEALLOCATE] Error in bulk deallocation:', error.message);
    return res.status(error.statusCode || 500).json({
      error: 'BULK_DEALLOCATE_FAILED',
      message: 'Failed to deallocate the requested virtual machines.'
    });
  }
});

/**
 * POST /azure/vms/bulk/start
 * Bulk starts a list of virtual machines with per-VM handling and controlled concurrency.
 */
router.post('/vms/bulk/start', authenticateToken, cloudMutationLimiter, async (req, res) => {
  const { connectionId, vms } = req.body;

  if (!Array.isArray(vms) || vms.length === 0 || vms.length > 25) {
    return res.status(400).json({ error: 'VM_BATCH_INVALID', message: 'Provide between 1 and 25 virtual machines.' });
  }

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);
    if (!resolved.subscriptionId) {
      return res.status(500).json({ error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables' });
    }

    const results = await executeBulkStart(
      resolved.subscriptionId,
      vms,
      {},
      resolved.credential,
      { userId: req.user.id, connectionId: resolved.connectionId }
    );

    return res.json(results);
  } catch (error) {
    console.error('[BULK-START] Error in bulk start:', error.message);
    return res.status(error.statusCode || 500).json({
      error: 'BULK_START_FAILED',
      message: 'Failed to start the requested virtual machines.'
    });
  }
});

module.exports = router;
