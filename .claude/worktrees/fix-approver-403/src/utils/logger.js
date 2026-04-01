// src/utils/logger.js
/**
 * Centralized logger utility for the frontend application
 * Automatically disables debug logs in production while keeping errors and warnings
 */

// Check if we're in development mode
const isDevelopment = import.meta.env.MODE === 'development';

// Allow override via environment variable
const DEBUG_ENABLED = import.meta.env.VITE_DEBUG === 'true' || isDevelopment;

// Logger object with environment-aware methods
export const logger = {
  /**
   * General purpose logging - disabled in production
   */
  log: (...args) => {
    if (DEBUG_ENABLED) {
      console.log(...args);
    }
  },

  /**
   * Error logging - always enabled
   */
  error: (...args) => {
    console.error(...args);
  },

  /**
   * Warning logging - always enabled
   */
  warn: (...args) => {
    console.warn(...args);
  },

  /**
   * Debug-specific logging with [DEBUG] prefix - disabled in production
   */
  debug: (...args) => {
    if (DEBUG_ENABLED) {
      console.log('[DEBUG]', ...args);
    }
  },

  /**
   * Info logging - disabled in production
   */
  info: (...args) => {
    if (DEBUG_ENABLED) {
      console.info(...args);
    }
  },

  /**
   * Grouped logging - disabled in production
   */
  group: (label) => {
    if (DEBUG_ENABLED) {
      console.group(label);
    }
  },

  /**
   * End grouped logging - disabled in production
   */
  groupEnd: () => {
    if (DEBUG_ENABLED) {
      console.groupEnd();
    }
  },

  /**
   * Table logging - disabled in production
   */
  table: (data) => {
    if (DEBUG_ENABLED) {
      console.table(data);
    }
  },

  /**
   * Time tracking start - disabled in production
   */
  time: (label) => {
    if (DEBUG_ENABLED) {
      console.time(label);
    }
  },

  /**
   * Time tracking end - disabled in production
   */
  timeEnd: (label) => {
    if (DEBUG_ENABLED) {
      console.timeEnd(label);
    }
  },

  /**
   * Check if debug mode is enabled
   */
  isDebugEnabled: () => DEBUG_ENABLED,

  /**
   * Get current environment
   */
  getEnvironment: () => import.meta.env.MODE
};

// Export individual functions for convenience
export const { log, error, warn, debug, info } = logger;

// Default export
export default logger;