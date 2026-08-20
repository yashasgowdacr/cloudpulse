const express = require('express');
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { encryptSecret } = require('../utils/crypto');

const router = express.Router();

/**
 * Validate standard GUID format (8-4-4-4-12 hex)
 */
function isValidGuid(val) {
  if (!val || typeof val !== 'string') return false;
  const guidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  return guidRegex.test(val.trim());
}

/**
 * GET /api/azure-connections
 * List safe Azure connection metadata for the authenticated user only.
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Explicitly select ONLY safe metadata columns (never select secret, ciphertext, iv, auth_tag)
    const result = await db.query(
      `SELECT id, connection_name, subscription_id, tenant_id, client_id, status, created_at, updated_at
       FROM azure_connections
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const connections = result.rows.map(row => ({
      id: row.id,
      connectionName: row.connection_name,
      subscriptionId: row.subscription_id,
      tenantId: row.tenant_id,
      clientId: row.client_id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    return res.json({
      count: connections.length,
      connections
    });
  } catch (error) {
    console.error('[AZURE-CONNECTIONS] List error:', error.message);
    return res.status(500).json({ error: 'Internal server error while fetching Azure connections' });
  }
});

/**
 * GET /api/azure-connections/:id
 * Retrieve safe Azure connection metadata by ID for the authenticated user only.
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Validate connection ID format as UUID
    if (!id || !isValidGuid(id)) {
      return res.status(400).json({ error: 'Connection ID must be a valid UUID format' });
    }

    // Query requiring BOTH connection ID and authenticated user_id
    const result = await db.query(
      `SELECT id, connection_name, subscription_id, tenant_id, client_id, status, created_at, updated_at
       FROM azure_connections
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      // 404 Not Found if connection does not exist or belongs to another user (never leak existence)
      return res.status(404).json({ error: 'Azure connection not found' });
    }

    const row = result.rows[0];

    return res.json({
      connection: {
        id: row.id,
        connectionName: row.connection_name,
        subscriptionId: row.subscription_id,
        tenantId: row.tenant_id,
        clientId: row.client_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    });
  } catch (error) {
    console.error('[AZURE-CONNECTIONS] Fetch by ID error:', error.message);
    return res.status(500).json({ error: 'Internal server error while fetching Azure connection' });
  }
});

/**
 * POST /api/azure-connections
 * Create an authenticated user's Azure Service Principal connection.
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Derive user_id strictly from req.user.id (never accept user_id from body)
    const userId = req.user.id;
    const { connectionName, tenantId, subscriptionId, clientId, clientSecret } = req.body || {};

    // 1. Validation: connectionName
    if (!connectionName || typeof connectionName !== 'string' || !connectionName.trim()) {
      return res.status(400).json({ error: 'Connection name is required' });
    }
    const trimmedConnectionName = connectionName.trim();
    if (trimmedConnectionName.length > 100) {
      return res.status(400).json({ error: 'Connection name must not exceed 100 characters' });
    }

    // 2. Validation: tenantId
    if (!tenantId || !isValidGuid(tenantId)) {
      return res.status(400).json({ error: 'Tenant ID must be a valid GUID format' });
    }
    const trimmedTenantId = tenantId.trim();

    // 3. Validation: subscriptionId
    if (!subscriptionId || !isValidGuid(subscriptionId)) {
      return res.status(400).json({ error: 'Subscription ID must be a valid GUID format' });
    }
    const trimmedSubscriptionId = subscriptionId.trim();

    // 4. Validation: clientId
    if (!clientId || !isValidGuid(clientId)) {
      return res.status(400).json({ error: 'Client ID must be a valid GUID format' });
    }
    const trimmedClientId = clientId.trim();

    // 5. Validation: clientSecret (Never trim or alter actual secret string)
    if (!clientSecret || typeof clientSecret !== 'string' || clientSecret.length === 0) {
      return res.status(400).json({ error: 'Client secret is required' });
    }

    // 6. Duplicate check for this user and subscription
    const duplicateCheck = await db.query(
      'SELECT id FROM azure_connections WHERE user_id = $1 AND subscription_id = $2',
      [userId, trimmedSubscriptionId]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ error: 'An Azure connection for this subscription already exists for your account' });
    }

    // 7. Azure Authentication & Subscription Access Validation BEFORE Database Insertion
    try {
      const credential = new ClientSecretCredential(
        trimmedTenantId,
        trimmedClientId,
        clientSecret
      );

      const computeClient = new ComputeManagementClient(credential, trimmedSubscriptionId);

      // Perform a read-only subscription validation check (fetch first item from VM list or request page)
      const vmIterator = computeClient.virtualMachines.listAll();
      await vmIterator.next();
    } catch (azureErr) {
      // Sanitize Azure error (never log or leak credentials/secrets)
      const rawMsg = azureErr.message ? azureErr.message.split('\n')[0] : 'Azure authentication failed';
      const sanitizedDetails = rawMsg.replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***');

      return res.status(400).json({
        error: 'Azure authentication or subscription access failed. Please verify your Tenant ID, Subscription ID, Client ID, Client Secret, and subscription permissions.',
        details: sanitizedDetails
      });
    }

    // 8. Encrypt Client Secret in memory using AES-256-GCM
    const encrypted = encryptSecret(clientSecret);

    // 9. Store connection in database (never store plaintext clientSecret)
    let insertRes;
    try {
      insertRes = await db.query(
        `INSERT INTO azure_connections 
         (user_id, connection_name, subscription_id, tenant_id, client_id, encrypted_client_secret, iv, auth_tag, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE')
         RETURNING id, connection_name, subscription_id, tenant_id, client_id, status, created_at`,
        [
          userId,
          trimmedConnectionName,
          trimmedSubscriptionId,
          trimmedTenantId,
          trimmedClientId,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag
        ]
      );
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        return res.status(409).json({ error: 'An Azure connection for this subscription already exists for your account' });
      }
      throw dbErr;
    }

    const newConnection = insertRes.rows[0];

    // 10. Return success response (NEVER return secret, ciphertext, iv, or auth_tag)
    return res.status(201).json({
      message: 'Azure connection created successfully',
      connection: {
        id: newConnection.id,
        connectionName: newConnection.connection_name,
        subscriptionId: newConnection.subscription_id,
        tenantId: newConnection.tenant_id,
        clientId: newConnection.client_id,
        status: newConnection.status,
        createdAt: newConnection.created_at
      }
    });
  } catch (error) {
    console.error('[AZURE-CONNECTIONS] Creation error:', error.message);
    return res.status(500).json({ error: 'Internal server error while creating Azure connection' });
  }
});

/**
 * DELETE /api/azure-connections/:id
 * Disconnect (soft-delete) an authenticated user's Azure connection by setting status = 'DISCONNECTED'.
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // 1. Validate connection ID format as UUID
    if (!id || !isValidGuid(id)) {
      return res.status(400).json({ error: 'Connection ID must be a valid UUID format' });
    }

    // 2. Perform soft disconnect: UPDATE status = 'DISCONNECTED' filtering on id AND user_id
    const result = await db.query(
      `UPDATE azure_connections
       SET status = 'DISCONNECTED',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING id, status, updated_at`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      // 404 Not Found if connection does not exist or belongs to another user (never leak existence)
      return res.status(404).json({ error: 'Azure connection not found' });
    }

    const row = result.rows[0];

    return res.json({
      message: 'Azure connection disconnected successfully',
      connection: {
        id: row.id,
        status: row.status,
        updatedAt: row.updated_at
      }
    });
  } catch (error) {
    console.error('[AZURE-CONNECTIONS] Disconnect error:', error.message);
    return res.status(500).json({ error: 'Internal server error while disconnecting Azure connection' });
  }
});

module.exports = router;
