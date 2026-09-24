const db = require('../db');

/**
 * Aggregates high-level platform health and usage metrics for the Admin Dashboard.
 * Strictly guarantees no secret credentials or sensitive tokens are exposed.
 */
async function getPlatformMetrics() {
  // 1. Tenant counts
  const tenantRes = await db.query(`
    SELECT
      COUNT(*) AS total_tenants,
      COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_tenants,
      COUNT(*) FILTER (WHERE status = 'SUSPENDED') AS suspended_tenants,
      COUNT(*) FILTER (WHERE status = 'INACTIVE') AS inactive_tenants
    FROM users
  `);
  const tenantCounts = tenantRes.rows[0] || {
    total_tenants: 0,
    active_tenants: 0,
    suspended_tenants: 0,
    inactive_tenants: 0
  };

  // 2. Cloud Connection counts
  const azureConnRes = await db.query(`
    SELECT
      COUNT(*) AS total_azure_connections,
      COUNT(DISTINCT subscription_id) AS connected_subscriptions
    FROM azure_connections
    WHERE status = 'ACTIVE'
  `);
  const connCounts = azureConnRes.rows[0] || {
    total_azure_connections: 0,
    connected_subscriptions: 0
  };

  // 3. Multi-cloud connections if table exists
  let totalCloudConnections = 0;
  try {
    const cloudRes = await db.query('SELECT COUNT(*) AS total FROM cloud_connections');
    totalCloudConnections = parseInt(cloudRes.rows[0]?.total || 0, 10);
  } catch (err) {
    totalCloudConnections = 0;
  }

  // 4. Optimization actions & avoided cost
  const actionsRes = await db.query(`
    SELECT
      COUNT(*) AS total_actions,
      COUNT(*) FILTER (WHERE action = 'DEALLOCATE' AND (status = 'SUCCESS' OR status = 'deallocated')) AS successful_deallocations
    FROM action_history
  `);
  const actionStats = actionsRes.rows[0] || {
    total_actions: 0,
    successful_deallocations: 0
  };

  const totalActions = parseInt(actionStats.total_actions || 0, 10);
  const successfulDeallocations = parseInt(actionStats.successful_deallocations || 0, 10);
  // Baseline estimated avoided cost: ~$70.08 per deallocated VM per month or ~$0.096/hr
  const totalEstimatedAvoidedCost = Math.round(successfulDeallocations * 70.08 * 100) / 100;

  return {
    totalTenants: parseInt(tenantCounts.total_tenants || 0, 10),
    activeTenants: parseInt(tenantCounts.active_tenants || 0, 10),
    suspendedTenants: parseInt(tenantCounts.suspended_tenants || 0, 10),
    inactiveTenants: parseInt(tenantCounts.inactive_tenants || 0, 10),
    totalAzureConnections: parseInt(connCounts.total_azure_connections || 0, 10),
    totalCloudConnections: totalCloudConnections + parseInt(connCounts.total_azure_connections || 0, 10),
    connectedSubscriptions: parseInt(connCounts.connected_subscriptions || 0, 10),
    totalOptimizationActions: totalActions,
    successfulDeallocations,
    totalEstimatedAvoidedCost,
    currency: 'INR'
  };
}

/**
 * Retrieves a paginated list of tenants with summary metrics.
 * Strictly excludes password_hash and secrets.
 */
async function listTenants({ page = 1, limit = 10, search = '', status = '' }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));
  const offset = (pageNum - 1) * limitNum;

  let whereClauses = [];
  let queryParams = [];

  if (search && search.trim()) {
    queryParams.push(`%${search.trim().toLowerCase()}%`);
    whereClauses.push(`(LOWER(name) LIKE $${queryParams.length} OR LOWER(email) LIKE $${queryParams.length})`);
  }

  if (status && status.trim()) {
    queryParams.push(status.trim().toUpperCase());
    whereClauses.push(`status = $${queryParams.length}`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const countRes = await db.query(
    `SELECT COUNT(*) AS total FROM users ${whereSql}`,
    queryParams
  );
  const totalTenants = parseInt(countRes.rows[0].total, 10);

  // Query paginated users
  const dataParams = [...queryParams, limitNum, offset];
  const usersQuery = `
    SELECT
      u.id,
      u.name,
      u.email,
      u.role,
      u.status,
      u.created_at,
      u.updated_at,
      (SELECT COUNT(*) FROM azure_connections ac WHERE ac.user_id = u.id) AS azure_connections_count,
      (SELECT COUNT(*) FROM action_history ah WHERE ah.user_id = u.id) AS actions_count
    FROM users u
    ${whereSql}
    ORDER BY u.created_at DESC
    LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}
  `;

  const usersRes = await db.query(usersQuery, dataParams);
  const tenants = usersRes.rows.map(u => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    azureConnectionsCount: parseInt(u.azure_connections_count, 10),
    actionsCount: parseInt(u.actions_count, 10),
    createdAt: u.created_at,
    updatedAt: u.updated_at
  }));

  return {
    tenants,
    pagination: {
      total: totalTenants,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalTenants / limitNum)
    }
  };
}

/**
 * Retrieves comprehensive details for a single tenant.
 * Never exposes secrets, passwords, or encrypted tokens.
 */
async function getTenantDetails(tenantId) {
  const userRes = await db.query(
    'SELECT id, name, email, role, status, created_at, updated_at FROM users WHERE id = $1',
    [tenantId]
  );

  if (userRes.rows.length === 0) {
    const err = new Error('Tenant account not found');
    err.statusCode = 404;
    throw err;
  }

  const tenant = userRes.rows[0];

  // Connections (safe columns only)
  const connsRes = await db.query(
    `SELECT id, connection_name, subscription_id, tenant_id, client_id, status, created_at, updated_at
     FROM azure_connections
     WHERE user_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );

  // Policy
  const policyRes = await db.query(
    'SELECT * FROM optimization_policies WHERE user_id = $1',
    [tenantId]
  );

  // Recent actions
  const actionsRes = await db.query(
    `SELECT id, vm_name, action, status, reason, created_at
     FROM action_history
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
    [tenantId]
  );

  // Budgets count
  const budgetCountRes = await db.query(
    'SELECT COUNT(*) AS total FROM budgets WHERE user_id = $1',
    [tenantId]
  );

  // Avoided cost calculation for this tenant
  const avoidedRes = await db.query(
    `SELECT COUNT(*) AS total FROM action_history
     WHERE user_id = $1 AND action = 'DEALLOCATE' AND (status = 'SUCCESS' OR status = 'deallocated')`,
    [tenantId]
  );
  const avoidedCount = parseInt(avoidedRes.rows[0].total, 10);
  const estimatedAvoidedCost = Math.round(avoidedCount * 70.08 * 100) / 100;

  return {
    tenant,
    connections: connsRes.rows,
    policy: policyRes.rows[0] || null,
    recentActions: actionsRes.rows,
    budgetCount: parseInt(budgetCountRes.rows[0].total, 10),
    estimatedAvoidedCost
  };
}

/**
 * Updates a tenant's status (e.g. SUSPENDED or ACTIVE).
 * Immediately revokes active refresh tokens if suspended.
 */
async function updateTenantStatus(tenantId, newStatus, currentAdminId) {
  const allowed = ['ACTIVE', 'SUSPENDED', 'INACTIVE'];
  const statusUpper = (newStatus || '').toUpperCase();

  if (!allowed.includes(statusUpper)) {
    const err = new Error(`Status must be one of: ${allowed.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  if (tenantId === currentAdminId && statusUpper === 'SUSPENDED') {
    const err = new Error('Administrators cannot suspend their own account');
    err.statusCode = 400;
    throw err;
  }

  const updateRes = await db.query(
    `UPDATE users
     SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id, name, email, role, status, updated_at`,
    [statusUpper, tenantId]
  );

  if (updateRes.rows.length === 0) {
    const err = new Error('Tenant not found');
    err.statusCode = 404;
    throw err;
  }

  // If suspended, revoke all active refresh tokens immediately to terminate sessions
  if (statusUpper === 'SUSPENDED' || statusUpper === 'INACTIVE') {
    await db.query(
      `UPDATE refresh_tokens
       SET revoked_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [tenantId]
    );
  }

  return updateRes.rows[0];
}

module.exports = {
  getPlatformMetrics,
  listTenants,
  getTenantDetails,
  updateTenantStatus
};
