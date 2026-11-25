// Ensure required test environment variables are initialized before importing modules
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_min_32_characters_long_12345';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret_min_32_characters_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('../../src/db');
const app = require('../../src/app');

// Mock db.query for clean, deterministic database isolation
jest.mock('../../src/db', () => ({
  query: jest.fn()
}));

describe('Authentication & RBAC Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('User Registration (POST /api/auth/register)', () => {
    it('should successfully register a new user with hashed password and return 201', async () => {
      // 1. Check existing email -> 0 rows
      db.query.mockResolvedValueOnce({ rows: [] });
      // 2. Insert user -> returns inserted user row
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'u-123',
            name: 'Alice Developer',
            email: 'alice@example.com',
            role: 'USER',
            status: 'ACTIVE',
            created_at: new Date().toISOString()
          }
        ]
      });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Alice Developer',
          email: 'alice@example.com',
          password: 'StrongPassword123!'
        });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe('User registered successfully');
      expect(res.body.user).toMatchObject({
        id: 'u-123',
        name: 'Alice Developer',
        email: 'alice@example.com',
        role: 'USER',
        status: 'ACTIVE'
      });
      expect(res.body.user.password).toBeUndefined();
      expect(res.body.user.password_hash).toBeUndefined();
    });

    it('should reject registration if email is already taken with 400', async () => {
      // Existing user found
      db.query.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] });

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Bob Duplicate',
          email: 'bob@example.com',
          password: 'Password123!'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('User with this email already exists');
    });

    it('should reject registration if password is under 8 characters with 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Short Pass',
          email: 'short@example.com',
          password: 'short'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Password must be at least 8 characters long');
    });

    it('should reject registration if email is invalid with 400', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Invalid Email',
          email: 'invalid-email-no-at',
          password: 'ValidPassword123!'
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Valid email address is required');
    });
  });

  describe('User Login (POST /api/auth/login)', () => {
    let validPasswordHash;

    beforeAll(async () => {
      validPasswordHash = await argon2.hash('CorrectSecret123!', { type: argon2.argon2id });
    });

    it('should authenticate valid credentials, issue access token, and set HttpOnly refresh cookie', async () => {
      db.query
        // 1. SELECT user by email
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'user-auth-uuid',
              name: 'Valid User',
              email: 'valid@example.com',
              password_hash: validPasswordHash,
              role: 'USER',
              status: 'ACTIVE'
            }
          ]
        })
        // 2. INSERT into refresh_tokens
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'valid@example.com',
          password: 'CorrectSecret123!'
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Login successful');
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user).toMatchObject({
        id: 'user-auth-uuid',
        email: 'valid@example.com',
        role: 'USER',
        status: 'ACTIVE'
      });

      // Verify HttpOnly cookie is returned
      const setCookieHeader = res.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader[0]).toContain('cloudpulse_refresh_token=');
      expect(setCookieHeader[0]).toContain('HttpOnly');
    });

    it('should reject login with invalid password with 401', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'user-auth-uuid',
            email: 'valid@example.com',
            password_hash: validPasswordHash,
            role: 'USER',
            status: 'ACTIVE'
          }
        ]
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'valid@example.com',
          password: 'WrongPassword999!'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('should reject login for non-existent user with generic 401 to prevent enumeration', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'SomePassword123!'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid email or password');
    });

    it('should reject login for inactive or suspended user with 403', async () => {
      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'suspended-user-uuid',
            email: 'suspended@example.com',
            password_hash: validPasswordHash,
            role: 'USER',
            status: 'SUSPENDED'
          }
        ]
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'suspended@example.com',
          password: 'CorrectSecret123!'
        });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Account is inactive or suspended');
    });
  });

  describe('Refresh Token Rotation (POST /api/auth/refresh)', () => {
    it('should rotate refresh token and issue new token pair', async () => {
      const sampleRefreshToken = jwt.sign(
        { sub: 'user-refresh-uuid', jti: 'random-jti-1' },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: '7d' }
      );

      const futureDate = new Date(Date.now() + 86400000).toISOString();

      db.query
        // 1. SELECT refresh_tokens
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'rt-1',
              user_id: 'user-refresh-uuid',
              expires_at: futureDate,
              revoked_at: null
            }
          ]
        })
        // 2. SELECT user
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'user-refresh-uuid',
              name: 'Refresh User',
              email: 'refresh@example.com',
              role: 'USER',
              status: 'ACTIVE'
            }
          ]
        })
        // 3. UPDATE refresh_tokens (revoke old)
        .mockResolvedValueOnce({ rows: [{ id: 'rt-1' }] })
        // 4. INSERT into refresh_tokens (new token)
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`cloudpulse_refresh_token=${sampleRefreshToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Token refreshed successfully');
      expect(res.body.accessToken).toBeDefined();

      const setCookieHeader = res.headers['set-cookie'];
      expect(setCookieHeader).toBeDefined();
      expect(setCookieHeader[0]).toContain('cloudpulse_refresh_token=');
    });

    it('should trigger theft detection and revoke all tokens if a revoked token is reused', async () => {
      const reusedRefreshToken = jwt.sign(
        { sub: 'user-theft-uuid', jti: 'stolen-jti' },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: '7d' }
      );

      db.query
        // 1. Token found but already revoked!
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'stolen-rt-id',
              user_id: 'user-theft-uuid',
              expires_at: new Date(Date.now() + 86400000).toISOString(),
              revoked_at: new Date(Date.now() - 3600000).toISOString() // Revoked 1 hour ago
            }
          ]
        })
        // 2. Theft reaction: Revoke all active tokens for this user
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', [`cloudpulse_refresh_token=${reusedRefreshToken}`]);

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid or expired refresh token');

      // Verify theft mitigation query executed
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('SET revoked_at = CURRENT_TIMESTAMP'),
        ['user-theft-uuid']
      );
    });
  });

  describe('User Logout (POST /api/auth/logout)', () => {
    it('should revoke the refresh token and clear cookie', async () => {
      const token = jwt.sign({ sub: 'user-logout' }, process.env.JWT_REFRESH_SECRET);
      db.query.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', [`cloudpulse_refresh_token=${token}`]);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Logged out successfully');

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      // Cookie cleared
      expect(setCookie[0]).toContain('cloudpulse_refresh_token=;');
    });
  });

  describe('Protected Endpoints & Role-Based Access Control (RBAC)', () => {
    it('should reject request when Bearer token is missing', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Access token missing or malformed');
    });

    it('should reject request when Bearer token is invalid or tampered', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.tampered.token');

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Invalid or expired access token');
    });

    it('should allow access to /api/auth/me for a valid authenticated user', async () => {
      const validToken = jwt.sign(
        { sub: 'auth-user-id', role: 'USER' },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'auth-user-id',
            name: 'Authorized User',
            email: 'auth@example.com',
            role: 'USER',
            status: 'ACTIVE'
          }
        ]
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${validToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({
        id: 'auth-user-id',
        email: 'auth@example.com',
        role: 'USER'
      });
    });

    it('should reject non-admin user accessing admin-only endpoint /api/auth/admin-test with 403', async () => {
      const userToken = jwt.sign(
        { sub: 'regular-user-id', role: 'USER' },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'regular-user-id',
            name: 'Regular User',
            email: 'regular@example.com',
            role: 'USER',
            status: 'ACTIVE'
          }
        ]
      });

      const res = await request(app)
        .get('/api/auth/admin-test')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Access denied: Insufficient privileges');
    });

    it('should grant access to /api/auth/admin-test when user has ADMIN role', async () => {
      const adminToken = jwt.sign(
        { sub: 'admin-user-id', role: 'ADMIN' },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      db.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'admin-user-id',
            name: 'Admin User',
            email: 'admin@example.com',
            role: 'ADMIN',
            status: 'ACTIVE'
          }
        ]
      });

      const res = await request(app)
        .get('/api/auth/admin-test')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Admin access granted');
      expect(res.body.user.role).toBe('ADMIN');
    });
  });
});
