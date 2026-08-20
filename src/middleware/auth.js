const jwt = require('jsonwebtoken');
const db = require('../db');

/**
 * Helper to retrieve JWT_SECRET or fail fast
 */
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('FATAL CONFIGURATION ERROR: JWT_SECRET environment variable is missing or empty in .env');
  }
  return secret;
}

/**
 * Authentication Middleware: Verifies Bearer JWT access token and attaches safe req.user
 */
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];

    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access token missing or malformed' });
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return res.status(401).json({ error: 'Access token missing' });
    }

    const jwtSecret = getJwtSecret();
    let decoded;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired access token' });
    }

    const userId = decoded.sub;
    if (!userId) {
      return res.status(401).json({ error: 'Invalid access token claims' });
    }

    // Parameterized query to fetch user from database
    const userRes = await db.query(
      'SELECT id, name, email, role, status FROM users WHERE id = $1',
      [userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'User account not found' });
    }

    const user = userRes.rows[0];

    // Reject inactive or suspended users
    if (user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'User account is inactive or suspended' });
    }

    // Attach ONLY safe user information (never password_hash, secrets, or JWT)
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status
    };

    next();
  } catch (error) {
    console.error('[AUTH-MIDDLEWARE] Authentication error:', error.message);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

/**
 * RBAC Middleware: Restricts access to users with specified role(s)
 */
function requireRole(requiredRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Access denied: Insufficient privileges' });
    }

    next();
  };
}

module.exports = {
  authenticateToken,
  requireRole
};
