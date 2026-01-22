/**
 * Error Logging Service for Temple Emanuel Resource Calendar
 * Provides centralized error logging to MongoDB with deduplication and notification support
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

// Database connection
let dbConnection = null;
let errorLogsCollection = null;
let systemSettingsCollection = null;

// Cache for error settings
let cachedSettings = null;
let settingsLastFetch = 0;
const SETTINGS_CACHE_TTL = 60000; // 1 minute

// In-memory tracking for notification cooldowns
const notificationCooldowns = new Map();

/**
 * Set database connection for error logging
 * @param {Object} db - MongoDB database connection
 */
function setDbConnection(db) {
  dbConnection = db;
  errorLogsCollection = db.collection('templeEvents__ErrorLogs');
  systemSettingsCollection = db.collection('templeEvents__SystemSettings');

  // Create indexes for efficient querying
  createIndexes();
}

/**
 * Create indexes for error logs collection
 */
async function createIndexes() {
  if (!errorLogsCollection) return;

  try {
    // Index for querying by type and severity
    await errorLogsCollection.createIndex(
      { type: 1, severity: 1, createdAt: -1 },
      { name: 'type_severity_createdAt', background: true }
    );

    // Index for fingerprint deduplication
    await errorLogsCollection.createIndex(
      { fingerprint: 1 },
      { name: 'fingerprint', background: true }
    );

    // Index for querying by source
    await errorLogsCollection.createIndex(
      { source: 1, createdAt: -1 },
      { name: 'source_createdAt', background: true }
    );

    // Index for reviewed status filtering
    await errorLogsCollection.createIndex(
      { reviewed: 1, createdAt: -1 },
      { name: 'reviewed_createdAt', background: true }
    );

    // TTL index for automatic cleanup based on retention
    // Default 90 days, can be changed via settings
    await errorLogsCollection.createIndex(
      { createdAt: 1 },
      { name: 'createdAt_ttl', expireAfterSeconds: 90 * 24 * 60 * 60, background: true }
    );

    logger.debug('Error logs indexes created successfully');
  } catch (error) {
    logger.warn('Error creating error logs indexes:', error.message);
  }
}

/**
 * Generate a correlation ID for tracking related errors
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId() {
  return `err-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a fingerprint for error deduplication
 * Based on error message, stack trace (first 3 lines), and source
 * @param {Object} errorData - Error data object
 * @returns {string} MD5 hash fingerprint
 */
function generateFingerprint(errorData) {
  const { message, stack, source, endpoint } = errorData;

  // Extract first 3 lines of stack trace for comparison
  const stackLines = (stack || '').split('\n').slice(0, 3).join('\n');

  const fingerprintSource = [
    message || '',
    stackLines,
    source || '',
    endpoint || ''
  ].join('|');

  return crypto.createHash('md5').update(fingerprintSource).digest('hex');
}

/**
 * Get error notification settings from database
 * @returns {Promise<Object>} Error settings
 */
async function getErrorSettings() {
  // Check cache first
  const now = Date.now();
  if (cachedSettings && (now - settingsLastFetch) < SETTINGS_CACHE_TTL) {
    return cachedSettings;
  }

  // Default settings
  const defaults = {
    notificationsEnabled: true,
    notifyOnSeverity: ['critical', 'high'],
    emailCooldownMinutes: 15,
    dailyEmailLimit: 50,
    retentionDays: 90
  };

  if (!systemSettingsCollection) {
    return defaults;
  }

  try {
    const settings = await systemSettingsCollection.findOne({ _id: 'error-settings' });
    cachedSettings = settings ? { ...defaults, ...settings } : defaults;
    settingsLastFetch = now;
    return cachedSettings;
  } catch (error) {
    logger.warn('Could not fetch error settings:', error.message);
    return defaults;
  }
}

/**
 * Clear settings cache (call after updating settings)
 */
function clearSettingsCache() {
  cachedSettings = null;
  settingsLastFetch = 0;
}

/**
 * Sanitize sensitive data from error context
 * @param {Object} data - Data to sanitize
 * @returns {Object} Sanitized data
 */
function sanitizeData(data) {
  if (!data) return data;

  const sensitiveKeys = [
    'password', 'token', 'secret', 'apikey', 'api_key', 'apiKey',
    'authorization', 'auth', 'credential', 'private', 'key',
    'accessToken', 'access_token', 'refreshToken', 'refresh_token',
    'x-graph-token', 'bearer'
  ];

  const sanitized = { ...data };

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(s => lowerKey.includes(s))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      sanitized[key] = sanitizeData(sanitized[key]);
    }
  }

  return sanitized;
}

/**
 * Determine error severity based on status code and error type
 * @param {number} statusCode - HTTP status code
 * @param {string} errorType - Type of error
 * @returns {string} Severity level
 */
function determineSeverity(statusCode, errorType) {
  if (statusCode >= 500 || errorType === 'unhandledRejection' || errorType === 'uncaughtException') {
    return 'critical';
  }
  if (statusCode === 403 || statusCode === 401) {
    return 'medium';
  }
  if (statusCode >= 400 && statusCode < 500) {
    return 'low';
  }
  return 'high';
}

/**
 * Check if admin should be notified for this error
 * @param {Object} errorDoc - Error document
 * @param {Object} settings - Error settings
 * @returns {boolean} Whether to notify
 */
async function shouldNotifyAdmin(errorDoc, settings) {
  if (!settings.notificationsEnabled) {
    return false;
  }

  // Check if severity is in the notify list
  if (!settings.notifyOnSeverity.includes(errorDoc.severity)) {
    return false;
  }

  // Check cooldown - don't spam for the same error
  const cooldownKey = errorDoc.fingerprint;
  const lastNotified = notificationCooldowns.get(cooldownKey);
  const cooldownMs = settings.emailCooldownMinutes * 60 * 1000;

  if (lastNotified && (Date.now() - lastNotified) < cooldownMs) {
    return false;
  }

  // Check daily email limit
  if (errorLogsCollection) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayCount = await errorLogsCollection.countDocuments({
      notificationSent: true,
      createdAt: { $gte: todayStart }
    });

    if (todayCount >= settings.dailyEmailLimit) {
      logger.warn('Daily error notification limit reached');
      return false;
    }
  }

  return true;
}

/**
 * Log an error to the database
 * @param {Object} errorData - Error data
 * @param {Object} context - Additional context (request, user, browser info)
 * @returns {Promise<Object>} Logged error document
 */
async function logError(errorData, context = {}) {
  if (!errorLogsCollection) {
    logger.warn('Error logging service not initialized - error not persisted');
    logger.error('Error details:', errorData);
    return null;
  }

  const correlationId = context.correlationId || generateCorrelationId();
  const fingerprint = generateFingerprint(errorData);
  const now = new Date();

  // Check for existing error with same fingerprint (deduplication)
  const existingError = await errorLogsCollection.findOne({ fingerprint });

  if (existingError) {
    // Increment occurrence count instead of creating duplicate
    await errorLogsCollection.updateOne(
      { _id: existingError._id },
      {
        $inc: { occurrenceCount: 1 },
        $set: { lastOccurredAt: now },
        $push: {
          occurrences: {
            $each: [{
              timestamp: now,
              requestId: context.requestId,
              userContext: context.userContext
            }],
            $slice: -10 // Keep only last 10 occurrences
          }
        }
      }
    );

    logger.debug('Error occurrence logged (deduplicated)', {
      fingerprint,
      correlationId: existingError.correlationId,
      occurrenceCount: existingError.occurrenceCount + 1
    });

    return { ...existingError, occurrenceCount: existingError.occurrenceCount + 1, deduplicated: true };
  }

  // Create new error document
  const errorDoc = {
    type: errorData.type || 'error',
    severity: errorData.severity || determineSeverity(errorData.statusCode, errorData.errorType),
    source: errorData.source || 'backend',
    message: errorData.message || 'Unknown error',
    stack: errorData.stack || null,
    endpoint: errorData.endpoint || null,
    statusCode: errorData.statusCode || null,
    requestId: context.requestId || null,
    correlationId,
    fingerprint,

    // User context (sanitized)
    userContext: context.userContext ? {
      userId: context.userContext.userId,
      email: context.userContext.email,
      name: context.userContext.name,
      isAdmin: context.userContext.isAdmin
    } : null,

    // Browser context (for frontend errors)
    browserContext: context.browserContext ? sanitizeData(context.browserContext) : null,

    // Request context (sanitized)
    requestContext: context.requestContext ? {
      method: context.requestContext.method,
      path: context.requestContext.path,
      query: sanitizeData(context.requestContext.query),
      body: sanitizeData(context.requestContext.body)
    } : null,

    // Additional error info
    errorType: errorData.errorType || null,
    componentStack: errorData.componentStack || null,

    // Admin workflow
    notificationSent: false,
    reviewed: false,
    resolution: null,
    notes: null,
    reviewedBy: null,
    reviewedAt: null,

    // Deduplication tracking
    occurrenceCount: 1,
    occurrences: [{
      timestamp: now,
      requestId: context.requestId,
      userContext: context.userContext
    }],
    lastOccurredAt: now,

    // Timestamps
    createdAt: now,
    updatedAt: now
  };

  try {
    const result = await errorLogsCollection.insertOne(errorDoc);
    errorDoc._id = result.insertedId;

    logger.debug('Error logged to database', {
      correlationId,
      fingerprint,
      severity: errorDoc.severity
    });

    return errorDoc;
  } catch (insertError) {
    logger.error('Failed to log error to database:', insertError);
    return null;
  }
}

/**
 * Log a user-submitted report
 * @param {Object} reportData - User report data
 * @param {Object} userContext - User context
 * @returns {Promise<Object>} Logged report document
 */
async function logUserReport(reportData, userContext = {}) {
  const errorDoc = await logError({
    type: 'user_report',
    severity: 'medium',
    source: reportData.source || 'frontend',
    message: reportData.description || 'User reported an issue',
    errorType: 'user_report',
    endpoint: reportData.currentUrl || null,
    stack: reportData.recentErrors || null
  }, {
    userContext,
    browserContext: reportData.browserContext,
    correlationId: reportData.correlationId
  });

  // Add user's description as a note
  if (errorDoc && reportData.userDescription) {
    await errorLogsCollection.updateOne(
      { _id: errorDoc._id },
      {
        $set: {
          userDescription: reportData.userDescription,
          userSelectedCategory: reportData.category,
          updatedAt: new Date()
        }
      }
    );
  }

  return errorDoc;
}

/**
 * Mark an error's notification as sent
 * @param {string} errorId - Error document ID
 */
async function markNotificationSent(errorId, fingerprint) {
  if (!errorLogsCollection) return;

  await errorLogsCollection.updateOne(
    { _id: errorId },
    { $set: { notificationSent: true, notificationSentAt: new Date() } }
  );

  // Update cooldown
  if (fingerprint) {
    notificationCooldowns.set(fingerprint, Date.now());
  }
}

/**
 * Get errors with filters and pagination
 * @param {Object} filters - Filter options
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} { errors: [], total: number }
 */
async function getErrors(filters = {}, pagination = {}) {
  if (!errorLogsCollection) {
    return { errors: [], total: 0 };
  }

  const { type, severity, source, reviewed, startDate, endDate, search } = filters;
  const { page = 1, limit = 50, sortBy = 'createdAt', sortOrder = -1 } = pagination;

  const query = {};

  if (type) query.type = type;
  if (severity) query.severity = Array.isArray(severity) ? { $in: severity } : severity;
  if (source) query.source = source;
  if (reviewed !== undefined) query.reviewed = reviewed;

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  if (search) {
    query.$or = [
      { message: { $regex: search, $options: 'i' } },
      { correlationId: { $regex: search, $options: 'i' } },
      { 'userContext.email': { $regex: search, $options: 'i' } }
    ];
  }

  const [errors, total] = await Promise.all([
    errorLogsCollection
      .find(query)
      .sort({ [sortBy]: sortOrder })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    errorLogsCollection.countDocuments(query)
  ]);

  return { errors, total };
}

/**
 * Get error by ID
 * @param {string} errorId - Error document ID
 * @returns {Promise<Object|null>} Error document
 */
async function getErrorById(errorId) {
  if (!errorLogsCollection) return null;

  const { ObjectId } = require('mongodb');
  return errorLogsCollection.findOne({ _id: new ObjectId(errorId) });
}

/**
 * Update error review status
 * @param {string} errorId - Error document ID
 * @param {Object} reviewData - Review data (reviewed, resolution, notes)
 * @param {Object} reviewer - Reviewer info
 * @returns {Promise<Object>} Updated document
 */
async function updateErrorReview(errorId, reviewData, reviewer) {
  if (!errorLogsCollection) return null;

  const { ObjectId } = require('mongodb');
  const updateFields = {
    reviewed: reviewData.reviewed !== undefined ? reviewData.reviewed : true,
    updatedAt: new Date()
  };

  if (reviewData.resolution) updateFields.resolution = reviewData.resolution;
  if (reviewData.notes) updateFields.notes = reviewData.notes;
  if (reviewer) {
    updateFields.reviewedBy = {
      userId: reviewer.userId,
      email: reviewer.email,
      name: reviewer.name
    };
    updateFields.reviewedAt = new Date();
  }

  await errorLogsCollection.updateOne(
    { _id: new ObjectId(errorId) },
    { $set: updateFields }
  );

  return getErrorById(errorId);
}

/**
 * Get error statistics
 * @returns {Promise<Object>} Error statistics
 */
async function getErrorStats() {
  if (!errorLogsCollection) {
    return {
      total: 0,
      bySeverity: {},
      byType: {},
      bySource: {},
      unreviewedCount: 0,
      todayCount: 0
    };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    total,
    bySeverity,
    byType,
    bySource,
    unreviewedCount,
    todayCount
  ] = await Promise.all([
    errorLogsCollection.countDocuments({}),
    errorLogsCollection.aggregate([
      { $group: { _id: '$severity', count: { $sum: 1 } } }
    ]).toArray(),
    errorLogsCollection.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]).toArray(),
    errorLogsCollection.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } }
    ]).toArray(),
    errorLogsCollection.countDocuments({ reviewed: false }),
    errorLogsCollection.countDocuments({ createdAt: { $gte: todayStart } })
  ]);

  return {
    total,
    bySeverity: Object.fromEntries(bySeverity.map(s => [s._id, s.count])),
    byType: Object.fromEntries(byType.map(t => [t._id, t.count])),
    bySource: Object.fromEntries(bySource.map(s => [s._id, s.count])),
    unreviewedCount,
    todayCount
  };
}

/**
 * Update error settings
 * @param {Object} settings - New settings
 * @returns {Promise<Object>} Updated settings
 */
async function updateErrorSettings(settings) {
  if (!systemSettingsCollection) return null;

  const updateDoc = {
    ...settings,
    updatedAt: new Date()
  };

  await systemSettingsCollection.updateOne(
    { _id: 'error-settings' },
    { $set: updateDoc },
    { upsert: true }
  );

  clearSettingsCache();
  return getErrorSettings();
}

module.exports = {
  setDbConnection,
  generateCorrelationId,
  generateFingerprint,
  logError,
  logUserReport,
  getErrors,
  getErrorById,
  updateErrorReview,
  getErrorStats,
  getErrorSettings,
  updateErrorSettings,
  clearSettingsCache,
  shouldNotifyAdmin,
  markNotificationSent,
  sanitizeData,
  determineSeverity
};
