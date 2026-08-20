import api from './api';

export const savingsService = {
  async getVmSavings(resourceGroup, vmName, connectionId) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.get(
      `/api/cost/savings/${encodeURIComponent(resourceGroup)}/${encodeURIComponent(vmName)}`,
      { params }
    );
    return response.data;
  }
};
