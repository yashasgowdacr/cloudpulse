import api from './api';

export const vmService = {
  async getVirtualMachines(connectionId) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.get('/azure/vms', { params });
    return response.data;
  },

  async getVmPowerState(resourceGroup, vmName, connectionId) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.get(
      `/azure/vms/${encodeURIComponent(resourceGroup)}/${encodeURIComponent(vmName)}/power-state`,
      { params }
    );
    return response.data;
  },

  async getVmMetrics(resourceGroup, vmName, connectionId) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.get(
      `/azure/vms/${encodeURIComponent(resourceGroup)}/${encodeURIComponent(vmName)}/metrics`,
      { params }
    );
    return response.data;
  },

  async getVmPrice(resourceGroup, vmName, connectionId) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.get(
      `/api/cost/vm-price/${encodeURIComponent(resourceGroup)}/${encodeURIComponent(vmName)}`,
      { params }
    );
    return response.data;
  },

  async getVmSavings(resourceGroup, vmName, connectionId) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.get(
      `/api/cost/savings/${encodeURIComponent(resourceGroup)}/${encodeURIComponent(vmName)}`,
      { params }
    );
    return response.data;
  },



  async shutdownVm(resourceGroup, vmName, connectionId) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.post(
      `/azure/vms/${encodeURIComponent(resourceGroup)}/${encodeURIComponent(vmName)}/shutdown`,
      {},
      { params }
    );
    return response.data;
  },

  async startVm(resourceGroup, vmName, connectionId) {
    const params = connectionId ? { connectionId } : {};
    const response = await api.post(
      `/azure/vms/${encodeURIComponent(resourceGroup)}/${encodeURIComponent(vmName)}/start`,
      {},
      { params }
    );
    return response.data;
  }
};
