/**
 * Error Reporting Service for Temple Emanuel Resource Calendar
 * Simplified version - Sentry handles automatic error capture
 * This module only handles user-submitted issue reports
 */

import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

/**
 * Submit a user issue report to the backend
 * User reports are stored in MongoDB for admin review
 * @param {Object} reportData - User report data
 * @param {string} apiToken - API authentication token
 * @returns {Promise<Object>} Report result
 */
export async function submitUserReport(reportData, apiToken) {
  if (!apiToken) {
    return { success: false, error: 'Not authenticated' };
  }

  const browserContext = {
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

  const payload = {
    description: reportData.description,
    category: reportData.category || 'general',
    browserContext,
    currentUrl: window.location.href
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
 * Used for normalizing errors before display or Sentry capture
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

export default {
  submitUserReport,
  normalizeError
};
