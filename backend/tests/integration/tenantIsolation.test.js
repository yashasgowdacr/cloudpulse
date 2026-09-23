// Ensure test environment variables are loaded before modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_min_32_characters_long_12345';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_min_32_characters_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('../../src/db');
const app = require('../../src/app');
const { getAzureCredentialForUser } = require('../../src/services/azureConnectionResolver');
const { getActions } = require('../../src/services/actionHistoryService');
const { isCircuitBreakerOpen, recordCircuitBreakerThrottle, clearCircuitBreaker } = require('../../src/services/azureCostService');

// Mock db.query to isolate tests from live PostgreSQL databases
jest.mock('../../src/db', () => ({
  query: jest.fn()
}));

describe('Multi-Tenant Isolation Integration Tests', () => {
  const USER_A_ID = '11111111-1111-4111-a111-111111111111';
  const USER_B_ID = '22222222-2222-4222-b222-222222222222';
  const CONN_B_ID = '33333333-3333-4333-c333-333333333333';

  const userAToken = jwt.sign({ sub: USER_A_ID, role: 'USER' }, process.env.JWT_SECRET);
  const userBToken = jwt.sign({ sub: USER_B_ID, role: 'USER' }, process.env.JWT_SECRET);

  beforeEach(() => {
    jest.clearAllMocks();

    // Default db.query mock: authenticateToken succeeds for valid user IDs
    db.query.mockImplementation(async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('FROM users WHERE id = $1')) {
        return {
          rows: [
            {
              id: params[0],
              name: 'Authenticated Tenant',
              email: 'tenant@example.com',
              role: 'USER',
              status: 'ACTIVE'
            }
          ]
        };
      }
      return { rows: [] };
    });
  });

  describe('Azure Connection Ownership Isolation (WHERE id = $1 AND user_id = $2)', () => {
    it('should reject resolution when User A attempts to access User B connectionId', async () => {
      // Mock db returns empty rows when query filters by (CONN_B_ID, USER_A_ID)
      db.query.mockImplementation(async (sql, params) => {
        if (sql.includes('FROM azure_connections WHERE id = $1 AND user_id = $2')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      await expect(getAzureCredentialForUser(USER_A_ID, CONN_B_ID)).rejects.toThrow(
        'Specified Azure connection not found for user'
      );

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND user_id = $2'),
        [CONN_B_ID, USER_A_ID]
      );
    });

    it('should return 404 when User A requests connection details belonging to User B via HTTP API', async () => {
      const res = await request(app)
        .get(`/api/azure-connections/${CONN_B_ID}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Azure connection not found');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND user_id = $2'),
        [CONN_B_ID, USER_A_ID]
      );
    });

    it('should return 404 when User A attempts to DELETE connection belonging to User B', async () => {
      const res = await request(app)
        .delete(`/api/azure-connections/${CONN_B_ID}`)
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Azure connection not found');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = $1 AND user_id = $2'),
        [CONN_B_ID, USER_A_ID]
      );
    });
  });

  describe('Action History Multi-Tenant Isolation (WHERE user_id = $1)', () => {
    it('should strictly scope getActions to the authenticated user ID', async () => {
      const dbRow = {
        id: 'act-1',
        user_id: USER_A_ID,
        connection_id: 'conn-1',
        vm_name: 'user-a-vm',
        action: 'START',
        status: 'SUCCESS',
        cpu_average: '2.50',
        reason: 'Manual start',
        created_at: new Date('2026-09-22T00:00:00Z')
      };

      db.query.mockImplementation(async (sql, params) => {
        if (sql.includes('WHERE user_id = $1')) {
          return { rows: [dbRow] };
        }
        return { rows: [] };
      });

      const actions = await getActions(USER_A_ID);

      expect(actions.length).toBe(1);
      expect(actions[0].userId).toBe(USER_A_ID);
      expect(actions[0].vmName).toBe('user-a-vm');
      expect(actions[0].cpuAverage).toBe(2.5);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1'),
        expect.arrayContaining([USER_A_ID])
      );
    });

    it('should pass authenticated req.user.id to database query via GET /api/actions', async () => {
      const res = await request(app)
        .get('/api/actions')
        .set('Authorization', `Bearer ${userBToken}`);

      expect(res.status).toBe(200);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE user_id = $1'),
        [USER_B_ID]
      );
    });
  });

  describe('Cost Management & Circuit Breaker Tenant Isolation', () => {
    it('should isolate circuit breaker states across different tenant IDs', () => {
      const subId = 'sub-test-456';

      clearCircuitBreaker(USER_A_ID, CONN_B_ID, subId);
      clearCircuitBreaker(USER_B_ID, CONN_B_ID, subId);

      // User A trips circuit breaker
      recordCircuitBreakerThrottle(USER_A_ID, CONN_B_ID, subId);

      // User A is throttled, User B is unaffected
      expect(isCircuitBreakerOpen(USER_A_ID, CONN_B_ID, subId)).toBe(true);
      expect(isCircuitBreakerOpen(USER_B_ID, CONN_B_ID, subId)).toBe(false);

      clearCircuitBreaker(USER_A_ID, CONN_B_ID, subId);
    });
  });
});
