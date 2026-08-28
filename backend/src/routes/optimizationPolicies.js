const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { getPolicyForUser, updatePolicyForUser } = require('../services/optimizationPolicyService');

const router = express.Router();

// GET /api/optimization-policy - Get authenticated user's policy
router.get('/', authenticateToken, async (req, res) => {
  try {
    const policy = await getPolicyForUser(req.user.id);
    return res.json({ policy: { ...policy } });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: 'POLICY_FETCH_FAILURE',
      message: error.message
    });
  }
});

// PUT /api/optimization-policy - Update authenticated user's policy
router.put('/', authenticateToken, async (req, res) => {
  try {
    const policy = await updatePolicyForUser(req.user.id, req.body);
    return res.json({
      message: 'Optimization policy updated successfully',
      policy: { ...policy }
    });
  } catch (error) {
    const status = error.statusCode || 400;
    return res.status(status).json({
      error: 'POLICY_UPDATE_FAILURE',
      message: error.message
    });
  }
});

module.exports = router;
