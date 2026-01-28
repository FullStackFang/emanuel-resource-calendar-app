/**
 * Global Error Handler Middleware
 *
 * Catches all errors and returns consistent JSON responses.
 * Internal error details are logged but not exposed to clients.
 *
 * Response format:
 * {
 *   error: string,        // Human-readable error message
 *   code: string,         // Machine-readable error code
 *   details?: any,        // Optional additional details (only for client errors)
 *   requestId?: string    // Request ID for tracking
 * }
 */

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Error handler middleware - must be registered LAST in Express
 */
function errorHandler(err, req, res, next) {
  // If headers already sent, delegate to Express default handler
  if (res.headersSent) {
    return next(err);
  }

  // Get request ID for tracking
  const requestId = req.requestId || 'unknown';

  // Determine if this is an operational error (expected) or programming error (bug)
  const isOperational = err instanceof ApiError || err.isOperational;

  // Log the error
  if (isOperational) {
    // Operational errors - log at warn level
    logger.warn(`[${requestId}] ${err.code || 'ERROR'}: ${err.message}`, {
      statusCode: err.statusCode,
      path: req.path,
      method: req.method
    });
  } else {
    // Programming errors - log full stack at error level
    logger.error(`[${requestId}] Unexpected error:`, {
      message: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      body: req.body ? JSON.stringify(req.body).substring(0, 500) : undefined
    });
  }

  // Build response
  let statusCode = 500;
  let response = {
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId
  };

  if (err instanceof ApiError) {
    // Our custom ApiError - use its properties
    statusCode = err.statusCode;
    response = {
      ...err.toJSON(),
      requestId
    };
  } else if (err.name === 'ValidationError') {
    // Mongoose validation error
    statusCode = 400;
    response = {
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: Object.keys(err.errors || {}).reduce((acc, key) => {
        acc[key] = err.errors[key].message;
        return acc;
      }, {}),
      requestId
    };
  } else if (err.name === 'CastError') {
    // Mongoose cast error (e.g., invalid ObjectId)
    statusCode = 400;
    response = {
      error: 'Invalid ID format',
      code: 'INVALID_ID',
      requestId
    };
  } else if (err.name === 'MongoServerError' && err.code === 11000) {
    // MongoDB duplicate key error
    statusCode = 409;
    response = {
      error: 'Resource already exists',
      code: 'DUPLICATE_RESOURCE',
      requestId
    };
  } else if (err.type === 'entity.parse.failed') {
    // JSON parse error
    statusCode = 400;
    response = {
      error: 'Invalid JSON in request body',
      code: 'INVALID_JSON',
      requestId
    };
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    // Multer file size limit
    statusCode = 400;
    response = {
      error: 'File too large',
      code: 'FILE_TOO_LARGE',
      requestId
    };
  } else if (isOperational) {
    // Other operational errors with statusCode
    statusCode = err.statusCode || 500;
    response = {
      error: err.message,
      code: err.code || 'ERROR',
      requestId
    };
  }
  // For non-operational errors, we keep the generic 500 response
  // to avoid leaking internal details

  // Send response
  res.status(statusCode).json(response);
}

/**
 * 404 handler - for routes that don't exist
 * Register this BEFORE the error handler
 */
function notFoundHandler(req, res, next) {
  const error = ApiError.notFound(`Route not found: ${req.method} ${req.path}`);
  next(error);
}

/**
 * Async handler wrapper - catches async errors automatically
 * Use this to wrap async route handlers
 *
 * @example
 * app.get('/api/users', asyncHandler(async (req, res) => {
 *   const users = await User.find();
 *   res.json(users);
 * }));
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler
};
