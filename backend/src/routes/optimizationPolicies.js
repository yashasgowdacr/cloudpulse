const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { publicErrorMessage } = require('../utils/http');
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
      message: publicErrorMessage(error, 'Unable to retrieve optimization policy.')
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
      message: publicErrorMessage(error, 'Unable to update optimization policy.')
    });
  }
});

// GET /api/optimization-policy/scopes - List scoped policies
router.get('/scopes', authenticateToken, async (req, res) => {
  try {
    const { getPolicyScopes } = require('../services/optimizationPolicyService');
    const scopes = await getPolicyScopes(req.user.id);
    return res.json({ scopes });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: 'SCOPES_FETCH_FAILURE',
      message: publicErrorMessage(error, 'Unable to retrieve policy scopes.')
    });
  }
});

// POST /api/optimization-policy/scopes - Create scoped policy
router.post('/scopes', authenticateToken, async (req, res) => {
  try {
    const { createPolicyScope } = require('../services/optimizationPolicyService');
    const scope = await createPolicyScope(req.user.id, req.body);
    return res.status(201).json({
      message: 'Policy scope created successfully',
      scope
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      error: 'SCOPE_CREATE_FAILURE',
      message: publicErrorMessage(error, 'Unable to create policy scope.')
    });
  }
});

// PUT /api/optimization-policy/scopes/:id - Update scoped policy
router.put('/scopes/:id', authenticateToken, async (req, res) => {
  try {
    const { updatePolicyScope } = require('../services/optimizationPolicyService');
    const scope = await updatePolicyScope(req.user.id, req.params.id, req.body);
    return res.json({
      message: 'Policy scope updated successfully',
      scope
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      error: 'SCOPE_UPDATE_FAILURE',
      message: publicErrorMessage(error, 'Unable to update policy scope.')
    });
  }
});

// DELETE /api/optimization-policy/scopes/:id - Delete scoped policy
router.delete('/scopes/:id', authenticateToken, async (req, res) => {
  try {
    const { deletePolicyScope } = require('../services/optimizationPolicyService');
    const result = await deletePolicyScope(req.user.id, req.params.id);
    return res.json({
      message: 'Policy scope deleted successfully',
      ...result
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      error: 'SCOPE_DELETE_FAILURE',
      message: publicErrorMessage(error, 'Unable to delete policy scope.')
    });
  }
});

// POST /api/optimization-policy/resolve - Resolve effective policy and explanation for a VM
router.post('/resolve', authenticateToken, async (req, res) => {
  try {
    const { resolveEffectivePolicy } = require('../services/optimizationPolicyService');
    const { vm, tags } = req.body;
    const result = await resolveEffectivePolicy(req.user.id, vm, tags);
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: 'POLICY_RESOLVE_FAILURE',
      message: publicErrorMessage(error, 'Unable to resolve optimization policy.')
    });
  }
});

module.exports = router;
