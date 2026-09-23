/**
 * Base abstract interface for Cloud Providers in CloudPulse.
 * Explicitly declares capabilities to avoid assumptions about multi-cloud feature parity.
 */
class CloudProvider {
  /**
   * Returns supported provider capabilities.
   * @returns {{ metrics: boolean, start: boolean, stop: boolean, cost: boolean, tags: boolean, bulk: boolean }}
   */
  getCapabilities() {
    return {
      metrics: false,
      start: false,
      stop: false,
      cost: false,
      tags: false,
      bulk: false
    };
  }

  /**
   * Helper to test if a specific capability is supported by this provider.
   * @param {string} capability
   * @returns {boolean}
   */
  hasCapability(capability) {
    const caps = this.getCapabilities();
    return Boolean(caps[capability]);
  }

  /**
   * Returns provider identifier name (e.g. 'AZURE', 'AWS', 'GCP').
   */
  getProviderName() {
    throw new Error('getProviderName() must be implemented by subclass');
  }

  /**
   * Validates provider credentials.
   */
  async validateCredentials(config) {
    throw new Error('validateCredentials() must be implemented by subclass');
  }

  /**
   * Discovers and lists virtual machine instances.
   */
  async listVirtualMachines(config) {
    throw new Error('listVirtualMachines() must be implemented by subclass');
  }

  /**
   * Retrieves power state and details for a specific virtual machine.
   */
  async getVirtualMachine(config, vmId) {
    throw new Error('getVirtualMachine() must be implemented by subclass');
  }

  /**
   * Retrieves CPU percentage utilization metrics for a virtual machine.
   */
  async getCpuMetrics(config, vmId, options = {}) {
    throw new Error('getCpuMetrics() not supported by provider');
  }

  /**
   * Powers ON a stopped/deallocated virtual machine.
   */
  async startVirtualMachine(config, vmId, tenantContext = {}) {
    throw new Error('startVirtualMachine() not supported by provider');
  }

  /**
   * Powers OFF / deallocates a running virtual machine.
   */
  async stopVirtualMachine(config, vmId, options = {}, tenantContext = {}) {
    throw new Error('stopVirtualMachine() not supported by provider');
  }

  /**
   * Retrieves cost data if supported by provider.
   */
  async getCost(config, options = {}) {
    throw new Error('getCost() not supported by provider');
  }
}

module.exports = CloudProvider;
