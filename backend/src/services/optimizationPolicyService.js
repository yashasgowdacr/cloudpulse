const db = require('../db');

function formatPolicyRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    idleCpuThreshold: parseFloat(row.idle_cpu_threshold),
    monitoringWindowMinutes: parseInt(row.monitoring_window_minutes, 10),
    autoShutdown: Boolean(row.auto_shutdown),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createDefaultPolicyForUser(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const query = `
    INSERT INTO optimization_policies (user_id, idle_cpu_threshold, monitoring_window_minutes, auto_shutdown)
    VALUES ($1, 5.00, 30, false)
    ON CONFLICT (user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    RETURNING id, user_id, idle_cpu_threshold, monitoring_window_minutes, auto_shutdown, created_at, updated_at
  `;

  const result = await db.query(query, [userId]);
  return formatPolicyRow(result.rows[0]);
}

async function getPolicyForUser(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const query = `
    SELECT id, user_id, idle_cpu_threshold, monitoring_window_minutes, auto_shutdown, created_at, updated_at
    FROM optimization_policies
    WHERE user_id = $1
  `;

  const result = await db.query(query, [userId]);

  if (result.rows.length === 0) {
    return await createDefaultPolicyForUser(userId);
  }

  return formatPolicyRow(result.rows[0]);
}

async function updatePolicyForUser(userId, updates = {}) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  // Allowed fields validation
  const allowedKeys = ['idleCpuThreshold', 'monitoringWindowMinutes', 'autoShutdown'];
  const updateKeys = Object.keys(updates);

  for (const key of updateKeys) {
    if (!allowedKeys.includes(key)) {
      const err = new Error(`Unknown policy field '${key}'`);
      err.statusCode = 400;
      throw err;
    }
  }

  if (updateKeys.length === 0) {
    const err = new Error('No policy fields provided for update');
    err.statusCode = 400;
    throw err;
  }

  // Validate idleCpuThreshold
  if ('idleCpuThreshold' in updates) {
    const val = updates.idleCpuThreshold;
    if (typeof val !== 'number' || isNaN(val) || val < 0 || val > 100) {
      const err = new Error('idleCpuThreshold must be a valid number between 0 and 100');
      err.statusCode = 400;
      throw err;
    }
  }

  // Validate monitoringWindowMinutes
  if ('monitoringWindowMinutes' in updates) {
    const val = updates.monitoringWindowMinutes;
    if (!Number.isInteger(val) || val < 5 || val > 1440) {
      const err = new Error('monitoringWindowMinutes must be an integer between 5 and 1440');
      err.statusCode = 400;
      throw err;
    }
  }

  // Validate autoShutdown
  if ('autoShutdown' in updates) {
    const val = updates.autoShutdown;
    if (typeof val !== 'boolean') {
      const err = new Error('autoShutdown must be a boolean');
      err.statusCode = 400;
      throw err;
    }
  }

  // Ensure policy exists first
  const currentPolicy = await getPolicyForUser(userId);

  const newThreshold = 'idleCpuThreshold' in updates ? updates.idleCpuThreshold : currentPolicy.idleCpuThreshold;
  const newWindow = 'monitoringWindowMinutes' in updates ? updates.monitoringWindowMinutes : currentPolicy.monitoringWindowMinutes;
  const newAutoShutdown = 'autoShutdown' in updates ? updates.autoShutdown : currentPolicy.autoShutdown;

  const updateQuery = `
    UPDATE optimization_policies
    SET idle_cpu_threshold = $2,
        monitoring_window_minutes = $3,
        auto_shutdown = $4,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
    RETURNING id, user_id, idle_cpu_threshold, monitoring_window_minutes, auto_shutdown, created_at, updated_at
  `;

  const result = await db.query(updateQuery, [userId, newThreshold, newWindow, newAutoShutdown]);
  return formatPolicyRow(result.rows[0]);
}

module.exports = {
  getPolicyForUser,
  createDefaultPolicyForUser,
  updatePolicyForUser
};
