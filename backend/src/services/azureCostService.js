const { DefaultAzureCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { CostManagementClient } = require('@azure/arm-costmanagement');
const db = require('../db');
const { getVmPowerState, fetchVmCpuMetrics, evaluateVmIdleStatus } = require('./azureVmService');

const costCache = new Map();
const inFlightRequests = new Map();
const throttleState = new Map();
const COST_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes fresh cache TTL
const CIRCUIT_BREAKER_TTL_MS = 5 * 60 * 1000; // 5 minutes circuit-breaker cooldown

/**
 * Checks if the circuit breaker is currently open (throttled) for the context.
 */
function isCircuitBreakerOpen(userId, connectionId, subscriptionId) {
  const contextKey = `${userId}:${connectionId}:${subscriptionId}`;
  const record = throttleState.get(contextKey);
  if (!record) return false;
  const now = Date.now();
  if (now - record.throttledAt < record.cooldownMs) {
    return true;
  }
  throttleState.delete(contextKey);
  return false;
}

/**
 * Records a 429 throttling event to trip the circuit breaker for the context.
 */
function recordCircuitBreakerThrottle(userId, connectionId, subscriptionId, retryAfterSec = null) {
  const contextKey = `${userId}:${connectionId}:${subscriptionId}`;
  let cooldownMs = CIRCUIT_BREAKER_TTL_MS;
  if (retryAfterSec) {
    const parsedSec = parseInt(retryAfterSec, 10);
    if (!isNaN(parsedSec) && parsedSec > 0) {
      cooldownMs = Math.max(60000, parsedSec * 1000);
    }
  }
  throttleState.set(contextKey, { throttledAt: Date.now(), cooldownMs });
  console.warn(`[AZURE-COST-API] Circuit breaker tripped for context '${contextKey}'. Cooldown: ${cooldownMs}ms`);
}

/**
 * Clears the circuit breaker on a successful Azure Cost Management query.
 */
function clearCircuitBreaker(userId, connectionId, subscriptionId) {
  const contextKey = `${userId}:${connectionId}:${subscriptionId}`;
  throttleState.delete(contextKey);
}

/**
 * Helper to execute Azure Cost Management API queries with exponential backoff retries on HTTP 429.
 */
async function executeAzureCostQueryWithRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.statusCode === 429 ||
                    (err.response && err.response.status === 429) ||
                    (err.message && err.message.includes('429')) ||
                    (err.code && err.code.includes('429'));

      if (is429 && attempt < maxRetries) {
        let delayMs = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
        const retryAfterHeader = (err.response && err.response.headers && err.response.headers['retry-after']) ||
                                 (err.headers && err.headers['retry-after']);
        if (retryAfterHeader) {
          const parsedSec = parseInt(retryAfterHeader, 10);
          if (!isNaN(parsedSec) && parsedSec > 0 && parsedSec <= 30) {
            delayMs = parsedSec * 1000;
          }
        }
        const jitter = Math.floor(Math.random() * 400) - 200;
        delayMs = Math.max(1000, delayMs + jitter);

        console.warn(`[AZURE-COST-API] 429 Rate limit encountered. Attempt ${attempt + 1}/${maxRetries}. Retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
}

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
 * exponential backoff retry on 429, PostgreSQL persistent caching, circuit breaker, and stale cache fallback.
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

  // 4. Circuit-Breaker Check: If circuit is open (throttled), do NOT hit Azure API
  if (isCircuitBreakerOpen(userId, connectionId, subscriptionId)) {
    const fallbackData = cached ? cached.data : dbSnapshot;
    if (fallbackData) {
      console.warn(`[AZURE-COST-API] Circuit breaker open. Returning stale MTD cost data for key '${cacheKey}'`);
      return {
        ...fallbackData,
        isStale: true,
        staleReason: 'Azure Cost Management is temporarily throttling requests. Showing last known Azure cost.',
        cachedAt: fallbackData.cachedAt || (cached ? new Date(cached.timestamp).toISOString() : new Date().toISOString())
      };
    }
    const rateLimitErr = new Error('Azure Cost Management is temporarily throttling requests. Please try again shortly.');
    rateLimitErr.statusCode = 429;
    rateLimitErr.code = 'COST_DATA_TEMPORARILY_UNAVAILABLE';
    throw rateLimitErr;
  }

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

      // Clear circuit breaker state on success
      clearCircuitBreaker(userId, connectionId, subscriptionId);

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

      if (is429) {
        const retryAfterHeader = (err.response && err.response.headers && err.response.headers['retry-after']) ||
                                 (err.headers && err.headers['retry-after']);
        recordCircuitBreakerThrottle(userId, connectionId, subscriptionId, retryAfterHeader);
      }

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

/**
 * Helper to compute an estimated month-to-date cost based on Azure Retail Prices API
 * when Azure Cost Management API is throttled AND no historical PostgreSQL snapshot exists.
 */
async function getResourceRetailEstimate(subscriptionId, resourceGroup, resourceName, customCredential = null) {
  try {
    const credential = customCredential || new DefaultAzureCredential();
    const computeClient = new ComputeManagementClient(credential, subscriptionId);
    let vm;
    try {
      vm = await computeClient.virtualMachines.get(resourceGroup, resourceName);
    } catch (vmErr) {
      return null;
    }

    const vmSize = (vm.hardwareProfile && vm.hardwareProfile.vmSize) ? vm.hardwareProfile.vmSize : null;
    const region = vm.location || null;

    if (!vmSize || !region) return null;

    const retailRes = await fetchVmRetailPrice(vmSize, region);
    if (!retailRes || !retailRes.dataFound || retailRes.hourlyPrice === null || retailRes.hourlyPrice === undefined) {
      return null;
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const hoursElapsed = Math.max(1, (now.getTime() - startOfMonth.getTime()) / (1000 * 60 * 60));
    const estimatedCost = Math.round(hoursElapsed * retailRes.hourlyPrice * 100) / 100;

    return {
      resourceName,
      resourceGroup,
      vmSize,
      region,
      totalCost: estimatedCost,
      currency: retailRes.currency || 'USD',
      timeframe: 'MonthToDate',
      source: 'Azure Retail Prices',
      dataFound: true,
      isStale: true,
      isEstimated: true,
      staleReason: 'Azure Cost Management is temporarily throttled. Showing an estimated cost based on Azure retail pricing.',
      reason: `Actual Azure Cost Management data is temporarily throttled. Showing an estimated month-to-date cost (${Math.round(hoursElapsed)} hours @ $${retailRes.hourlyPrice}/hr) based on Azure retail pricing.`,
      cachedAt: new Date().toISOString()
    };
  } catch (err) {
    return null;
  }
}

/**
 * Fetches Resource Month-to-Date cost with multi-tenant caching, in-flight request deduplication,
 * exponential backoff retry on 429, PostgreSQL persistent caching, circuit breaker, retail price estimate fallback, and stale cache fallback.
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

  // Circuit-Breaker Check: If subscription is currently throttled, return PostgreSQL resource snapshot or Retail Price Estimate
  if (isCircuitBreakerOpen(userId, connectionId, subscriptionId)) {
    const fallbackData = cached ? cached.data : dbSnapshot;
    if (fallbackData) {
      console.warn(`[AZURE-COST-API] Circuit breaker open. Returning stale Resource cost data for key '${cacheKey}'`);
      return {
        ...fallbackData,
        isStale: true,
        isEstimated: false,
        staleReason: 'Azure Cost Management is temporarily throttling requests. Showing last known Azure cost.',
        cachedAt: fallbackData.cachedAt || (cached ? new Date(cached.timestamp).toISOString() : new Date().toISOString())
      };
    }

    const estimateFallback = await getResourceRetailEstimate(subscriptionId, resourceGroup, resourceName, customCredential);
    if (estimateFallback) {
      console.warn(`[AZURE-COST-API] Circuit breaker open & 0 snapshot. Returning Retail Price estimate for key '${cacheKey}'`);
      return estimateFallback;
    }

    const rateLimitErr = new Error('Azure Cost Management is temporarily throttling requests. Please try again shortly.');
    rateLimitErr.statusCode = 429;
    rateLimitErr.code = 'COST_DATA_TEMPORARILY_UNAVAILABLE';
    throw rateLimitErr;
  }

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
          isEstimated: false,
          reason: dataFound
            ? `Matching cost record found for resource '${resourceName}'.`
            : `No matching billing record found for resource '${resourceName}' in resource group '${resourceGroup}' for the current month-to-date period.`
        };
      });

      clearCircuitBreaker(userId, connectionId, subscriptionId);

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

      if (is429) {
        const retryAfterHeader = (err.response && err.response.headers && err.response.headers['retry-after']) ||
                                 (err.headers && err.headers['retry-after']);
        recordCircuitBreakerThrottle(userId, connectionId, subscriptionId, retryAfterHeader);
      }

      const fallbackData = cached ? cached.data : dbSnapshot;
      if (fallbackData) {
        console.warn(`[AZURE-COST-API] Throttled/Error. Returning stale cached Resource cost data for key '${cacheKey}'`);
        return {
          ...fallbackData,
          isStale: true,
          isEstimated: false,
          staleReason: 'Azure Cost Management is temporarily throttling requests. Showing last known Azure cost.',
          cachedAt: fallbackData.cachedAt || (cached ? new Date(cached.timestamp).toISOString() : new Date().toISOString())
        };
      }

      if (is429) {
        const estimateFallback = await getResourceRetailEstimate(subscriptionId, resourceGroup, resourceName, customCredential);
        if (estimateFallback) {
          console.warn(`[AZURE-COST-API] Throttled 429 & 0 snapshot. Returning Retail Price estimate for key '${cacheKey}'`);
          return estimateFallback;
        }

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

/**
 * Queries Azure Retail Prices API for on-demand Pay-As-You-Go pricing for a specific VM SKU and region.
 */
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

/**
 * Calculates potential compute cost savings for an idle VM based on retail price and power state.
 */
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

/**
 * Retrieves pricing details for a named VM by looking up its hardwareProfile size and region.
 */
async function fetchVmPriceDetails(subscriptionId, resourceGroup, vmName, customCredential = null) {
  const credential = customCredential || new DefaultAzureCredential();
  const client = new ComputeManagementClient(credential, subscriptionId);

  let vm;
  try {
    vm = await client.virtualMachines.get(resourceGroup, vmName);
  } catch (vmErr) {
    if (vmErr.statusCode === 404 || (vmErr.message && vmErr.message.includes('ResourceNotFound'))) {
      const notFoundErr = new Error(`Virtual machine '${vmName}' not found in resource group '${resourceGroup}'.`);
      notFoundErr.code = 'VM_NOT_FOUND';
      notFoundErr.statusCode = 404;
      throw notFoundErr;
    }
    throw vmErr;
  }

  const vmSize = (vm.hardwareProfile && vm.hardwareProfile.vmSize) ? vm.hardwareProfile.vmSize : null;
  const region = vm.location || null;

  if (!vmSize || !region) {
    return {
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
    };
  }

  const priceResult = await fetchVmRetailPrice(vmSize, region);

  return {
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
  };
}

module.exports = {
  isCircuitBreakerOpen,
  recordCircuitBreakerThrottle,
  clearCircuitBreaker,
  executeAzureCostQueryWithRetry,
  savePersistentCostCache,
  getPersistentCostCache,
  fetchSubscriptionMonthToDateCost,
  getResourceRetailEstimate,
  fetchResourceMonthToDateCost,
  fetchVmRetailPrice,
  fetchVmPriceDetails,
  calculateVmPotentialSavings
};
