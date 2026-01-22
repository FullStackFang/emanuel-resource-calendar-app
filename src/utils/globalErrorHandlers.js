/**
 * Global Error Handlers for Temple Emanuel Resource Calendar
 * Catches unhandled errors and promise rejections
 */

import { reportError, normalizeError } from '../services/errorReportingService';
import { logger } from './logger';

// Token getter function (set during initialization)
let getApiToken = null;

// Error modal trigger function (set during initialization)
let showErrorModal = null;

/**
 * Initialize global error handlers
 * @param {Object} options - Initialization options
 * @param {Function} options.getApiToken - Function to get current API token
 * @param {Function} options.onError - Callback when error occurs (for showing modal)
 */
export function initializeGlobalErrorHandlers(options = {}) {
  getApiToken = options.getApiToken || null;
  showErrorModal = options.onError || null;

  // Handle uncaught errors
  window.onerror = function(message, source, lineno, colno, error) {
    logger.error('Uncaught error:', { message, source, lineno, colno });

    const errorInfo = normalizeError(error || { message, filename: source, lineno, colno }, {
      errorType: 'uncaughtException',
      severity: 'critical'
    });

    handleError(errorInfo);

    // Return false to allow default browser error handling
    return false;
  };

  // Handle unhandled promise rejections
  window.onunhandledrejection = function(event) {
    logger.error('Unhandled promise rejection:', event.reason);

    const errorInfo = normalizeError(event, {
      errorType: 'unhandledRejection',
      severity: 'critical'
    });

    handleError(errorInfo);
  };

  logger.debug('Global error handlers initialized');
}

/**
 * Handle an error - report and optionally show modal
 * @param {Object} errorInfo - Normalized error info
 */
async function handleError(errorInfo) {
  // Report to backend if we have a token
  const token = getApiToken?.();
  if (token) {
    try {
      const result = await reportError(errorInfo, token);
      if (result.correlationId) {
        errorInfo.correlationId = result.correlationId;
      }
    } catch (reportError) {
      logger.error('Failed to report error:', reportError);
    }
  }

  // Trigger error modal if handler is set
  if (showErrorModal) {
    showErrorModal(errorInfo);
  }
}

/**
 * Manually report an error (can be called from anywhere)
 * @param {Error|string|Object} error - Error to report
 * @param {Object} context - Additional context
 */
export async function reportGlobalError(error, context = {}) {
  const errorInfo = normalizeError(error, {
    errorType: context.errorType || 'manual_report',
    severity: context.severity || 'high',
    ...context
  });

  await handleError(errorInfo);
  return errorInfo;
}

/**
 * Clean up global error handlers (on unmount)
 */
export function cleanupGlobalErrorHandlers() {
  window.onerror = null;
  window.onunhandledrejection = null;
  getApiToken = null;
  showErrorModal = null;
}

export default {
  initializeGlobalErrorHandlers,
  reportGlobalError,
  cleanupGlobalErrorHandlers
};
