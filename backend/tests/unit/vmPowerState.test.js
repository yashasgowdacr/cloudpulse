const { getVmPowerState } = require('../../src/services/azureVmService');

describe('VM Power State Parser Unit Tests', () => {
  describe('Standard exact states', () => {
    it('should return "running" when PowerState/running is present', () => {
      const statuses = [{ code: 'PowerState/running' }];
      expect(getVmPowerState(statuses)).toBe('running');
    });

    it('should return "stopped" when PowerState/stopped is present', () => {
      const statuses = [{ code: 'PowerState/stopped' }];
      expect(getVmPowerState(statuses)).toBe('stopped');
    });

    it('should return "deallocated" when PowerState/deallocated is present', () => {
      const statuses = [{ code: 'PowerState/deallocated' }];
      expect(getVmPowerState(statuses)).toBe('deallocated');
    });
  });

  describe('Sub-state / transitional states mapping', () => {
    it('should map transitional "deallocating" to "deallocated"', () => {
      const statuses = [{ code: 'PowerState/deallocating' }];
      expect(getVmPowerState(statuses)).toBe('deallocated');
    });

    it('should map transitional "stopping" to "stopped"', () => {
      const statuses = [{ code: 'PowerState/stopping' }];
      expect(getVmPowerState(statuses)).toBe('stopped');
    });

    it('should map transitional "starting" to "running"', () => {
      const statuses = [{ code: 'PowerState/starting' }];
      expect(getVmPowerState(statuses)).toBe('running');
    });
  });

  describe('Edge cases, unrecognized and missing data handling', () => {
    it('should return "unknown" when statuses is null or undefined', () => {
      expect(getVmPowerState(null)).toBe('unknown');
      expect(getVmPowerState(undefined)).toBe('unknown');
    });

    it('should return "unknown" when statuses is not an array', () => {
      expect(getVmPowerState('running')).toBe('unknown');
      expect(getVmPowerState({})).toBe('unknown');
      expect(getVmPowerState(42)).toBe('unknown');
    });

    it('should return "unknown" when statuses array is empty', () => {
      expect(getVmPowerState([])).toBe('unknown');
    });

    it('should return "unknown" when no status entry starts with "PowerState/"', () => {
      const statuses = [
        { code: 'ProvisioningState/succeeded' },
        { code: 'OSState/generalized' }
      ];
      expect(getVmPowerState(statuses)).toBe('unknown');
    });

    it('should return "unknown" for unrecognized power states', () => {
      const statuses = [{ code: 'PowerState/hibernating' }];
      expect(getVmPowerState(statuses)).toBe('unknown');
    });

    it('should correctly pick PowerState when array contains ProvisioningState first', () => {
      const statuses = [
        { code: 'ProvisioningState/succeeded', displayStatus: 'Provisioning succeeded' },
        { code: 'PowerState/running', displayStatus: 'VM running' }
      ];
      expect(getVmPowerState(statuses)).toBe('running');
    });
  });
});
