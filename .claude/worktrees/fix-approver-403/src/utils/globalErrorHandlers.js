/**
 * Global Error Handlers for Temple Emanuel Resource Calendar
 * Simplified version - Sentry handles automatic error capture
 * This module only handles UI notification (showing error modal)
 */

import * as Sentry from '@sentry/react';
import { normalizeError } from '../services/errorReportingService';
import { logger } from './logger';

// Error modal trigger function (set during initialization)
let showErrorModal = null;

/**
 * Initialize global error handlers
 * @param {Object} options - Initialization options
 * @param {Function} options.getApiToken - Function to get current API token (kept for backward compatibility)
 * @param {Function} options.onError - Callback when error occurs (for showing modal)
 */
export function initializeGlobalErrorHandlers(options = {}) {
  showErrorModal = options.onError || null;

  // Handle uncaught errors - Sentry auto-captures, we just show modal
  window.onerror = function(message, source, lineno, colno, error) {
    logger.error('Uncaught error:', { message, source, lineno, colno });

    const errorInfo = normalizeError(error || { message, filename: source, lineno, colno }, {
      errorType: 'uncaughtException',
      severity: 'critical'
    });

    // Sentry captures automatically, but add extra context
    if (error) {
      Sentry.addBreadcrumb({
        category: 'error',
        message: `Uncaught error: ${message}`,
        level: 'error',
        data: { source, lineno, colno }
      });
    }

    // Show error modal to user
    if (showErrorModal) {
      showErrorModal(errorInfo);
    }

    // Return false to allow default browser error handling
    return false;
  };

  // Handle unhandled promise rejections - Sentry auto-captures
  window.onunhandledrejection = function(event) {
    logger.error('Unhandled promise rejection:', event.reason);

    const errorInfo = normalizeError(event, {
      errorType: 'unhandledRejection',
      severity: 'critical'
    });

    // Add breadcrumb for context
    Sentry.addBreadcrumb({
      category: 'error',
      message: `Unhandled rejection: ${event.reason?.message || event.reason}`,
      level: 'error'
    });

    // Show error modal to user
    if (showErrorModal) {
      showErrorModal(errorInfo);
    }
  };

  logger.debug('Global error handlers initialized (Sentry mode)');
}

/**
 * Manually report an error to Sentry (can be called from anywhere)
 * @param {Error|string|Object} error - Error to report
 * @param {Object} context - Additional context
 * @returns {string|null} Sentry event ID
 */
export function reportGlobalError(error, context = {}) {
  const errorInfo = normalizeError(error, {
    errorType: context.errorType || 'manual_report',
    severity: context.severity || 'high',
    ...context
  });

  // Capture with Sentry
  const eventId = Sentry.captureException(
    error instanceof Error ? error : new Error(errorInfo.message),
    {
      extra: {
        ...context,
        originalError: errorInfo
      },
      tags: {
        errorType: context.errorType || 'manual_report',
        severity: context.severity || 'high'
      }
    }
  );

  // Show error modal if handler is set
  if (showErrorModal) {
    showErrorModal({ ...errorInfo, eventId });
  }

  return eventId;
}

/**
 * Clean up global error handlers (on unmount)
 */
export function cleanupGlobalErrorHandlers() {
  window.onerror = null;
  window.onunhandledrejection = null;
  showErrorModal = null;
}

export default {
  initializeGlobalErrorHandlers,
  reportGlobalError,
  cleanupGlobalErrorHandlers
};
