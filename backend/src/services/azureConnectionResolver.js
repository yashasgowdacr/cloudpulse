const { DefaultAzureCredential, ClientSecretCredential } = require('@azure/identity');
const db = require('../db');
const { decryptSecret } = require('../utils/crypto');

/**
 * Validate standard GUID / UUID format (8-4-4-4-12 hex)
 */
function isValidGuid(val) {
  if (!val || typeof val !== 'string') return false;
  const guidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  return guidRegex.test(val.trim());
}

/**
 * Decrypts secret in memory and constructs ClientSecretCredential with metadata.
 * Plaintext client secret is never returned, stored, or logged.
 */
function constructClientSecretCredential(row) {
  let decryptedSecret;
  try {
    decryptedSecret = decryptSecret({
      ciphertext: row.encrypted_client_secret,
      iv: row.iv,
      authTag: row.auth_tag
    });
  } catch (err) {
    throw new Error('Failed to decrypt Azure Service Principal credentials for connection');
  }

  const credential = new ClientSecretCredential(
    row.tenant_id,
    row.client_id,
    decryptedSecret
  );

  // Overwrite reference to assist in-memory garbage collection
  decryptedSecret = null;

  return {
    credential,
    subscriptionId: row.subscription_id,
    connectionId: row.id,
    tenantId: row.tenant_id,
    clientId: row.client_id,
    isFallback: false
  };
}

/**
 * Development mode fallback using DefaultAzureCredential and process.env.AZURE_SUBSCRIPTION_ID
 */
function getDevelopmentFallback() {
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    throw new Error('No active Azure connections found for user. Development fallback is disabled in production environment.');
  }

  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || null;
  const credential = new DefaultAzureCredential();

  return {
    credential,
    subscriptionId,
    connectionId: null,
    tenantId: null,
    clientId: null,
    isFallback: true
  };
}

/**
 * Resolves the appropriate Azure Credential & Metadata for a CloudPulse user.
 * 
 * @param {string} userId - Authenticated user's UUID
 * @param {string|null} [connectionId=null] - Optional specific connection UUID
 * @returns {Promise<{ credential: Object, subscriptionId: string, connectionId: string|null, tenantId: string|null, clientId: string|null, isFallback: boolean }>}
 */
async function getAzureCredentialForUser(userId, connectionId = null) {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('User ID is required for Azure connection resolution');
  }

  const trimmedUserId = userId.trim();
  if (!isValidGuid(trimmedUserId)) {
    throw new Error('Invalid User ID format');
  }

  // 1. If explicit connectionId is supplied
  if (connectionId) {
    if (typeof connectionId !== 'string' || !isValidGuid(connectionId)) {
      throw new Error('Invalid Connection ID format');
    }

    const trimmedConnId = connectionId.trim();

    const result = await db.query(
      `SELECT id, tenant_id, client_id, subscription_id, encrypted_client_secret, iv, auth_tag, status
       FROM azure_connections
       WHERE id = $1 AND user_id = $2`,
      [trimmedConnId, trimmedUserId]
    );

    if (result.rows.length === 0) {
      throw new Error('Specified Azure connection not found for user');
    }

    const row = result.rows[0];

    if (row.status !== 'ACTIVE') {
      throw new Error(`Specified Azure connection is not active (status: ${row.status})`);
    }

    return constructClientSecretCredential(row);
  }

  // 2. If no connectionId supplied, query all ACTIVE connections for user
  const result = await db.query(
    `SELECT id, tenant_id, client_id, subscription_id, encrypted_client_secret, iv, auth_tag, status
     FROM azure_connections
     WHERE user_id = $1 AND status = 'ACTIVE'
     ORDER BY created_at DESC`,
    [trimmedUserId]
  );

  // Case A: Multiple ACTIVE connections -> Require explicit connectionId
  if (result.rows.length > 1) {
    throw new Error('Multiple active Azure connections found. An explicit connectionId is required.');
  }

  // Case B: Exactly 1 ACTIVE connection -> Decrypt & construct ClientSecretCredential
  if (result.rows.length === 1) {
    return constructClientSecretCredential(result.rows[0]);
  }

  // Case C: 0 ACTIVE connections (or all DISCONNECTED/DISABLED/INVALID_CREDENTIALS) -> Development Fallback
  return getDevelopmentFallback();
}

module.exports = {
  getAzureCredentialForUser
};
