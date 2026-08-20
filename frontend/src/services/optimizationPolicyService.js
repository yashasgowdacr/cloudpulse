import api from './api';

export const optimizationPolicyService = {
  async getOptimizationPolicy() {
    const response = await api.get('/api/optimization-policy');
    return response.data;
  },

  async updateOptimizationPolicy(data) {
    // data: { idleCpuThreshold, monitoringWindowMinutes, autoShutdown }
    const response = await api.put('/api/optimization-policy', data);
    return response.data;
  }
};
