import api from './api';

export const actionHistoryService = {
  async getActions() {
    const response = await api.get('/api/actions');
    return response.data;
  },

  async getActionsByVm(vmName) {
    const response = await api.get(`/api/actions/${encodeURIComponent(vmName)}`);
    return response.data;
  },

  async runOptimizationNow() {
    const response = await api.post('/api/optimization/run-now');
    return response.data;
  }
};
