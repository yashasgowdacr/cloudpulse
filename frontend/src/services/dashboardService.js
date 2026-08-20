import api from './api';

export const dashboardService = {
  async getAzureConnections() {
    const response = await api.get('/api/azure-connections');
    return response.data;
  },

  async getVirtualMachines() {
    const response = await api.get('/azure/vms');
    return response.data;
  },

  async getMonthToDateCost() {
    const response = await api.get('/api/cost/month-to-date');
    return response.data;
  },

  async getOptimizationPolicy() {
    const response = await api.get('/api/optimization-policy');
    return response.data;
  },

  async getActionHistory() {
    const response = await api.get('/api/actions');
    return response.data;
  }
};
