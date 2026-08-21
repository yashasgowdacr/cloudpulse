const express = require('express');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Validate JWT_SECRET on module load to fail fast on missing configuration
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('FATAL CONFIGURATION ERROR: JWT_SECRET environment variable is missing or empty in .env');
  }
  return secret;
}

/**
 * Validate JWT_REFRESH_SECRET on module load to fail fast on missing configuration
 */
function getJwtRefreshSecret() {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('FATAL CONFIGURATION ERROR: JWT_REFRESH_SECRET environment variable is missing or empty in .env');
  }
  return secret;
}

// Fail fast on module load if secrets are not configured
getJwtSecret();
getJwtRefreshSecret();

/**
 * Compute SHA-256 hash of raw refresh token for database storage/querying
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a cryptographically secure refresh token, hash it, and store in PostgreSQL refresh_tokens table.
 * Returns raw refresh token string.
 */
async function generateAndStoreRefreshToken(userId) {
  const refreshSecret = getJwtRefreshSecret();
  const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

  // Cryptographically random unique token identifier claim
  const jti = crypto.randomBytes(16).toString('hex');

  const refreshToken = jwt.sign(
    {
      sub: userId,
      jti
    },
    refreshSecret,
    { expiresIn: refreshExpiresIn }
  );

  // Decode to obtain exact expiration timestamp
  const decoded = jwt.decode(refreshToken);
  const expiresAt = new Date(decoded.exp * 1000);

  // Compute SHA-256 hash (never store raw token)
  const tokenHash = hashToken(refreshToken);

  // Store hashed token record in PostgreSQL
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return refreshToken;
}

/**
 * Helper to set HttpOnly cloudpulse_refresh_token cookie
 */
function setRefreshTokenCookie(res, refreshToken) {
  res.cookie('cloudpulse_refresh_token', refreshToken, {
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    path: '/api/auth',
    maxAge: 604800000
  });
}

/**
 * Validate standard email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * POST /api/auth/register
 * User registration with Argon2id password hashing
 */
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    // 1. Validate required fields
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    if (!email || typeof email !== 'string' || !email.trim() || !isValidEmail(email.trim())) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Password is required' });
    }

    // 2. Enforce minimum password length (minimum 8 characters)
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // 3. Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // 4. Check if user already exists
    const existingUserRes = await db.query(
      'SELECT id FROM users WHERE LOWER(email) = $1',
      [normalizedEmail]
    );

    if (existingUserRes.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    // 5. Hash password using Argon2id
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id
    });

    // 6. Insert new user into database with forced role USER and status ACTIVE
    const insertRes = await db.query(
      `INSERT INTO users (name, email, password_hash, role, status)
       VALUES ($1, $2, $3, 'USER', 'ACTIVE')
       RETURNING id, name, email, role, status, created_at`,
      [name.trim(), normalizedEmail, passwordHash]
    );

    const newUser = insertRes.rows[0];

    // 7. Return safe user object (never log or return password/hash)
    return res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        status: newUser.status,
        createdAt: newUser.created_at
      }
    });
  } catch (error) {
    console.error('[AUTH] Registration error:', error.message);
    return res.status(500).json({ error: 'Internal server error during registration' });
  }
});

/**
 * POST /api/auth/login
 * User authentication, JWT access token & refresh token generation
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    // 1. Basic field check
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 2. Find user by email
    const userRes = await db.query(
      'SELECT id, name, email, password_hash, role, status FROM users WHERE LOWER(email) = $1',
      [normalizedEmail]
    );

    if (userRes.rows.length === 0) {
      // Generic error to prevent email enumeration
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userRes.rows[0];

    // 3. Verify password using Argon2id
    const passwordValid = await argon2.verify(user.password_hash, password);

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 4. Reject INACTIVE or SUSPENDED users
    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account is inactive or suspended' });
    }

    // 5. Generate short-lived Access JWT
    const jwtSecret = getJwtSecret();
    const expiresIn = process.env.JWT_EXPIRES_IN || '15m';

    const accessToken = jwt.sign(
      {
        sub: user.id,
        role: user.role
      },
      jwtSecret,
      { expiresIn }
    );

    // 6. Generate secure Refresh Token and store hash in PostgreSQL
    const refreshToken = await generateAndStoreRefreshToken(user.id);

    // 7. Set HttpOnly cookie for browser client
    setRefreshTokenCookie(res, refreshToken);

    // 8. Return access token and safe user info (refreshToken excluded from JSON body)
    return res.json({
      message: 'Login successful',
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    console.error('[AUTH] Login error:', error.message);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh Token rotation: verifies refresh token, revokes old token, issues new Access + Refresh token pair
 */
router.post('/refresh', async (req, res) => {
  try {
    const refreshToken = (req.cookies && req.cookies.cloudpulse_refresh_token) || (req.body && req.body.refreshToken);

    if (!refreshToken || typeof refreshToken !== 'string' || !refreshToken.trim()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const refreshSecret = getJwtRefreshSecret();

    // 1. Verify token signature and expiration
    let decoded;
    try {
      decoded = jwt.verify(refreshToken, refreshSecret);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const tokenHash = hashToken(refreshToken);

    // 2. Query refresh_tokens table for matching token_hash
    const tokenRes = await db.query(
      `SELECT id, user_id, expires_at, revoked_at 
       FROM refresh_tokens 
       WHERE token_hash = $1`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const storedToken = tokenRes.rows[0];

    // 3. Check if token has been revoked (Theft Detection)
    if (storedToken.revoked_at !== null) {
      console.warn(`[SECURITY-ALERT] Refresh token reuse detected for user ID '${storedToken.user_id}'! Revoking all active tokens.`);
      await db.query(
        `UPDATE refresh_tokens 
         SET revoked_at = CURRENT_TIMESTAMP 
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [storedToken.user_id]
      );
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // 4. Check if token has expired in database
    if (new Date(storedToken.expires_at) <= new Date()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // 5. Verify associated user exists and status is ACTIVE
    const userRes = await db.query(
      'SELECT id, name, email, role, status FROM users WHERE id = $1',
      [storedToken.user_id]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const user = userRes.rows[0];

    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ error: 'Account is inactive or suspended' });
    }

    // 6. Refresh Token Rotation: Revoke old refresh token in PostgreSQL
    await db.query(
      `UPDATE refresh_tokens 
       SET revoked_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [storedToken.id]
    );

    // 7. Generate new Refresh Token & store hash in PostgreSQL
    const newRefreshToken = await generateAndStoreRefreshToken(user.id);

    // Set replacement HttpOnly cookie for browser client
    setRefreshTokenCookie(res, newRefreshToken);

    // 8. Generate new Access JWT
    const jwtSecret = getJwtSecret();
    const expiresIn = process.env.JWT_EXPIRES_IN || '15m';

    const newAccessToken = jwt.sign(
      {
        sub: user.id,
        role: user.role
      },
      jwtSecret,
      { expiresIn }
    );

    // 9. Return new access token and safe user info (refreshToken excluded from JSON body)
    return res.json({
      message: 'Token refreshed successfully',
      accessToken: newAccessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status
      }
    });
  } catch (error) {
    console.error('[AUTH] Refresh token error:', error.message);
    return res.status(500).json({ error: 'Internal server error during token refresh' });
  }
});

/**
 * POST /api/auth/logout
 * Revokes refresh token in database (sets revoked_at timestamp)
 */
router.post('/logout', async (req, res) => {
  try {
    const refreshToken = (req.cookies && req.cookies.cloudpulse_refresh_token) || (req.body && req.body.refreshToken);

    if (refreshToken && typeof refreshToken === 'string' && refreshToken.trim()) {
      const tokenHash = hashToken(refreshToken);

      await db.query(
        `UPDATE refresh_tokens 
         SET revoked_at = CURRENT_TIMESTAMP 
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash]
      );
    }

    res.clearCookie('cloudpulse_refresh_token', {
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      path: '/api/auth'
    });

    return res.json({
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('[AUTH] Logout error:', error.message);
    res.clearCookie('cloudpulse_refresh_token', {
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      path: '/api/auth'
    });
    return res.json({
      message: 'Logged out successfully'
    });
  }
});

/**
 * GET /api/auth/me
 * Temporary development test endpoint: protected by authenticateToken
 */
router.get('/me', authenticateToken, (req, res) => {
  return res.json({
    user: req.user
  });
});

/**
 * GET /api/auth/admin-test
 * Temporary development test endpoint: protected by authenticateToken + requireRole('ADMIN')
 */
router.get('/admin-test', authenticateToken, requireRole('ADMIN'), (req, res) => {
  return res.json({
    message: 'Admin access granted',
    user: req.user
  });
});

module.exports = router;

