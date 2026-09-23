const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
  createBudget,
  getBudgets,
  getBudgetById,
  updateBudget,
  deleteBudget
} = require('../services/budgetService');

const router = express.Router();

/**
 * GET /api/budgets
 * Retrieves all budgets for authenticated tenant.
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const budgets = await getBudgets(req.user.id);
    return res.json({ budgets });
  } catch (error) {
    console.error('[BUDGETS] Error listing budgets:', error.message);
    return res.status(error.statusCode || 500).json({
      error: 'LIST_BUDGETS_FAILED',
      message: error.message
    });
  }
});

/**
 * POST /api/budgets
 * Creates a new budget.
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const budget = await createBudget(req.user.id, req.body);
    return res.status(201).json({
      message: 'Budget created successfully',
      budget
    });
  } catch (error) {
    console.error('[BUDGETS] Error creating budget:', error.message);
    return res.status(error.statusCode || 500).json({
      error: 'CREATE_BUDGET_FAILED',
      message: error.message
    });
  }
});

/**
 * GET /api/budgets/:id
 * Retrieves single budget by ID.
 */
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const budget = await getBudgetById(req.user.id, req.params.id);
    return res.json({ budget });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: 'GET_BUDGET_FAILED',
      message: error.message
    });
  }
});

/**
 * PUT /api/budgets/:id
 * Updates budget by ID.
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const budget = await updateBudget(req.user.id, req.params.id, req.body);
    return res.json({
      message: 'Budget updated successfully',
      budget
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: 'UPDATE_BUDGET_FAILED',
      message: error.message
    });
  }
});

/**
 * DELETE /api/budgets/:id
 * Deletes budget by ID.
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const result = await deleteBudget(req.user.id, req.params.id);
    return res.json({
      message: 'Budget deleted successfully',
      ...result
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: 'DELETE_BUDGET_FAILED',
      message: error.message
    });
  }
});

module.exports = router;
