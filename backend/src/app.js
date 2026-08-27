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
const { google } = require('googleapis');
require('dotenv').config();

const authRouter = require('./routes/auth');
const azureConnectionsRouter = require('./routes/azureConnections');
const optimizationPoliciesRouter = require('./routes/optimizationPolicies');
const { authenticateToken, requireRole } = require('./middleware/auth');
const { getAzureCredentialForUser } = require('./services/azureConnectionResolver');
const { getPolicyForUser } = require('./services/optimizationPolicyService');
const { getEncryptionKey } = require('./utils/crypto');
const { runMigrations } = require('./db/migrate');
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

// Auto-run database schema migrations idempotently on startup
runMigrations().catch((migErr) => {
  console.error('[STARTUP-MIGRATION-ERROR] Failed to run schema migrations:', migErr.message);
});

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
  const isDryRun = process.env.DRY_RUN !== 'false';
  const wouldExecute = policyResult.allowed;
  const reason = isDryRun
    ? (wouldExecute
        ? `[DRY-RUN] Virtual machine '${vmName}' meets all policy requirements and WOULD be deallocated.`
        : `[DRY-RUN] Virtual machine '${vmName}' deallocation WOULD NOT execute. Reason: ${policyResult.reason}`)
    : (wouldExecute
        ? `[LIVE] Virtual machine '${vmName}' meets all policy requirements and WILL be deallocated live.`
        : `[LIVE] Virtual machine '${vmName}' deallocation WILL NOT execute. Reason: ${policyResult.reason}`);

  return {
    vmName,
    action: 'DEALLOCATE',
    dryRun: isDryRun,
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

/**
 * Safely masks email address for production logging (e.g. yashascr251@gmail.com -> y***1@gmail.com)
 */
function maskEmail(email) {
  if (!email || typeof email !== 'string' || !email.includes('@')) return 'unknown';
  const [name, domain] = email.split('@');
  if (name.length <= 2) return `${name.charAt(0)}***@${domain}`;
  return `${name.charAt(0)}***${name.charAt(name.length - 1)}@${domain}`;
}

/**
 * Creates an authenticated Gmail API client using OAuth 2.0 refresh token.
 */
function getGmailClient() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/["'\s]/g, '');
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').replace(/["'\s]/g, '');
  const redirectUri = (process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/oauth2callback').replace(/["'\s]/g, '');
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || '').replace(/["'\s]/g, '');

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/**
 * Constructs a MIME/RFC 2822 formatted email string and encodes it as base64url.
 */
function createMimeMessage({ from, to, subject, text, html }) {
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${utf8Subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="cloudpulse_boundary"`,
    ``,
    `--cloudpulse_boundary`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    text || '',
    ``,
    `--cloudpulse_boundary`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    html || text || '',
    ``,
    `--cloudpulse_boundary--`
  ];

  const mimeString = messageParts.join('\r\n');
  return Buffer.from(mimeString)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Unified, safe notification dispatch function using Gmail API OAuth 2.0.
 * Always constructs subject and body in outer scope before attempting API call.
 */
async function sendNotification({ recipientEmail, vmName, action, status, cpuAverage, reason, timestamp }) {
  if (!recipientEmail) {
    console.log(`[NOTIFICATION] Skipped: No recipient email address provided for VM '${vmName}'.`);
    return { success: false, reason: 'NO_RECIPIENT' };
  }

  const senderEmail = (process.env.GMAIL_SENDER_EMAIL || 'cloudpulse.project@gmail.com').replace(/["'\s]/g, '');
  const gmail = getGmailClient();

  if (!gmail) {
    console.log('[NOTIFICATION] Skipped: Gmail API OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) unconfigured.');
    return { success: false, reason: 'GMAIL_API_UNCONFIGURED' };
  }

  // 1. Explicit Subject Construction (Guaranteed in Scope)
  const actionTitle = action === 'START' ? 'VM Start' : 'VM Deallocation';
  const subject = `[CloudPulse Alert] Azure ${actionTitle} ${status}: ${vmName}`;

  // 2. Explicit Body Construction
  const cpuStr = cpuAverage !== null && cpuAverage !== undefined ? `${cpuAverage}%` : 'N/A';
  const formattedTime = timestamp ? new Date(timestamp).toUTCString() : new Date().toUTCString();

  const textContent = [
    `CloudPulse Azure Optimization Alert`,
    `========================================`,
    `Target VM: ${vmName}`,
    `Action: ${action}`,
    `Status: ${status}`,
    `CPU Average: ${cpuStr}`,
    `Reason: ${reason || 'N/A'}`,
    `Timestamp: ${formattedTime}`,
    `========================================`
  ].join('\n');

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h2 style="color: #0f172a; margin-top: 0;">CloudPulse Azure Optimization Alert</h2>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;" />
      <table style="width: 100%; border-collapse: collapse; text-align: left;">
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">Target VM:</td><td style="padding: 8px 0; color: #0f172a;">${vmName}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">Action:</td><td style="padding: 8px 0; color: #0f172a;">${action}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">Status:</td><td style="padding: 8px 0; color: ${status === 'SUCCESS' ? '#16a34a' : '#dc2626'}; font-weight: bold;">${status}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">CPU Average:</td><td style="padding: 8px 0; color: #0f172a;">${cpuStr}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">Reason:</td><td style="padding: 8px 0; color: #0f172a;">${reason || 'N/A'}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b; font-weight: bold;">Timestamp:</td><td style="padding: 8px 0; color: #0f172a;">${formattedTime}</td></tr>
      </table>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;" />
      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">This email was sent automatically by CloudPulse SaaS Azure Optimization Service.</p>
    </div>
  `;

  const fromHeader = `CloudPulse <${senderEmail}>`;
  const encodedMessage = createMimeMessage({
    from: fromHeader,
    to: recipientEmail,
    subject,
    text: textContent,
    html: htmlContent
  });

  const maskedRecipient = maskEmail(recipientEmail);
  console.log(`[NOTIFICATION] Preparing notification | VM: ${vmName} | Action: ${action} | Status: ${status} | Recipient: ${maskedRecipient}`);

  try {
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    console.log(`[NOTIFICATION] Gmail API send succeeded | VM: ${vmName} | MessageId: ${response.data.id}`);
    return { success: true, messageId: response.data.id };
  } catch (err) {
    console.error(`[NOTIFICATION] Gmail API send failed | VM: ${vmName} | Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function sendDeallocationNotification(actionRecord) {
  // Do not send notification for dry-run preview simulation mode
  if (actionRecord.dryRun) {
    return;
  }

  // Only dispatch email for SUCCESS or FAILED action outcomes
  const isSuccess = actionRecord.status === 'SUCCESS';
  const isFailure = actionRecord.status === 'FAILED';
  if (!isSuccess && !isFailure) {
    return;
  }

  let recipientEmail = actionRecord.recipientEmail || actionRecord.userEmail || null;

  // Resolve customer email securely from database if not attached
  if (!recipientEmail && actionRecord.userId) {
    try {
      const userRes = await db.query(
        `SELECT email FROM users WHERE id = $1 AND status = 'ACTIVE'`,
        [actionRecord.userId]
      );
      if (userRes.rows.length > 0) {
        recipientEmail = userRes.rows[0].email;
      }
    } catch (dbErr) {
      console.error('[NOTIFICATION] Error resolving customer email from database:', dbErr.message);
    }
  }

  if (!recipientEmail) {
    console.log(`[NOTIFICATION] Skipped: Customer recipient email could not be resolved for VM '${actionRecord.vmName}'.`);
    return;
  }

  await sendNotification({
    recipientEmail,
    vmName: actionRecord.vmName,
    action: actionRecord.action || 'DEALLOCATE',
    status: actionRecord.status,
    cpuAverage: actionRecord.cpuAverage,
    reason: actionRecord.reason,
    timestamp: actionRecord.timestamp
  });
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
  const recipientEmail = entry.recipientEmail || entry.userEmail || null;

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
      recipientEmail: recipientEmail,
      connectionId: row.connection_id,
      vmName: row.vm_name,
      action: row.action,
      status: row.status,
      dryRun: Boolean(row.dry_run),
      cpuAverage: row.cpu_average !== null ? parseFloat(row.cpu_average) : null,
      reason: row.reason,
      timestamp: row.created_at
    };

    // 🛡️ Notification MUST NOT break VM operations. Catch notification errors separately.
    try {
      await sendDeallocationNotification(record);
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
      dryRun,
      cpuAverage,
      reason
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
      WHERE user_id = $1 AND LOWER(vm_name) = LOWER($2)
      ORDER BY created_at DESC
    `;
    values = [userId, vmNameFilter];
  } else {
    query = `
      SELECT id, user_id, connection_id, vm_name, action, status, dry_run, cpu_average, reason, created_at
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
  let environment = options.environment || 'development';
  let autoShutdown = options.autoShutdown !== undefined ? options.autoShutdown : true;

  const credential = customCredential || new DefaultAzureCredential();
  const computeClient = new ComputeManagementClient(credential, subscriptionId);

  // Auto-detect production environment from VM name or Azure tags
  if (vmName.toLowerCase().includes('prod') || vmName.toLowerCase().includes('production')) {
    environment = 'production';
  }

  try {
    const vmResource = await computeClient.virtualMachines.get(resourceGroup, vmName);
    if (vmResource && vmResource.tags) {
      const envTag = vmResource.tags.Environment || vmResource.tags.environment || vmResource.tags.ENV || vmResource.tags.env;
      if (envTag && envTag.toLowerCase() === 'production') {
        environment = 'production';
      }
      const autoShutdownTag = vmResource.tags.AutoShutdown || vmResource.tags.autoshutdown;
      if (autoShutdownTag && (autoShutdownTag.toLowerCase() === 'disabled' || autoShutdownTag.toLowerCase() === 'false')) {
        autoShutdown = false;
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
    policyResult = evaluateShutdownPolicy(vmName, idleStatus, environment, autoShutdown);
  }

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
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;
  const { windowMinutes, threshold } = parseQueryOptions(req.query);

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

    return res.json(idleStatus);
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

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to evaluate idle status';

    return res.status(500).json({
      error: `Failed to evaluate idle status for VM '${vmName}' in resource group '${resourceGroup}'`,
      details: sanitizedMsg
    });
  }
});

app.get('/azure/vms/:resourceGroup/:vmName/policy', authenticateToken, async (req, res) => {
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

    return res.json(policyResult);
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

    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to evaluate policy';

    return res.status(500).json({
      error: `Failed to evaluate policy for VM '${vmName}' in resource group '${resourceGroup}'`,
      details: sanitizedMsg
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

    let detectedEnv = environment || 'development';
    let isAutoShutdownEnabled = autoShutdown !== undefined ? autoShutdown : true;

    if (vmName.toLowerCase().includes('prod') || vmName.toLowerCase().includes('production')) {
      detectedEnv = 'production';
    }

    const computeClient = new ComputeManagementClient(resolved.credential, resolved.subscriptionId);
    try {
      const vmResource = await computeClient.virtualMachines.get(resourceGroup, vmName);
      if (vmResource && vmResource.tags) {
        const envTag = vmResource.tags.Environment || vmResource.tags.environment || vmResource.tags.ENV || vmResource.tags.env;
        if (envTag && envTag.toLowerCase() === 'production') {
          detectedEnv = 'production';
        }
        const autoShutdownTag = vmResource.tags.AutoShutdown || vmResource.tags.autoshutdown;
        if (autoShutdownTag && (autoShutdownTag.toLowerCase() === 'disabled' || autoShutdownTag.toLowerCase() === 'false')) {
          isAutoShutdownEnabled = false;
        }
      }
    } catch (tagErr) {}

    const timespan = `PT${windowMinutes}M`;
    const metricsData = await fetchVmCpuMetrics(resolved.subscriptionId, resourceGroup, vmName, timespan, resolved.credential);
    const idleStatus = evaluateVmIdleStatus(vmName, metricsData, threshold, windowMinutes);
    const policyResult = evaluateShutdownPolicy(vmName, idleStatus, detectedEnv, isAutoShutdownEnabled);
    const dryRunResult = evaluateDryRunShutdown(vmName, policyResult);

    const isDryRun = process.env.DRY_RUN !== 'false';

    recordAction({
      userId: req.user.id,
      connectionId: resolved.connectionId,
      vmName,
      action: 'DEALLOCATE',
      status: isDryRun ? 'DRY_RUN' : (policyResult.allowed ? 'LIVE_PREVIEW' : 'BLOCKED'),
      dryRun: isDryRun,
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

app.post('/azure/vms/:resourceGroup/:vmName/start', authenticateToken, async (req, res) => {
  const { connectionId } = req.query;
  const { resourceGroup, vmName } = req.params;
  let resolvedConnId = null;

  try {
    const resolved = await getAzureCredentialForUser(req.user.id, connectionId);
    resolvedConnId = resolved ? resolved.connectionId : null;

    if (!resolved.subscriptionId) {
      return res.status(500).json({
        error: 'AZURE_SUBSCRIPTION_ID is missing in environment variables'
      });
    }

    const computeClient = new ComputeManagementClient(resolved.credential, resolved.subscriptionId);

    console.log(`[VM-START] Initiating start command for VM '${vmName}' in RG '${resourceGroup}'...`);
    await computeClient.virtualMachines.beginStartAndWait(resourceGroup, vmName);

    await recordAction({
      userId: req.user.id,
      connectionId: resolved.connectionId,
      vmName,
      action: 'START',
      status: 'SUCCESS',
      dryRun: false,
      cpuAverage: null,
      reason: `Virtual machine '${vmName}' was successfully powered ON (started) on Azure.`
    });

    return res.json({
      vmName,
      action: 'START',
      executed: true,
      status: 'RUNNING',
      message: `Virtual machine '${vmName}' was successfully started on Azure.`
    });
  } catch (error) {
    console.error(`[VM-START] Failed to start VM '${vmName}':`, error.message);
    const sanitizedMsg = error.message ? error.message.split('\n')[0].replace(/clientSecret=[^&\s]+/gi, 'clientSecret=***') : 'Failed to start VM';

    try {
      await recordAction({
        userId: req.user.id,
        connectionId: resolvedConnId,
        vmName,
        action: 'START',
        status: 'FAILED',
        dryRun: false,
        cpuAverage: null,
        reason: `Failed to power ON virtual machine '${vmName}': ${sanitizedMsg}`
      });
    } catch (recErr) {
      console.error('[VM-START] Failed to record start failure:', recErr.message);
    }

    return res.status(500).json({
      error: `Failed to start VM '${vmName}' in resource group '${resourceGroup}'`,
      message: sanitizedMsg
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

app.post('/api/optimization/run-now', authenticateToken, async (req, res) => {
  try {
    const userPolicy = await getPolicyForUser(req.user.id);
    const connResult = await db.query(
      `SELECT id, connection_name, subscription_id FROM azure_connections WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY created_at ASC`,
      [req.user.id]
    );
    const connections = connResult.rows;

    if (connections.length === 0) {
      return res.status(400).json({
        error: 'NO_ACTIVE_CONNECTIONS',
        message: 'No active Azure connections found for this user account.'
      });
    }

    const shutdownOptions = {
      threshold: userPolicy.idleCpuThreshold,
      windowMinutes: userPolicy.monitoringWindowMinutes,
      autoShutdown: userPolicy.autoShutdown,
      isManual: false
    };

    const results = [];

    for (const conn of connections) {
      const resolved = await getAzureCredentialForUser(req.user.id, conn.id);
      const vms = await discoverAzureVms(resolved.subscriptionId, resolved.credential);

      for (const vm of vms) {
        if (!vm.resourceGroup || !vm.name) continue;

        const state = (vm.status || '').toLowerCase();
        if (state === 'stopped' || state === 'deallocated') {
          const skipReason = `Optimization skipped: Virtual machine '${vm.name}' is already ${vm.status}.`;
          await recordAction({
            userId: req.user.id,
            connectionId: conn.id,
            vmName: vm.name,
            action: 'DEALLOCATE',
            status: 'SKIPPED',
            dryRun: process.env.DRY_RUN !== 'false',
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
          { userId: req.user.id, connectionId: conn.id }
        );
        results.push(resObj);
      }
    }

    return res.json({
      message: 'Optimization scan completed successfully.',
      totalVmsEvaluated: results.length,
      results
    });
  } catch (error) {
    console.error('[MANUAL-OPTIMIZATION] Scan error:', error.message);
    return res.status(500).json({
      error: 'OPTIMIZATION_SCAN_FAILED',
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
  const targetEmail = req.user && req.user.email ? req.user.email : null;

  if (!targetEmail) {
    return res.status(400).json({
      status: 'FAILED',
      message: 'Target recipient email address could not be resolved from authenticated user session.'
    });
  }

  const result = await sendNotification({
    recipientEmail: targetEmail,
    vmName: 'test-vm-diagnostics',
    action: 'START',
    status: 'SUCCESS',
    cpuAverage: null,
    reason: 'Manual admin test notification triggered via /api/notifications/test',
    timestamp: new Date().toISOString()
  });

  if (result.success) {
    return res.json({
      success: true,
      provider: 'gmail-api',
      message: `Test email notification sent successfully via Gmail API to ${targetEmail}.`,
      messageId: result.messageId,
      recipient: targetEmail,
      timestamp: new Date().toISOString()
    });
  } else {
    return res.status(500).json({
      status: 'FAILED',
      message: `Failed to send test email notification: ${result.error || result.reason}`,
      recipient: targetEmail
    });
  }
});

const costCache = new Map();
const inFlightRequests = new Map();
const COST_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes fresh cache TTL

/**
 * Persists a successful Azure Cost Management reading to PostgreSQL cost_cache table.
 */
async function savePersistentCostCache({ userId, connectionId, subscriptionId, cacheType, resourceGroup = null, resourceName = null, totalCost, currency }) {
  if (!userId || !subscriptionId) return;

  try {
    const rgClean = resourceGroup ? resourceGroup.trim() : null;
    const nameClean = resourceName ? resourceName.trim() : null;

    if (cacheType === 'MONTH_TO_DATE') {
      await db.query(
        `INSERT INTO cost_cache (user_id, connection_id, subscription_id, cache_type, total_cost, currency, cached_at, updated_at)
         VALUES ($1, $2, $3, 'MONTH_TO_DATE', $4, $5, NOW(), NOW())
         ON CONFLICT (user_id, connection_id, subscription_id) WHERE cache_type = 'MONTH_TO_DATE'
         DO UPDATE SET total_cost = EXCLUDED.total_cost, currency = EXCLUDED.currency, cached_at = NOW(), updated_at = NOW()`,
        [userId, connectionId, subscriptionId, totalCost, currency]
      );
    } else if (cacheType === 'RESOURCE') {
      await db.query(
        `INSERT INTO cost_cache (user_id, connection_id, subscription_id, cache_type, resource_group, resource_name, total_cost, currency, cached_at, updated_at)
         VALUES ($1, $2, $3, 'RESOURCE', $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (user_id, connection_id, subscription_id, LOWER(resource_group), LOWER(resource_name)) WHERE cache_type = 'RESOURCE'
         DO UPDATE SET total_cost = EXCLUDED.total_cost, currency = EXCLUDED.currency, cached_at = NOW(), updated_at = NOW()`,
        [userId, connectionId, subscriptionId, rgClean, nameClean, totalCost, currency]
      );
    }
  } catch (err) {
    console.error('[COST-CACHE-DB] Failed to persist cost snapshot:', err.message);
  }
}

/**
 * Retrieves last known successful cost snapshot from PostgreSQL cost_cache table.
 */
async function getPersistentCostCache({ userId, connectionId, subscriptionId, cacheType, resourceGroup = null, resourceName = null }) {
  if (!userId || !subscriptionId) return null;

  try {
    if (cacheType === 'MONTH_TO_DATE') {
      const res = await db.query(
        `SELECT total_cost, currency, cached_at
         FROM cost_cache
         WHERE user_id = $1 AND connection_id = $2 AND subscription_id = $3 AND cache_type = 'MONTH_TO_DATE'
         LIMIT 1`,
        [userId, connectionId, subscriptionId]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          totalCost: parseFloat(row.total_cost),
          currency: row.currency,
          cachedAt: row.cached_at,
          timeframe: 'MonthToDate',
          source: 'Azure Cost Management (Persistent Cache)'
        };
      }
    } else if (cacheType === 'RESOURCE' && resourceGroup && resourceName) {
      const res = await db.query(
        `SELECT total_cost, currency, cached_at
         FROM cost_cache
         WHERE user_id = $1 AND connection_id = $2 AND subscription_id = $3 AND cache_type = 'RESOURCE'
           AND LOWER(resource_group) = LOWER($4) AND LOWER(resource_name) = LOWER($5)
         LIMIT 1`,
        [userId, connectionId, subscriptionId, resourceGroup.trim(), resourceName.trim()]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          resourceName,
          resourceGroup,
          totalCost: parseFloat(row.total_cost),
          currency: row.currency,
          cachedAt: row.cached_at,
          timeframe: 'MonthToDate',
          dataFound: true,
          source: 'Azure Cost Management (Persistent Cache)'
        };
      }
    }
  } catch (err) {
    console.error('[COST-CACHE-DB] Failed to read persistent cost snapshot:', err.message);
  }

  return null;
}

/**
 * Fetches Subscription Month-to-Date cost with multi-tenant caching, in-flight request deduplication,
 * exponential backoff retry on 429, PostgreSQL persistent caching, and stale cache fallback.
 */
async function fetchSubscriptionMonthToDateCost(subscriptionId, customCredential = null, context = {}) {
  const userId = context.userId || 'system';
  const connectionId = context.connectionId || 'default';
  const cacheKey = `cost:mtd:${userId}:${connectionId}:${subscriptionId}`;
  const now = Date.now();
  const cached = costCache.get(cacheKey);

  // 1. Return fresh cached data if within 10-minute TTL
  if (cached && (now - cached.timestamp < COST_CACHE_TTL_MS)) {
    return cached.data;
  }

  // 2. Request Deduplication: Await existing in-flight Promise for identical key
  if (inFlightRequests.has(cacheKey)) {
    return await inFlightRequests.get(cacheKey);
  }

  // 3. Query PostgreSQL persistent cache to use as cold-start fallback if Azure throttles
  const dbSnapshot = await getPersistentCostCache({ userId, connectionId, subscriptionId, cacheType: 'MONTH_TO_DATE' });

  const fetchPromise = (async () => {
    try {
      const data = await executeAzureCostQueryWithRetry(async () => {
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

        return {
          totalCost,
          currency: currency || 'INR',
          timeframe: 'MonthToDate',
          source: 'Azure Cost Management',
          isStale: false
        };
      });

      // Update in-memory cache
      costCache.set(cacheKey, { timestamp: Date.now(), data });

      // Persist successful reading to PostgreSQL
      await savePersistentCostCache({
        userId,
        connectionId,
        subscriptionId,
        cacheType: 'MONTH_TO_DATE',
        totalCost: data.totalCost,
        currency: data.currency
      });

      return data;
    } catch (err) {
      const is429 = err.statusCode === 429 || 
                    (err.response && err.response.status === 429) || 
                    (err.message && err.message.includes('429')) ||
                    (err.code && err.code.includes('429'));

      // 4. Stale Cache Fallback: Prefer in-memory cache first, then PostgreSQL DB snapshot
      const fallbackData = cached ? cached.data : dbSnapshot;
      if (fallbackData) {
        console.warn(`[AZURE-COST-API] Throttled/Error. Returning stale cached MTD cost data for key '${cacheKey}'`);
        return {
          ...fallbackData,
          isStale: true,
          staleReason: 'Azure Cost Management is temporarily throttling requests. Showing last known Azure cost.',
          cachedAt: fallbackData.cachedAt || (cached ? new Date(cached.timestamp).toISOString() : new Date().toISOString())
        };
      }

      if (is429) {
        const rateLimitErr = new Error('Azure Cost Management is temporarily throttling requests. Please try again shortly.');
        rateLimitErr.statusCode = 429;
        rateLimitErr.code = 'COST_DATA_TEMPORARILY_UNAVAILABLE';
        throw rateLimitErr;
      }

      throw err;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  return await fetchPromise;
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

    const costData = await fetchSubscriptionMonthToDateCost(
      resolved.subscriptionId, 
      resolved.credential, 
      { userId: req.user.id, connectionId: resolved.connectionId }
    );
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

    if (error.statusCode === 429 || error.code === 'COST_DATA_TEMPORARILY_UNAVAILABLE') {
      return res.status(429).json({
        error: 'COST_DATA_TEMPORARILY_UNAVAILABLE',
        message: 'Azure Cost Management is temporarily throttling requests. Please try again shortly.'
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

/**
 * Fetches Resource Month-to-Date cost with multi-tenant caching, in-flight request deduplication,
 * exponential backoff retry on 429, PostgreSQL persistent caching, and stale cache fallback.
 */
async function fetchResourceMonthToDateCost(subscriptionId, resourceGroup, resourceName, customCredential = null, context = {}) {
  const userId = context.userId || 'system';
  const connectionId = context.connectionId || 'default';
  const cacheKey = `cost:resource:${userId}:${connectionId}:${subscriptionId}:${resourceGroup.toLowerCase()}:${resourceName.toLowerCase()}`;
  const now = Date.now();
  const cached = costCache.get(cacheKey);

  if (cached && (now - cached.timestamp < COST_CACHE_TTL_MS)) {
    return cached.data;
  }

  if (inFlightRequests.has(cacheKey)) {
    return await inFlightRequests.get(cacheKey);
  }

  const dbSnapshot = await getPersistentCostCache({ userId, connectionId, subscriptionId, cacheType: 'RESOURCE', resourceGroup, resourceName });

  const fetchPromise = (async () => {
    try {
      const data = await executeAzureCostQueryWithRetry(async () => {
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
          isStale: false,
          reason: dataFound
            ? `Matching cost record found for resource '${resourceName}'.`
            : `No matching billing record found for resource '${resourceName}' in resource group '${resourceGroup}' for the current month-to-date period.`
        };
      });

      costCache.set(cacheKey, { timestamp: Date.now(), data });

      await savePersistentCostCache({
        userId,
        connectionId,
        subscriptionId,
        cacheType: 'RESOURCE',
        resourceGroup,
        resourceName,
        totalCost: data.totalCost,
        currency: data.currency
      });

      return data;
    } catch (err) {
      const is429 = err.statusCode === 429 || 
                    (err.response && err.response.status === 429) || 
                    (err.message && err.message.includes('429')) ||
                    (err.code && err.code.includes('429'));

      const fallbackData = cached ? cached.data : dbSnapshot;
      if (fallbackData) {
        console.warn(`[AZURE-COST-API] Throttled/Error. Returning stale cached Resource cost data for key '${cacheKey}'`);
        return {
          ...fallbackData,
          isStale: true,
          staleReason: 'Azure Cost Management is temporarily throttling requests. Showing last known Azure cost.',
          cachedAt: fallbackData.cachedAt || (cached ? new Date(cached.timestamp).toISOString() : new Date().toISOString())
        };
      }

      if (is429) {
        const rateLimitErr = new Error('Azure Cost Management is temporarily throttling requests. Please try again shortly.');
        rateLimitErr.statusCode = 429;
        rateLimitErr.code = 'COST_DATA_TEMPORARILY_UNAVAILABLE';
        throw rateLimitErr;
      }

      throw err;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  return await fetchPromise;
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

    const costData = await fetchResourceMonthToDateCost(
      resolved.subscriptionId, 
      resourceGroup, 
      resourceName, 
      resolved.credential,
      { userId: req.user.id, connectionId: resolved.connectionId }
    );
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

    if (error.statusCode === 429 || error.code === 'COST_DATA_TEMPORARILY_UNAVAILABLE') {
      return res.status(429).json({
        error: 'COST_DATA_TEMPORARILY_UNAVAILABLE',
        message: 'Azure Cost Management is temporarily throttling requests. Please try again shortly.'
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
  let powerState = 'unknown';
  try {
    const instanceView = await computeClient.virtualMachines.instanceView(resourceGroup, vmName);
    powerState = getVmPowerState(instanceView.statuses);
  } catch (err) {}

  const isStopped = (powerState === 'stopped' || powerState === 'deallocated');

  let cpuAverage = null;
  let isIdle = false;
  let idleReason = '';

  if (isStopped) {
    idleReason = `VM is currently ${powerState.toUpperCase()}. Azure Monitor collects CPU metrics only when a VM is powered on.`;
  } else {
    try {
      const metricsData = await fetchVmCpuMetrics(subscriptionId, resourceGroup, vmName, timespan, customCredential);
      const idleStatus = evaluateVmIdleStatus(vmName, metricsData, threshold, windowMinutes);
      cpuAverage = idleStatus.cpuAverage;
      isIdle = idleStatus.idle;
      idleReason = idleStatus.reason;
    } catch (metricsErr) {
      idleReason = `Failed to query metrics: ${metricsErr.message}`;
    }
  }

  let potentialHourlySavings = 0;
  let potential30MinuteSavings = 0;

  if (isIdle && hourlyPrice !== null && hourlyPrice !== undefined) {
    potentialHourlySavings = Math.round(hourlyPrice * 10000) / 10000;
    potential30MinuteSavings = Math.round((hourlyPrice / 2) * 10000) / 10000;
  }

  const responseReason = isStopped
    ? `Virtual machine '${vmName}' is currently ${powerState}. Azure Monitor emits CPU metrics only when a VM is running. Potential hourly savings from further shutdown are 0 because it is already powered off.`
    : (isIdle
        ? `Virtual machine '${vmName}' is idle (${idleReason}). Potential compute savings calculated based on retail hourly rate.`
        : `Virtual machine '${vmName}' is active or has insufficient CPU metrics during its running window. Potential savings are 0.`);

  return {
    vmName,
    resourceGroup,
    vmSize,
    region,
    hourlyPrice,
    currency,
    idle: isIdle,
    isStopped,
    powerState,
    cpuAverage,
    monitoringWindowMinutes: windowMinutes,
    potentialHourlySavings,
    potential30MinuteSavings,
    source: 'Azure Retail Prices API + Azure Monitor',
    isEstimate: true,
    reason: responseReason
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

function verifyGmailConfiguration() {
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').replace(/["'\s]/g, '');
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').replace(/["'\s]/g, '');
  const refreshToken = (process.env.GOOGLE_REFRESH_TOKEN || '').replace(/["'\s]/g, '');
  const sender = (process.env.GMAIL_SENDER_EMAIL || 'cloudpulse.project@gmail.com').replace(/["'\s]/g, '');

  if (!clientId || !clientSecret || !refreshToken) {
    console.log('[STARTUP-DIAGNOSTICS] Gmail API configuration incomplete | Required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_REFRESH_TOKEN');
    return;
  }

  console.log(`[STARTUP-DIAGNOSTICS] Gmail API configuration initialized | Client ID: configured | Refresh token: configured | Sender: ${sender}`);
}

cron.schedule('*/10 * * * *', () => {
  runScheduledOptimization();
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Scheduler initialized: running VM optimization scan every 10 minutes.`);
  verifyGmailConfiguration();
});


