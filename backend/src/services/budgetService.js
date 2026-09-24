const db = require('../db');
const { sendBudgetAlertNotification } = require('./notificationService');

/**
 * Validates budget input fields.
 */
function validateBudgetInput(data) {
  const { name, subscriptionId, monthlyAmount, warningThresholdPct = 80, criticalThresholdPct = 100 } = data;

  if (!name || typeof name !== 'string' || !name.trim()) {
    const err = new Error('Budget name is required');
    err.statusCode = 400;
    throw err;
  }

  if (!subscriptionId || typeof subscriptionId !== 'string' || !subscriptionId.trim()) {
    const err = new Error('Subscription ID is required');
    err.statusCode = 400;
    throw err;
  }

  const amount = parseFloat(monthlyAmount);
  if (isNaN(amount) || amount <= 0) {
    const err = new Error('Monthly amount must be a positive number');
    err.statusCode = 400;
    throw err;
  }

  const warnPct = parseFloat(warningThresholdPct);
  if (isNaN(warnPct) || warnPct <= 0 || warnPct > 100) {
    const err = new Error('Warning threshold must be between 1 and 100 percent');
    err.statusCode = 400;
    throw err;
  }

  const critPct = parseFloat(criticalThresholdPct);
  if (isNaN(critPct) || critPct < warnPct || critPct > 200) {
    const err = new Error('Critical threshold must be equal to or greater than warning threshold');
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Creates a new tenant-scoped budget.
 */
async function createBudget(userId, data) {
  validateBudgetInput(data);

  const query = `
    INSERT INTO budgets (
      user_id, subscription_id, resource_group, name, monthly_amount,
      currency, warning_threshold_pct, critical_threshold_pct
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;

  const values = [
    userId,
    data.subscriptionId.trim(),
    data.resourceGroup ? data.resourceGroup.trim() : null,
    data.name.trim(),
    parseFloat(data.monthlyAmount),
    data.currency ? data.currency.trim().toUpperCase() : 'INR',
    data.warningThresholdPct ? parseFloat(data.warningThresholdPct) : 80.00,
    data.criticalThresholdPct ? parseFloat(data.criticalThresholdPct) : 100.00
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Retrieves all budgets for authenticated user, enriched with current month spend.
 */
async function getBudgets(userId) {
  const budgetsRes = await db.query(
    'SELECT * FROM budgets WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  const budgets = budgetsRes.rows;

  const enriched = [];
  for (const b of budgets) {
    // Lookup current spend from cost_cache
    let spendQuery = `
      SELECT total_cost, currency FROM cost_cache
      WHERE user_id = $1 AND subscription_id = $2
    `;
    const params = [userId, b.subscription_id];

    if (b.resource_group) {
      spendQuery += ' AND LOWER(resource_group) = LOWER($3)';
      params.push(b.resource_group);
    }

    spendQuery += ' ORDER BY updated_at DESC LIMIT 1';
    const spendRes = await db.query(spendQuery, params);
    const currentSpend = spendRes.rows.length > 0 ? parseFloat(spendRes.rows[0].total_cost || 0) : 0;
    const monthlyAmount = parseFloat(b.monthly_amount);
    const percentUsed = monthlyAmount > 0 ? Math.round((currentSpend / monthlyAmount) * 10000) / 100 : 0;

    let alertStatus = 'NORMAL';
    if (percentUsed >= parseFloat(b.critical_threshold_pct)) {
      alertStatus = 'CRITICAL';
    } else if (percentUsed >= parseFloat(b.warning_threshold_pct)) {
      alertStatus = 'WARNING';
    }

    enriched.push({
      ...b,
      monthly_amount: monthlyAmount,
      warning_threshold_pct: parseFloat(b.warning_threshold_pct),
      critical_threshold_pct: parseFloat(b.critical_threshold_pct),
      current_spend: currentSpend,
      percent_used: percentUsed,
      alert_status: alertStatus
    });
  }

  return enriched;
}

/**
 * Retrieves a single budget by ID strictly scoped to user.
 */
async function getBudgetById(userId, budgetId) {
  const result = await db.query(
    'SELECT * FROM budgets WHERE id = $1 AND user_id = $2',
    [budgetId, userId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Budget not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

/**
 * Updates a budget strictly scoped to user.
 */
async function updateBudget(userId, budgetId, updates) {
  const existing = await getBudgetById(userId, budgetId);
  const merged = { ...existing, ...updates };
  validateBudgetInput(merged);

  const query = `
    UPDATE budgets
    SET name = $3,
        subscription_id = $4,
        resource_group = $5,
        monthly_amount = $6,
        currency = $7,
        warning_threshold_pct = $8,
        critical_threshold_pct = $9,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND user_id = $2
    RETURNING *
  `;

  const values = [
    budgetId,
    userId,
    merged.name.trim(),
    merged.subscription_id.trim(),
    merged.resource_group ? merged.resource_group.trim() : null,
    parseFloat(merged.monthly_amount),
    merged.currency ? merged.currency.trim().toUpperCase() : 'INR',
    parseFloat(merged.warning_threshold_pct),
    parseFloat(merged.critical_threshold_pct)
  ];

  const result = await db.query(query, values);
  return result.rows[0];
}

/**
 * Deletes a budget strictly scoped to user.
 */
async function deleteBudget(userId, budgetId) {
  const result = await db.query(
    'DELETE FROM budgets WHERE id = $1 AND user_id = $2 RETURNING id',
    [budgetId, userId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Budget not found');
    err.statusCode = 404;
    throw err;
  }

  return { success: true, id: budgetId };
}

/**
 * Evaluates all budgets for a user and dispatches threshold notifications without duplication.
 */
async function evaluateBudgetsForUser(userId, userEmail) {
  const budgets = await getBudgets(userId);
  const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

  for (const b of budgets) {
    const percentUsed = b.percent_used;
    const isCritical = percentUsed >= b.critical_threshold_pct;
    const isWarning = percentUsed >= b.warning_threshold_pct;

    let targetAlertLevel = 'NONE';
    let targetThreshold = 0;

    if (isCritical) {
      targetAlertLevel = 'CRITICAL';
      targetThreshold = b.critical_threshold_pct;
    } else if (isWarning) {
      targetAlertLevel = 'WARNING';
      targetThreshold = b.warning_threshold_pct;
    }

    if (targetAlertLevel === 'NONE') continue;

    // Duplicate alert check: Do not re-notify for the same or lower level in the same month
    if (b.last_alert_month === currentMonth) {
      if (b.last_alert_level === 'CRITICAL' || b.last_alert_level === targetAlertLevel) {
        continue;
      }
    }

    // Check user notification preferences
    const prefRes = await db.query(
      'SELECT optimization_notifications FROM user_notification_preferences WHERE user_id = $1',
      [userId]
    );
    const notificationsAllowed = prefRes.rows.length === 0 || prefRes.rows[0].optimization_notifications;

    if (notificationsAllowed && userEmail) {
      await sendBudgetAlertNotification({
        recipientEmail: userEmail,
        budgetName: b.name,
        subscriptionId: b.subscription_id,
        resourceGroup: b.resource_group,
        currentSpend: b.current_spend,
        budgetLimit: b.monthly_amount,
        thresholdPct: targetThreshold,
        currency: b.currency
      });
    }

    // Update alert status
    await db.query(
      `UPDATE budgets
       SET last_alert_level = $1, last_alert_month = $2, last_alert_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 AND user_id = $4`,
      [targetAlertLevel, currentMonth, b.id, userId]
    );
  }
}

module.exports = {
  createBudget,
  getBudgets,
  getBudgetById,
  updateBudget,
  deleteBudget,
  evaluateBudgetsForUser
};
