process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_min_32_characters_long_12345';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_min_32_characters_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('../../src/db');
const app = require('../../src/app');
const { evaluateShutdownPolicy } = require('../../src/services/azureVmService');

jest.mock('../../src/db', () => ({
  query: jest.fn()
}));

describe('Phase 6B — Settings, Policy Scheduling & Safety Tests', () => {
  const testUserId = 'u-test-6b-456';
  const testUserToken = jwt.sign(
    { sub: testUserId, role: 'USER' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );

  const mockUserRow = {
    id: testUserId,
    name: 'Jane Cloud',
    email: 'jane@example.com',
    role: 'USER',
    status: 'ACTIVE',
    created_at: new Date().toISOString()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/settings', () => {
    it('should reject unauthenticated request with 401', async () => {
      const res = await request(app).get('/api/settings');
      expect(res.status).toBe(401);
    });

    it('should return user profile, notification preferences, and exclusion tags count', async () => {
      // 1. authenticateToken user lookup
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] });
      // 2. getUserProfile query
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] });
      // 3. getNotificationPreferences query
      db.query.mockResolvedValueOnce({ rows: [{ deallocation_notifications: true, optimization_notifications: false }] });
      // 4. getExclusionTags query
      db.query.mockResolvedValueOnce({ rows: [{ id: 'tag-1', tag_key: 'CostCenter', tag_value: 'Core', created_at: new Date().toISOString() }] });

      const res = await request(app)
        .get('/api/settings')
        .set('Authorization', `Bearer ${testUserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        id: testUserId,
        name: 'Jane Cloud',
        email: 'jane@example.com'
      });
      expect(res.body.notifications).toEqual({
        deallocationNotifications: true,
        optimizationNotifications: false
      });
      expect(res.body.exclusionTagsCount).toBe(1);
    });
  });

  describe('PATCH /api/settings/password', () => {
    it('should reject password change if current password is missing', async () => {
      // authenticateToken user lookup
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] });

      const res = await request(app)
        .patch('/api/settings/password')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ newPassword: 'NewSecurePassword123!' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Current password is required');
    });

    it('should reject password change if new password is under 8 characters', async () => {
      // authenticateToken user lookup
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] });

      const res = await request(app)
        .patch('/api/settings/password')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ currentPassword: 'OldPassword123!', newPassword: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('at least 8 characters');
    });

    it('should reject password change if current password does not verify with Argon2', async () => {
      const existingHash = await argon2.hash('RealOldPassword123!', { type: argon2.argon2id });

      // 1. authenticateToken lookup
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] });
      // 2. changePassword user lookup
      db.query.mockResolvedValueOnce({
        rows: [{ ...mockUserRow, password_hash: existingHash }]
      });

      const res = await request(app)
        .patch('/api/settings/password')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ currentPassword: 'WrongPassword!', newPassword: 'NewSecurePassword123!' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Incorrect current password');
    });

    it('should successfully change password, revoke prior refresh tokens, and return new access token', async () => {
      const realOldPassword = 'OldValidPassword123!';
      const existingHash = await argon2.hash(realOldPassword, { type: argon2.argon2id });

      // 1. authenticateToken lookup
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] });
      // 2. changePassword user lookup
      db.query.mockResolvedValueOnce({
        rows: [{ ...mockUserRow, password_hash: existingHash }]
      });
      // 3. update user password query
      db.query.mockResolvedValueOnce({ rows: [] });
      // 4. revoke existing refresh tokens query
      db.query.mockResolvedValueOnce({ rows: [] });
      // 5. insert new refresh token query
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .patch('/api/settings/password')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ currentPassword: realOldPassword, newPassword: 'BrandNewPassword123!' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Password changed successfully');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user).toMatchObject({ id: testUserId, email: 'jane@example.com' });

      // Verify revoke tokens query was called
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SET revoked_at = CURRENT_TIMESTAMP'),
        [testUserId]
      );
    });
  });

  describe('GET & PATCH /api/settings/notifications', () => {
    it('should return default notification preferences when none exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] }); // auth
      db.query.mockResolvedValueOnce({ rows: [] }); // prefs

      const res = await request(app)
        .get('/api/settings/notifications')
        .set('Authorization', `Bearer ${testUserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.preferences).toEqual({
        deallocationNotifications: true,
        optimizationNotifications: true
      });
    });

    it('should update and persist notification preferences', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] }); // auth
      db.query.mockResolvedValueOnce({ rows: [{ deallocation_notifications: true, optimization_notifications: true }] }); // current
      db.query.mockResolvedValueOnce({
        rows: [{ deallocation_notifications: false, optimization_notifications: true }]
      }); // upsert

      const res = await request(app)
        .patch('/api/settings/notifications')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ deallocationNotifications: false });

      expect(res.status).toBe(200);
      expect(res.body.preferences).toEqual({
        deallocationNotifications: false,
        optimizationNotifications: true
      });
    });
  });

  describe('Exclusion Tags Management (/api/settings/exclusion-tags)', () => {
    it('should reject adding a tag with empty key or value', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] }); // auth

      const res = await request(app)
        .post('/api/settings/exclusion-tags')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ tagKey: '', tagValue: 'Prod' });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Tag key is required');
    });

    it('should add a custom exclusion tag with proper tenant ownership', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] }); // auth
      db.query.mockResolvedValueOnce({ rows: [] }); // check duplicate
      db.query.mockResolvedValueOnce({
        rows: [{ id: 'tag-101', tag_key: 'Tier', tag_value: 'MissionCritical', created_at: new Date().toISOString() }]
      });

      const res = await request(app)
        .post('/api/settings/exclusion-tags')
        .set('Authorization', `Bearer ${testUserToken}`)
        .send({ tagKey: 'Tier', tagValue: 'MissionCritical' });

      expect(res.status).toBe(201);
      expect(res.body.tag).toMatchObject({
        id: 'tag-101',
        tagKey: 'Tier',
        tagValue: 'MissionCritical'
      });
    });

    it('should delete a custom exclusion tag owned by the user', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] }); // auth
      db.query.mockResolvedValueOnce({ rows: [{ id: 'tag-101' }] }); // delete returning id

      const res = await request(app)
        .delete('/api/settings/exclusion-tags/tag-101')
        .set('Authorization', `Bearer ${testUserToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Exclusion tag deleted successfully');
    });
  });

  describe('Custom Exclusion Tag Safety Shield Enforcement', () => {
    it('should block shutdown when VM matches a custom user exclusion tag', () => {
      const idleStatus = { idle: true, cpuAverage: 1.5 };
      const result = evaluateShutdownPolicy(
        'analytics-worker',
        idleStatus,
        'development',
        true,
        'CostCenter=ProtectedCore'
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Virtual machine matches user exclusion tag 'CostCenter=ProtectedCore'");
    });
  });

  describe('Export Functionality (/api/export)', () => {
    it('should export Action History as CSV with attachment headers', async () => {
      db.query.mockResolvedValueOnce({ rows: [mockUserRow] }); // auth
      db.query.mockResolvedValueOnce({
        rows: [
          {
            created_at: new Date('2026-09-22T10:00:00Z'),
            vm_name: 'dev-vm-01',
            action: 'DEALLOCATE',
            status: 'SUCCESS',
            cpu_average: 2.1,
            reason: 'Idle VM deallocated',
            connection_name: 'Azure Dev'
          }
        ]
      });

      const res = await request(app)
        .get('/api/export/actions?format=csv')
        .set('Authorization', `Bearer ${testUserToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment; filename=');
      expect(res.text).toContain('VM Name,Action,Status');
      expect(res.text).toContain('dev-vm-01,DEALLOCATE,SUCCESS');
    });
  });
});
