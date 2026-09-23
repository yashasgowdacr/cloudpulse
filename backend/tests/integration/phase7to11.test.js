// Ensure test environment variables are loaded before modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_min_32_characters_long_12345';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_min_32_characters_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('../../src/db');
const app = require('../../src/app');
const { redactSensitiveData } = require('../../src/utils/logger');
const CloudProviderFactory = require('../../src/services/cloud/CloudProviderFactory');
const { resolveEffectivePolicy } = require('../../src/services/optimizationPolicyService');

// Mock db.query
jest.mock('../../src/db', () => ({
  query: jest.fn()
}));

describe('Phases 7-11 Critical Feature Integration & Unit Tests', () => {
  const USER_A_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const USER_B_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const ADMIN_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
  const SUSPENDED_USER_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

  const userAToken = jwt.sign({ sub: USER_A_ID, role: 'USER' }, process.env.JWT_SECRET);
  const userBToken = jwt.sign({ sub: USER_B_ID, role: 'USER' }, process.env.JWT_SECRET);
  const adminToken = jwt.sign({ sub: ADMIN_ID, role: 'ADMIN' }, process.env.JWT_SECRET);
  const suspendedToken = jwt.sign({ sub: SUSPENDED_USER_ID, role: 'USER' }, process.env.JWT_SECRET);

  beforeEach(() => {
    jest.clearAllMocks();

    db.query.mockImplementation(async (sql, params) => {
      const sqlStr = typeof sql === 'string' ? sql : '';

      // Auth user lookup
      if (sqlStr.includes('FROM users WHERE id = $1')) {
        const uid = params[0];
        if (uid === SUSPENDED_USER_ID) {
          return {
            rows: [{ id: uid, name: 'Suspended Tenant', email: 'suspended@test.com', role: 'USER', status: 'SUSPENDED' }]
          };
        }
        if (uid === ADMIN_ID) {
          return {
            rows: [{ id: uid, name: 'Admin User', email: 'admin@test.com', role: 'ADMIN', status: 'ACTIVE' }]
          };
        }
        return {
          rows: [{ id: uid, name: 'Active Tenant', email: 'user@test.com', role: 'USER', status: 'ACTIVE' }]
        };
      }

      return { rows: [] };
    });
  });

  // ==========================================
  // 1. BUDGET TENANT ISOLATION
  // ==========================================
  describe('Phase 8: Budget Management & Tenant Isolation', () => {
    it('GET /api/budgets strictly scopes queries to authenticated user_id', async () => {
      db.query.mockImplementation(async (sql, params) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: USER_A_ID, role: 'USER', status: 'ACTIVE' }] };
        }
        if (sql.includes('SELECT * FROM budgets WHERE user_id = $1')) {
          expect(params[0]).toBe(USER_A_ID);
          return {
            rows: [
              { id: 'budget-1', user_id: USER_A_ID, scope: 'TENANT', amount: '1000.00' }
            ]
          };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .get('/api/budgets')
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.budgets).toHaveLength(1);
      expect(res.body.budgets[0].user_id).toBe(USER_A_ID);
    });

    it('DELETE /api/budgets/:id forbids deleting another tenant budget', async () => {
      db.query.mockImplementation(async (sql, params) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: USER_A_ID, role: 'USER', status: 'ACTIVE' }] };
        }
        if (sql.includes('DELETE FROM budgets WHERE id = $1 AND user_id = $2')) {
          expect(params[0]).toBe('budget-of-user-b');
          expect(params[1]).toBe(USER_A_ID);
          return { rows: [] }; // No row affected because it belongs to User B
        }
        return { rows: [] };
      });

      const res = await request(app)
        .delete('/api/budgets/budget-of-user-b')
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(404);
      expect(res.body.message).toMatch(/not found/i);
    });
  });

  // ==========================================
  // 2. COST ANOMALY TENANT ISOLATION
  // ==========================================
  describe('Phase 8: Cost Anomaly Tenant Isolation', () => {
    it('GET /api/anomalies scopes queries to authenticated user_id', async () => {
      db.query.mockImplementation(async (sql, params) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: USER_A_ID, role: 'USER', status: 'ACTIVE' }] };
        }
        if (sql.includes('SELECT * FROM cost_anomalies WHERE user_id = $1')) {
          expect(params[0]).toBe(USER_A_ID);
          return {
            rows: [
              {
                id: 'anomaly-1',
                user_id: USER_A_ID,
                resource_name: 'vm-worker-01',
                actual_cost: '45.00',
                expected_cost: '10.00',
                reason: 'Unusual cost increase detected.'
              }
            ]
          };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .get('/api/anomalies')
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.anomalies).toHaveLength(1);
      expect(res.body.anomalies[0].reason).toBe('Unusual cost increase detected.');
    });
  });

  // ==========================================
  // 3. POLICY PRECEDENCE & MANDATORY SAFETY
  // ==========================================
  describe('Phase 9: Policy Precedence Hierarchy', () => {
    it('Mandatory Safety ALWAYS wins over scoped policies for production VM names', async () => {
      db.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM policy_scopes')) {
          return {
            rows: [
              {
                id: 'scope-1',
                scope_type: 'VM_NAME_PATTERN',
                scope_value: 'prod-*',
                idle_cpu_threshold: 50.0,
                auto_shutdown: true,
                priority: 10
              }
            ]
          };
        }
        if (sql.includes('FROM user_exclusion_tags')) {
          return { rows: [] };
        }
        if (sql.includes('FROM optimization_policies')) {
          return { rows: [{ idle_cpu_threshold: 5.0, auto_shutdown: true }] };
        }
        return { rows: [] };
      });

      const vm = {
        name: 'prod-database-primary',
        resourceGroup: 'rg-prod',
        subscriptionId: 'sub-123',
        tags: {}
      };

      const result = await resolveEffectivePolicy(USER_A_ID, vm, vm.tags);
      expect(result.isProtected).toBe(true);
      expect(result.protectionReason).toMatch(/production/i);
    });

    it('Mandatory Safety ALWAYS wins for Environment=production tag', async () => {
      db.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM policy_scopes')) return { rows: [] };
        if (sql.includes('FROM user_exclusion_tags')) return { rows: [] };
        if (sql.includes('FROM optimization_policies')) return { rows: [{ idle_cpu_threshold: 5.0, auto_shutdown: true }] };
        return { rows: [] };
      });

      const vm = {
        name: 'app-server-01',
        resourceGroup: 'rg-apps',
        tags: { Environment: 'production' }
      };

      const result = await resolveEffectivePolicy(USER_A_ID, vm, vm.tags);
      expect(result.isProtected).toBe(true);
      expect(result.protectionReason).toMatch(/Environment=production/i);
    });

    it('Mandatory Safety ALWAYS wins for custom exclusion tags', async () => {
      db.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM policy_scopes')) return { rows: [] };
        if (sql.includes('FROM user_exclusion_tags')) {
          return { rows: [{ tag_key: 'CostCenter', tag_value: 'Database' }] };
        }
        if (sql.includes('FROM optimization_policies')) return { rows: [{ idle_cpu_threshold: 5.0, auto_shutdown: true }] };
        return { rows: [] };
      });

      const vm = {
        name: 'db-cache-instance',
        resourceGroup: 'rg-db',
        tags: { CostCenter: 'Database' }
      };

      const result = await resolveEffectivePolicy(USER_A_ID, vm, vm.tags);
      expect(result.isProtected).toBe(true);
      expect(result.protectionReason).toMatch(/CostCenter=Database/i);
    });

    it('Precedence resolves VM Tag/Name pattern scope before Resource Group or Subscription scope', async () => {
      db.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM policy_scopes')) {
          return {
            rows: [
              {
                id: 'scope-tag',
                scope_type: 'VM_TAG',
                scope_value: 'Tier=Staging',
                idle_cpu_threshold: 12.0,
                auto_shutdown: false,
                priority: 10
              },
              {
                id: 'scope-rg',
                scope_type: 'RESOURCE_GROUP',
                scope_value: 'rg-staging',
                idle_cpu_threshold: 20.0,
                auto_shutdown: true,
                priority: 20
              }
            ]
          };
        }
        if (sql.includes('FROM user_exclusion_tags')) return { rows: [] };
        if (sql.includes('FROM optimization_policies')) return { rows: [{ idle_cpu_threshold: 5.0, auto_shutdown: false }] };
        return { rows: [] };
      });

      const vm = {
        name: 'staging-worker',
        resourceGroup: 'rg-staging',
        tags: { Tier: 'Staging' }
      };

      const result = await resolveEffectivePolicy(USER_A_ID, vm, vm.tags);
      expect(result.isProtected).toBe(false);
      expect(result.effectivePolicy.idleCpuThreshold).toBe(12.0); // Selected VM_TAG (priority 10) instead of RG (20)
      expect(result.sourceScope).toBe('VM_TAG');
    });
  });

  // ==========================================
  // 4. ADMIN RBAC & TENANT SUSPENSION
  // ==========================================
  describe('Phase 10: Admin Management & Suspension', () => {
    it('GET /api/admin/metrics returns 403 Forbidden for non-admin users', async () => {
      const res = await request(app)
        .get('/api/admin/metrics')
        .set('Authorization', `Bearer ${userAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied: Insufficient privileges');
    });

    it('GET /api/admin/metrics returns 200 for ADMIN users', async () => {
      db.query.mockImplementation(async (sql) => {
        if (sql.includes('FROM users WHERE id = $1')) {
          return { rows: [{ id: ADMIN_ID, role: 'ADMIN', status: 'ACTIVE' }] };
        }
        if (sql.includes('total_tenants')) {
          return {
            rows: [{
              total_tenants: '5',
              active_tenants: '4',
              suspended_tenants: '1',
              inactive_tenants: '0'
            }]
          };
        }
        if (sql.includes('FROM azure_connections')) {
          return { rows: [{ total_azure_connections: '3', connected_subscriptions: '2' }] };
        }
        if (sql.includes('FROM action_history')) {
          return { rows: [{ total_actions: '12', successful_deallocations: '8' }] };
        }
        return { rows: [] };
      });

      const res = await request(app)
        .get('/api/admin/metrics')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.metrics.totalTenants).toBe(5);
      expect(res.body.metrics.totalEstimatedAvoidedCost).toBe(560.64);
    });

    it('Suspended tenant is rejected by authenticateToken with 401', async () => {
      const res = await request(app)
        .get('/api/budgets')
        .set('Authorization', `Bearer ${suspendedToken}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/suspended/i);
    });
  });

  // ==========================================
  // 5. STRUCTURED LOGGING & SECRET REDACTION
  // ==========================================
  describe('Phase 10: Observability & Secret Redaction', () => {
    it('recursively redacts passwords, tokens, and secrets from logged data', () => {
      const sensitiveData = {
        name: 'test-user',
        password: 'SuperSecretPassword123!',
        tokens: {
          accessToken: 'jwt.access.token.string',
          refreshToken: 'jwt.refresh.token.string'
        },
        credentials: {
          clientSecret: 'azure-service-principal-secret-value',
          privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkq...',
          authorization: 'Bearer secret-jwt-token'
        },
        safeField: 'This is non-sensitive information'
      };

      const sanitized = redactSensitiveData(sensitiveData);

      expect(sanitized.password).toBe('***REDACTED***');
      expect(sanitized.tokens.accessToken).toBe('***REDACTED***');
      expect(sanitized.tokens.refreshToken).toBe('***REDACTED***');
      expect(sanitized.credentials.clientSecret).toBe('***REDACTED***');
      expect(sanitized.credentials.privateKey).toBe('***REDACTED***');
      expect(sanitized.credentials.authorization).toBe('***REDACTED***');
      expect(sanitized.safeField).toBe('This is non-sensitive information');
    });
  });

  // ==========================================
  // 6. MULTI-CLOUD PROVIDER CAPABILITY DETECTION
  // ==========================================
  describe('Phase 11: Multi-Cloud Provider Abstraction & Capabilities', () => {
    it('AzureProvider reports full metrics, lifecycle, tags, and cost capabilities', () => {
      const azure = CloudProviderFactory.getProvider('AZURE');
      expect(azure.hasCapability('metrics')).toBe(true);
      expect(azure.hasCapability('start')).toBe(true);
      expect(azure.hasCapability('stop')).toBe(true);
      expect(azure.hasCapability('tags')).toBe(true);
      expect(azure.hasCapability('cost')).toBe(true);
    });

    it('AwsProvider explicitly marks cost as false (no fake billing)', () => {
      const aws = CloudProviderFactory.getProvider('AWS');
      expect(aws.hasCapability('metrics')).toBe(true);
      expect(aws.hasCapability('start')).toBe(true);
      expect(aws.hasCapability('stop')).toBe(true);
      expect(aws.hasCapability('cost')).toBe(false);
    });

    it('GcpProvider explicitly marks cost as false (no fake billing)', () => {
      const gcp = CloudProviderFactory.getProvider('GCP');
      expect(gcp.hasCapability('metrics')).toBe(true);
      expect(gcp.hasCapability('start')).toBe(true);
      expect(gcp.hasCapability('stop')).toBe(true);
      expect(gcp.hasCapability('cost')).toBe(false);
    });
  });
});
