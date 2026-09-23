const { evaluateVmIdleStatus } = require('../../src/services/azureVmService');

describe('VM Idle Status Evaluation Unit Tests', () => {
  const VM_NAME = 'dev-web-worker-01';

  describe('CPU Threshold Boundaries', () => {
    it('should evaluate CPU below threshold as idle (cpu < threshold)', () => {
      const result = evaluateVmIdleStatus(VM_NAME, { averageCpuPercentage: 4.99 }, 5.0, 30);
      expect(result.idle).toBe(true);
      expect(result.cpuAverage).toBe(4.99);
      expect(result.threshold).toBe(5.0);
      expect(result.reason).toContain('is below the threshold of 5%');
    });

    it('should evaluate CPU exactly equal to threshold as NOT idle (strict boundary: cpu < threshold, NOT <=)', () => {
      const result = evaluateVmIdleStatus(VM_NAME, { averageCpuPercentage: 5.0 }, 5.0, 30);
      expect(result.idle).toBe(false);
      expect(result.cpuAverage).toBe(5.0);
      expect(result.reason).toContain('is at or above the threshold of 5%');
    });

    it('should evaluate CPU above threshold as NOT idle (cpu > threshold)', () => {
      const result = evaluateVmIdleStatus(VM_NAME, { averageCpuPercentage: 5.01 }, 5.0, 30);
      expect(result.idle).toBe(false);
      expect(result.cpuAverage).toBe(5.01);
      expect(result.reason).toContain('is at or above the threshold of 5%');
    });

    it('should evaluate high CPU load as NOT idle', () => {
      const result = evaluateVmIdleStatus(VM_NAME, { averageCpuPercentage: 88.5 }, 5.0, 30);
      expect(result.idle).toBe(false);
      expect(result.cpuAverage).toBe(88.5);
    });

    it('should evaluate zero CPU utilization as idle', () => {
      const result = evaluateVmIdleStatus(VM_NAME, { averageCpuPercentage: 0.0 }, 5.0, 30);
      expect(result.idle).toBe(true);
      expect(result.cpuAverage).toBe(0.0);
    });
  });

  describe('Custom threshold and windowMinutes configuration', () => {
    it('should respect custom threshold and custom monitoring window', () => {
      const result = evaluateVmIdleStatus(VM_NAME, { averageCpuPercentage: 7.5 }, 10, 60);
      expect(result.idle).toBe(true);
      expect(result.threshold).toBe(10);
      expect(result.windowMinutes).toBe(60);
      expect(result.reason).toContain('over the last 60 minutes is below the threshold of 10%');
    });

    it('should support raw numeric metricsData input', () => {
      const result = evaluateVmIdleStatus(VM_NAME, 2.5, 5, 30);
      expect(result.idle).toBe(true);
      expect(result.cpuAverage).toBe(2.5);
    });
  });

  describe('Missing / null metrics (insufficient data safety protection)', () => {
    it('should safely mark as NOT idle when averageCpuPercentage is null', () => {
      const result = evaluateVmIdleStatus(VM_NAME, { averageCpuPercentage: null }, 5, 30);
      expect(result.idle).toBe(false);
      expect(result.cpuAverage).toBeNull();
      expect(result.reason).toContain('Insufficient monitoring data');
    });

    it('should safely mark as NOT idle when metricsData is null or undefined', () => {
      const nullResult = evaluateVmIdleStatus(VM_NAME, null, 5, 30);
      expect(nullResult.idle).toBe(false);
      expect(nullResult.cpuAverage).toBeNull();

      const undefResult = evaluateVmIdleStatus(VM_NAME, undefined, 5, 30);
      expect(undefResult.idle).toBe(false);
      expect(undefResult.cpuAverage).toBeNull();
    });

    it('should safely mark as NOT idle when metricsData has no data points', () => {
      const result = evaluateVmIdleStatus(VM_NAME, { averageCpuPercentage: null, dataPointsCount: 0 }, 5, 45);
      expect(result.idle).toBe(false);
      expect(result.cpuAverage).toBeNull();
      expect(result.windowMinutes).toBe(45);
      expect(result.reason).toContain('No CPU metric data available for the last 45 minutes');
    });
  });
});
