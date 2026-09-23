const { logger } = require('../utils/logger');

/**
 * Service boundary for external Application Performance Monitoring (APM) and Error Tracking (e.g. Sentry, Datadog).
 * Ensures CloudPulse functions flawlessly without requiring mandatory external SaaS services during local dev or tests.
 */
class ErrorMonitoringService {
  constructor() {
    this.isConfigured = Boolean(process.env.SENTRY_DSN || process.env.APM_SERVICE_URL);
    this.environment = process.env.NODE_ENV || 'development';
  }

  /**
   * Captures an unhandled exception or critical error.
   */
  captureException(error, context = {}) {
    const sanitizedContext = { ...context };

    logger.error(`[APM-ERROR-MONITOR] ${error.message || 'Unknown Error'}`, error, sanitizedContext);

    if (this.isConfigured) {
      // Future Sentry / APM dispatch hook
      try {
        // e.g. Sentry.captureException(error, { extra: sanitizedContext });
      } catch (err) {
        console.error('[APM-DISPATCH-FAILURE]', err.message);
      }
    }

    return {
      tracked: true,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Records a diagnostic breadcrumb for tracing application workflows.
   */
  captureBreadcrumb(category, message, data = {}) {
    if (this.environment !== 'production') {
      logger.info(`[BREADCRUMB:${category}] ${message}`, data);
    }
  }
}

const errorMonitoringService = new ErrorMonitoringService();

module.exports = {
  errorMonitoringService
};
