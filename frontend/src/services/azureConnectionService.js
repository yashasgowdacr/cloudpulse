import api from './api';

export const azureConnectionService = {
  async getAzureConnections() {
    const response = await api.get('/api/azure-connections');
    return response.data;
  },

  async getAzureConnection(id) {
    const response = await api.get(`/api/azure-connections/${id}`);
    return response.data;
  },

  async createAzureConnection(data) {
    // data: { connectionName, tenantId, subscriptionId, clientId, clientSecret }
    const response = await api.post('/api/azure-connections', data);
    return response.data;
  },

  async disconnectAzureConnection(id) {
    const response = await api.delete(`/api/azure-connections/${id}`);
    return response.data;
  }
};
