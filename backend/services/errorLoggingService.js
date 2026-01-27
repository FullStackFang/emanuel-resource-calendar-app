/**
 * Error Logging Service for Temple Emanuel Resource Calendar
 * Simplified version - Sentry handles automatic error capture
 * This module handles user-submitted reports only (stored in MongoDB)
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

// Database connection
let dbConnection = null;
let errorLogsCollection = null;

/**
 * Set database connection for error logging
 * @param {Object} db - MongoDB database connection
 */
function setDbConnection(db) {
  dbConnection = db;
  errorLogsCollection = db.collection('templeEvents__ErrorLogs');

  // Create indexes for efficient querying
  createIndexes();
}

/**
 * Create indexes for error logs collection
 */
async function createIndexes() {
  if (!errorLogsCollection) return;

  try {
    // Index for querying by type (user_report)
    await errorLogsCollection.createIndex(
      { type: 1, createdAt: -1 },
      { name: 'type_createdAt', background: true }
    );

    // Index for reviewed status filtering
    await errorLogsCollection.createIndex(
      { reviewed: 1, createdAt: -1 },
      { name: 'reviewed_createdAt', background: true }
    );

    // TTL index for automatic cleanup (90 days)
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
 * Generate a correlation ID for tracking
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId() {
  return `rpt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Sanitize sensitive data from context
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
 * Log a user-submitted report to MongoDB
 * @param {Object} reportData - User report data
 * @param {Object} userContext - User context
 * @returns {Promise<Object>} Logged report document
 */
async function logUserReport(reportData, userContext = {}) {
  if (!errorLogsCollection) {
    logger.warn('Error logging service not initialized - report not persisted');
    return null;
  }

  const correlationId = generateCorrelationId();
  const now = new Date();

  const reportDoc = {
    type: 'user_report',
    severity: 'medium',
    source: reportData.source || 'frontend',
    message: reportData.description || 'User reported an issue',
    userDescription: reportData.userDescription || reportData.description,
    userSelectedCategory: reportData.category || 'general',

    // User context (sanitized)
    userContext: userContext ? {
      userId: userContext.userId,
      email: userContext.email,
      name: userContext.name,
      isAdmin: userContext.isAdmin
    } : null,

    // Browser context
    browserContext: reportData.browserContext ? sanitizeData(reportData.browserContext) : null,

    // URL where issue was reported
    endpoint: reportData.currentUrl || null,

    // Tracking
    correlationId,

    // Admin workflow
    reviewed: false,
    resolution: null,
    notes: null,
    reviewedBy: null,
    reviewedAt: null,

    // Timestamps
    createdAt: now,
    updatedAt: now
  };

  try {
    const result = await errorLogsCollection.insertOne(reportDoc);
    reportDoc._id = result.insertedId;

    logger.debug('User report logged to database', { correlationId });
    return reportDoc;
  } catch (insertError) {
    logger.error('Failed to log user report to database:', insertError);
    return null;
  }
}

/**
 * Get user reports with filters and pagination
 * @param {Object} filters - Filter options
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} { errors: [], total: number }
 */
async function getErrors(filters = {}, pagination = {}) {
  if (!errorLogsCollection) {
    return { errors: [], total: 0 };
  }

  const { type, reviewed, startDate, endDate, search } = filters;
  const { page = 1, limit = 50, sortBy = 'createdAt', sortOrder = -1 } = pagination;

  // Default to showing only user_reports (Sentry handles automatic errors)
  const query = { type: type || 'user_report' };

  if (reviewed !== undefined) query.reviewed = reviewed;

  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  if (search) {
    query.$or = [
      { message: { $regex: search, $options: 'i' } },
      { userDescription: { $regex: search, $options: 'i' } },
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
 * Get report by ID
 * @param {string} reportId - Report document ID
 * @returns {Promise<Object|null>} Report document
 */
async function getErrorById(reportId) {
  if (!errorLogsCollection) return null;

  const { ObjectId } = require('mongodb');
  return errorLogsCollection.findOne({ _id: new ObjectId(reportId) });
}

/**
 * Update report review status
 * @param {string} reportId - Report document ID
 * @param {Object} reviewData - Review data (reviewed, resolution, notes)
 * @param {Object} reviewer - Reviewer info
 * @returns {Promise<Object>} Updated document
 */
async function updateErrorReview(reportId, reviewData, reviewer) {
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
    { _id: new ObjectId(reportId) },
    { $set: updateFields }
  );

  return getErrorById(reportId);
}

/**
 * Get user report statistics
 * @returns {Promise<Object>} Statistics
 */
async function getErrorStats() {
  if (!errorLogsCollection) {
    return {
      total: 0,
      unreviewedCount: 0,
      todayCount: 0
    };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Only count user_reports (Sentry handles automatic errors)
  const userReportQuery = { type: 'user_report' };

  const [total, unreviewedCount, todayCount] = await Promise.all([
    errorLogsCollection.countDocuments(userReportQuery),
    errorLogsCollection.countDocuments({ ...userReportQuery, reviewed: false }),
    errorLogsCollection.countDocuments({ ...userReportQuery, createdAt: { $gte: todayStart } })
  ]);

  return {
    total,
    unreviewedCount,
    todayCount,
    // These are kept for backward compatibility but now only reflect user reports
    bySeverity: { medium: total },
    byType: { user_report: total },
    bySource: { frontend: total }
  };
}

module.exports = {
  setDbConnection,
  generateCorrelationId,
  logUserReport,
  getErrors,
  getErrorById,
  updateErrorReview,
  getErrorStats,
  sanitizeData
};
