/**
 * NotificationContext - Centralized notification system
 * Replaces browser alerts with non-blocking toasts and automatic error logging
 */

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import * as Sentry from '@sentry/react';
import { normalizeError } from '../services/errorReportingService';
import { logger } from '../utils/logger';

const NotificationContext = createContext(null);

// Store for critical error callback (outside component to allow registration before provider mounts)
let criticalErrorCallback = null;

// Notification severities and their configurations
const SEVERITY_CONFIG = {
  success: { duration: 3000, autoLog: false },
  info: { duration: 4000, autoLog: false },
  warning: { duration: 5000, autoLog: false },
  error: { duration: 5000, autoLog: false },
  critical: { duration: 8000, autoLog: true }
};

// Classify HTTP errors by status code
function classifyHttpError(status) {
  if (status >= 500) return 'critical';
  if (status === 0) return 'critical'; // Network error
  if (status === 401 || status === 403) return 'warning';
  if (status >= 400) return 'error';
  return 'error';
}

// Extract user-friendly message from error
function extractErrorMessage(error, userMessage) {
  if (userMessage) return userMessage;

  if (typeof error === 'string') return error;

  if (error?.response?.data?.message) {
    return error.response.data.message;
  }

  if (error?.message) {
    // Clean up common error messages
    const msg = error.message;
    if (msg.includes('Failed to fetch')) return 'Network error - please check your connection';
    if (msg.includes('NetworkError')) return 'Network error - please check your connection';
    if (msg.includes('timeout')) return 'Request timed out - please try again';
    return msg;
  }

  return 'An unexpected error occurred';
}

let notificationId = 0;

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);
  const timersRef = useRef(new Map());
  const criticalErrorCallbackRef = useRef(criticalErrorCallback);

  // Keep ref in sync with module-level callback
  useEffect(() => {
    criticalErrorCallbackRef.current = criticalErrorCallback;
  });

  // Function to register critical error callback
  const setCriticalErrorCallback = useCallback((callback) => {
    criticalErrorCallback = callback;
    criticalErrorCallbackRef.current = callback;
  }, []);

  // Remove a notification
  const removeNotification = useCallback((id) => {
    // Clear any existing timer
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  // Add a notification
  const addNotification = useCallback((notification) => {
    const id = ++notificationId;
    const config = SEVERITY_CONFIG[notification.severity] || SEVERITY_CONFIG.info;
    const duration = notification.duration ?? config.duration;

    const newNotification = {
      id,
      ...notification,
      timestamp: Date.now()
    };

    setNotifications(prev => {
      // Limit to 5 notifications max
      const limited = prev.length >= 5 ? prev.slice(1) : prev;
      return [...limited, newNotification];
    });

    // Set auto-dismiss timer if duration > 0
    if (duration > 0) {
      const timer = setTimeout(() => {
        removeNotification(id);
      }, duration);
      timersRef.current.set(id, timer);
    }

    return id;
  }, [removeNotification]);

  // Show a generic notification
  // Supports both (message, options) and (message, severity_string) signatures
  const showNotification = useCallback((message, optionsOrSeverity = {}) => {
    // Handle legacy (message, type_string) signature
    const options = typeof optionsOrSeverity === 'string'
      ? { severity: optionsOrSeverity }
      : optionsOrSeverity;

    const severity = options.severity || 'info';
    return addNotification({
      message,
      severity,
      ...options
    });
  }, [addNotification]);

  // Show success notification
  const showSuccess = useCallback((message, options = {}) => {
    return addNotification({
      message,
      severity: 'success',
      ...options
    });
  }, [addNotification]);

  // Show warning notification
  const showWarning = useCallback((message, options = {}) => {
    return addNotification({
      message,
      severity: 'warning',
      ...options
    });
  }, [addNotification]);

  // Show error notification with optional backend logging
  const showError = useCallback((error, options = {}) => {
    const {
      context = 'Unknown',
      userMessage,
      httpStatus,
      skipLog = false
    } = options;

    // Determine severity based on HTTP status or default to error
    let severity = options.severity || 'error';
    if (httpStatus) {
      severity = classifyHttpError(httpStatus);
    } else if (error?.status) {
      severity = classifyHttpError(error.status);
    } else if (error?.response?.status) {
      severity = classifyHttpError(error.response.status);
    }

    const message = extractErrorMessage(error, userMessage);
    const config = SEVERITY_CONFIG[severity];

    // Log to Sentry for critical/high severity errors (unless skipped)
    let eventId = null;
    if (config.autoLog && !skipLog) {
      // Capture with Sentry
      eventId = Sentry.captureException(
        error instanceof Error ? error : new Error(message),
        {
          extra: {
            context,
            severity,
            userMessage
          },
          tags: {
            errorType: 'handled_error',
            severity,
            context
          }
        }
      );

      logger.debug(`Error captured by Sentry [${context}]:`, eventId);

      // Trigger critical error callback with Sentry event ID
      if (severity === 'critical' && criticalErrorCallbackRef.current) {
        criticalErrorCallbackRef.current({
          message,
          context,
          severity,
          eventId,
          originalError: error
        });
      }
    } else if (severity === 'critical' && criticalErrorCallbackRef.current) {
      // Critical error but logging skipped - still trigger callback
      criticalErrorCallbackRef.current({
        message,
        context,
        severity,
        eventId: null,
        originalError: error
      });
    }

    // Always log to console for debugging
    logger.error(`[${context}]`, error);

    return addNotification({
      message,
      severity,
      context
    });
  }, [addNotification]);

  const value = {
    notifications,
    showNotification,
    showSuccess,
    showWarning,
    showError,
    removeNotification,
    setCriticalErrorCallback
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

// Custom hook to use notifications
export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
}

export default NotificationContext;
