import api from './api';

export const settingsService = {
  // Get all settings & user profile
  getSettings: async () => {
    const response = await api.get('/api/settings');
    return response.data;
  },

  // Change password
  updatePassword: async ({ currentPassword, newPassword }) => {
    const response = await api.patch('/api/settings/password', {
      currentPassword,
      newPassword
    });
    return response.data;
  },

  // Notification preferences
  getNotificationPreferences: async () => {
    const response = await api.get('/api/settings/notifications');
    return response.data;
  },

  updateNotificationPreferences: async (preferences) => {
    const response = await api.patch('/api/settings/notifications', preferences);
    return response.data;
  },

  // Custom safety exclusion tags
  getExclusionTags: async () => {
    const response = await api.get('/api/settings/exclusion-tags');
    return response.data;
  },

  addExclusionTag: async ({ tagKey, tagValue }) => {
    const response = await api.post('/api/settings/exclusion-tags', {
      tagKey,
      tagValue
    });
    return response.data;
  },

  deleteExclusionTag: async (tagId) => {
    const response = await api.delete(`/api/settings/exclusion-tags/${tagId}`);
    return response.data;
  }
};
