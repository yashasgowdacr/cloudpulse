const ExcelJS = require('exceljs');
const db = require('../db');
const { getAzureCredentialForUser } = require('./azureConnectionResolver');
const { discoverAzureVms } = require('./azureVmService');

function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateCsv(headers, rows) {
  const headerLine = headers.map(h => escapeCsvValue(h.label)).join(',');
  const dataLines = rows.map(row => headers.map(h => escapeCsvValue(row[h.key])).join(','));
  return [headerLine, ...dataLines].join('\r\n');
}

async function generateExcelBuffer(sheetName, headers, rows) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CloudPulse';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = headers.map(h => ({
    header: h.label,
    key: h.key,
    width: h.width || 20
  }));

  // Style header row
  sheet.getRow(1).font = { bold: true, color: { argb: 'FF0F172A' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF1F5F9' }
  };

  sheet.addRows(rows);
  return await workbook.xlsx.writeBuffer();
}

/**
 * Export VM Inventory for authenticated user's Azure connection
 */
async function exportVmInventory(userId, connectionId, format = 'csv') {
  if (!userId) {
    const err = new Error('User ID is required');
    err.statusCode = 400;
    throw err;
  }

  // If connectionId is not provided, find the active connection
  let targetConnId = connectionId;
  if (!targetConnId) {
    const conns = await db.query(
      `SELECT id FROM azure_connections WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY created_at ASC LIMIT 2`,
      [userId]
    );
    if (conns.rows.length === 0) {
      const err = new Error('No active Azure connections found');
      err.statusCode = 404;
      throw err;
    }
    if (conns.rows.length > 1) {
      const err = new Error('Multiple connections exist. Please provide connectionId');
      err.statusCode = 400;
      throw err;
    }
    targetConnId = conns.rows[0].id;
  }

  // Validate tenant ownership
  const resolved = await getAzureCredentialForUser(userId, targetConnId);
  const vms = await discoverAzureVms(resolved.subscriptionId, resolved.credential);

  const headers = [
    { label: 'VM Name', key: 'name', width: 25 },
    { label: 'Resource Group', key: 'resourceGroup', width: 25 },
    { label: 'Location', key: 'location', width: 20 },
    { label: 'Size', key: 'size', width: 20 },
    { label: 'Power State', key: 'status', width: 15 }
  ];

  const rows = vms.map(v => ({
    name: v.name,
    resourceGroup: v.resourceGroup,
    location: v.location,
    size: v.size || 'N/A',
    status: v.status || 'unknown'
  }));

  const isExcel = format.toLowerCase() === 'xlsx' || format.toLowerCase() === 'excel';
  const filename = `cloudpulse-vms-${Date.now()}.${isExcel ? 'xlsx' : 'csv'}`;
  const contentType = isExcel
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv';

  const data = isExcel
    ? await generateExcelBuffer('VM Inventory', headers, rows)
    : generateCsv(headers, rows);

  return { filename, contentType, data };
}

/**
 * Export Action History for authenticated user
 */
async function exportActionHistory(userId, format = 'csv') {
  if (!userId) {
    const err = new Error('User ID is required');
    err.statusCode = 400;
    throw err;
  }

  const result = await db.query(
    `SELECT a.created_at, a.vm_name, a.action, a.status, a.cpu_average, a.reason, c.connection_name
     FROM action_history a
     LEFT JOIN azure_connections c ON a.connection_id = c.id
     WHERE a.user_id = $1
     ORDER BY a.created_at DESC`,
    [userId]
  );

  const headers = [
    { label: 'Timestamp (UTC)', key: 'timestamp', width: 25 },
    { label: 'VM Name', key: 'vmName', width: 25 },
    { label: 'Action', key: 'action', width: 15 },
    { label: 'Status', key: 'status', width: 15 },
    { label: 'CPU Average (%)', key: 'cpuAverage', width: 18 },
    { label: 'Connection', key: 'connectionName', width: 20 },
    { label: 'Reason / Details', key: 'reason', width: 45 }
  ];

  const rows = result.rows.map(r => ({
    timestamp: new Date(r.created_at).toISOString(),
    vmName: r.vm_name,
    action: r.action,
    status: r.status,
    cpuAverage: r.cpu_average !== null && r.cpu_average !== undefined ? `${r.cpu_average}%` : 'N/A',
    connectionName: r.connection_name || 'N/A',
    reason: r.reason || ''
  }));

  const isExcel = format.toLowerCase() === 'xlsx' || format.toLowerCase() === 'excel';
  const filename = `cloudpulse-actions-${Date.now()}.${isExcel ? 'xlsx' : 'csv'}`;
  const contentType = isExcel
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv';

  const data = isExcel
    ? await generateExcelBuffer('Action History', headers, rows)
    : generateCsv(headers, rows);

  return { filename, contentType, data };
}

/**
 * Export Cost Data for authenticated user
 */
async function exportCostData(userId, connectionId = null, format = 'csv') {
  if (!userId) {
    const err = new Error('User ID is required');
    err.statusCode = 400;
    throw err;
  }

  let query = `
    SELECT c.subscription_id, c.cache_type, c.resource_group, c.resource_name, c.total_cost, c.currency, c.cached_at, conn.connection_name
    FROM cost_cache c
    LEFT JOIN azure_connections conn ON c.connection_id = conn.id
    WHERE c.user_id = $1
  `;
  const params = [userId];

  if (connectionId) {
    // Validate connection belongs to user
    const check = await db.query(
      `SELECT id FROM azure_connections WHERE id = $1 AND user_id = $2`,
      [connectionId, userId]
    );
    if (check.rows.length === 0) {
      const err = new Error('Azure connection not found or unauthorized');
      err.statusCode = 404;
      throw err;
    }
    query += ` AND c.connection_id = $2`;
    params.push(connectionId);
  }

  query += ` ORDER BY c.cached_at DESC`;

  const result = await db.query(query, params);

  const headers = [
    { label: 'Connection', key: 'connectionName', width: 20 },
    { label: 'Subscription ID', key: 'subscriptionId', width: 35 },
    { label: 'Cache Type', key: 'cacheType', width: 18 },
    { label: 'Resource Group', key: 'resourceGroup', width: 25 },
    { label: 'Resource Name', key: 'resourceName', width: 25 },
    { label: 'Total Cost', key: 'totalCost', width: 15 },
    { label: 'Currency', key: 'currency', width: 10 },
    { label: 'Cached At (UTC)', key: 'cachedAt', width: 25 }
  ];

  const rows = result.rows.map(r => ({
    connectionName: r.connection_name || 'N/A',
    subscriptionId: r.subscription_id,
    cacheType: r.cache_type,
    resourceGroup: r.resource_group || 'All',
    resourceName: r.resource_name || 'All',
    totalCost: parseFloat(r.total_cost).toFixed(2),
    currency: r.currency || 'USD',
    cachedAt: new Date(r.cached_at).toISOString()
  }));

  const isExcel = format.toLowerCase() === 'xlsx' || format.toLowerCase() === 'excel';
  const filename = `cloudpulse-costs-${Date.now()}.${isExcel ? 'xlsx' : 'csv'}`;
  const contentType = isExcel
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv';

  const data = isExcel
    ? await generateExcelBuffer('Cost Overview', headers, rows)
    : generateCsv(headers, rows);

  return { filename, contentType, data };
}

module.exports = {
  exportVmInventory,
  exportActionHistory,
  exportCostData
};
