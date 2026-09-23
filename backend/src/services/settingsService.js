const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('FATAL CONFIGURATION ERROR: JWT_SECRET environment variable is missing or empty in .env');
  }
  return secret;
}

function getJwtRefreshSecret() {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('FATAL CONFIGURATION ERROR: JWT_REFRESH_SECRET environment variable is missing or empty in .env');
  }
  return secret;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function generateAndStoreRefreshToken(userId) {
  const refreshSecret = getJwtRefreshSecret();
  const refreshExpiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  const jti = crypto.randomBytes(16).toString('hex');

  const refreshToken = jwt.sign(
    {
      sub: userId,
      jti
    },
    refreshSecret,
    { expiresIn: refreshExpiresIn }
  );

  const decoded = jwt.decode(refreshToken);
  const expiresAt = new Date(decoded.exp * 1000);
  const tokenHash = hashToken(refreshToken);

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return refreshToken;
}

function generateAccessToken(user) {
  const jwtSecret = getJwtSecret();
  const expiresIn = process.env.JWT_EXPIRES_IN || '15m';

  return jwt.sign(
    {
      sub: user.id,
      role: user.role
    },
    jwtSecret,
    { expiresIn }
  );
}

/**
 * Retrieves safe profile for authenticated user
 */
async function getUserProfile(userId) {
  if (!userId) {
    const err = new Error('User ID is required');
    err.statusCode = 400;
    throw err;
  }

  const result = await db.query(
    `SELECT id, name, email, role, status, created_at FROM users WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  const user = result.rows[0];
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.created_at
  };
}

/**
 * Changes password for authenticated user with Argon2id verification and session revocation
 */
async function changePassword(userId, { currentPassword, newPassword }) {
  if (!userId) {
    const err = new Error('User ID is required');
    err.statusCode = 400;
    throw err;
  }

  if (!currentPassword || typeof currentPassword !== 'string') {
    const err = new Error('Current password is required');
    err.statusCode = 400;
    throw err;
  }

  if (!newPassword || typeof newPassword !== 'string') {
    const err = new Error('New password is required');
    err.statusCode = 400;
    throw err;
  }

  if (newPassword.length < 8) {
    const err = new Error('Password must be at least 8 characters long');
    err.statusCode = 400;
    throw err;
  }

  // Fetch current user password hash and details
  const userRes = await db.query(
    `SELECT id, name, email, role, status, password_hash FROM users WHERE id = $1`,
    [userId]
  );

  if (userRes.rows.length === 0) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  const user = userRes.rows[0];

  if (user.status !== 'ACTIVE') {
    const err = new Error('Account is inactive or suspended');
    err.statusCode = 403;
    throw err;
  }

  // Verify current password with Argon2
  const passwordValid = await argon2.verify(user.password_hash, currentPassword);
  if (!passwordValid) {
    const err = new Error('Incorrect current password');
    err.statusCode = 400;
    throw err;
  }

  // Hash new password using Argon2id
  const newPasswordHash = await argon2.hash(newPassword, {
    type: argon2.argon2id
  });

  // Update password in database
  await db.query(
    `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [newPasswordHash, userId]
  );

  // Revoke all existing refresh tokens for this user
  await db.query(
    `UPDATE refresh_tokens
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );

  // Issue replacement refresh token and access token
  const newRefreshToken = await generateAndStoreRefreshToken(userId);
  const newAccessToken = generateAccessToken(user);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status
    }
  };
}

/**
 * Retrieves notification preferences for user, defaulting to enabled
 */
async function getNotificationPreferences(userId) {
  if (!userId) {
    const err = new Error('User ID is required');
    err.statusCode = 400;
    throw err;
  }

  const result = await db.query(
    `SELECT deallocation_notifications, optimization_notifications
     FROM user_notification_preferences
     WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return {
      deallocationNotifications: true,
      optimizationNotifications: true
    };
  }

  const row = result.rows[0];
  return {
    deallocationNotifications: Boolean(row.deallocation_notifications),
    optimizationNotifications: Boolean(row.optimization_notifications)
  };
}

/**
 * Updates notification preferences for user
 */
async function updateNotificationPreferences(userId, { deallocationNotifications, optimizationNotifications }) {
  if (!userId) {
    const err = new Error('User ID is required');
    err.statusCode = 400;
    throw err;
  }

  if (deallocationNotifications !== undefined && typeof deallocationNotifications !== 'boolean') {
    const err = new Error('deallocationNotifications must be a boolean');
    err.statusCode = 400;
    throw err;
  }

  if (optimizationNotifications !== undefined && typeof optimizationNotifications !== 'boolean') {
    const err = new Error('optimizationNotifications must be a boolean');
    err.statusCode = 400;
    throw err;
  }

  const currentPrefs = await getNotificationPreferences(userId);

  const finalDealloc = deallocationNotifications !== undefined ? deallocationNotifications : currentPrefs.deallocationNotifications;
  const finalOpt = optimizationNotifications !== undefined ? optimizationNotifications : currentPrefs.optimizationNotifications;

  const result = await db.query(
    `INSERT INTO user_notification_preferences (user_id, deallocation_notifications, optimization_notifications)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET
       deallocation_notifications = EXCLUDED.deallocation_notifications,
       optimization_notifications = EXCLUDED.optimization_notifications,
       updated_at = CURRENT_TIMESTAMP
     RETURNING deallocation_notifications, optimization_notifications`,
    [userId, finalDealloc, finalOpt]
  );

  const row = result.rows[0];
  return {
    deallocationNotifications: Boolean(row.deallocation_notifications),
    optimizationNotifications: Boolean(row.optimization_notifications)
  };
}

/**
 * Retrieves custom exclusion tags for user
 */
async function getExclusionTags(userId) {
  if (!userId) {
    const err = new Error('User ID is required');
    err.statusCode = 400;
    throw err;
  }

  const result = await db.query(
    `SELECT id, tag_key, tag_value, created_at
     FROM user_exclusion_tags
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    tagKey: row.tag_key,
    tagValue: row.tag_value,
    createdAt: row.created_at
  }));
}

/**
 * Adds an exclusion tag for user
 */
async function addExclusionTag(userId, { tagKey, tagValue }) {
  if (!userId) {
    const err = new Error('User ID is required');
    err.statusCode = 400;
    throw err;
  }

  if (!tagKey || typeof tagKey !== 'string' || !tagKey.trim()) {
    const err = new Error('Tag key is required');
    err.statusCode = 400;
    throw err;
  }

  if (!tagValue || typeof tagValue !== 'string' || !tagValue.trim()) {
    const err = new Error('Tag value is required');
    err.statusCode = 400;
    throw err;
  }

  const cleanKey = tagKey.trim();
  const cleanVal = tagValue.trim();

  if (cleanKey.length > 100) {
    const err = new Error('Tag key cannot exceed 100 characters');
    err.statusCode = 400;
    throw err;
  }

  if (cleanVal.length > 100) {
    const err = new Error('Tag value cannot exceed 100 characters');
    err.statusCode = 400;
    throw err;
  }

  // Check for duplicate
  const existing = await db.query(
    `SELECT id FROM user_exclusion_tags
     WHERE user_id = $1 AND LOWER(tag_key) = LOWER($2) AND LOWER(tag_value) = LOWER($3)`,
    [userId, cleanKey, cleanVal]
  );

  if (existing.rows.length > 0) {
    const err = new Error('Exclusion tag already exists');
    err.statusCode = 409;
    throw err;
  }

  const result = await db.query(
    `INSERT INTO user_exclusion_tags (user_id, tag_key, tag_value)
     VALUES ($1, $2, $3)
     RETURNING id, tag_key, tag_value, created_at`,
    [userId, cleanKey, cleanVal]
  );

  const row = result.rows[0];
  return {
    id: row.id,
    tagKey: row.tag_key,
    tagValue: row.tag_value,
    createdAt: row.created_at
  };
}

/**
 * Deletes an exclusion tag for user
 */
async function deleteExclusionTag(userId, tagId) {
  if (!userId) {
    const err = new Error('User ID is required');
    err.statusCode = 400;
    throw err;
  }

  if (!tagId) {
    const err = new Error('Tag ID is required');
    err.statusCode = 400;
    throw err;
  }

  const result = await db.query(
    `DELETE FROM user_exclusion_tags
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [tagId, userId]
  );

  if (result.rows.length === 0) {
    const err = new Error('Exclusion tag not found or unauthorized');
    err.statusCode = 404;
    throw err;
  }

  return { id: result.rows[0].id };
}

module.exports = {
  getUserProfile,
  changePassword,
  getNotificationPreferences,
  updateNotificationPreferences,
  getExclusionTags,
  addExclusionTag,
  deleteExclusionTag
};
