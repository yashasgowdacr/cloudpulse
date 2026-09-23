const db = require('../db');

/**
 * Detects cost anomalies for a tenant using cached historical cost data.
 * Adheres strictly to the rule: "Do NOT flag an anomaly if the baseline is insufficient."
 */
async function detectAnomaliesForUser(userId) {
  // Query resource-level cost entries for the user
  const costEntriesRes = await db.query(
    `SELECT subscription_id, resource_group, resource_name, total_cost, currency, cached_at
     FROM cost_cache
     WHERE user_id = $1 AND total_cost > 0
     ORDER BY cached_at DESC LIMIT 100`,
    [userId]
  );
  const costEntries = costEntriesRes.rows;

  if (costEntries.length < 3) {
    // Insufficient historical data to establish statistical baseline
    return [];
  }

  // Calculate baseline average spend
  const totalSpend = costEntries.reduce((sum, e) => sum + parseFloat(e.total_cost || 0), 0);
  const baselineAverage = totalSpend / costEntries.length;

  const detectedAnomalies = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const entry of costEntries) {
    const actual = parseFloat(entry.total_cost || 0);
    // Anomaly condition: current cost exceeds baseline average by at least 50%
    if (actual > baselineAverage * 1.5) {
      const expected = Math.round(baselineAverage * 100) / 100;
      const deviationPct = Math.round(((actual - expected) / expected) * 10000) / 100;

      let severity = 'MEDIUM';
      if (deviationPct > 100) {
        severity = 'CRITICAL';
      } else if (deviationPct > 60) {
        severity = 'HIGH';
      }

      const reason = `Unusual cost increase detected: Current cost of ${entry.currency || 'USD'} ${actual} is ${deviationPct}% above the baseline expected cost of ${entry.currency || 'USD'} ${expected}.`;

      // Check if already recorded for today to prevent duplicates
      const existingRes = await db.query(
        `SELECT id FROM cost_anomalies
         WHERE user_id = $1 AND subscription_id = $2
           AND COALESCE(resource_name, '') = COALESCE($3, '')
           AND detected_date = $4`,
        [userId, entry.subscription_id, entry.resource_name, today]
      );

      if (existingRes.rows.length === 0) {
        const insertRes = await db.query(
          `INSERT INTO cost_anomalies (
            user_id, subscription_id, resource_group, resource_name,
            detected_date, actual_cost, expected_cost, deviation_percentage,
            severity, status, reason
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'OPEN', $10)
          RETURNING *`,
          [
            userId,
            entry.subscription_id,
            entry.resource_group || null,
            entry.resource_name || null,
            today,
            actual,
            expected,
            deviationPct,
            severity,
            reason
          ]
        );
        detectedAnomalies.push(insertRes.rows[0]);
      }
    }
  }

  return detectedAnomalies;
}

/**
 * Retrieves cost anomalies for authenticated tenant.
 */
async function getAnomalies(userId, filters = {}) {
  let query = 'SELECT * FROM cost_anomalies WHERE user_id = $1';
  const params = [userId];

  if (filters.status) {
    query += ' AND status = $2';
    params.push(filters.status.toUpperCase());
  }

  query += ' ORDER BY detected_date DESC, created_at DESC';

  const result = await db.query(query, params);
  return result.rows.map(r => ({
    ...r,
    actual_cost: parseFloat(r.actual_cost),
    expected_cost: parseFloat(r.expected_cost),
    deviation_percentage: parseFloat(r.deviation_percentage)
  }));
}

/**
 * Acknowledges a detected anomaly.
 */
async function acknowledgeAnomaly(userId, anomalyId) {
  const result = await db.query(
    `UPDATE cost_anomalies
     SET status = 'ACKNOWLEDGED', acknowledged_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [anomalyId, userId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Anomaly record not found');
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  detectAnomaliesForUser,
  getAnomalies,
  acknowledgeAnomaly
};
