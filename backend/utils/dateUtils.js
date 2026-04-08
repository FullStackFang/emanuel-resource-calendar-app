/**
 * Date utility functions for datetime string manipulation.
 */

/**
 * Extract the date portion (YYYY-MM-DD) from an ISO datetime string.
 * Handles trailing Z, milliseconds, and missing values.
 *
 * @param {string|null|undefined} dateTimeStr - ISO datetime string (e.g., "2026-03-15T14:30:00Z")
 * @returns {string|null} Date portion (e.g., "2026-03-15") or null if input is falsy
 */
function extractDatePart(dateTimeStr) {
  if (!dateTimeStr) return null;
  return dateTimeStr.replace(/Z$/, '').split('T')[0] || null;
}

module.exports = { extractDatePart };
