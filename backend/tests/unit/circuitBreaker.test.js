const {
  isCircuitBreakerOpen,
  recordCircuitBreakerThrottle,
  clearCircuitBreaker,
  executeAzureCostQueryWithRetry
} = require('../../src/services/azureCostService');

describe('Azure Cost API Circuit Breaker Unit Tests', () => {
  const USER_ID = 'test-user-circuit-123';
  const CONN_ID = 'test-conn-456';
  const SUB_ID = 'test-sub-789';

  beforeEach(() => {
    // Ensure clean state before each test
    clearCircuitBreaker(USER_ID, CONN_ID, SUB_ID);
  });

  afterEach(() => {
    clearCircuitBreaker(USER_ID, CONN_ID, SUB_ID);
  });

  describe('Initial State', () => {
    it('should be closed initially for a new context', () => {
      expect(isCircuitBreakerOpen(USER_ID, CONN_ID, SUB_ID)).toBe(false);
    });
  });

  describe('Throttling and Tripping', () => {
    it('should trip and open when recordCircuitBreakerThrottle is called', () => {
      recordCircuitBreakerThrottle(USER_ID, CONN_ID, SUB_ID);
      expect(isCircuitBreakerOpen(USER_ID, CONN_ID, SUB_ID)).toBe(true);
    });

    it('should respect custom Retry-After seconds (minimum 60s cooldown)', () => {
      recordCircuitBreakerThrottle(USER_ID, CONN_ID, SUB_ID, 120);
      expect(isCircuitBreakerOpen(USER_ID, CONN_ID, SUB_ID)).toBe(true);
    });

    it('should enforce 60s minimum cooldown even if Retry-After is less than 60', () => {
      recordCircuitBreakerThrottle(USER_ID, CONN_ID, SUB_ID, 5);
      expect(isCircuitBreakerOpen(USER_ID, CONN_ID, SUB_ID)).toBe(true);
    });
  });

  describe('Reset and Cooldown Recovery', () => {
    it('should immediately close when clearCircuitBreaker is called on success', () => {
      recordCircuitBreakerThrottle(USER_ID, CONN_ID, SUB_ID);
      expect(isCircuitBreakerOpen(USER_ID, CONN_ID, SUB_ID)).toBe(true);

      clearCircuitBreaker(USER_ID, CONN_ID, SUB_ID);
      expect(isCircuitBreakerOpen(USER_ID, CONN_ID, SUB_ID)).toBe(false);
    });

    it('should auto-recover once cooldown expires', () => {
      const realDateNow = Date.now;
      try {
        const startTime = 1000000;
        Date.now = jest.fn(() => startTime);

        recordCircuitBreakerThrottle(USER_ID, CONN_ID, SUB_ID, 60); // 60s cooldown = 60,000ms
        expect(isCircuitBreakerOpen(USER_ID, CONN_ID, SUB_ID)).toBe(true);

        // Advance simulated time past cooldown (+61 seconds)
        Date.now = jest.fn(() => startTime + 61000);
        expect(isCircuitBreakerOpen(USER_ID, CONN_ID, SUB_ID)).toBe(false);
      } finally {
        Date.now = realDateNow;
      }
    });
  });

  describe('Tenant Context Isolation', () => {
    const OTHER_USER = 'other-user-999';
    const OTHER_CONN = 'other-conn-888';
    const OTHER_SUB = 'other-sub-777';

    afterEach(() => {
      clearCircuitBreaker(OTHER_USER, OTHER_CONN, OTHER_SUB);
    });

    it('should isolate circuit breaker states across different tenant contexts', () => {
      recordCircuitBreakerThrottle(USER_ID, CONN_ID, SUB_ID);

      expect(isCircuitBreakerOpen(USER_ID, CONN_ID, SUB_ID)).toBe(true);
      expect(isCircuitBreakerOpen(OTHER_USER, OTHER_CONN, OTHER_SUB)).toBe(false);
      expect(isCircuitBreakerOpen(USER_ID, OTHER_CONN, SUB_ID)).toBe(false);
    });
  });

  describe('Query Retry with Exponential Backoff', () => {
    it('should succeed immediately if the underlying operation succeeds', async () => {
      const fn = jest.fn().mockResolvedValue({ totalCost: 125.50 });
      const result = await executeAzureCostQueryWithRetry(fn, 2);

      expect(result).toEqual({ totalCost: 125.50 });
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should not retry non-429 errors and should re-throw immediately', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Generic database error'));

      await expect(executeAzureCostQueryWithRetry(fn, 3)).rejects.toThrow('Generic database error');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should re-throw after exhausting maxRetries on persistent 429 errors', async () => {
      const error429 = new Error('Too Many Requests');
      error429.statusCode = 429;
      const fn = jest.fn().mockRejectedValue(error429);

      // maxRetries = 1 for quick test execution
      await expect(executeAzureCostQueryWithRetry(fn, 1)).rejects.toThrow('Too Many Requests');
      expect(fn).toHaveBeenCalledTimes(2); // initial attempt + 1 retry
    });
  });
});
