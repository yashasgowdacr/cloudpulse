const db = require('../db');

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

function formatPolicyRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    idleCpuThreshold: parseFloat(row.idle_cpu_threshold),
    monitoringWindowMinutes: parseInt(row.monitoring_window_minutes, 10),
    autoShutdown: Boolean(row.auto_shutdown),
    scheduledShutdownEnabled: Boolean(row.scheduled_shutdown_enabled),
    scheduledShutdownTime: row.scheduled_shutdown_time || null,
    scheduledStartEnabled: Boolean(row.scheduled_start_enabled),
    scheduledStartTime: row.scheduled_start_time || null,
    scheduleTimezone: row.schedule_timezone || 'UTC',
    scheduleDays: row.schedule_days || '1,2,3,4,5',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createDefaultPolicyForUser(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const query = `
    INSERT INTO optimization_policies (
      user_id,
      idle_cpu_threshold,
      monitoring_window_minutes,
      auto_shutdown,
      scheduled_shutdown_enabled,
      scheduled_shutdown_time,
      scheduled_start_enabled,
      scheduled_start_time,
      schedule_timezone,
      schedule_days
    )
    VALUES ($1, 5.00, 30, false, false, NULL, false, NULL, 'UTC', '1,2,3,4,5')
    ON CONFLICT (user_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    RETURNING *
  `;

  const result = await db.query(query, [userId]);
  return formatPolicyRow(result.rows[0]);
}

async function getPolicyForUser(userId) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const query = `
    SELECT *
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
  const allowedKeys = [
    'idleCpuThreshold',
    'monitoringWindowMinutes',
    'autoShutdown',
    'scheduledShutdownEnabled',
    'scheduledShutdownTime',
    'scheduledStartEnabled',
    'scheduledStartTime',
    'scheduleTimezone',
    'scheduleDays'
  ];
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

  // Validate scheduledShutdownEnabled
  if ('scheduledShutdownEnabled' in updates) {
    const val = updates.scheduledShutdownEnabled;
    if (typeof val !== 'boolean') {
      const err = new Error('scheduledShutdownEnabled must be a boolean');
      err.statusCode = 400;
      throw err;
    }
  }

  // Validate scheduledShutdownTime
  if ('scheduledShutdownTime' in updates) {
    const val = updates.scheduledShutdownTime;
    if (val !== null && val !== '') {
      if (typeof val !== 'string' || !TIME_REGEX.test(val.trim())) {
        const err = new Error('scheduledShutdownTime must be in HH:mm (24-hour) format or null');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  // Validate scheduledStartEnabled
  if ('scheduledStartEnabled' in updates) {
    const val = updates.scheduledStartEnabled;
    if (typeof val !== 'boolean') {
      const err = new Error('scheduledStartEnabled must be a boolean');
      err.statusCode = 400;
      throw err;
    }
  }

  // Validate scheduledStartTime
  if ('scheduledStartTime' in updates) {
    const val = updates.scheduledStartTime;
    if (val !== null && val !== '') {
      if (typeof val !== 'string' || !TIME_REGEX.test(val.trim())) {
        const err = new Error('scheduledStartTime must be in HH:mm (24-hour) format or null');
        err.statusCode = 400;
        throw err;
      }
    }
  }

  // Validate scheduleTimezone
  if ('scheduleTimezone' in updates) {
    const val = updates.scheduleTimezone;
    if (typeof val !== 'string' || !val.trim() || val.length > 50) {
      const err = new Error('scheduleTimezone must be a non-empty string under 50 characters');
      err.statusCode = 400;
      throw err;
    }
  }

  // Validate scheduleDays
  if ('scheduleDays' in updates) {
    const val = updates.scheduleDays;
    if (typeof val !== 'string' || !val.trim() || val.length > 50) {
      const err = new Error('scheduleDays must be a non-empty string under 50 characters');
      err.statusCode = 400;
      throw err;
    }
  }

  // Ensure policy exists first
  const currentPolicy = await getPolicyForUser(userId);

  const newThreshold = 'idleCpuThreshold' in updates ? updates.idleCpuThreshold : currentPolicy.idleCpuThreshold;
  const newWindow = 'monitoringWindowMinutes' in updates ? updates.monitoringWindowMinutes : currentPolicy.monitoringWindowMinutes;
  const newAutoShutdown = 'autoShutdown' in updates ? updates.autoShutdown : currentPolicy.autoShutdown;
  const newSchedShutdown = 'scheduledShutdownEnabled' in updates ? updates.scheduledShutdownEnabled : currentPolicy.scheduledShutdownEnabled;
  const newSchedShutdownTime = 'scheduledShutdownTime' in updates ? (updates.scheduledShutdownTime ? updates.scheduledShutdownTime.trim() : null) : currentPolicy.scheduledShutdownTime;
  const newSchedStart = 'scheduledStartEnabled' in updates ? updates.scheduledStartEnabled : currentPolicy.scheduledStartEnabled;
  const newSchedStartTime = 'scheduledStartTime' in updates ? (updates.scheduledStartTime ? updates.scheduledStartTime.trim() : null) : currentPolicy.scheduledStartTime;
  const newTimezone = 'scheduleTimezone' in updates ? updates.scheduleTimezone.trim() : currentPolicy.scheduleTimezone;
  const newDays = 'scheduleDays' in updates ? updates.scheduleDays.trim() : currentPolicy.scheduleDays;

  const updateQuery = `
    UPDATE optimization_policies
    SET idle_cpu_threshold = $2,
        monitoring_window_minutes = $3,
        auto_shutdown = $4,
        scheduled_shutdown_enabled = $5,
        scheduled_shutdown_time = $6,
        scheduled_start_enabled = $7,
        scheduled_start_time = $8,
        schedule_timezone = $9,
        schedule_days = $10,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $1
    RETURNING *
  `;

  const result = await db.query(updateQuery, [
    userId,
    newThreshold,
    newWindow,
    newAutoShutdown,
    newSchedShutdown,
    newSchedShutdownTime,
    newSchedStart,
    newSchedStartTime,
    newTimezone,
    newDays
  ]);

  return formatPolicyRow(result.rows[0]);
}

/**
 * Creates a scoped policy for a specific subscription, resource group, tag, or VM name pattern.
 */
async function createPolicyScope(userId, data) {
  const {
    scopeType,
    scopeValue,
    idleCpuThreshold = 5.00,
    monitoringWindowMinutes = 30,
    autoShutdown = false,
    scheduledShutdownEnabled = false,
    scheduledShutdownTime = null,
    scheduledStartEnabled = false,
    scheduledStartTime = null,
    scheduleTimezone = 'UTC',
    scheduleDays = '1,2,3,4,5'
  } = data;

  const validTypes = ['GLOBAL', 'SUBSCRIPTION', 'RESOURCE_GROUP', 'VM_TAG', 'VM_NAME_PATTERN'];
  if (!scopeType || !validTypes.includes(scopeType.toUpperCase())) {
    const err = new Error(`scopeType must be one of: ${validTypes.join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  // Precedence priorities: VM_NAME_PATTERN/VM_TAG (10) > RESOURCE_GROUP (20) > SUBSCRIPTION (30) > GLOBAL (40)
  const priorityMap = {
    'VM_NAME_PATTERN': 10,
    'VM_TAG': 10,
    'RESOURCE_GROUP': 20,
    'SUBSCRIPTION': 30,
    'GLOBAL': 40
  };
  const priority = priorityMap[scopeType.toUpperCase()] || 100;

  const query = `
    INSERT INTO policy_scopes (
      user_id, scope_type, scope_value, idle_cpu_threshold, monitoring_window_minutes,
      auto_shutdown, scheduled_shutdown_enabled, scheduled_shutdown_time,
      scheduled_start_enabled, scheduled_start_time, schedule_timezone, schedule_days, priority
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *
  `;

  const values = [
    userId,
    scopeType.toUpperCase(),
    scopeValue ? scopeValue.trim() : null,
    parseFloat(idleCpuThreshold),
    parseInt(monitoringWindowMinutes, 10),
    Boolean(autoShutdown),
    Boolean(scheduledShutdownEnabled),
    scheduledShutdownTime || null,
    Boolean(scheduledStartEnabled),
    scheduledStartTime || null,
    scheduleTimezone || 'UTC',
    scheduleDays || '1,2,3,4,5',
    priority
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Lists all policy scopes configured for user.
 */
async function getPolicyScopes(userId) {
  const result = await db.query(
    'SELECT * FROM policy_scopes WHERE user_id = $1 ORDER BY priority ASC, created_at DESC',
    [userId]
  );
  return result.rows;
}

/**
 * Updates a policy scope strictly scoped to user.
 */
async function updatePolicyScope(userId, scopeId, updates) {
  const existingRes = await db.query(
    'SELECT * FROM policy_scopes WHERE id = $1 AND user_id = $2',
    [scopeId, userId]
  );
  if (existingRes.rows.length === 0) {
    const err = new Error('Policy scope not found');
    err.statusCode = 404;
    throw err;
  }

  const existing = existingRes.rows[0];
  const query = `
    UPDATE policy_scopes
    SET idle_cpu_threshold = $3,
        monitoring_window_minutes = $4,
        auto_shutdown = $5,
        scheduled_shutdown_enabled = $6,
        scheduled_shutdown_time = $7,
        scheduled_start_enabled = $8,
        scheduled_start_time = $9,
        schedule_timezone = $10,
        schedule_days = $11,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND user_id = $2
    RETURNING *
  `;

  const values = [
    scopeId,
    userId,
    updates.idleCpuThreshold !== undefined ? parseFloat(updates.idleCpuThreshold) : existing.idle_cpu_threshold,
    updates.monitoringWindowMinutes !== undefined ? parseInt(updates.monitoringWindowMinutes, 10) : existing.monitoring_window_minutes,
    updates.autoShutdown !== undefined ? Boolean(updates.autoShutdown) : existing.auto_shutdown,
    updates.scheduledShutdownEnabled !== undefined ? Boolean(updates.scheduledShutdownEnabled) : existing.scheduled_shutdown_enabled,
    updates.scheduledShutdownTime !== undefined ? updates.scheduledShutdownTime : existing.scheduled_shutdown_time,
    updates.scheduledStartEnabled !== undefined ? Boolean(updates.scheduledStartEnabled) : existing.scheduled_start_enabled,
    updates.scheduledStartTime !== undefined ? updates.scheduledStartTime : existing.scheduled_start_time,
    updates.scheduleTimezone !== undefined ? updates.scheduleTimezone : existing.schedule_timezone,
    updates.scheduleDays !== undefined ? updates.scheduleDays : existing.schedule_days
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Deletes a policy scope strictly scoped to user.
 */
async function deletePolicyScope(userId, scopeId) {
  const result = await db.query(
    'DELETE FROM policy_scopes WHERE id = $1 AND user_id = $2 RETURNING id',
    [scopeId, userId]
  );
  if (result.rows.length === 0) {
    const err = new Error('Policy scope not found');
    err.statusCode = 404;
    throw err;
  }
  return { success: true, id: scopeId };
}

/**
 * Resolves effective policy according to documented precedence:
 * 1. MANDATORY SAFETY (Prod name, Environment=production, AutoShutdown=disabled, custom exclusion tags) - INVIOLABLE
 * 2. VM Tag / Name Pattern Scopes (Priority 10)
 * 3. Resource Group Scope (Priority 20)
 * 4. Subscription Scope (Priority 30)
 * 5. Global Policy (Priority 40)
 */
async function resolveEffectivePolicy(userId, vm = {}, vmTags = {}) {
  const vmName = vm.name || '';
  const vmNameLower = vmName.toLowerCase();
  const resourceGroup = (vm.resourceGroup || '').toLowerCase();
  const subscriptionId = vm.subscriptionId || '';

  // 1. Mandatory Safety Protection Evaluation
  // A. VM Name Pattern Guard
  if (vmNameLower.includes('prod') || vmNameLower.startsWith('pr-')) {
    return {
      isProtected: true,
      protectionReason: 'Production safeguard: Virtual machine name matches production pattern.',
      sourceScope: 'MANDATORY_SAFETY',
      explanation: 'Protected: Virtual machine name indicates production workload.',
      effectivePolicy: { autoShutdown: false }
    };
  }

  // B. Azure Tags Guard
  for (const [tagKey, tagVal] of Object.entries(vmTags || {})) {
    const kLower = tagKey.toLowerCase();
    const vLower = (tagVal || '').toLowerCase();
    if (kLower === 'environment' && (vLower === 'production' || vLower === 'prod')) {
      return {
        isProtected: true,
        protectionReason: 'Production safeguard: Tag Environment=production matched.',
        sourceScope: 'MANDATORY_SAFETY',
        explanation: 'Protected: Environment=production tag applied.',
        effectivePolicy: { autoShutdown: false }
      };
    }
    if (kLower === 'autoshutdown' && (vLower === 'disabled' || vLower === 'false' || vLower === 'no')) {
      return {
        isProtected: true,
        protectionReason: 'Production safeguard: Tag AutoShutdown=disabled matched.',
        sourceScope: 'MANDATORY_SAFETY',
        explanation: 'Protected: AutoShutdown=disabled tag applied.',
        effectivePolicy: { autoShutdown: false }
      };
    }
  }

  // C. Custom Exclusion Tags Guard
  const exclusionTagsRes = await db.query(
    'SELECT tag_key, tag_value FROM user_exclusion_tags WHERE user_id = $1',
    [userId]
  );
  for (const ex of exclusionTagsRes.rows) {
    const k = ex.tag_key.toLowerCase();
    const v = ex.tag_value.toLowerCase();
    for (const [vmK, vmV] of Object.entries(vmTags || {})) {
      if (vmK.toLowerCase() === k && (vmV || '').toLowerCase() === v) {
        return {
          isProtected: true,
          protectionReason: `User exclusion tag '${ex.tag_key}=${ex.tag_value}' matched.`,
          sourceScope: 'MANDATORY_SAFETY',
          explanation: `Excluded by custom safety tag '${ex.tag_key}=${ex.tag_value}'.`,
          effectivePolicy: { autoShutdown: false }
        };
      }
    }
  }

  // 2. Evaluate Scoped Policies by Precedence
  const scopesRes = await db.query(
    'SELECT * FROM policy_scopes WHERE user_id = $1 ORDER BY priority ASC, created_at DESC',
    [userId]
  );
  const scopes = scopesRes.rows;

  for (const scope of scopes) {
    const sType = scope.scope_type;
    const sVal = (scope.scope_value || '').toLowerCase();

    // Check VM_NAME_PATTERN
    if (sType === 'VM_NAME_PATTERN') {
      try {
        const regex = new RegExp(scope.scope_value, 'i');
        if (regex.test(vmName)) {
          return {
            isProtected: false,
            protectionReason: null,
            sourceScope: 'VM_NAME_PATTERN',
            explanation: `Scoped policy matched VM name pattern '${scope.scope_value}'. Threshold: ${scope.idle_cpu_threshold}% CPU.`,
            effectivePolicy: {
              idleCpuThreshold: parseFloat(scope.idle_cpu_threshold),
              monitoringWindowMinutes: parseInt(scope.monitoring_window_minutes, 10),
              autoShutdown: Boolean(scope.auto_shutdown),
              scheduledShutdownEnabled: Boolean(scope.scheduled_shutdown_enabled),
              scheduledShutdownTime: scope.scheduled_shutdown_time,
              scheduledStartEnabled: Boolean(scope.scheduled_start_enabled),
              scheduledStartTime: scope.scheduled_start_time,
              scheduleTimezone: scope.schedule_timezone,
              scheduleDays: scope.schedule_days
            }
          };
        }
      } catch (err) {}
    }

    // Check VM_TAG (Format: 'Key=Value')
    if (sType === 'VM_TAG' && sVal.includes('=')) {
      const [tKey, tVal] = sVal.split('=');
      for (const [vmK, vmV] of Object.entries(vmTags || {})) {
        if (vmK.toLowerCase() === tKey.trim() && (vmV || '').toLowerCase() === tVal.trim()) {
          return {
            isProtected: false,
            protectionReason: null,
            sourceScope: 'VM_TAG',
            explanation: `Scoped policy matched VM tag '${scope.scope_value}'. Threshold: ${scope.idle_cpu_threshold}% CPU.`,
            effectivePolicy: {
              idleCpuThreshold: parseFloat(scope.idle_cpu_threshold),
              monitoringWindowMinutes: parseInt(scope.monitoring_window_minutes, 10),
              autoShutdown: Boolean(scope.auto_shutdown),
              scheduledShutdownEnabled: Boolean(scope.scheduled_shutdown_enabled),
              scheduledShutdownTime: scope.scheduled_shutdown_time,
              scheduledStartEnabled: Boolean(scope.scheduled_start_enabled),
              scheduledStartTime: scope.scheduled_start_time,
              scheduleTimezone: scope.schedule_timezone,
              scheduleDays: scope.schedule_days
            }
          };
        }
      }
    }

    // Check RESOURCE_GROUP
    if (sType === 'RESOURCE_GROUP' && resourceGroup === sVal) {
      return {
        isProtected: false,
        protectionReason: null,
        sourceScope: 'RESOURCE_GROUP',
        explanation: `Scoped policy applied for resource group '${scope.scope_value}'. Threshold: ${scope.idle_cpu_threshold}% CPU.`,
        effectivePolicy: {
          idleCpuThreshold: parseFloat(scope.idle_cpu_threshold),
          monitoringWindowMinutes: parseInt(scope.monitoring_window_minutes, 10),
          autoShutdown: Boolean(scope.auto_shutdown),
          scheduledShutdownEnabled: Boolean(scope.scheduled_shutdown_enabled),
          scheduledShutdownTime: scope.scheduled_shutdown_time,
          scheduledStartEnabled: Boolean(scope.scheduled_start_enabled),
          scheduledStartTime: scope.scheduled_start_time,
          scheduleTimezone: scope.schedule_timezone,
          scheduleDays: scope.schedule_days
        }
      };
    }

    // Check SUBSCRIPTION
    if (sType === 'SUBSCRIPTION' && subscriptionId.toLowerCase() === sVal) {
      return {
        isProtected: false,
        protectionReason: null,
        sourceScope: 'SUBSCRIPTION',
        explanation: `Scoped policy applied for subscription '${scope.scope_value}'. Threshold: ${scope.idle_cpu_threshold}% CPU.`,
        effectivePolicy: {
          idleCpuThreshold: parseFloat(scope.idle_cpu_threshold),
          monitoringWindowMinutes: parseInt(scope.monitoring_window_minutes, 10),
          autoShutdown: Boolean(scope.auto_shutdown),
          scheduledShutdownEnabled: Boolean(scope.scheduled_shutdown_enabled),
          scheduledShutdownTime: scope.scheduled_shutdown_time,
          scheduledStartEnabled: Boolean(scope.scheduled_start_enabled),
          scheduledStartTime: scope.scheduled_start_time,
          scheduleTimezone: scope.schedule_timezone,
          scheduleDays: scope.schedule_days
        }
      };
    }
  }

  // 3. Fallback to Global Policy
  const globalPolicy = await getPolicyForUser(userId);
  return {
    isProtected: false,
    protectionReason: null,
    sourceScope: 'GLOBAL',
    explanation: `Default global policy applied (Threshold: ${globalPolicy.idleCpuThreshold}% CPU, Monitoring Window: ${globalPolicy.monitoringWindowMinutes}m).`,
    effectivePolicy: globalPolicy
  };
}

module.exports = {
  getPolicyForUser,
  createDefaultPolicyForUser,
  updatePolicyForUser,
  createPolicyScope,
  getPolicyScopes,
  updatePolicyScope,
  deletePolicyScope,
  resolveEffectivePolicy
};
