const { evaluateShutdownPolicy } = require('../../src/services/azureVmService');

describe('Shutdown Policy & Production Safety Unit Tests', () => {
  const IDLE_TRUE = { idle: true, cpuAverage: 2.1 };
  const IDLE_FALSE = { idle: false, cpuAverage: 45.0 };
  const IDLE_INSUFFICIENT = { idle: false, cpuAverage: null };

  describe('Production Environment Shield', () => {
    it('should block shutdown if environment is "production" (exact match)', () => {
      const result = evaluateShutdownPolicy('worker-vm', IDLE_TRUE, 'production', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Virtual machine is in a production environment');
    });

    it('should block shutdown if environment is "PRODUCTION" (case-insensitive check)', () => {
      const result = evaluateShutdownPolicy('worker-vm', IDLE_TRUE, 'PRODUCTION', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Virtual machine is in a production environment');
    });

    it('should block shutdown if environment is "Production" (mixed-case check)', () => {
      const result = evaluateShutdownPolicy('worker-vm', IDLE_TRUE, 'Production', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Virtual machine is in a production environment');
    });
  });

  describe('AutoShutdown Toggle Guard', () => {
    it('should block shutdown if autoShutdown is false', () => {
      const result = evaluateShutdownPolicy('dev-vm', IDLE_TRUE, 'development', false);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Automatic shutdown setting is disabled');
    });
  });

  describe('Insufficient Monitoring Data Guard', () => {
    it('should block shutdown when CPU monitoring metrics are null / insufficient', () => {
      const result = evaluateShutdownPolicy('dev-vm', IDLE_INSUFFICIENT, 'development', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Insufficient monitoring data');
    });
  });

  describe('Active (Non-Idle) Virtual Machine Guard', () => {
    it('should block shutdown when VM is active (not idle)', () => {
      const result = evaluateShutdownPolicy('dev-vm', IDLE_FALSE, 'development', true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Virtual machine is active and not idle');
    });
  });

  describe('Permitted Deallocation for Eligible Dev/Staging VMs', () => {
    it('should allow shutdown when VM is idle, non-production, and autoShutdown is enabled', () => {
      const result = evaluateShutdownPolicy('dev-frontend', IDLE_TRUE, 'development', true);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Shutdown allowed');
    });

    it('should allow shutdown in staging environment when idle and autoShutdown is enabled', () => {
      const result = evaluateShutdownPolicy('staging-worker', IDLE_TRUE, 'staging', true);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Shutdown allowed');
    });

    it('should allow shutdown in test environment when idle and autoShutdown is enabled', () => {
      const result = evaluateShutdownPolicy('test-runner', IDLE_TRUE, 'test', true);
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain('Shutdown allowed');
    });
  });

  describe('Production Name Pattern Guard Verification', () => {
    // In executeVmShutdown, VM names containing 'prod' or 'production' are automatically forced to 'production'
    const isProductionName = (name) => {
      const lower = name.toLowerCase();
      return lower.includes('prod') || lower.includes('production');
    };

    it('should identify production names matching "prod" prefix or substring', () => {
      expect(isProductionName('prod-api-server')).toBe(true);
      expect(isProductionName('PROD-AUTH-01')).toBe(true);
      expect(isProductionName('my-service-prod')).toBe(true);
      expect(isProductionName('web-production-node')).toBe(true);
      expect(isProductionName('PRODUCTION_DB')).toBe(true);
    });

    it('should not identify non-production names', () => {
      expect(isProductionName('dev-vm-01')).toBe(false);
      expect(isProductionName('staging-worker')).toBe(false);
      expect(isProductionName('test-runner')).toBe(false);
      expect(isProductionName('qa-cluster')).toBe(false);
    });

    it('should ensure any VM detected as production via name is rejected by evaluateShutdownPolicy', () => {
      const prodNames = ['prod-api', 'PROD-GATEWAY', 'production-db', 'billing-production-svc'];
      for (const name of prodNames) {
        const env = isProductionName(name) ? 'production' : 'development';
        const result = evaluateShutdownPolicy(name, IDLE_TRUE, env, true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('production');
      }
    });
  });

  describe('Tag-Based Safety Guard Verification', () => {
    const resolveTagProtection = (tags) => {
      let environment = 'development';
      let autoShutdown = true;
      if (tags) {
        const envTag = tags.Environment || tags.environment || tags.ENV || tags.env;
        if (envTag && envTag.toLowerCase() === 'production') {
          environment = 'production';
        }
        const autoShutdownTag = tags.AutoShutdown || tags.autoshutdown;
        if (autoShutdownTag && (autoShutdownTag.toLowerCase() === 'disabled' || autoShutdownTag.toLowerCase() === 'false')) {
          autoShutdown = false;
        }
      }
      return { environment, autoShutdown };
    };

    it('should detect Environment tag = "production" (case-insensitive) and block shutdown', () => {
      const tagSets = [
        { Environment: 'production' },
        { environment: 'Production' },
        { ENV: 'PRODUCTION' },
        { env: 'production' }
      ];
      for (const tags of tagSets) {
        const { environment, autoShutdown } = resolveTagProtection(tags);
        const result = evaluateShutdownPolicy('random-vm-name', IDLE_TRUE, environment, autoShutdown);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('production');
      }
    });

    it('should detect AutoShutdown tag = "disabled" or "false" and block shutdown', () => {
      const tagSets = [
        { AutoShutdown: 'disabled' },
        { autoshutdown: 'DISABLED' },
        { AutoShutdown: 'false' },
        { autoshutdown: 'FALSE' }
      ];
      for (const tags of tagSets) {
        const { environment, autoShutdown } = resolveTagProtection(tags);
        const result = evaluateShutdownPolicy('dev-vm', IDLE_TRUE, environment, autoShutdown);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('Automatic shutdown setting is disabled');
      }
    });
  });
});
