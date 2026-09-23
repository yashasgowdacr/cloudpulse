const cron = require('node-cron');
const db = require('../db');
const { getPolicyForUser } = require('./optimizationPolicyService');
const { getAzureCredentialForUser } = require('./azureConnectionResolver');
const { discoverAzureVms, executeVmShutdown, executeVmStart } = require('./azureVmService');
const { recordAction } = require('./actionHistoryService');

const SCHEDULER_LOCK_ID = 987654321;

/**
 * Checks if current time in the specified timezone matches the scheduled HH:mm window (within windowToleranceMinutes).
 */
function isScheduledTimeWindow(targetTime, timezone = 'UTC', daysStr = '1,2,3,4,5', windowToleranceMinutes = 10) {
  if (!targetTime || typeof targetTime !== 'string') return false;
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false
    }).formatToParts(now);

    const currentHour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const currentMinute = parseInt(parts.find(p => p.type === 'minute').value, 10);
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    const [targetH, targetM] = targetTime.split(':').map(Number);
    const targetTotalMinutes = targetH * 60 + targetM;

    const weekdayStr = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      weekday: 'short'
    }).format(now);
    const dayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };
    const currentDay = dayMap[weekdayStr] ?? now.getUTCDay();

    const activeDays = (daysStr || '1,2,3,4,5').split(',').map(s => parseInt(s.trim(), 10));
    if (!activeDays.includes(currentDay)) {
      return false;
    }

    const diff = currentTotalMinutes - targetTotalMinutes;
    return diff >= 0 && diff < windowToleranceMinutes;
  } catch (err) {
    return false;
  }
}

/**
 * Runs an on-demand optimization scan across all active Azure connections for a single tenant.
 */
async function runManualOptimizationForUser(userId) {
  const userPolicy = await getPolicyForUser(userId);
  const connResult = await db.query(
    `SELECT id, connection_name, subscription_id FROM azure_connections WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY created_at ASC`,
    [userId]
  );
  const connections = connResult.rows;

  if (connections.length === 0) {
    const noConnErr = new Error('No active Azure connections found for this user account.');
    noConnErr.code = 'NO_ACTIVE_CONNECTIONS';
    noConnErr.statusCode = 400;
    throw noConnErr;
  }

  const shutdownOptions = {
    threshold: userPolicy.idleCpuThreshold,
    windowMinutes: userPolicy.monitoringWindowMinutes,
    autoShutdown: userPolicy.autoShutdown,
    isManual: false
  };

  const results = [];

  for (const conn of connections) {
    const resolved = await getAzureCredentialForUser(userId, conn.id);
    const vms = await discoverAzureVms(resolved.subscriptionId, resolved.credential);

    for (const vm of vms) {
      if (!vm.resourceGroup || !vm.name) continue;

      const state = (vm.status || '').toLowerCase();
      if (state === 'stopped' || state === 'deallocated') {
        const skipReason = `Optimization skipped: Virtual machine '${vm.name}' is already ${vm.status}.`;
        await recordAction({
          userId,
          connectionId: conn.id,
          vmName: vm.name,
          action: 'DEALLOCATE',
          status: 'SKIPPED',
          cpuAverage: null,
          reason: skipReason
        });
        results.push({ vmName: vm.name, status: 'SKIPPED', reason: skipReason });
        continue;
      }

      const resObj = await executeVmShutdown(
        resolved.subscriptionId,
        vm.resourceGroup,
        vm.name,
        shutdownOptions,
        resolved.credential,
        { userId, connectionId: conn.id }
      );
      results.push(resObj);
    }
  }

  return {
    message: 'Optimization scan completed successfully.',
    totalVmsEvaluated: results.length,
    results
  };
}

/**
 * Runs scheduled multi-tenant optimization scan protected by a PostgreSQL advisory lock.
 * Processes active users and their active Azure connections sequentially with strict per-tenant isolation.
 */
async function runScheduledOptimization() {
  let lockAcquired = false;
  try {
    const lockRes = await db.query('SELECT pg_try_advisory_lock($1) AS acquired', [SCHEDULER_LOCK_ID]);
    lockAcquired = lockRes.rows[0] ? lockRes.rows[0].acquired : false;
  } catch (err) {
    console.error('[SCHEDULER] Error checking PostgreSQL advisory lock:', err.message);
    return;
  }

  if (!lockAcquired) {
    console.log('[SCHEDULER] Optimization scan already running on another instance (PostgreSQL advisory lock held). Skipping duplicate execution.');
    return;
  }

  console.log('[SCHEDULER] Starting multi-user optimization scan (advisory lock acquired)...');

  try {
    const usersResult = await db.query(
      `SELECT id, email FROM users WHERE status = 'ACTIVE' ORDER BY created_at ASC`
    );
    const activeUsers = usersResult.rows;
    console.log(`[SCHEDULER] Active users discovered: ${activeUsers.length}`);

    let totalUserConnectionsProcessed = 0;

    for (const user of activeUsers) {
      try {
        const userPolicy = await getPolicyForUser(user.id);

        const connResult = await db.query(
          `SELECT id, connection_name, subscription_id FROM azure_connections WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY created_at ASC`,
          [user.id]
        );
        const connections = connResult.rows;

        if (connections.length === 0) {
          continue;
        }

        const isScheduledStartWindow = userPolicy.scheduledStartEnabled &&
          isScheduledTimeWindow(userPolicy.scheduledStartTime, userPolicy.scheduleTimezone, userPolicy.scheduleDays, 10);

        const isScheduledShutdownWindow = userPolicy.scheduledShutdownEnabled &&
          isScheduledTimeWindow(userPolicy.scheduledShutdownTime, userPolicy.scheduleTimezone, userPolicy.scheduleDays, 10);

        console.log(`[SCHEDULER] User: ${user.email} (id: ${user.id}) | Active Azure connections: ${connections.length} | Policy [threshold: ${userPolicy.idleCpuThreshold}%, autoShutdown: ${userPolicy.autoShutdown}, schedStart: ${userPolicy.scheduledStartEnabled} (${isScheduledStartWindow}), schedShutdown: ${userPolicy.scheduledShutdownEnabled} (${isScheduledShutdownWindow})]`);

        const shutdownOptions = {
          threshold: userPolicy.idleCpuThreshold,
          windowMinutes: userPolicy.monitoringWindowMinutes,
          autoShutdown: userPolicy.autoShutdown,
          isManual: false
        };

        for (const conn of connections) {
          totalUserConnectionsProcessed++;
          try {
            console.log(`[SCHEDULER] Processing connection: ${conn.id} | Subscription: ${conn.subscription_id}`);

            const resolved = await getAzureCredentialForUser(user.id, conn.id);
            const vms = await discoverAzureVms(resolved.subscriptionId, resolved.credential);
            console.log(`[SCHEDULER] Connection ${conn.id}: Discovered ${vms.length} Virtual Machine(s).`);

            for (const vm of vms) {
              if (!vm.resourceGroup || !vm.name) continue;

              try {
                const state = (vm.status || '').toLowerCase();
                const isStoppedOrDeallocated = state === 'stopped' || state === 'deallocated';

                // 1. Scheduled Start Window: Power ON stopped/deallocated VMs
                if (isScheduledStartWindow && isStoppedOrDeallocated) {
                  console.log(`[SCHEDULER] Executing scheduled start for VM '${vm.name}'`);
                  await executeVmStart(
                    resolved.subscriptionId,
                    vm.resourceGroup,
                    vm.name,
                    {},
                    resolved.credential,
                    { userId: user.id, connectionId: conn.id }
                  );
                  continue;
                }

                // If VM is already stopped/deallocated, skip shutdown
                if (isStoppedOrDeallocated) {
                  const skipReason = `Optimization skipped: Virtual machine '${vm.name}' is already ${vm.status}.`;
                  console.log(`[SCHEDULER] VM: '${vm.name}' | State: ${vm.status} | Decision: SKIPPED`);

                  await recordAction({
                    userId: user.id,
                    connectionId: conn.id,
                    vmName: vm.name,
                    action: 'DEALLOCATE',
                    status: 'SKIPPED',
                    cpuAverage: null,
                    reason: skipReason
                  });

                  continue;
                }

                // 2. Scheduled Shutdown Window: Deallocate running VM (strictly protected by production safeguards & exclusion tags)
                if (isScheduledShutdownWindow) {
                  console.log(`[SCHEDULER] Executing scheduled shutdown for running VM '${vm.name}'`);
                  const schedResult = await executeVmShutdown(
                    resolved.subscriptionId,
                    vm.resourceGroup,
                    vm.name,
                    { ...shutdownOptions, autoShutdown: true, isManual: false },
                    resolved.credential,
                    { userId: user.id, connectionId: conn.id }
                  );
                  console.log(`[SCHEDULER] VM: '${vm.name}' | State: ${vm.status} | Scheduled Shutdown Decision: ${schedResult.reason}`);
                  continue;
                }

                // 3. CPU-based Optimization Scan (if auto_shutdown is configured)
                if (userPolicy.autoShutdown) {
                  console.log(`[SCHEDULER] VM: '${vm.name}' | State: ${vm.status} | Evaluating CPU metrics & shutdown policy...`);
                  const result = await executeVmShutdown(
                    resolved.subscriptionId,
                    vm.resourceGroup,
                    vm.name,
                    shutdownOptions,
                    resolved.credential,
                    { userId: user.id, connectionId: conn.id }
                  );
                  console.log(`[SCHEDULER] VM: '${vm.name}' | State: ${vm.status} | Decision: ${result.reason}`);
                }
              } catch (vmErr) {
                console.error(`[SCHEDULER] Error evaluating VM '${vm.name}' on connection ${conn.id}:`, vmErr.message);
              }
            }
          } catch (connErr) {
            console.error(`[SCHEDULER] Error processing Azure connection ${conn.id} for user ${user.email}:`, connErr.message);
          }
        }

        // Budget Evaluation & Deduplicated Notification Check (Phase 8)
        try {
          const { evaluateBudgetsForUser } = require('./budgetService');
          await evaluateBudgetsForUser(user.id, user.email);
        } catch (bErr) {
          console.warn(`[SCHEDULER] Budget evaluation notice for user ${user.email}:`, bErr.message);
        }

        // Cost Anomaly Detection (Phase 8)
        try {
          const { detectAnomaliesForUser } = require('./anomalyDetectionService');
          await detectAnomaliesForUser(user.id);
        } catch (aErr) {
          console.warn(`[SCHEDULER] Anomaly detection notice for user ${user.email}:`, aErr.message);
        }
      } catch (userErr) {
        console.error(`[SCHEDULER] Error processing user ${user.email} (id: ${user.id}):`, userErr.message);
      }
    }

    console.log(`[SCHEDULER] Multi-user optimization scan complete. Total user connections processed: ${totalUserConnectionsProcessed}.`);
  } catch (scanErr) {
    console.error('[SCHEDULER] Critical error during multi-user optimization scan:', scanErr.message);
  } finally {
    try {
      await db.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK_ID]);
      console.log('[SCHEDULER] PostgreSQL advisory lock released.');
    } catch (unlockErr) {
      console.error('[SCHEDULER] Error releasing PostgreSQL advisory lock:', unlockErr.message);
    }
  }
}

/**
 * Initializes recurring cron schedule for VM optimization scans.
 * Runs every 10 minutes.
 */
function initScheduler() {
  const task = cron.schedule('*/10 * * * *', () => {
    runScheduledOptimization();
  });
  console.log('Scheduler initialized: running VM optimization scan every 10 minutes.');
  return task;
}

module.exports = {
  SCHEDULER_LOCK_ID,
  runScheduledOptimization,
  runManualOptimizationForUser,
  initScheduler
};
