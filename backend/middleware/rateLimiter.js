/**
 * Rate Limiting Middleware
 *
 * Protects API endpoints from abuse and DDoS attacks.
 * Different limits are applied based on endpoint sensitivity.
 */

const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/**
 * Standard rate limiter for authenticated endpoints
 * 1000 requests per 15 minutes per IP
 */
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    error: 'Too many requests',
    message: 'You have exceeded the rate limit. Please try again later.',
    retryAfter: '15 minutes'
  },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json(options.message);
  },
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/health';
  }
});

/**
 * Strict rate limiter for public/unauthenticated endpoints
 * 100 requests per 15 minutes per IP
 */
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'You have exceeded the rate limit for public endpoints. Please try again later.',
    retryAfter: '15 minutes'
  },
  handler: (req, res, next, options) => {
    logger.warn(`Public rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json(options.message);
  }
});

/**
 * Very strict rate limiter for sensitive operations
 * 10 requests per 15 minutes per IP (e.g., token generation, password reset)
 */
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'You have exceeded the rate limit for this sensitive operation. Please try again later.',
    retryAfter: '15 minutes'
  },
  handler: (req, res, next, options) => {
    logger.warn(`Sensitive operation rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json(options.message);
  }
});

/**
 * Burst limiter for high-frequency endpoints (e.g., search, autocomplete)
 * 50 requests per minute per IP
 */
const burstLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // limit each IP to 50 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Too many requests in a short time. Please slow down.',
    retryAfter: '1 minute'
  },
  handler: (req, res, next, options) => {
    logger.warn(`Burst rate limit exceeded for IP: ${req.ip}, path: ${req.path}`);
    res.status(429).json(options.message);
  }
});

module.exports = {
  standardLimiter,
  publicLimiter,
  sensitiveLimiter,
  burstLimiter
};
