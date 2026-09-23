const CloudProvider = require('./CloudProvider');
const {
  discoverAzureVms,
  fetchVmCpuMetrics,
  executeVmShutdown,
  executeVmStart,
  executeBulkShutdown,
  executeBulkStart
} = require('../azureVmService');
const { fetchSubscriptionMonthToDateCost } = require('../azureCostService');

/**
 * Azure CloudProvider implementation wrapping existing Azure SDK services.
 * Invariant: Preserves 100% of existing Azure behavior.
 */
class AzureProvider extends CloudProvider {
  getProviderName() {
    return 'AZURE';
  }

  getCapabilities() {
    return {
      metrics: true,
      start: true,
      stop: true,
      cost: true,
      tags: true,
      bulk: true
    };
  }

  async validateCredentials(config) {
    if (!config.subscriptionId || !config.tenantId || !config.clientId || !config.clientSecret) {
      const err = new Error('Azure credentials require subscriptionId, tenantId, clientId, and clientSecret');
      err.statusCode = 400;
      throw err;
    }
    return { valid: true, provider: 'AZURE' };
  }

  async listVirtualMachines(config) {
    const vms = await discoverAzureVms(config.subscriptionId, config.credential);
    return vms.map(vm => ({
      provider: 'AZURE',
      name: vm.name,
      id: vm.name,
      location: vm.location,
      resourceGroup: vm.resourceGroup,
      size: vm.size,
      status: vm.status,
      powerState: vm.status,
      tags: vm.tags || {}
    }));
  }

  async getVirtualMachine(config, vmName) {
    const vms = await this.listVirtualMachines(config);
    return vms.find(v => v.name.toLowerCase() === vmName.toLowerCase()) || null;
  }

  async getCpuMetrics(config, vmName, options = {}) {
    const timespan = options.timespan || 'PT30M';
    const resourceGroup = options.resourceGroup || config.resourceGroup;
    return await fetchVmCpuMetrics(config.subscriptionId, resourceGroup, vmName, timespan, config.credential);
  }

  async startVirtualMachine(config, vmName, tenantContext = {}) {
    const resourceGroup = config.resourceGroup;
    return await executeVmStart(
      config.subscriptionId,
      resourceGroup,
      vmName,
      {},
      config.credential,
      tenantContext
    );
  }

  async stopVirtualMachine(config, vmName, options = {}, tenantContext = {}) {
    const resourceGroup = config.resourceGroup;
    return await executeVmShutdown(
      config.subscriptionId,
      resourceGroup,
      vmName,
      options,
      config.credential,
      tenantContext
    );
  }

  async getCost(config, options = {}) {
    return await fetchSubscriptionMonthToDateCost(
      config.subscriptionId,
      config.credential,
      options.tenantContext || {}
    );
  }

  async bulkStop(config, vmsList = [], options = {}, tenantContext = {}) {
    return await executeBulkShutdown(
      config.subscriptionId,
      vmsList,
      options,
      config.credential,
      tenantContext
    );
  }

  async bulkStart(config, vmsList = [], options = {}, tenantContext = {}) {
    return await executeBulkStart(
      config.subscriptionId,
      vmsList,
      options,
      config.credential,
      tenantContext
    );
  }
}

module.exports = AzureProvider;
