/**
 * Custom API Error Class
 *
 * Provides consistent error structure across the API.
 * All errors should use this class for standardized responses.
 *
 * Response format:
 * {
 *   error: string,        // Human-readable error message
 *   code: string,         // Machine-readable error code (e.g., 'VALIDATION_ERROR')
 *   details?: any,        // Optional additional details (field errors, etc.)
 *   requestId?: string    // Request ID for tracking (added by error handler)
 * }
 */

class ApiError extends Error {
  /**
   * Create an API error
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code (default: 500)
   * @param {string} code - Machine-readable error code (default: 'INTERNAL_ERROR')
   * @param {any} details - Optional additional details
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Distinguishes from programming errors

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert to JSON response format
   */
  toJSON() {
    const response = {
      error: this.message,
      code: this.code
    };

    if (this.details) {
      response.details = this.details;
    }

    return response;
  }

  // ============================================
  // Static factory methods for common errors
  // ============================================

  /**
   * 400 Bad Request - Invalid input
   */
  static badRequest(message = 'Bad request', details = null) {
    return new ApiError(message, 400, 'BAD_REQUEST', details);
  }

  /**
   * 400 Validation Error - Input validation failed
   */
  static validation(message = 'Validation failed', fieldErrors = null) {
    return new ApiError(message, 400, 'VALIDATION_ERROR', fieldErrors);
  }

  /**
   * 401 Unauthorized - Authentication required
   */
  static unauthorized(message = 'Authentication required') {
    return new ApiError(message, 401, 'UNAUTHORIZED');
  }

  /**
   * 403 Forbidden - Insufficient permissions
   */
  static forbidden(message = 'Access denied') {
    return new ApiError(message, 403, 'FORBIDDEN');
  }

  /**
   * 404 Not Found - Resource doesn't exist
   */
  static notFound(message = 'Resource not found', resource = null) {
    return new ApiError(message, 404, 'NOT_FOUND', resource ? { resource } : null);
  }

  /**
   * 409 Conflict - Resource conflict (e.g., duplicate)
   */
  static conflict(message = 'Resource conflict', details = null) {
    return new ApiError(message, 409, 'CONFLICT', details);
  }

  /**
   * 429 Too Many Requests - Rate limited
   */
  static tooManyRequests(message = 'Too many requests', retryAfter = null) {
    return new ApiError(message, 429, 'RATE_LIMITED', retryAfter ? { retryAfter } : null);
  }

  /**
   * 500 Internal Server Error - Unexpected error
   */
  static internal(message = 'Internal server error') {
    return new ApiError(message, 500, 'INTERNAL_ERROR');
  }

  /**
   * 503 Service Unavailable - Service temporarily unavailable
   */
  static serviceUnavailable(message = 'Service temporarily unavailable') {
    return new ApiError(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

module.exports = ApiError;
