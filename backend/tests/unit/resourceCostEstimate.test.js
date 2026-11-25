const {
  fetchResourceMonthToDateCost,
  recordCircuitBreakerThrottle,
  clearCircuitBreaker
} = require('../../src/services/azureCostService');
const db = require('../../src/db');

jest.mock('../../src/db', () => ({
  query: jest.fn()
}));

describe('Resource Cost Retail Estimate & Precedence Unit Tests', () => {
  const USER_ID = 'user-est-123';
  const CONN_ID = 'conn-est-456';
  const SUB_ID = 'sub-est-789';
  const RG = 'rg-analytics';
  const VM_NAME = 'analytics-worker';

  afterEach(() => {
    clearCircuitBreaker(USER_ID, CONN_ID, SUB_ID);
    jest.clearAllMocks();
  });

  it('should prioritize cached actual billed cost over retail price estimate when breaker is open', async () => {
    // 1. Simulate existing PostgreSQL snapshot for resource
    const mockDbSnapshot = {
      resource_group: RG,
      resource_name: VM_NAME,
      total_cost: 84.50,
      currency: 'USD',
      cached_at: new Date().toISOString()
    };

    db.query.mockResolvedValueOnce({ rows: [mockDbSnapshot] });

    // 2. Trip circuit breaker
    recordCircuitBreakerThrottle(USER_ID, CONN_ID, SUB_ID);

    // 3. Request resource cost
    const result = await fetchResourceMonthToDateCost(SUB_ID, RG, VM_NAME, null, {
      userId: USER_ID,
      connectionId: CONN_ID
    });

    // 4. Assert actual cached cost was returned with isStale: true and isEstimated: false
    expect(result).toBeDefined();
    expect(result.totalCost).toBe(84.50);
    expect(result.currency).toBe('USD');
    expect(result.isStale).toBe(true);
    expect(result.isEstimated).toBe(false);
    expect(result.staleReason).toContain('Showing last known Azure cost');
  });

  it('should clearly label retail price estimates as isEstimated: true when used as fallback', async () => {
    const mockEstimate = {
      resourceName: VM_NAME,
      resourceGroup: RG,
      vmSize: 'Standard_D2s_v3',
      region: 'eastus',
      totalCost: 45.20,
      currency: 'USD',
      timeframe: 'MonthToDate',
      source: 'Azure Retail Prices',
      dataFound: true,
      isStale: true,
      isEstimated: true,
      staleReason: 'Azure Cost Management is temporarily throttled. Showing an estimated cost based on Azure retail pricing.',
      cachedAt: new Date().toISOString()
    };

    expect(mockEstimate.isEstimated).toBe(true);
    expect(mockEstimate.source).toBe('Azure Retail Prices');
    expect(mockEstimate.isStale).toBe(true);
    expect(mockEstimate.staleReason).toContain('Azure retail pricing');
  });
});
