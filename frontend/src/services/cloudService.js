import api from './api';

export const cloudService = {
  async getProviders() {
    const response = await api.get('/api/cloud/providers');
    return response.data;
  },

  async getConnections() {
    const response = await api.get('/api/cloud/connections');
    return response.data;
  },

  async createConnection(data) {
    const response = await api.post('/api/cloud/connections', data);
    return response.data;
  },

  async deleteConnection(id) {
    const response = await api.delete(`/api/cloud/connections/${id}`);
    return response.data;
  },

  async getUnifiedVms(connectionId = null) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.get('/api/cloud/vms', { params });
    return response.data;
  }
};
