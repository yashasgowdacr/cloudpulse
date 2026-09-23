const db = require('../db');

/**
 * Lazy-load notification dispatcher to avoid circular dependency and support independent testing
 */
let notificationDispatcher = null;

function getNotificationDispatcher() {
  if (!notificationDispatcher) {
    try {
      const notifService = require('./notificationService');
      if (notifService && typeof notifService.sendDeallocationNotification === 'function') {
        notificationDispatcher = notifService.sendDeallocationNotification;
      }
    } catch (err) {
      // notificationService not yet loaded or unavailable
    }
  }
  return notificationDispatcher;
}

function setNotificationDispatcher(fn) {
  notificationDispatcher = fn;
}

/**
 * Persists an action event to action_history and dispatches notification if applicable.
 * Preserves strict tenant isolation and non-blocking notification delivery.
 */
async function recordAction(entry) {
  const userId = entry.userId || entry.user_id || null;
  const connectionId = entry.connectionId || entry.connection_id || null;
  const vmName = entry.vmName;
  const action = entry.action || 'DEALLOCATE';
  const status = entry.status || (entry.executed ? 'SUCCESS' : 'BLOCKED');
  const cpuAverage = entry.cpuAverage !== undefined ? entry.cpuAverage : (entry.policy ? entry.policy.cpuAverage : null);
  const reason = entry.reason || '';
  const recipientEmail = entry.recipientEmail || entry.userEmail || null;

  try {
    const query = `
      INSERT INTO action_history (user_id, connection_id, vm_name, action, status, cpu_average, reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, user_id, connection_id, vm_name, action, status, cpu_average, reason, created_at
    `;
    const values = [userId, connectionId, vmName, action, status, cpuAverage, reason];
    const result = await db.query(query, values);
    const row = result.rows[0];

    const record = {
      id: row.id,
      userId: row.user_id,
      recipientEmail: recipientEmail,
      connectionId: row.connection_id,
      vmName: row.vm_name,
      action: row.action,
      status: row.status,
      cpuAverage: row.cpu_average !== null ? parseFloat(row.cpu_average) : null,
      reason: row.reason,
      timestamp: row.created_at
    };

    // 🛡️ Notification MUST NOT break VM operations. Catch notification errors separately.
    try {
      const dispatcher = getNotificationDispatcher();
      if (typeof dispatcher === 'function') {
        await dispatcher(record);
      }
    } catch (err) {
      console.error('[NOTIFICATION] Non-fatal notification dispatch error:', err.message);
    }

    return record;
  } catch (err) {
    console.error('[ACTION-HISTORY] Error persisting action record:', err.message);
    return {
      vmName,
      action,
      status,
      cpuAverage,
      reason
    };
  }
}

/**
 * Retrieves audit history records for a specific user, optionally filtered by VM name.
 * Strictly scoped by user_id to enforce multi-tenant isolation.
 */
async function getActions(userId, vmNameFilter = null) {
  if (!userId) {
    return [];
  }

  let query;
  let values;

  if (vmNameFilter) {
    query = `
      SELECT id, user_id, connection_id, vm_name, action, status, cpu_average, reason, created_at
      FROM action_history
      WHERE user_id = $1 AND LOWER(vm_name) = LOWER($2)
      ORDER BY created_at DESC
    `;
    values = [userId, vmNameFilter];
  } else {
    query = `
      SELECT id, user_id, connection_id, vm_name, action, status, cpu_average, reason, created_at
      FROM action_history
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    values = [userId];
  }

  const result = await db.query(query, values);
  return result.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    connectionId: row.connection_id,
    vmName: row.vm_name,
    action: row.action,
    status: row.status,
    cpuAverage: row.cpu_average !== null ? parseFloat(row.cpu_average) : null,
    reason: row.reason,
    timestamp: row.created_at
  }));
}

module.exports = {
  recordAction,
  getActions,
  setNotificationDispatcher
};
