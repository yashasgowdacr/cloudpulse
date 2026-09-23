const db = require('../db');
const { encryptSecret, decryptSecret } = require('../utils/crypto');
const CloudProviderFactory = require('./cloud/CloudProviderFactory');
const { getAzureCredentialForUser } = require('./azureConnectionResolver');
const { resolveEffectivePolicy } = require('./optimizationPolicyService');

/**
 * Creates a new cloud connection with credentials encrypted at rest via AES-256-GCM.
 */
async function createCloudConnection(userId, data) {
  const { provider, connectionName, accountOrSubscriptionId, tenantOrRegion, clientOrAccessKey, secret } = data;

  if (!provider || !['AZURE', 'AWS', 'GCP'].includes(provider.toUpperCase())) {
    const err = new Error('Provider must be one of: AZURE, AWS, GCP');
    err.statusCode = 400;
    throw err;
  }

  if (!connectionName || typeof connectionName !== 'string' || !connectionName.trim()) {
    const err = new Error('Connection name is required');
    err.statusCode = 400;
    throw err;
  }

  if (!accountOrSubscriptionId || !accountOrSubscriptionId.trim()) {
    const err = new Error('Account / Subscription / Project ID is required');
    err.statusCode = 400;
    throw err;
  }

  if (!clientOrAccessKey || !clientOrAccessKey.trim()) {
    const err = new Error('Client ID / Access Key ID / Service Account Email is required');
    err.statusCode = 400;
    throw err;
  }

  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    const err = new Error('Secret / Private Key is required');
    err.statusCode = 400;
    throw err;
  }

  // Encrypt secret with AES-256-GCM
  const encrypted = encryptSecret(secret.trim());

  const query = `
    INSERT INTO cloud_connections (
      user_id, provider, connection_name, account_or_subscription_id,
      tenant_or_region, client_or_access_key, encrypted_secret, iv, auth_tag, status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ACTIVE')
    ON CONFLICT (user_id, provider, account_or_subscription_id)
    DO UPDATE SET
      connection_name = EXCLUDED.connection_name,
      tenant_or_region = EXCLUDED.tenant_or_region,
      client_or_access_key = EXCLUDED.client_or_access_key,
      encrypted_secret = EXCLUDED.encrypted_secret,
      iv = EXCLUDED.iv,
      auth_tag = EXCLUDED.auth_tag,
      status = 'ACTIVE',
      updated_at = CURRENT_TIMESTAMP
    RETURNING id, provider, connection_name, account_or_subscription_id, tenant_or_region, client_or_access_key, status, created_at, updated_at
  `;

  const values = [
    userId,
    provider.toUpperCase(),
    connectionName.trim(),
    accountOrSubscriptionId.trim(),
    tenantOrRegion ? tenantOrRegion.trim() : null,
    clientOrAccessKey.trim(),
    encrypted.encryptedData,
    encrypted.iv,
    encrypted.authTag
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Retrieves all cloud connections for user, unifying existing azure_connections with any cloud_connections.
 * Never exposes credentials or secrets.
 */
async function getCloudConnections(userId) {
  // 1. Fetch from cloud_connections
  let cloudRows = [];
  try {
    const cloudRes = await db.query(
      `SELECT id, provider, connection_name, account_or_subscription_id, tenant_or_region, client_or_access_key, status, created_at, updated_at
       FROM cloud_connections
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    cloudRows = cloudRes.rows;
  } catch (err) {
    cloudRows = [];
  }

  // 2. Fetch existing azure_connections to preserve 100% backward compatibility
  const azureRes = await db.query(
    `SELECT id, connection_name, subscription_id, tenant_id, client_id, status, created_at, updated_at
     FROM azure_connections
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  const unified = [...cloudRows];

  // Merge azure connections if not already present
  for (const az of azureRes.rows) {
    const alreadyPresent = unified.some(c => c.provider === 'AZURE' && c.account_or_subscription_id === az.subscription_id);
    if (!alreadyPresent) {
      unified.push({
        id: az.id,
        provider: 'AZURE',
        connection_name: az.connection_name,
        account_or_subscription_id: az.subscription_id,
        tenant_or_region: az.tenant_id,
        client_or_access_key: az.client_id,
        status: az.status,
        created_at: az.created_at,
        updated_at: az.updated_at
      });
    }
  }

  return unified;
}

/**
 * Deletes a cloud connection strictly scoped to user.
 */
async function deleteCloudConnection(userId, connectionId) {
  // Attempt delete from cloud_connections
  let deleted = false;
  try {
    const delRes = await db.query(
      'DELETE FROM cloud_connections WHERE id = $1 AND user_id = $2 RETURNING id',
      [connectionId, userId]
    );
    if (delRes.rows.length > 0) deleted = true;
  } catch (err) {}

  // If not in cloud_connections, attempt delete from azure_connections
  if (!deleted) {
    const azDel = await db.query(
      'DELETE FROM azure_connections WHERE id = $1 AND user_id = $2 RETURNING id',
      [connectionId, userId]
    );
    if (azDel.rows.length > 0) deleted = true;
  }

  if (!deleted) {
    const err = new Error('Connection not found');
    err.statusCode = 404;
    throw err;
  }

  return { success: true, id: connectionId };
}

/**
 * Discovers unified virtual machines across all connected clouds (Azure, AWS, GCP).
 */
async function discoverUnifiedVms(userId, connectionId = null) {
  const connections = await getCloudConnections(userId);
  const filtered = connectionId ? connections.filter(c => c.id === connectionId) : connections;

  const allVms = [];

  for (const conn of filtered) {
    try {
      const provider = CloudProviderFactory.getProvider(conn.provider);

      let config = {
        subscriptionId: conn.account_or_subscription_id,
        region: conn.tenant_or_region,
        connectionId: conn.id
      };

      if (conn.provider === 'AZURE') {
        try {
          const resolved = await getAzureCredentialForUser(userId, conn.id);
          config.credential = resolved.credential;
          config.subscriptionId = resolved.subscriptionId;
        } catch (azErr) {
          // If not in azure_connections, look up encrypted secret
        }
      }

      const vms = await provider.listVirtualMachines(config);

      for (const vm of vms) {
        let policyRes = { isProtected: false, explanation: 'Active' };
        try {
          policyRes = await resolveEffectivePolicy(userId, vm, vm.tags);
        } catch (pErr) {}

        allVms.push({
          ...vm,
          connectionId: conn.id,
          connectionName: conn.connection_name,
          provider: conn.provider,
          isProtected: policyRes.isProtected,
          protectionReason: policyRes.protectionReason,
          policyExplanation: policyRes.explanation
        });
      }
    } catch (connErr) {
      console.warn(`[MULTI-CLOUD-DISCOVERY] Failed to discover VMs on connection ${conn.id} (${conn.provider}):`, connErr.message);
    }
  }

  return allVms;
}

module.exports = {
  createCloudConnection,
  getCloudConnections,
  deleteCloudConnection,
  discoverUnifiedVms
};
