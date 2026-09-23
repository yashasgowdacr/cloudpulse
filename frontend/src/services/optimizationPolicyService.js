import api from './api';

export const optimizationPolicyService = {
  async getOptimizationPolicy() {
    const response = await api.get('/api/optimization-policy');
    return response.data;
  },

  async updateOptimizationPolicy(data) {
    const response = await api.put('/api/optimization-policy', data);
    return response.data;
  },

  async getPolicyScopes() {
    const response = await api.get('/api/optimization-policy/scopes');
    return response.data;
  },

  async createPolicyScope(data) {
    const response = await api.post('/api/optimization-policy/scopes', data);
    return response.data;
  },

  async updatePolicyScope(id, data) {
    const response = await api.put(`/api/optimization-policy/scopes/${id}`, data);
    return response.data;
  },

  async deletePolicyScope(id) {
    const response = await api.delete(`/api/optimization-policy/scopes/${id}`);
    return response.data;
  },

  async resolvePolicy(vm, tags = {}) {
    const response = await api.post('/api/optimization-policy/resolve', { vm, tags });
    return response.data;
  }
};
