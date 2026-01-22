/**
 * Error Reporting Service for Temple Emanuel Resource Calendar
 * Handles frontend error capture, logging, and user issue reports
 */

import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

// Store recent errors for context (max 10)
const recentErrors = [];
const MAX_RECENT_ERRORS = 10;

// Debounce tracking for similar errors
const errorDebounce = new Map();
const DEBOUNCE_MS = 5000; // 5 seconds

/**
 * Collect browser context information
 * @returns {Object} Browser context data
 */
export function collectBrowserContext() {
  return {
    userAgent: navigator.userAgent,
    url: window.location.href,
    referrer: document.referrer,
    screenSize: `${window.screen.width}x${window.screen.height}`,
    viewportSize: `${window.innerWidth}x${window.innerHeight}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    online: navigator.onLine,
    timestamp: new Date().toISOString()
  };
}

/**
 * Generate a simple fingerprint for error deduplication
 * @param {Error|Object} error - Error object
 * @returns {string} Fingerprint
 */
function generateErrorFingerprint(error) {
  const message = error?.message || String(error);
  const stack = error?.stack?.split('\n').slice(0, 3).join('|') || '';
  return `${message}::${stack}`;
}

/**
 * Check if error should be debounced
 * @param {string} fingerprint - Error fingerprint
 * @returns {boolean} Whether to debounce
 */
function shouldDebounce(fingerprint) {
  const lastReported = errorDebounce.get(fingerprint);
  if (lastReported && Date.now() - lastReported < DEBOUNCE_MS) {
    return true;
  }
  errorDebounce.set(fingerprint, Date.now());
  return false;
}

/**
 * Add error to recent errors list
 * @param {Object} errorInfo - Error info object
 */
function addToRecentErrors(errorInfo) {
  recentErrors.unshift({
    ...errorInfo,
    timestamp: new Date().toISOString()
  });

  // Keep only the most recent errors
  if (recentErrors.length > MAX_RECENT_ERRORS) {
    recentErrors.pop();
  }
}

/**
 * Get recent errors for context
 * @returns {Array} Recent errors
 */
export function getRecentErrors() {
  return [...recentErrors];
}

/**
 * Report an error to the backend
 * @param {Object} errorData - Error data to report
 * @param {string} apiToken - API authentication token
 * @returns {Promise<Object>} Report result
 */
export async function reportError(errorData, apiToken) {
  const fingerprint = generateErrorFingerprint(errorData);

  // Debounce similar errors
  if (shouldDebounce(fingerprint)) {
    logger.debug('Error debounced (duplicate within 5s):', errorData.message);
    return { debounced: true };
  }

  // Add to recent errors
  addToRecentErrors({
    message: errorData.message,
    stack: errorData.stack,
    type: errorData.errorType
  });

  // If no token, just log locally
  if (!apiToken) {
    logger.error('Cannot report error - no API token:', errorData);
    return { success: false, error: 'No API token' };
  }

  const browserContext = collectBrowserContext();

  const payload = {
    message: errorData.message || 'Unknown error',
    stack: errorData.stack || null,
    componentStack: errorData.componentStack || null,
    errorType: errorData.errorType || 'frontend_error',
    severity: errorData.severity || 'high',
    browserContext,
    currentUrl: window.location.href
  };

  try {
    const response = await fetch(`${APP_CONFIG.API_BASE_URL}/log-error`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Failed to report error:', errorText);
      return { success: false, error: errorText };
    }

    const result = await response.json();
    logger.debug('Error reported successfully:', result.correlationId);
    return { success: true, correlationId: result.correlationId };

  } catch (networkError) {
    logger.error('Network error reporting error:', networkError);
    return { success: false, error: networkError.message };
  }
}

/**
 * Submit a user issue report
 * @param {Object} reportData - User report data
 * @param {string} apiToken - API authentication token
 * @returns {Promise<Object>} Report result
 */
export async function submitUserReport(reportData, apiToken) {
  if (!apiToken) {
    return { success: false, error: 'Not authenticated' };
  }

  const browserContext = collectBrowserContext();

  const payload = {
    description: reportData.description,
    category: reportData.category || 'general',
    browserContext,
    currentUrl: window.location.href,
    recentErrors: recentErrors.map(e => `[${e.timestamp}] ${e.type}: ${e.message}`).slice(0, 5)
  };

  try {
    const response = await fetch(`${APP_CONFIG.API_BASE_URL}/report-issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiToken}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: errorText };
    }

    const result = await response.json();
    return { success: true, correlationId: result.correlationId };

  } catch (networkError) {
    logger.error('Network error submitting report:', networkError);
    return { success: false, error: networkError.message };
  }
}

/**
 * Create error info object from various error types
 * @param {Error|string|Event} error - Error source
 * @param {Object} extra - Extra context
 * @returns {Object} Normalized error info
 */
export function normalizeError(error, extra = {}) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
      ...extra
    };
  }

  if (typeof error === 'string') {
    return {
      message: error,
      stack: null,
      ...extra
    };
  }

  // ErrorEvent from window.onerror
  if (error && error.message) {
    return {
      message: error.message,
      stack: error.error?.stack || null,
      filename: error.filename,
      lineno: error.lineno,
      colno: error.colno,
      ...extra
    };
  }

  // PromiseRejectionEvent
  if (error && error.reason) {
    const reason = error.reason;
    return {
      message: reason?.message || String(reason),
      stack: reason?.stack || null,
      ...extra
    };
  }

  return {
    message: String(error),
    stack: null,
    ...extra
  };
}

/**
 * Clear recent errors (e.g., on logout)
 */
export function clearRecentErrors() {
  recentErrors.length = 0;
  errorDebounce.clear();
}

export default {
  reportError,
  submitUserReport,
  collectBrowserContext,
  getRecentErrors,
  normalizeError,
  clearRecentErrors
};
