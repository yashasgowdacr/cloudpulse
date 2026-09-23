const { DefaultAzureCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { MetricsQueryClient } = require('@azure/monitor-query');
const db = require('../db');
const { recordAction } = require('./actionHistoryService');

/**
 * Extracts and maps Azure VM power state from instance view statuses array.
 */
function getVmPowerState(statuses) {
  if (!statuses || !Array.isArray(statuses)) return 'unknown';

  const powerStatus = statuses.find(s => s.code && s.code.startsWith('PowerState/'));
  if (!powerStatus) return 'unknown';

  const state = powerStatus.code.split('/')[1];
  if (state === 'running' || state === 'stopped' || state === 'deallocated') {
    return state;
  }

  if (state && state.includes('deallocat')) return 'deallocated';
  if (state && state.includes('stop')) return 'stopped';
  if (state && (state.includes('running') || state.includes('start'))) return 'running';

  return 'unknown';
}

/**
 * Discovers virtual machines across resource groups in a subscription.
 */
async function discoverAzureVms(subscriptionId, customCredential = null) {
  const credential = customCredential || new DefaultAzureCredential();
  const client = new ComputeManagementClient(credential, subscriptionId);

  const vms = [];
  for await (const vm of client.virtualMachines.listAll()) {
    const resourceGroup = vm.id ? vm.id.split('/')[4] : null;
    let status = 'unknown';

    if (resourceGroup && vm.name) {
      try {
        const instanceView = await client.virtualMachines.instanceView(resourceGroup, vm.name);
        status = getVmPowerState(instanceView.statuses);
      } catch (err) {
        // Fallback to unknown if instance view lookup fails
      }
    }

    vms.push({
      name: vm.name,
      location: vm.location,
      resourceGroup: resourceGroup,
      size: vm.hardwareProfile ? vm.hardwareProfile.vmSize : null,
      status: status,
      tags: vm.tags || {}
    });
  }

  return vms;
}

/**
 * Fetches Percentage CPU utilization metrics from Azure Monitor for a specific VM.
 */
async function fetchVmCpuMetrics(subscriptionId, resourceGroup, vmName, timespan = 'PT30M', customCredential = null) {
  const credential = customCredential || new DefaultAzureCredential();
  const metricsQueryClient = new MetricsQueryClient(credential);

  const resourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}`;

  const metricsResponse = await metricsQueryClient.queryResource(
    resourceId,
    ['Percentage CPU'],
    {
      timespan: { duration: timespan },
      aggregations: ['Average']
    }
  );

  const metric = metricsResponse.getMetricByName ? metricsResponse.getMetricByName('Percentage CPU') : null;

  let totalCpu = 0;
  let dataPointCount = 0;
  const dataPoints = [];

  if (metric && metric.timeseries) {
    for (const ts of metric.timeseries) {
      if (ts.data) {
        for (const point of ts.data) {
          if (point.average !== undefined && point.average !== null) {
            totalCpu += point.average;
            dataPointCount++;
            dataPoints.push({
              timeStamp: point.timeStamp,
              average: point.average
            });
          }
        }
      }
    }
  }

  const avgCpu = dataPointCount > 0 ? totalCpu / dataPointCount : null;
  const averageCpuPercentage = avgCpu !== null ? Math.round(avgCpu * 100) / 100 : null;

  return {
    averageCpuPercentage,
    dataPointsCount: dataPoints.length,
    dataPoints
  };
}

/**
 * Evaluates whether a VM is considered idle given CPU metrics and threshold.
 */
function evaluateVmIdleStatus(vmName, metricsData, threshold = 5, windowMinutes = 30) {
  const cpuAverage = (metricsData && typeof metricsData === 'object' && 'averageCpuPercentage' in metricsData)
    ? metricsData.averageCpuPercentage
    : metricsData;

  if (cpuAverage === null || cpuAverage === undefined) {
    return {
      vmName,
      cpuAverage: null,
      threshold,
      windowMinutes,
      idle: false,
      reason: `Insufficient monitoring data: No CPU metric data available for the last ${windowMinutes} minutes.`
    };
  }

  const idle = cpuAverage < threshold;
  const reason = idle
    ? `Average CPU usage (${cpuAverage}%) over the last ${windowMinutes} minutes is below the threshold of ${threshold}%.`
    : `Average CPU usage (${cpuAverage}%) over the last ${windowMinutes} minutes is at or above the threshold of ${threshold}%.`;

  return {
    vmName,
    cpuAverage,
    threshold,
    windowMinutes,
    idle,
    reason
  };
}

/**
 * Evaluates whether deallocation is permitted under current policy and environment constraints.
 * CRITICAL SAFETY: Production environments are strictly protected.
 */
function evaluateShutdownPolicy(vmName, idleResult, environment = 'development', autoShutdown = true, exclusionTagMatched = null) {
  const idle = (idleResult && typeof idleResult === 'object') ? idleResult.idle : Boolean(idleResult);
  const cpuAverage = (idleResult && typeof idleResult === 'object') ? idleResult.cpuAverage : null;
  const hasInsufficientData = (idleResult && typeof idleResult === 'object' && idleResult.cpuAverage === null);

  const envNormalized = (environment || '').toLowerCase();

  if (hasInsufficientData) {
    return {
      vmName,
      idle: false,
      cpuAverage: null,
      environment,
      autoShutdown,
      allowed: false,
      reason: 'Shutdown blocked: Insufficient monitoring data available to evaluate idle status.'
    };
  }

  if (envNormalized === 'production') {
    return {
      vmName,
      idle,
      cpuAverage,
      environment,
      autoShutdown,
      allowed: false,
      reason: 'Shutdown blocked: Virtual machine is in a production environment.'
    };
  }

  if (exclusionTagMatched) {
    return {
      vmName,
      idle,
      cpuAverage,
      environment,
      autoShutdown,
      allowed: false,
      reason: `Shutdown blocked: Virtual machine matches user exclusion tag '${exclusionTagMatched}'.`
    };
  }

  if (!autoShutdown) {
    return {
      vmName,
      idle,
      cpuAverage,
      environment,
      autoShutdown,
      allowed: false,
      reason: 'Shutdown blocked: Automatic shutdown setting is disabled for this virtual machine.'
    };
  }

  if (!idle) {
    return {
      vmName,
      idle,
      cpuAverage,
      environment,
      autoShutdown,
      allowed: false,
      reason: 'Shutdown blocked: Virtual machine is active and not idle.'
    };
  }

  return {
    vmName,
    idle,
    cpuAverage,
    environment,
    autoShutdown,
    allowed: true,
    reason: 'Shutdown allowed: Virtual machine is idle, non-production, and automatic shutdown is enabled.'
  };
}

/**
 * Standardizes query and body options across VM endpoints.
 */
function parseQueryOptions(query) {
  let windowMinutes = 30;
  if (query.windowMinutes) {
    const parsed = parseInt(query.windowMinutes, 10);
    if (!isNaN(parsed) && parsed > 0) windowMinutes = parsed;
  } else if (query.minutes) {
    const parsed = parseInt(query.minutes, 10);
    if (!isNaN(parsed) && parsed > 0) windowMinutes = parsed;
  } else if (query.duration) {
    const parsed = parseInt(query.duration, 10);
    if (!isNaN(parsed) && parsed > 0) windowMinutes = parsed;
  }

  let timespan = `PT${windowMinutes}M`;
  if (query.timespan && typeof query.timespan === 'string' && query.timespan.startsWith('P')) {
    timespan = query.timespan;
  } else if (query.duration && typeof query.duration === 'string' && query.duration.startsWith('P')) {
    timespan = query.duration;
  }

  let threshold = 5;
  if (query.threshold !== undefined) {
    const parsed = parseFloat(query.threshold);
    if (!isNaN(parsed) && parsed >= 0) threshold = parsed;
  }

  const environment = query.environment || 'development';
  let autoShutdown = true;
  if (query.autoShutdown !== undefined) {
    autoShutdown = query.autoShutdown === 'true' || query.autoShutdown === '1';
  }

  return { windowMinutes, timespan, threshold, environment, autoShutdown };
}

/**
 * Executes VM shutdown / deallocation on Azure with safety guards.
 * CRITICAL SAFETY CHECKS:
 * - Automatically detects production environment from VM name or Azure resource tags.
 * - Re-checks power state; skips already stopped/deallocated VMs.
 * - Records action outcome in audit history.
 */
async function executeVmShutdown(subscriptionId, resourceGroup, vmName, options = {}, customCredential = null, context = {}) {
  const userId = context.userId || options.userId || null;
  const connectionId = context.connectionId || options.connectionId || null;

  const windowMinutes = options.windowMinutes || 30;
  const timespan = options.timespan || `PT${windowMinutes}M`;
  const threshold = options.threshold !== undefined ? options.threshold : 5;
  let environment = options.environment || 'development';
  let autoShutdown = options.autoShutdown !== undefined ? options.autoShutdown : true;

  const credential = customCredential || new DefaultAzureCredential();
  const computeClient = new ComputeManagementClient(credential, subscriptionId);

  // Auto-detect production environment from VM name or Azure tags
  if (vmName.toLowerCase().includes('prod') || vmName.toLowerCase().includes('production')) {
    environment = 'production';
  }

  let matchedExclusionTag = null;
  try {
    const vmResource = await computeClient.virtualMachines.get(resourceGroup, vmName);
    if (vmResource && vmResource.tags) {
      const vmTags = vmResource.tags;
      const envTag = vmTags.Environment || vmTags.environment || vmTags.ENV || vmTags.env;
      if (envTag && envTag.toLowerCase() === 'production') {
        environment = 'production';
      }
      const autoShutdownTag = vmTags.AutoShutdown || vmTags.autoshutdown;
      if (autoShutdownTag && (autoShutdownTag.toLowerCase() === 'disabled' || autoShutdownTag.toLowerCase() === 'false')) {
        autoShutdown = false;
      }

      // Check user custom exclusion tags (additional safety rules)
      if (userId) {
        try {
          const exclusionResult = await db.query(
            `SELECT tag_key, tag_value FROM user_exclusion_tags WHERE user_id = $1`,
            [userId]
          );
          if (exclusionResult && exclusionResult.rows) {
            for (const row of exclusionResult.rows) {
              for (const [k, v] of Object.entries(vmTags)) {
                if (k.toLowerCase() === row.tag_key.toLowerCase() && String(v).toLowerCase() === row.tag_value.toLowerCase()) {
                  matchedExclusionTag = `${row.tag_key}=${row.tag_value}`;
                  autoShutdown = false;
                  break;
                }
              }
              if (matchedExclusionTag) break;
            }
          }
        } catch (dbErr) {
          // Non-blocking fallback
        }
      }
    }
  } catch (tagErr) {
    // Proceed if Azure tag query fails
  }

  let instanceView;
  try {
    instanceView = await computeClient.virtualMachines.instanceView(resourceGroup, vmName);
  } catch (err) {
    if (err.statusCode === 404 || (err.message && err.message.includes('ResourceNotFound'))) {
      const result = {
        vmName,
        action: 'DEALLOCATE',
        executed: false,
        allowed: false,
        error: 'VM_NOT_FOUND',
        reason: `Deallocation failed: Virtual machine '${vmName}' was not found in resource group '${resourceGroup}'.`,
        details: err.message
      };

      await recordAction({
        userId,
        connectionId,
        vmName,
        action: 'DEALLOCATE',
        status: 'FAILED',
        cpuAverage: null,
        reason: result.reason
      });

      return result;
    }
    if (err.statusCode === 403 || (err.code && err.code.includes('AuthorizationFailed'))) {
      const result = {
        vmName,
        action: 'DEALLOCATE',
        executed: false,
        allowed: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        reason: `Deallocation failed: Insufficient Azure permissions to view VM '${vmName}'.`,
        details: err.message
      };

      await recordAction({
        userId,
        connectionId,
        vmName,
        action: 'DEALLOCATE',
        status: 'FAILED',
        cpuAverage: null,
        reason: result.reason
      });

      return result;
    }

    const result = {
      vmName,
      action: 'DEALLOCATE',
      executed: false,
      allowed: false,
      error: 'AZURE_API_FAILURE',
      reason: `Deallocation failed while checking status for VM '${vmName}': ${err.message}`,
      details: err.message
    };

    await recordAction({
      userId,
      connectionId,
      vmName,
      action: 'DEALLOCATE',
      status: 'FAILED',
      cpuAverage: null,
      reason: result.reason
    });

    return result;
  }

  const currentPowerState = getVmPowerState(instanceView.statuses);
  if (currentPowerState === 'stopped' || currentPowerState === 'deallocated') {
    const skipReason = `Deallocation skipped: Virtual machine '${vmName}' is already ${currentPowerState}.`;
    const result = {
      vmName,
      action: 'DEALLOCATE',
      executed: false,
      allowed: false,
      status: 'SKIPPED',
      reason: skipReason
    };

    await recordAction({
      userId,
      connectionId,
      vmName,
      action: 'DEALLOCATE',
      status: 'SKIPPED',
      cpuAverage: null,
      reason: skipReason
    });

    return result;
  }

  const isManual = options.isManual !== undefined ? options.isManual : true;

  let policyResult;
  if (isManual) {
    if (environment === 'production') {
      policyResult = {
        vmName,
        idle: false,
        cpuAverage: null,
        environment: 'production',
        autoShutdown: true,
        allowed: false,
        reason: 'Shutdown blocked: Virtual machine is in a production environment.'
      };
    } else if (matchedExclusionTag) {
      policyResult = {
        vmName,
        idle: false,
        cpuAverage: null,
        environment,
        autoShutdown: false,
        allowed: false,
        reason: `Shutdown blocked: Virtual machine matches user exclusion tag '${matchedExclusionTag}'.`
      };
    } else {
      policyResult = {
        vmName,
        idle: true,
        cpuAverage: null,
        environment,
        autoShutdown: true,
        allowed: true,
        reason: 'Manual deallocation requested by authenticated user.'
      };
    }
  } else {
    const metricsData = await fetchVmCpuMetrics(subscriptionId, resourceGroup, vmName, timespan, customCredential);
    const idleStatus = evaluateVmIdleStatus(vmName, metricsData, threshold, windowMinutes);
    policyResult = evaluateShutdownPolicy(vmName, idleStatus, environment, autoShutdown, matchedExclusionTag);
  }

  if (!policyResult.allowed) {
    const result = {
      vmName,
      action: 'DEALLOCATE',
      executed: false,
      allowed: false,
      reason: policyResult.reason,
      policy: policyResult
    };

    await recordAction({
      userId,
      connectionId,
      vmName,
      action: 'DEALLOCATE',
      status: 'BLOCKED',
      cpuAverage: policyResult.cpuAverage,
      reason: policyResult.reason
    });

    return result;
  }

  try {
    await computeClient.virtualMachines.beginDeallocateAndWait(resourceGroup, vmName);

    const result = {
      vmName,
      action: 'DEALLOCATE',
      executed: true,
      allowed: true,
      status: 'deallocated',
      reason: `Virtual machine '${vmName}' was successfully deallocated in resource group '${resourceGroup}'.`,
      policy: policyResult
    };

    await recordAction({
      userId,
      connectionId,
      vmName,
      action: 'DEALLOCATE',
      status: 'SUCCESS',
      cpuAverage: policyResult.cpuAverage,
      reason: result.reason
    });

    return result;
  } catch (err) {
    let errorCode = 'AZURE_API_FAILURE';
    let userReason = `Deallocation failed for VM '${vmName}': ${err.message}`;

    if (err.statusCode === 403 || (err.code && err.code.includes('AuthorizationFailed'))) {
      errorCode = 'INSUFFICIENT_PERMISSIONS';
      userReason = `Deallocation failed: Insufficient Azure permissions to deallocate VM '${vmName}'.`;
    }

    const result = {
      vmName,
      action: 'DEALLOCATE',
      executed: false,
      allowed: true,
      error: errorCode,
      reason: userReason,
      details: err.message,
      policy: policyResult
    };

    await recordAction({
      userId,
      connectionId,
      vmName,
      action: 'DEALLOCATE',
      status: 'FAILED',
      cpuAverage: policyResult.cpuAverage,
      reason: userReason
    });

    return result;
  }
}

/**
 * Powers ON (starts) a deallocated or stopped Azure VM.
 */
async function executeVmStart(subscriptionId, resourceGroup, vmName, options = {}, customCredential = null, context = {}) {
  const userId = context.userId || options.userId || null;
  const connectionId = context.connectionId || options.connectionId || null;

  const credential = customCredential || new DefaultAzureCredential();
  const computeClient = new ComputeManagementClient(credential, subscriptionId);

  console.log(`[VM-START] Initiating start command for VM '${vmName}' in RG '${resourceGroup}'...`);
  try {
    await computeClient.virtualMachines.beginStartAndWait(resourceGroup, vmName);

    await recordAction({
      userId,
      connectionId,
      vmName,
      action: 'START',
      status: 'SUCCESS',
      cpuAverage: null,
      reason: `Virtual machine '${vmName}' was successfully powered ON (started) on Azure.`
    });

    return {
      vmName,
      action: 'START',
      executed: true,
      status: 'RUNNING',
      message: `Virtual machine '${vmName}' was successfully started on Azure.`
    };
  } catch (error) {
    console.error(`[VM-START] Failed to start VM '${vmName}':`, error.message);
    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to start VM';

    try {
      await recordAction({
        userId,
        connectionId,
        vmName,
        action: 'START',
        status: 'FAILED',
        cpuAverage: null,
        reason: `Failed to power ON virtual machine '${vmName}': ${sanitizedMsg}`
      });
    } catch (recErr) {
      console.error('[VM-START] Failed to record start failure:', recErr.message);
    }

    throw error;
  }
}

/**
 * Executes bulk VM deallocation with per-VM safety evaluation and controlled concurrency.
 * Invariant: Production VMs and exclusion tags are NEVER bypassed.
 */
async function executeBulkShutdown(subscriptionId, vmsList = [], options = {}, credential = null, tenantContext = {}) {
  const MAX_BATCH_SIZE = 50;
  if (!Array.isArray(vmsList)) {
    const err = new Error('vms must be an array of objects containing resourceGroup and vmName');
    err.statusCode = 400;
    throw err;
  }

  if (vmsList.length > MAX_BATCH_SIZE) {
    const err = new Error(`Batch size exceeds maximum limit of ${MAX_BATCH_SIZE} virtual machines`);
    err.statusCode = 400;
    throw err;
  }

  const results = {
    success: [],
    skipped: [],
    protected: [],
    failed: []
  };

  for (const item of vmsList) {
    const { resourceGroup, vmName } = item || {};
    if (!resourceGroup || !vmName) {
      results.failed.push({ resourceGroup, vmName, reason: 'Missing resourceGroup or vmName' });
      continue;
    }

    try {
      const shutdownRes = await executeVmShutdown(
        subscriptionId,
        resourceGroup,
        vmName,
        { ...options, isManual: true },
        credential,
        tenantContext
      );

      if (shutdownRes.allowed && shutdownRes.executed) {
        results.success.push({ vmName, resourceGroup, status: 'deallocated', reason: shutdownRes.reason });
      } else if (shutdownRes.status === 'SKIPPED') {
        results.skipped.push({ vmName, resourceGroup, status: 'SKIPPED', reason: shutdownRes.reason });
      } else {
        // BLOCKED by safety guard (production or exclusion tag)
        results.protected.push({ vmName, resourceGroup, status: 'PROTECTED', reason: shutdownRes.reason });
      }
    } catch (err) {
      results.failed.push({
        vmName,
        resourceGroup,
        status: 'FAILED',
        error: err.message ? err.message.replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Deallocation failed'
      });
    }
  }

  return results;
}

/**
 * Executes bulk VM start with per-VM handling and controlled concurrency.
 */
async function executeBulkStart(subscriptionId, vmsList = [], options = {}, credential = null, tenantContext = {}) {
  const MAX_BATCH_SIZE = 50;
  if (!Array.isArray(vmsList)) {
    const err = new Error('vms must be an array of objects containing resourceGroup and vmName');
    err.statusCode = 400;
    throw err;
  }

  if (vmsList.length > MAX_BATCH_SIZE) {
    const err = new Error(`Batch size exceeds maximum limit of ${MAX_BATCH_SIZE} virtual machines`);
    err.statusCode = 400;
    throw err;
  }

  const results = {
    success: [],
    skipped: [],
    protected: [],
    failed: []
  };

  for (const item of vmsList) {
    const { resourceGroup, vmName } = item || {};
    if (!resourceGroup || !vmName) {
      results.failed.push({ resourceGroup, vmName, reason: 'Missing resourceGroup or vmName' });
      continue;
    }

    try {
      const startRes = await executeVmStart(
        subscriptionId,
        resourceGroup,
        vmName,
        options,
        credential,
        tenantContext
      );

      if (startRes.executed) {
        results.success.push({ vmName, resourceGroup, status: 'running', reason: startRes.reason });
      } else {
        results.skipped.push({ vmName, resourceGroup, status: 'SKIPPED', reason: startRes.reason });
      }
    } catch (err) {
      results.failed.push({
        vmName,
        resourceGroup,
        status: 'FAILED',
        error: err.message ? err.message.replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Start failed'
      });
    }
  }

  return results;
}

module.exports = {
  getVmPowerState,
  discoverAzureVms,
  fetchVmCpuMetrics,
  evaluateVmIdleStatus,
  evaluateShutdownPolicy,
  parseQueryOptions,
  executeVmShutdown,
  executeVmStart,
  executeBulkShutdown,
  executeBulkStart
};
