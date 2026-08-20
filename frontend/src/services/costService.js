import api from './api';

export const costService = {
  async getMonthToDateCost(connectionId) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.get('/api/cost/month-to-date', { params });
    return response.data;
  },

  async getResourceCost(resourceGroup, resourceName, connectionId) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.get(
      `/api/cost/resource/${encodeURIComponent(resourceGroup)}/${encodeURIComponent(resourceName)}`,
      { params }
    );
    return response.data;
  }
};
