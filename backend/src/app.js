const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { DefaultAzureCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { MetricsQueryClient } = require('@azure/monitor-query');
const { CostManagementClient } = require('@azure/arm-costmanagement');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
require('dotenv').config();

const authRouter = require('./routes/auth');
const azureConnectionsRouter = require('./routes/azureConnections');
const optimizationPoliciesRouter = require('./routes/optimizationPolicies');
const { authenticateToken, requireRole } = require('./middleware/auth');
const { getAzureCredentialForUser } = require('./services/azureConnectionResolver');
const { getEncryptionKey } = require('./utils/crypto');
const db = require('./db');

// Validate critical production encryption key on application startup
try {
  getEncryptionKey();
} catch (configErr) {
  console.error('[FATAL-STARTUP-ERROR]', configErr.message);
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const app = express();

// Trust reverse proxy (Render, Vercel, Nginx) for rate-limiting & client IP detection
app.set('trust proxy', 1);

app.use(helmet());
app.use(cookieParser());

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'TOO_MANY_REQUESTS',
    message: 'Too many authentication attempts. Please try again after 15 minutes.'
  }
});

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'https://cloudpulse-ochre.vercel.app'
];
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : defaultOrigins;

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy: Not allowed by origin'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '100kb' }));

app.use('/api/auth', authRateLimiter, authRouter);
app.use('/api/azure-connections', azureConnectionsRouter);
app.use('/api/optimization-policy', optimizationPoliciesRouter);

app.get('/health', (req, res) => {
  res.json({
    status: 'UP',
    message: 'CloudPulse API is running'
  });
});

app.get('/azure/health', async (req, res) => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

  if (!subscriptionId) {
    return res.status(500).json({
      status: 'DOWN',
      message: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
    });
  }

  try {
    const credential = new DefaultAzureCredential();
    const token = await credential.getToken('https://management.azure.com/.default');

    if (token) {
      return res.json({
        status: 'UP',
        message: 'Azure authentication successful'
      });
    } else {
      return res.status(500).json({
        status: 'DOWN',
        message: 'Failed to acquire Azure token'
      });
    }
  } catch (error) {
    return res.status(500).json({
      status: 'DOWN',
      message: 'Azure authentication failed',
      error: error.message
    });
  }
});

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
      status: status
    });
  }

  return vms;
}

app.get('/azure/vms', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const vms = await discoverAzureVms(resolved.subscriptionId, resolved.credential);

    return res.json({
      count: vms.length,
      vms: vms
    });
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

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to discover virtual machines';

    return res.status(500).json({
      error: 'VM_DISCOVERY_FAILURE',
      message: `Failed to discover virtual machines: ${sanitizedMsg}`
    });
  }
});

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

function evaluateShutdownPolicy(vmName, idleResult, environment = 'development', autoShutdown = true) {
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

function evaluateDryRunShutdown(vmName, policyResult) {
  const wouldExecute = policyResult.allowed;
  const reason = wouldExecute
    ? `[DRY-RUN] Virtual machine '${vmName}' meets all policy requirements and WOULD be deallocated.`
    : `[DRY-RUN] Virtual machine '${vmName}' deallocation WOULD NOT execute. Reason: ${policyResult.reason}`;

  return {
    vmName,
    action: 'DEALLOCATE',
    dryRun: true,
    wouldExecute,
    idle: policyResult.idle,
    cpuAverage: policyResult.cpuAverage,
    environment: policyResult.environment,
    autoShutdown: policyResult.autoShutdown,
    allowed: policyResult.allowed,
    reason,
    policy: policyResult
  };
}

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

async function sendDeallocationNotification(actionRecord) {
  if (actionRecord.dryRun) {
    return;
  }

  const isSuccess = actionRecord.status === 'SUCCESS';
  const isFailure = actionRecord.status === 'FAILED';

  if (!isSuccess && !isFailure) {
    return;
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host) {
    console.log('[NOTIFICATION] Notification skipped: SMTP_HOST environment variable not configured.');
    return;
  }

  if (!actionRecord.userId) {
    console.log(`[NOTIFICATION] Notification skipped: Action record missing user ID for VM '${actionRecord.vmName}'.`);
    return;
  }

  let recipientEmail = null;
  try {
    const userRes = await db.query(
      `SELECT email FROM users WHERE id = $1 AND status = 'ACTIVE'`,
      [actionRecord.userId]
    );
    if (userRes.rows.length > 0) {
      recipientEmail = userRes.rows[0].email;
    }
  } catch (dbErr) {
    console.error('[NOTIFICATION] Error resolving user email from database:', dbErr.message);
  }

  if (!recipientEmail) {
    console.log(`[NOTIFICATION] Notification skipped: No active user account found for user ID '${actionRecord.userId}' (VM: '${actionRecord.vmName}').`);
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: (user && pass) ? { user, pass } : undefined
    });

    const subject = `[CloudPulse Alert] Azure VM Deallocation ${actionRecord.status}: ${actionRecord.vmName}`;
    const cpuStr = actionRecord.cpuAverage !== null && actionRecord.cpuAverage !== undefined
      ? `${actionRecord.cpuAverage}%`
      : 'N/A';

    const textContent = [
      `CloudPulse Optimization Notification`,
      `----------------------------------------`,
      `User/Account: ${recipientEmail}`,
      `VM Name: ${actionRecord.vmName}`,
      `Action: ${actionRecord.action}`,
      `Status: ${actionRecord.status}`,
      `CPU Average: ${cpuStr}`,
      `Reason: ${actionRecord.reason}`,
      `Timestamp: ${actionRecord.timestamp}`,
      `----------------------------------------`
    ].join('\n');

    await transporter.sendMail({
      from: user || `cloudpulse@${host}`,
      to: recipientEmail,
      subject,
      text: textContent
    });

    console.log(`[NOTIFICATION] Email sent successfully to ${recipientEmail} for VM '${actionRecord.vmName}' (Status: ${actionRecord.status}).`);
  } catch (error) {
    console.error(`[NOTIFICATION] Failed to send email notification for VM '${actionRecord.vmName}':`, error.message);
  }
}

async function recordAction(entry) {
  const userId = entry.userId || entry.user_id || null;
  const connectionId = entry.connectionId || entry.connection_id || null;
  const vmName = entry.vmName;
  const action = entry.action || 'DEALLOCATE';
  const status = entry.status || (entry.executed ? 'SUCCESS' : (entry.dryRun ? 'DRY_RUN' : 'BLOCKED'));
  const dryRun = Boolean(entry.dryRun);
  const cpuAverage = entry.cpuAverage !== undefined ? entry.cpuAverage : (entry.policy ? entry.policy.cpuAverage : null);
  const reason = entry.reason || '';

  try {
    const query = `
      INSERT INTO action_history (user_id, connection_id, vm_name, action, status, dry_run, cpu_average, reason)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, user_id, connection_id, vm_name, action, status, dry_run, cpu_average, reason, created_at
    `;
    const values = [userId, connectionId, vmName, action, status, dryRun, cpuAverage, reason];
    const result = await db.query(query, values);
    const row = result.rows[0];

    const record = {
      id: row.id,
      userId: row.user_id,
      connectionId: row.connection_id,
      vmName: row.vm_name,
      action: row.action,
      status: row.status,
      dryRun: Boolean(row.dry_run),
      cpuAverage: row.cpu_average !== null ? parseFloat(row.cpu_average) : null,
      reason: row.reason,
      timestamp: row.created_at
    };

    sendDeallocationNotification(record).catch(err => {
      console.error('[NOTIFICATION] Unexpected error handling email dispatch:', err.message);
    });

    return record;
  } catch (err) {
    console.error('[ACTION-HISTORY] Error persisting action record:', err.message);
    return {
      vmName,
      action,
      status,
      dryRun,
      cpuAverage,
      reason,
      timestamp: new Date().toISOString()
    };
  }
}

async function getActions(userId, vmNameFilter = null) {
  if (!userId) {
    return [];
  }

  let query;
  let values;

  if (vmNameFilter) {
    query = `
      SELECT id, user_id, connection_id, vm_name, action, status, dry_run, cpu_average, reason, created_at
      FROM action_history
      WHERE (user_id = $1 OR user_id IS NULL) AND LOWER(vm_name) = LOWER($2)
      ORDER BY created_at DESC
    `;
    values = [userId, vmNameFilter];
  } else {
    query = `
      SELECT id, user_id, connection_id, vm_name, action, status, dry_run, cpu_average, reason, created_at
      FROM action_history
      WHERE (user_id = $1 OR user_id IS NULL)
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
    dryRun: Boolean(row.dry_run),
    cpuAverage: row.cpu_average !== null ? parseFloat(row.cpu_average) : null,
    reason: row.reason,
    timestamp: row.created_at
  }));
}

async function executeVmShutdown(subscriptionId, resourceGroup, vmName, options = {}, customCredential = null, context = {}) {
  const userId = context.userId || options.userId || null;
  const connectionId = context.connectionId || options.connectionId || null;
  const isDryRun = process.env.DRY_RUN !== 'false';

  const windowMinutes = options.windowMinutes || 30;
  const timespan = options.timespan || `PT${windowMinutes}M`;
  const threshold = options.threshold !== undefined ? options.threshold : 5;
  const environment = options.environment || 'development';
  const autoShutdown = options.autoShutdown !== undefined ? options.autoShutdown : true;

  const credential = customCredential || new DefaultAzureCredential();
  const computeClient = new ComputeManagementClient(credential, subscriptionId);

  let instanceView;
  try {
    instanceView = await computeClient.virtualMachines.instanceView(resourceGroup, vmName);
  } catch (err) {
    if (err.statusCode === 404 || (err.message && err.message.includes('ResourceNotFound'))) {
      const result = {
        vmName,
        action: 'DEALLOCATE',
        dryRun: isDryRun,
        wouldExecute: false,
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
        dryRun: isDryRun,
        cpuAverage: null,
        reason: result.reason
      });

      return result;
    }
    if (err.statusCode === 403 || (err.code && err.code.includes('AuthorizationFailed'))) {
      const result = {
        vmName,
        action: 'DEALLOCATE',
        dryRun: isDryRun,
        wouldExecute: false,
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
        dryRun: isDryRun,
        cpuAverage: null,
        reason: result.reason
      });

      return result;
    }

    const result = {
      vmName,
      action: 'DEALLOCATE',
      dryRun: isDryRun,
      wouldExecute: false,
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
        dryRun: isDryRun,
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
      dryRun: isDryRun,
      wouldExecute: false,
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
      dryRun: isDryRun,
      cpuAverage: null,
      reason: skipReason
    });

    return result;
  }

  const metricsData = await fetchVmCpuMetrics(subscriptionId, resourceGroup, vmName, timespan, customCredential);
  const idleStatus = evaluateVmIdleStatus(vmName, metricsData, threshold, windowMinutes);
  const policyResult = evaluateShutdownPolicy(vmName, idleStatus, environment, autoShutdown);

  if (!policyResult.allowed) {
    const result = {
      vmName,
      action: 'DEALLOCATE',
      dryRun: isDryRun,
      wouldExecute: false,
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
      dryRun: isDryRun,
      cpuAverage: policyResult.cpuAverage,
      reason: policyResult.reason
    });

    return result;
  }

  if (isDryRun) {
    const reason = `[DRY-RUN] Virtual machine '${vmName}' meets all policy requirements and WOULD be deallocated. No Azure action was performed because DRY_RUN is enabled.`;
    const result = {
      vmName,
      action: 'DEALLOCATE',
      dryRun: true,
      wouldExecute: true,
      executed: false,
      allowed: true,
      reason,
      policy: policyResult
    };

    await recordAction({
      userId,
      connectionId,
      vmName,
      action: 'DEALLOCATE',
      status: 'DRY_RUN',
      dryRun: true,
      cpuAverage: policyResult.cpuAverage,
      reason
    });

    return result;
  }

  try {
    await computeClient.virtualMachines.beginDeallocateAndWait(resourceGroup, vmName);

    const result = {
      vmName,
      action: 'DEALLOCATE',
      dryRun: false,
      wouldExecute: true,
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
      dryRun: false,
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
      dryRun: false,
      wouldExecute: true,
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
      dryRun: false,
      cpuAverage: policyResult.cpuAverage,
      reason: userReason
    });

    return result;
  }
}

app.get('/azure/vms/:resourceGroup/:vmName/metrics', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;
  const { timespan } = parseQueryOptions(req.query);

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const metricsData = await fetchVmCpuMetrics(resolved.subscriptionId, resourceGroup, vmName, timespan, resolved.credential);

    return res.json({
      resourceGroup,
      vmName,
      metricName: 'Percentage CPU',
      timespan,
      averageCpuPercentage: metricsData.averageCpuPercentage,
      dataPointsCount: metricsData.dataPointsCount,
      dataPoints: metricsData.dataPoints
    });
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

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to query CPU metrics';

    return res.status(500).json({
      error: 'METRICS_QUERY_FAILURE',
      message: `Failed to query metrics for VM '${vmName}' in resource group '${resourceGroup}': ${sanitizedMsg}`
    });
  }
});

app.get('/azure/vms/:resourceGroup/:vmName/idle', authenticateToken, async (req, res) => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

  if (!subscriptionId) {
    return res.status(500).json({
      error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
    });
  }

  const { resourceGroup, vmName } = req.params;
  const { windowMinutes, threshold } = parseQueryOptions(req.query);

  try {
    const timespan = `PT${windowMinutes}M`;
    const metricsData = await fetchVmCpuMetrics(subscriptionId, resourceGroup, vmName, timespan);
    const idleStatus = evaluateVmIdleStatus(vmName, metricsData, threshold, windowMinutes);

    return res.json(idleStatus);
  } catch (error) {
    return res.status(500).json({
      error: `Failed to evaluate idle status for VM '${vmName}' in resource group '${resourceGroup}'`,
      details: error.message
    });
  }
});

app.get('/azure/vms/:resourceGroup/:vmName/policy', authenticateToken, async (req, res) => {
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;

  if (!subscriptionId) {
    return res.status(500).json({
      error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
    });
  }

  const { resourceGroup, vmName } = req.params;
  const { windowMinutes, threshold, environment, autoShutdown } = parseQueryOptions(req.query);

  try {
    const timespan = `PT${windowMinutes}M`;
    const metricsData = await fetchVmCpuMetrics(subscriptionId, resourceGroup, vmName, timespan);
    const idleStatus = evaluateVmIdleStatus(vmName, metricsData, threshold, windowMinutes);
    const policyResult = evaluateShutdownPolicy(vmName, idleStatus, environment, autoShutdown);

    return res.json(policyResult);
  } catch (error) {
    return res.status(500).json({
      error: `Failed to evaluate policy for VM '${vmName}' in resource group '${resourceGroup}'`,
      details: error.message
    });
  }
});

app.get('/azure/vms/:resourceGroup/:vmName/shutdown/dry-run', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;
  const { windowMinutes, threshold, environment, autoShutdown } = parseQueryOptions(req.query);

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const timespan = `PT${windowMinutes}M`;
    const metricsData = await fetchVmCpuMetrics(resolved.subscriptionId, resourceGroup, vmName, timespan, resolved.credential);
    const idleStatus = evaluateVmIdleStatus(vmName, metricsData, threshold, windowMinutes);
    const policyResult = evaluateShutdownPolicy(vmName, idleStatus, environment, autoShutdown);
    const dryRunResult = evaluateDryRunShutdown(vmName, policyResult);

    recordAction({
      userId: req.user.id,
      connectionId: resolved.connectionId,
      vmName,
      action: 'DEALLOCATE',
      status: 'DRY_RUN',
      dryRun: true,
      cpuAverage: policyResult.cpuAverage,
      reason: dryRunResult.reason
    });

    return res.json(dryRunResult);
  } catch (error) {
    if (error.message && error.message.includes('Multiple active Azure connections found')) {
      return res.status(400).json({
        error: 'MULTIPLE_CONNECTIONS_REQUIRED',
        message: error.message
      });
    }

    return res.status(500).json({
      error: `Failed to execute shutdown dry-run for VM '${vmName}' in resource group '${resourceGroup}'`,
      details: error.message
    });
  }
});

app.post('/azure/vms/:resourceGroup/:vmName/shutdown', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;
  const options = parseQueryOptions({ ...req.query, ...req.body });

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const result = await executeVmShutdown(resolved.subscriptionId, resourceGroup, vmName, options, resolved.credential, { userId: req.user.id, connectionId: resolved.connectionId });
    return res.json(result);
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

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to execute shutdown';

    return res.status(500).json({
      error: `Failed to execute shutdown for VM '${vmName}' in resource group '${resourceGroup}'`,
      details: sanitizedMsg
    });
  }
});



app.get('/api/actions', authenticateToken, async (req, res) => {
  try {
    const actions = await getActions(req.user.id);
    return res.json({
      count: actions.length,
      actions
    });
  } catch (error) {
    return res.status(500).json({
      error: 'ACTIONS_FETCH_FAILURE',
      message: error.message
    });
  }
});

app.get('/api/actions/:vmName', authenticateToken, async (req, res) => {
  const { vmName } = req.params;
  try {
    const actions = await getActions(req.user.id, vmName);
    return res.json({
      vmName,
      count: actions.length,
      actions
    });
  } catch (error) {
    return res.status(500).json({
      error: 'ACTIONS_FETCH_FAILURE',
      message: error.message
    });
  }
});

const SCHEDULER_LOCK_ID = 987654321;

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

  const isDryRun = process.env.DRY_RUN !== 'false';
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

        console.log(`[SCHEDULER] User: ${user.email} (id: ${user.id}) | Active Azure connections: ${connections.length} | Policy [threshold: ${userPolicy.idleCpuThreshold}%, window: ${userPolicy.monitoringWindowMinutes}m, autoShutdown: ${userPolicy.autoShutdown}]`);

        const shutdownOptions = {
          threshold: userPolicy.idleCpuThreshold,
          windowMinutes: userPolicy.monitoringWindowMinutes,
          autoShutdown: userPolicy.autoShutdown
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
                if (state === 'stopped' || state === 'deallocated') {
                  const skipReason = `Optimization skipped: Virtual machine '${vm.name}' is already ${vm.status}.`;
                  console.log(`[SCHEDULER] VM: '${vm.name}' | State: ${vm.status} | Decision: SKIPPED`);

                  await recordAction({
                    userId: user.id,
                    connectionId: conn.id,
                    vmName: vm.name,
                    action: 'DEALLOCATE',
                    status: 'SKIPPED',
                    dryRun: isDryRun,
                    cpuAverage: null,
                    reason: skipReason
                  });

                  continue;
                }

                console.log(`[SCHEDULER] VM: '${vm.name}' | State: ${vm.status} | Evaluating CPU metrics & shutdown policy...`);
                const result = await executeVmShutdown(resolved.subscriptionId, vm.resourceGroup, vm.name, shutdownOptions, resolved.credential, { userId: user.id, connectionId: conn.id });
                console.log(`[SCHEDULER] VM: '${vm.name}' | State: ${vm.status} | Decision: ${result.reason}`);
              } catch (vmErr) {
                console.error(`[SCHEDULER] Error evaluating VM '${vm.name}' on connection ${conn.id}:`, vmErr.message);
              }
            }
          } catch (connErr) {
            console.error(`[SCHEDULER] Error processing Azure connection ${conn.id} for user ${user.email}:`, connErr.message);
          }
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

app.get('/api/scheduler/run-now', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  try {
    console.log('[SCHEDULER] Manual optimization scan triggered via /api/scheduler/run-now');
    await runScheduledOptimization();
    return res.json({
      status: 'SUCCESS',
      message: 'Optimization scan executed successfully.',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      status: 'ERROR',
      message: 'Failed to execute manual optimization scan.',
      details: error.message
    });
  }
});

app.get('/api/notifications/test', authenticateToken, requireRole('ADMIN'), async (req, res) => {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const targetEmail = req.user && req.user.email ? req.user.email : (process.env.ALERT_EMAIL || null);

  if (!host || !targetEmail) {
    return res.status(400).json({
      status: 'FAILED',
      message: 'SMTP configuration is incomplete. Ensure SMTP_HOST environment variable is configured.',
      configured: {
        SMTP_HOST: Boolean(host),
        targetEmail: Boolean(targetEmail)
      }
    });
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: (user && pass) ? { user, pass } : undefined
    });

    const subject = `[CloudPulse Test] Email Notification Test`;
    const textContent = [
      `CloudPulse Notification Test`,
      `----------------------------------------`,
      `This is a manual test notification from CloudPulse backend.`,
      `SMTP Host: ${host}`,
      `Recipient: ${targetEmail}`,
      `Timestamp: ${new Date().toISOString()}`,
      `----------------------------------------`
    ].join('\n');

    await transporter.sendMail({
      from: user || `cloudpulse@${host}`,
      to: targetEmail,
      subject,
      text: textContent
    });

    console.log(`[NOTIFICATION-TEST] Test email sent successfully to ${targetEmail}.`);

    return res.json({
      status: 'SUCCESS',
      message: `Test email notification sent successfully to ${targetEmail}.`,
      recipient: targetEmail,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`[NOTIFICATION-TEST] Failed to send test email to ${targetEmail}:`, error.message);
    return res.status(500).json({
      status: 'FAILED',
      message: `Failed to send test email notification: ${error.message}`,
      recipient: targetEmail,
      details: error.message
    });
  }
});

const costCache = new Map();

async function fetchSubscriptionMonthToDateCost(subscriptionId, customCredential = null) {
  const cacheKey = subscriptionId;
  const cached = costCache.get(cacheKey);
  const now = Date.now();

  if (cached && (now - cached.timestamp < 60000)) {
    return cached.data;
  }

  const credential = customCredential || new DefaultAzureCredential();
  const costClient = new CostManagementClient(credential);
  const scope = `/subscriptions/${subscriptionId}`;

  const queryParameters = {
    type: 'Usage',
    timeframe: 'MonthToDate',
    dataset: {
      granularity: 'None',
      aggregation: {
        totalCost: {
          name: 'PreTaxCost',
          function: 'Sum'
        }
      }
    }
  };

  try {
    const result = await costClient.query.usage(scope, queryParameters);

    let totalCost = 0;
    let currency = 'INR';

    if (result && result.rows && Array.isArray(result.rows) && result.rows.length > 0) {
      const row = result.rows[0];
      const costValue = parseFloat(row[0]);
      if (!isNaN(costValue)) {
        totalCost = Math.round(costValue * 100) / 100;
      }
      if (row[1] && typeof row[1] === 'string') {
        currency = row[1];
      }
    }

    const data = {
      totalCost,
      currency: currency || 'INR',
      timeframe: 'MonthToDate',
      source: 'Azure Cost Management'
    };

    costCache.set(cacheKey, { timestamp: now, data });
    return data;
  } catch (err) {
    if (cached) {
      return cached.data;
    }
    throw err;
  }
}

app.get('/api/cost/month-to-date', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const costData = await fetchSubscriptionMonthToDateCost(resolved.subscriptionId, resolved.credential);
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

    if (error.statusCode === 429) {
      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Azure Cost Management API rate limit exceeded. Please retry shortly.',
        details: error.message
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

async function fetchResourceMonthToDateCost(subscriptionId, resourceGroup, resourceName, customCredential = null) {
  const credential = customCredential || new DefaultAzureCredential();
  const costClient = new CostManagementClient(credential);
  const scope = `/subscriptions/${subscriptionId}`;

  const queryParameters = {
    type: 'Usage',
    timeframe: 'MonthToDate',
    dataset: {
      granularity: 'None',
      aggregation: {
        totalCost: {
          name: 'PreTaxCost',
          function: 'Sum'
        }
      },
      grouping: [
        { type: 'Dimension', name: 'ResourceId' },
        { type: 'Dimension', name: 'ResourceGroupName' },
        { type: 'Dimension', name: 'ResourceType' }
      ]
    }
  };

  const result = await costClient.query.usage(scope, queryParameters);

  let totalCost = 0;
  let currency = 'USD';
  let dataFound = false;

  const targetRgLower = resourceGroup.toLowerCase();
  const targetNameLower = resourceName.toLowerCase();

  if (result && result.columns && result.rows && Array.isArray(result.rows)) {
    const costIdx = result.columns.findIndex(c => c.name === 'PreTaxCost');
    const currencyIdx = result.columns.findIndex(c => c.name === 'Currency');
    const resourceIdIdx = result.columns.findIndex(c => c.name === 'ResourceId');
    const rgIdx = result.columns.findIndex(c => c.name === 'ResourceGroupName');

    for (const row of result.rows) {
      const rowCurrency = (currencyIdx !== -1 && row[currencyIdx]) ? row[currencyIdx] : 'USD';
      if (rowCurrency) currency = rowCurrency;

      const rowResourceId = (resourceIdIdx !== -1 && row[resourceIdIdx]) ? String(row[resourceIdIdx]) : '';
      const rowRg = (rgIdx !== -1 && row[rgIdx]) ? String(row[rgIdx]) : '';

      const rgMatches = (rowRg && rowRg.toLowerCase() === targetRgLower) ||
                        (rowResourceId && rowResourceId.toLowerCase().includes(`/resourcegroups/${targetRgLower}/`));

      const nameMatches = rowResourceId && (
        rowResourceId.toLowerCase().endsWith(`/${targetNameLower}`) ||
        rowResourceId.toLowerCase().includes(`/${targetNameLower}/`)
      );

      if (rgMatches && nameMatches) {
        const costVal = parseFloat(row[costIdx !== -1 ? costIdx : 0]);
        if (!isNaN(costVal)) {
          totalCost += costVal;
          dataFound = true;
        }
      }
    }
  }

  totalCost = Math.round(totalCost * 100) / 100;

  return {
    resourceName,
    resourceGroup,
    totalCost,
    currency,
    timeframe: 'MonthToDate',
    source: 'Azure Cost Management',
    dataFound,
    reason: dataFound
      ? `Matching cost record found for resource '${resourceName}'.`
      : `No matching billing record found for resource '${resourceName}' in resource group '${resourceGroup}' for the current month-to-date period.`
  };
}

app.get('/api/cost/resource/:resourceGroup/:resourceName', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, resourceName } = req.params;

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const costData = await fetchResourceMonthToDateCost(resolved.subscriptionId, resourceGroup, resourceName, resolved.credential);
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

    if (error.statusCode === 429) {
      return res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Azure Cost Management API rate limit exceeded. Please retry shortly.',
        details: error.message
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

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to query resource cost';

    return res.status(500).json({
      error: 'AZURE_COST_API_FAILURE',
      message: `Failed to query resource cost from Azure Cost Management API: ${sanitizedMsg}`,
      details: sanitizedMsg
    });
  }
});

async function fetchVmRetailPrice(vmSize, region) {
  if (!vmSize || !region) {
    return {
      vmSize,
      region,
      hourlyPrice: null,
      currency: null,
      priceUnit: null,
      source: 'Azure Retail Prices API',
      dataFound: false,
      reason: 'VM size or region not provided.'
    };
  }

  const regionClean = region.toLowerCase().replace(/\s+/g, '');
  const filterPrimary = `armRegionName eq '${regionClean}' and armSkuName eq '${vmSize}' and serviceName eq 'Virtual Machines' and priceType eq 'Consumption'`;
  const urlPrimary = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filterPrimary)}`;

  try {
    const resPrimary = await fetch(urlPrimary);
    const dataPrimary = await resPrimary.json();

    let items = (dataPrimary && dataPrimary.Items) ? dataPrimary.Items : [];

    if (items.length === 0) {
      const filterFallback = `armSkuName eq '${vmSize}' and serviceName eq 'Virtual Machines' and priceType eq 'Consumption'`;
      const urlFallback = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filterFallback)}`;
      const resFallback = await fetch(urlFallback);
      const dataFallback = await resFallback.json();

      if (dataFallback && dataFallback.Items && dataFallback.Items.length > 0) {
        items = dataFallback.Items.filter(item => {
          const itemRegion = (item.armRegionName || '').toLowerCase().replace(/\s+/g, '');
          const itemLoc = (item.location || '').toLowerCase().replace(/\s+/g, '');
          return itemRegion === regionClean || itemLoc === regionClean || itemRegion.includes(regionClean) || regionClean.includes(itemRegion);
        });

        if (items.length === 0) {
          items = dataFallback.Items;
        }
      }
    }

    if (items.length > 0) {
      const item = items.find(i => i.productName && !i.productName.toLowerCase().includes('windows')) || items[0];
      const hourlyPrice = item.unitPrice !== undefined ? item.unitPrice : item.retailPrice;

      return {
        vmSize,
        region,
        hourlyPrice: hourlyPrice !== undefined ? hourlyPrice : null,
        currency: item.currencyCode || 'USD',
        priceUnit: item.unitOfMeasure || '1 Hour',
        source: 'Azure Retail Prices API',
        dataFound: true,
        reason: `Found matching retail price for ${vmSize} in ${region}.`
      };
    }

    return {
      vmSize,
      region,
      hourlyPrice: null,
      currency: null,
      priceUnit: null,
      source: 'Azure Retail Prices API',
      dataFound: false,
      reason: `No retail pricing data found for SKU '${vmSize}' in region '${region}'.`
    };
  } catch (error) {
    return {
      vmSize,
      region,
      hourlyPrice: null,
      currency: null,
      priceUnit: null,
      source: 'Azure Retail Prices API',
      dataFound: false,
      reason: `Failed to query Azure Retail Prices API: ${error.message}`
    };
  }
}

app.get('/api/cost/vm-price/:resourceGroup/:vmName', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const client = new ComputeManagementClient(resolved.credential, resolved.subscriptionId);

    let vm;
    try {
      vm = await client.virtualMachines.get(resourceGroup, vmName);
    } catch (vmErr) {
      if (vmErr.statusCode === 404 || (vmErr.message && vmErr.message.includes('ResourceNotFound'))) {
        return res.status(404).json({
          error: 'VM_NOT_FOUND',
          message: `Virtual machine '${vmName}' not found in resource group '${resourceGroup}'.`
        });
      }
      throw vmErr;
    }

    const vmSize = (vm.hardwareProfile && vm.hardwareProfile.vmSize) ? vm.hardwareProfile.vmSize : null;
    const region = vm.location || null;

    if (!vmSize || !region) {
      return res.status(400).json({
        vmName,
        resourceGroup,
        vmSize,
        region,
        hourlyPrice: null,
        currency: null,
        priceUnit: null,
        source: 'Azure Retail Prices API',
        dataFound: false,
        reason: `VM size or region details missing for VM '${vmName}'.`
      });
    }

    const priceResult = await fetchVmRetailPrice(vmSize, region);

    return res.json({
      vmName,
      resourceGroup,
      vmSize,
      region,
      hourlyPrice: priceResult.hourlyPrice,
      currency: priceResult.currency,
      priceUnit: priceResult.priceUnit,
      source: 'Azure Retail Prices API',
      dataFound: priceResult.dataFound,
      reason: priceResult.reason
    });
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

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to query retail price';

    return res.status(500).json({
      error: 'VM_PRICE_QUERY_FAILURE',
      message: `Failed to query retail price for VM '${vmName}': ${sanitizedMsg}`,
      details: sanitizedMsg
    });
  }
});

async function calculateVmPotentialSavings(subscriptionId, resourceGroup, vmName, options = {}, customCredential = null) {
  const windowMinutes = options.windowMinutes || 30;
  const timespan = options.timespan || `PT${windowMinutes}M`;
  const threshold = options.threshold !== undefined ? options.threshold : 5;

  const credential = customCredential || new DefaultAzureCredential();
  const computeClient = new ComputeManagementClient(credential, subscriptionId);

  let vm;
  try {
    vm = await computeClient.virtualMachines.get(resourceGroup, vmName);
  } catch (err) {
    if (err.statusCode === 404 || (err.message && err.message.includes('ResourceNotFound'))) {
      return {
        error: 'VM_NOT_FOUND',
        message: `Virtual machine '${vmName}' not found in resource group '${resourceGroup}'.`
      };
    }
    throw err;
  }

  const vmSize = (vm.hardwareProfile && vm.hardwareProfile.vmSize) ? vm.hardwareProfile.vmSize : null;
  const region = vm.location || null;

  const priceResult = await fetchVmRetailPrice(vmSize, region);
  const hourlyPrice = priceResult.dataFound ? priceResult.hourlyPrice : null;
  const currency = priceResult.currency || 'USD';

  let cpuAverage = null;
  let isIdle = false;
  let idleReason = '';

  try {
    const metricsData = await fetchVmCpuMetrics(subscriptionId, resourceGroup, vmName, timespan, customCredential);
    const idleStatus = evaluateVmIdleStatus(vmName, metricsData, threshold, windowMinutes);
    cpuAverage = idleStatus.cpuAverage;
    isIdle = idleStatus.idle;
    idleReason = idleStatus.reason;
  } catch (metricsErr) {
    idleReason = `Failed to query metrics: ${metricsErr.message}`;
  }

  let potentialHourlySavings = 0;
  let potential30MinuteSavings = 0;

  if (isIdle && hourlyPrice !== null && hourlyPrice !== undefined) {
    potentialHourlySavings = Math.round(hourlyPrice * 10000) / 10000;
    potential30MinuteSavings = Math.round((hourlyPrice / 2) * 10000) / 10000;
  }

  return {
    vmName,
    resourceGroup,
    vmSize,
    region,
    hourlyPrice,
    currency,
    idle: isIdle,
    cpuAverage,
    monitoringWindowMinutes: windowMinutes,
    potentialHourlySavings,
    potential30MinuteSavings,
    source: 'Azure Retail Prices API + Azure Monitor',
    isEstimate: true,
    reason: isIdle
      ? `Virtual machine '${vmName}' is idle (${idleReason}). Potential compute savings calculated based on retail hourly rate.`
      : `Virtual machine '${vmName}' is not idle or has insufficient monitoring data. Potential savings are 0.`
  };
}

app.get('/api/cost/savings/:resourceGroup/:vmName', authenticateToken, async (req, res) => {
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

// Centralized Express Error Handler (Production Hardened)
app.use((err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === 'production';
  const sanitizedMsg = err.message ? err.message.replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Internal Server Error';
  console.error('[EXPRESS-ERROR]', sanitizedMsg);

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Request payload size exceeds maximum limit of 100kb.'
    });
  }

  const status = err.status || err.statusCode || 500;
  return res.status(status).json({
    error: err.code || 'SERVER_ERROR',
    message: isProduction ? 'An unexpected server error occurred.' : sanitizedMsg
  });
});

cron.schedule('*/10 * * * *', () => {
  runScheduledOptimization();
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Scheduler initialized: running VM optimization scan every 10 minutes.`);
});


