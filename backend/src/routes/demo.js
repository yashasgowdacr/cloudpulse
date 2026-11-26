const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();
const azureRouter = express.Router();
const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';
const DEMO_CONNECTION_ID = '00000000-0000-4000-8000-000000000002';

function demoGate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();
  try {
    const decoded = jwt.verify(header.slice(7).trim(), process.env.JWT_SECRET);
    if (decoded.demo === true && decoded.sub === DEMO_USER_ID) {
      req.user = {
        id: DEMO_USER_ID,
        name: 'CloudPulse User',
        email: 'user@cloudpulse.app',
        role: 'ADMIN',
        status: 'ACTIVE',
        isDemo: true
      };
      return next();
    }
  } catch (error) {
    // Let the normal authentication middleware produce the canonical 401.
  }
  return next();
}

function demoOnly(req, res, next) {
  return req.user?.isDemo ? next() : next('router');
}

const connection = {
  id: DEMO_CONNECTION_ID,
  connectionName: 'Primary Cloud Subscription',
  subscriptionId: '00000000-0000-4000-8000-000000000003',
  tenantId: '00000000-0000-4000-8000-000000000004',
  clientId: '00000000-0000-4000-8000-000000000005',
  provider: 'AZURE',
  status: 'ACTIVE'
};

const vms = [
  { id: 'vm-web-01', name: 'web-production-01', vmName: 'web-production-01', resourceGroup: 'rg-production', location: 'East US', vmSize: 'Standard_D2s_v5', powerState: 'running', status: 'running', averageCpuPercentage: 18.4, isProtected: true, protectionReason: 'Production workload', provider: 'AZURE', connectionId: DEMO_CONNECTION_ID },
  { id: 'vm-api-01', name: 'api-staging-01', vmName: 'api-staging-01', resourceGroup: 'rg-staging', location: 'East US', vmSize: 'Standard_B2s', powerState: 'running', status: 'running', averageCpuPercentage: 3.1, isProtected: false, provider: 'AZURE', connectionId: DEMO_CONNECTION_ID },
  { id: 'vm-worker-01', name: 'worker-dev-01', vmName: 'worker-dev-01', resourceGroup: 'rg-development', location: 'Central US', vmSize: 'Standard_B2s', powerState: 'deallocated', status: 'deallocated', averageCpuPercentage: 0, isProtected: false, provider: 'AZURE', connectionId: DEMO_CONNECTION_ID }
];

const actions = [
  { id: 'action-1', vmName: 'worker-dev-01', action: 'DEALLOCATE', status: 'SUCCESS', reason: 'Idle development VM', createdAt: '2026-11-24T10:30:00.000Z' },
  { id: 'action-2', vmName: 'api-staging-01', action: 'EVALUATE', status: 'SKIPPED', reason: 'Monitoring window not met', createdAt: '2026-11-23T08:15:00.000Z' }
];

function ok(data) { return (req, res) => res.json(data); }
router.use(demoGate, demoOnly);

router.get('/api/azure-connections', ok({ count: 1, connections: [connection] }));
router.get('/api/azure-connections/:id', (req, res) => req.params.id === DEMO_CONNECTION_ID ? res.json({ connection }) : res.status(404).json({ error: 'Azure connection not found' }));
router.post('/api/azure-connections', (req, res) => res.status(403).json({ error: 'Connections are read-only for this account.' }));
router.delete('/api/azure-connections/:id', (req, res) => res.status(403).json({ error: 'Connections are read-only for this account.' }));

router.get('/api/cloud/providers', ok({ providers: [
  { provider: 'AZURE', displayName: 'Microsoft Azure', capabilities: { discovery: true, metrics: true, lifecycle: true, cost: true } },
  { provider: 'AWS', displayName: 'Amazon Web Services', capabilities: { discovery: true, metrics: true, lifecycle: true, cost: false } },
  { provider: 'GCP', displayName: 'Google Cloud Platform', capabilities: { discovery: true, metrics: true, lifecycle: true, cost: false } }
] }));
router.get('/api/cloud/connections', ok({ connections: [connection] }));
router.get('/api/cloud/vms', ok({ count: vms.length, vms }));
router.post('/api/cloud/connections', (req, res) => res.status(403).json({ error: 'Connections are read-only for this account.' }));
router.delete('/api/cloud/connections/:id', (req, res) => res.status(403).json({ error: 'Connections are read-only for this account.' }));

router.get('/api/cost/month-to-date', ok({ totalCost: 1842.67, currency: 'USD', timeframe: 'MonthToDate', source: 'Cloud billing data', isStale: false }));
router.get('/api/cost/resource/:resourceGroup/:resourceName', (req, res) => res.json({ resourceGroup: req.params.resourceGroup, resourceName: req.params.resourceName, totalCost: 412.28, currency: 'USD', timeframe: 'MonthToDate', dataFound: true, source: 'Cloud billing data', isStale: false }));
router.get('/api/cost/vm-price/:resourceGroup/:vmName', ok({ vmSize: 'Standard_B2s', region: 'East US', hourlyPrice: 0.0416, currency: 'USD', priceUnit: '1 Hour', dataFound: true, source: 'Cloud pricing data' }));
router.get('/api/cost/savings/:resourceGroup/:vmName', ok({ vmName: 'api-staging-01', resourceGroup: 'rg-staging', hourlyPrice: 0.0416, currency: 'USD', idle: true, potentialHourlySavings: 0.0416, potential30MinuteSavings: 0.0208, isEstimate: true, source: 'Cloud pricing data' }));

router.get('/api/dashboard/kpis', ok({ kpis: {
  actualMonthToDateCost: 1842.67,
  estimatedProjectedCost: 2211.20,
  potentialMonthlySavings: 318.44,
  estimatedAvoidedCost: 126.75,
  currency: 'USD',
  activeVmCount: 2,
  idleVmCount: 1,
  protectedVmCount: 1,
  totalOptimizationActions: 1
}, labels: {
  actual: 'ACTUAL BILLED',
  estimated: 'ESTIMATED PROJECTED',
  potential: 'POTENTIAL SAVINGS',
  avoided: 'ESTIMATED AVOIDED COST'
} }));
router.get('/api/dashboard/trends', ok({
  dailyTrends: [
    { date: '2026-11-20', cost: 244.12, currency: 'USD' },
    { date: '2026-11-21', cost: 251.44, currency: 'USD' },
    { date: '2026-11-22', cost: 238.91, currency: 'USD' },
    { date: '2026-11-23', cost: 269.12, currency: 'USD' },
    { date: '2026-11-24', cost: 281.37, currency: 'USD' },
    { date: '2026-11-25', cost: 276.88, currency: 'USD' }
  ],
  byResourceGroup: [
    { resourceGroup: 'rg-production', cost: 1034.18, currency: 'USD' },
    { resourceGroup: 'rg-staging', cost: 512.49, currency: 'USD' },
    { resourceGroup: 'rg-platform', cost: 296.00, currency: 'USD' }
  ]
}));
router.get('/api/dashboard/savings-analytics', ok({ totalSavings: 318.44, monthlySavings: 318.44, savingsByDay: [ { date: '2026-11-24', amount: 12.48 } ], currency: 'USD' }));
router.get('/api/actions', ok({ count: actions.length, actions }));
router.get('/api/actions/:vmName', (req, res) => res.json({ vmName: req.params.vmName, count: actions.filter(a => a.vmName === req.params.vmName).length, actions: actions.filter(a => a.vmName === req.params.vmName) }));
router.get('/api/anomalies', ok({ count: 1, anomalies: [{ id: 'anomaly-1', resourceName: 'web-production-01', actualCost: 412.28, expectedCost: 300, deviationPercentage: 37.43, severity: 'MEDIUM', status: 'OPEN', reason: 'Cost above expected daily trend' }] }));
router.post('/api/anomalies/:id/acknowledge', ok({ message: 'Cost anomaly acknowledged successfully.' }));

router.get('/api/budgets', ok({ count: 1, budgets: [{ id: 'budget-1', name: 'Monthly cloud budget', subscriptionId: connection.subscriptionId, monthlyAmount: 3000, currency: 'USD', warningThresholdPct: 80, criticalThresholdPct: 100, currentSpend: 1842.67, utilizationPct: 61.42, status: 'ON_TRACK' }] }));
router.get('/api/budgets/:id', ok({ budget: { id: 'budget-1', name: 'Monthly cloud budget', subscriptionId: connection.subscriptionId, monthlyAmount: 3000, currency: 'USD', warningThresholdPct: 80, criticalThresholdPct: 100 } }));
router.post('/api/budgets', (req, res) => res.status(403).json({ error: 'This account is read-only.' }));
router.put('/api/budgets/:id', (req, res) => res.status(403).json({ error: 'This account is read-only.' }));
router.delete('/api/budgets/:id', (req, res) => res.status(403).json({ error: 'This account is read-only.' }));

router.get('/api/settings', ok({ user: { id: DEMO_USER_ID, name: 'CloudPulse User', email: 'user@cloudpulse.app', role: 'ADMIN', status: 'ACTIVE' }, notifications: { deallocationNotifications: true, optimizationNotifications: true }, exclusionTagsCount: 1 }));
router.get('/api/settings/notifications', ok({ preferences: { deallocationNotifications: true, optimizationNotifications: true } }));
router.get('/api/settings/exclusion-tags', ok({ tags: [{ id: 'tag-1', tagKey: 'Environment', tagValue: 'production', createdAt: '2026-11-01T00:00:00.000Z' }] }));
router.patch('/api/settings/password', (req, res) => res.status(403).json({ error: 'Password changes are unavailable for this account.' }));
router.patch('/api/settings/notifications', ok({ message: 'Notification preferences updated successfully.', preferences: { deallocationNotifications: true, optimizationNotifications: true } }));
router.post('/api/settings/exclusion-tags', (req, res) => res.status(403).json({ error: 'This account is read-only.' }));
router.delete('/api/settings/exclusion-tags/:id', (req, res) => res.status(403).json({ error: 'This account is read-only.' }));

router.get('/api/optimization-policy', ok({ policy: { idleCpuThreshold: 5, monitoringWindowMinutes: 30, autoShutdown: true, scheduledShutdownEnabled: true, scheduledShutdownTime: '22:00', scheduledStartEnabled: true, scheduledStartTime: '08:00', scheduleTimezone: 'UTC', scheduleDays: '1,2,3,4,5' } }));
router.get('/api/optimization-policy/scopes', ok({ scopes: [{ id: 'scope-1', scopeType: 'RESOURCE_GROUP', scopeValue: 'rg-development', idleCpuThreshold: 5, monitoringWindowMinutes: 30, autoShutdown: true, priority: 50 }] }));
router.post('/api/optimization-policy/resolve', ok({ isProtected: false, autoShutdown: true, explanation: 'Policy allows shutdown for idle non-production resources.', sourceScope: 'rg-development' }));
router.put('/api/optimization-policy', (req, res) => res.status(403).json({ error: 'This account is read-only.' }));
router.post('/api/optimization-policy/scopes', (req, res) => res.status(403).json({ error: 'This account is read-only.' }));
router.put('/api/optimization-policy/scopes/:id', (req, res) => res.status(403).json({ error: 'This account is read-only.' }));
router.delete('/api/optimization-policy/scopes/:id', (req, res) => res.status(403).json({ error: 'This account is read-only.' }));

router.post('/api/optimization/run-now', ok({ status: 'SUCCESS', message: 'Optimization scan completed.', scanned: 3, eligible: 1, protected: 1, skipped: 1 }));
router.get('/api/scheduler/run-now', ok({ status: 'SUCCESS', message: 'Optimization scan completed.', scanned: 3, eligible: 1, protected: 1, skipped: 1 }));
router.get('/api/notifications/test', ok({ success: true, provider: 'notification service', message: 'Test notification sent successfully.', recipient: 'cloudpulse.project@gmail.com' }));
router.get('/api/admin/metrics', ok({ metrics: { totalTenants: 1, activeTenants: 1, totalAzureConnections: 1, totalOptimizationActions: actions.length, successfulDeallocations: 1, totalEstimatedAvoidedCost: 318.44, currency: 'USD' } }));
router.get('/api/export/vms', (req, res) => res.type('text/csv').send('VM Name,Resource Group,Location,Power State\nweb-production-01,rg-production,East US,running\napi-staging-01,rg-staging,East US,running\nworker-dev-01,rg-development,Central US,deallocated\n'));
router.get('/api/export/actions', (req, res) => res.type('text/csv').send('Timestamp (UTC),VM Name,Action,Status,CPU Average (%),Connection,Reason / Details\n2026-11-24T10:30:00.000Z,worker-dev-01,DEALLOCATE,SUCCESS,,Primary Cloud Subscription,Idle development VM\n'));
router.get('/api/export/costs', (req, res) => res.type('text/csv').send('Date,Resource,Cost,Currency\n2026-11-25,api-staging-01,1842.67,USD\n'));

azureRouter.use(demoGate, demoOnly);
azureRouter.get('/vms', ok({ count: vms.length, vms }));
azureRouter.get('/vms/:resourceGroup/:vmName/metrics', ok({ resourceGroup: 'rg-staging', vmName: 'api-staging-01', metricName: 'Percentage CPU', timespan: 'PT30M', averageCpuPercentage: 3.1, dataPointsCount: 6, dataPoints: [2.8, 3.4, 3.0, 2.9, 3.2, 3.3] }));
azureRouter.get('/vms/:resourceGroup/:vmName/idle', ok({ vmName: 'api-staging-01', idle: true, cpuAverage: 3.1, threshold: 5, monitoringWindowMinutes: 30, reason: 'Average CPU is below the configured threshold.' }));
azureRouter.get('/vms/:resourceGroup/:vmName/policy', ok({ allowed: true, autoShutdown: true, reason: 'VM is idle and not production.' }));
azureRouter.post('/vms/:resourceGroup/:vmName/shutdown', ok({ allowed: true, executed: false, status: 'PREVIEW', action: 'DEALLOCATE', reason: 'Actions are preview-only for this account.' }));
azureRouter.post('/vms/:resourceGroup/:vmName/start', ok({ executed: false, status: 'PREVIEW', action: 'START', reason: 'Actions are preview-only for this account.' }));
azureRouter.post('/vms/bulk/deallocate', ok({ success: [], skipped: vms, protected: [], errors: [], status: 'PREVIEW' }));
azureRouter.post('/vms/bulk/start', ok({ success: [], skipped: vms, protected: [], errors: [], status: 'PREVIEW' }));

module.exports = { router, azureRouter, DEMO_USER_ID };
