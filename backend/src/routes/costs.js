const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { cloudReadLimiter } = require('../middleware/rateLimit');
const { getAzureCredentialForUser } = require('../services/azureConnectionResolver');
const { parseQueryOptions } = require('../services/azureVmService');
const {
  fetchSubscriptionMonthToDateCost,
  fetchResourceMonthToDateCost,
  fetchVmPriceDetails,
  calculateVmPotentialSavings
} = require('../services/azureCostService');

const router = express.Router();

/**
 * GET /api/cost/month-to-date
 * Retrieves month-to-date accumulated cost for the active Azure subscription.
 */
router.get('/month-to-date', authenticateToken, cloudReadLimiter, async (req, res) => {
  const { connectionId } = req.query;

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const costData = await fetchSubscriptionMonthToDateCost(
      resolved.subscriptionId,
      resolved.credential,
      { userId: req.user.id, connectionId: resolved.connectionId }
    );
    return res.json(costData);
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

    if (error.statusCode === 429 || error.code === 'COST_DATA_TEMPORARILY_UNAVAILABLE') {
      return res.status(429).json({
        error: 'COST_DATA_TEMPORARILY_UNAVAILABLE',
        message: 'Azure Cost Management is temporarily throttling requests. Please try again shortly.'
      });
    }

    if (error.statusCode === 403 || (error.code && error.code.includes('AuthorizationFailed'))) {
      return res.status(403).json({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Insufficient Azure permissions to access Azure Cost Management API.',
        details: error.message
      });
    }

    if (error.statusCode === 404 || (error.code && error.code.includes('ResourceNotFound'))) {
      return res.status(404).json({
        error: 'SUBSCRIPTION_NOT_FOUND',
        message: 'Subscription not found or scope invalid.',
        details: error.message
      });
    }

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to query Azure Cost Management API';

    return res.status(500).json({
      error: 'AZURE_COST_API_FAILURE',
      message: `Failed to query Azure Cost Management API: ${sanitizedMsg}`,
      details: sanitizedMsg
    });
  }
});

/**
 * GET /api/cost/resource/:resourceGroup/:resourceName
 * Retrieves month-to-date cost breakdown for a specific Azure resource.
 */
router.get('/resource/:resourceGroup/:resourceName', authenticateToken, cloudReadLimiter, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, resourceName } = req.params;

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const costData = await fetchResourceMonthToDateCost(
      resolved.subscriptionId,
      resourceGroup,
      resourceName,
      resolved.credential,
      { userId: req.user.id, connectionId: resolved.connectionId }
    );
    return res.json(costData);
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

    if (error.statusCode === 429 || error.code === 'COST_DATA_TEMPORARILY_UNAVAILABLE') {
      return res.status(429).json({
        error: 'COST_DATA_TEMPORARILY_UNAVAILABLE',
        message: 'Azure Cost Management is temporarily throttling requests. Please try again shortly.'
      });
    }

    if (error.statusCode === 403 || (error.code && error.code.includes('AuthorizationFailed'))) {
      return res.status(403).json({
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Insufficient Azure permissions to access Azure Cost Management API.',
        details: error.message
      });
    }

    if (error.statusCode === 404 || (error.code && error.code.includes('ResourceNotFound'))) {
      return res.status(404).json({
        error: 'RESOURCE_NOT_FOUND',
        message: 'Resource not found or scope invalid.',
        details: error.message
      });
    }

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to query Azure Cost Management API';

    return res.status(500).json({
      error: 'AZURE_COST_API_FAILURE',
      message: `Failed to query Azure Cost Management API: ${sanitizedMsg}`,
      details: sanitizedMsg
    });
  }
});

/**
 * GET /api/cost/vm-price/:resourceGroup/:vmName
 * Retrieves hourly price details for a virtual machine size and region via Azure Retail Prices.
 */
router.get('/vm-price/:resourceGroup/:vmName', authenticateToken, cloudReadLimiter, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const priceResult = await fetchVmPriceDetails(resolved.subscriptionId, resourceGroup, vmName, resolved.credential);

    if (!priceResult.vmSize || !priceResult.region) {
      return res.status(400).json(priceResult);
    }

    return res.json(priceResult);
  } catch (error) {
    if (error.code === 'VM_NOT_FOUND' || error.statusCode === 404) {
      return res.status(404).json({
        error: 'VM_NOT_FOUND',
        message: error.message
      });
    }

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

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to query retail price';

    return res.status(500).json({
      error: 'VM_PRICE_QUERY_FAILURE',
      message: `Failed to query retail price for VM '${vmName}': ${sanitizedMsg}`,
      details: sanitizedMsg
    });
  }
});

/**
 * GET /api/cost/savings/:resourceGroup/:vmName
 * Calculates potential compute savings for an idle virtual machine based on retail rates.
 */
router.get('/savings/:resourceGroup/:vmName', authenticateToken, cloudReadLimiter, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;
  const options = parseQueryOptions(req.query);

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const savingsResult = await calculateVmPotentialSavings(resolved.subscriptionId, resourceGroup, vmName, options, resolved.credential);

    if (savingsResult.error === 'VM_NOT_FOUND') {
      return res.status(404).json(savingsResult);
    }

    return res.json(savingsResult);
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

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to calculate potential savings';

    return res.status(500).json({
      error: 'POTENTIAL_SAVINGS_QUERY_FAILURE',
      message: `Failed to calculate potential savings for VM '${vmName}': ${sanitizedMsg}`,
      details: sanitizedMsg
    });
  }
});

module.exports = router;
