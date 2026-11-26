const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
  getUserProfile,
  changePassword,
  getNotificationPreferences,
  updateNotificationPreferences,
  getExclusionTags,
  addExclusionTag,
  deleteExclusionTag
} = require('../services/settingsService');
const { publicErrorMessage } = require('../utils/http');

const router = express.Router();

/**
 * GET /api/settings
 * Retrieves account settings & profile for authenticated user
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const profile = await getUserProfile(req.user.id);
    const notifications = await getNotificationPreferences(req.user.id);
    const exclusionTags = await getExclusionTags(req.user.id);

    return res.json({
      user: profile,
      notifications,
      exclusionTagsCount: exclusionTags.length
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: 'SETTINGS_FETCH_FAILURE',
      message: publicErrorMessage(error, 'Unable to retrieve account settings.')
    });
  }
});

/**
 * PATCH /api/settings/password
 * Changes password for authenticated user, revoking existing sessions
 */
router.patch('/password', authenticateToken, async (req, res) => {
  try {
    const result = await changePassword(req.user.id, req.body || {});

    // Set replacement HttpOnly cookie for browser client
    res.cookie('cloudpulse_refresh_token', result.refreshToken, {
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      path: '/api/auth',
      maxAge: 604800000
    });

    return res.json({
      message: 'Password changed successfully',
      accessToken: result.accessToken,
      user: result.user
    });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: 'PASSWORD_CHANGE_FAILURE',
      message: publicErrorMessage(error, 'Unable to change password.')
    });
  }
});

/**
 * GET /api/settings/notifications
 * Retrieves user notification preferences
 */
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const preferences = await getNotificationPreferences(req.user.id);
    return res.json({ preferences });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: 'NOTIFICATION_PREFS_FETCH_FAILURE',
      message: publicErrorMessage(error, 'Unable to retrieve notification preferences.')
    });
  }
});

/**
 * PATCH /api/settings/notifications
 * Updates user notification preferences
 */
router.patch('/notifications', authenticateToken, async (req, res) => {
  try {
    const preferences = await updateNotificationPreferences(req.user.id, req.body || {});
    return res.json({
      message: 'Notification preferences updated successfully',
      preferences
    });
  } catch (error) {
    const status = error.statusCode || 400;
    return res.status(status).json({
      error: 'NOTIFICATION_PREFS_UPDATE_FAILURE',
      message: publicErrorMessage(error, 'Unable to update notification preferences.')
    });
  }
});

/**
 * GET /api/settings/exclusion-tags
 * Retrieves custom exclusion tags for authenticated user
 */
router.get('/exclusion-tags', authenticateToken, async (req, res) => {
  try {
    const tags = await getExclusionTags(req.user.id);
    return res.json({ tags });
  } catch (error) {
    const status = error.statusCode || 500;
    return res.status(status).json({
      error: 'EXCLUSION_TAGS_FETCH_FAILURE',
      message: publicErrorMessage(error, 'Unable to retrieve exclusion tags.')
    });
  }
});

/**
 * POST /api/settings/exclusion-tags
 * Adds a new custom exclusion tag for authenticated user
 */
router.post('/exclusion-tags', authenticateToken, async (req, res) => {
  try {
    const tag = await addExclusionTag(req.user.id, req.body || {});
    return res.status(201).json({
      message: 'Exclusion tag added successfully',
      tag
    });
  } catch (error) {
    const status = error.statusCode || 400;
    return res.status(status).json({
      error: 'EXCLUSION_TAG_CREATE_FAILURE',
      message: publicErrorMessage(error, 'Unable to create exclusion tag.')
    });
  }
});

/**
 * DELETE /api/settings/exclusion-tags/:id
 * Deletes an exclusion tag for authenticated user
 */
router.delete('/exclusion-tags/:id', authenticateToken, async (req, res) => {
  try {
    await deleteExclusionTag(req.user.id, req.params.id);
    return res.json({
      message: 'Exclusion tag deleted successfully',
      id: req.params.id
    });
  } catch (error) {
    const status = error.statusCode || 400;
    return res.status(status).json({
      error: 'EXCLUSION_TAG_DELETE_FAILURE',
      message: publicErrorMessage(error, 'Unable to delete exclusion tag.')
    });
  }
});

module.exports = router;
