import api from './api';

export const adminService = {
  async getMetrics() {
    const response = await api.get('/api/admin/metrics');
    return response.data;
  },

  async getTenants(params = {}) {
    const response = await api.get('/api/admin/tenants', { params });
    return response.data;
  },

  async getTenantDetails(id) {
    const response = await api.get(`/api/admin/tenants/${id}`);
    return response.data;
  },

  async updateTenantStatus(id, status) {
    const response = await api.patch(`/api/admin/tenants/${id}/status`, { status });
    return response.data;
  }
};
