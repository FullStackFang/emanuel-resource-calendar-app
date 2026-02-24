/**
 * Email Service for Temple Emanuel Resource Calendar
 * Uses Microsoft Graph API to send emails via shared mailbox
 */

const msal = require('@azure/msal-node');
const logger = require('../utils/logger');
const emailTemplates = require('./emailTemplates');

// Environment configuration (defaults - can be overridden by database settings)
const ENV_EMAIL_ENABLED = process.env.EMAIL_ENABLED === 'true';
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'templeEventsSandbox@emanuelnyc.org';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Temple Emanuel Reservations';
const ENV_EMAIL_REDIRECT_TO = process.env.EMAIL_REDIRECT_TO || null; // For testing - redirect all emails

// Use same fallbacks as api-server.js for consistency
const APP_ID = process.env.APP_ID || 'c2187009-796d-4fea-b58c-f83f7a89589e';
const TENANT_ID = process.env.TENANT_ID || 'fcc71126-2b16-4653-b639-0f1ef8332302';

// Cached database settings (refreshed on demand)
let cachedDbSettings = null;
let dbSettingsLastFetch = 0;
const DB_SETTINGS_CACHE_TTL = 30000; // 30 seconds

/**
 * Set database connection for fetching settings
 * Called from api-server.js after DB connection is established
 */
let dbConnection = null;
function setDbConnection(db) {
  dbConnection = db;
}

/**
 * Get email settings (DB overrides ENV)
 * @returns {Promise<{enabled: boolean, redirectTo: string|null}>}
 */
async function getEffectiveSettings() {
  // Check cache first
  const now = Date.now();
  if (cachedDbSettings && (now - dbSettingsLastFetch) < DB_SETTINGS_CACHE_TTL) {
    return cachedDbSettings;
  }

  // Try to fetch from database
  if (dbConnection) {
    try {
      const settings = await dbConnection.collection('templeEvents__SystemSettings')
        .findOne({ _id: 'email-settings' });

      if (settings) {
        cachedDbSettings = {
          enabled: settings.enabled !== undefined ? settings.enabled : ENV_EMAIL_ENABLED,
          redirectTo: settings.redirectTo !== undefined ? settings.redirectTo : ENV_EMAIL_REDIRECT_TO,
          ccTo: settings.ccTo || null
        };
        dbSettingsLastFetch = now;
        return cachedDbSettings;
      }
    } catch (error) {
      logger.warn('Could not fetch email settings from DB, using env vars:', error.message);
    }
  }

  // Fallback to environment variables
  return {
    enabled: ENV_EMAIL_ENABLED,
    redirectTo: ENV_EMAIL_REDIRECT_TO,
    ccTo: null
  };
}

/**
 * Clear the settings cache (call after updating settings)
 */
function clearSettingsCache() {
  cachedDbSettings = null;
  dbSettingsLastFetch = 0;
  logger.debug('Email settings cache cleared');
}

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// MSAL Configuration for Client Credentials Flow
let cca = null;

/**
 * Initialize MSAL client (lazy initialization)
 */
function getMsalClient() {
  if (!cca) {
    const msalConfig = {
      auth: {
        clientId: APP_ID,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        clientSecret: process.env.EMAIL_CLIENT_SECRET
      }
    };
    cca = new msal.ConfidentialClientApplication(msalConfig);
  }
  return cca;
}

/**
 * Validate email address format
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid
 */
function validateEmail(email) {
  return EMAIL_REGEX.test(email);
}

/**
 * Generate correlation ID for tracking
 * @returns {string} Unique correlation ID
 */
function generateCorrelationId() {
  return `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Acquire access token using client credentials flow
 * @returns {Promise<string>} Access token
 */
async function getAppAccessToken() {
  const client = getMsalClient();
  const result = await client.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default']
  });
  return result.accessToken;
}

/**
 * Send email via Microsoft Graph API
 * @param {string|string[]} to - Recipient email(s)
 * @param {string} subject - Email subject
 * @param {string} htmlBody - HTML email body
 * @param {Object} options - Optional settings
 * @param {string[]} options.cc - CC recipients
 * @param {string} options.reservationId - For logging/tracking
 * @returns {Promise<Object>} Result with success status and correlationId
 */
async function sendEmail(to, subject, htmlBody, options = {}) {
  const { cc = [], reservationId = null } = options;
  const correlationId = generateCorrelationId();

  // Get effective settings (DB overrides ENV)
  const settings = await getEffectiveSettings();
  const emailEnabled = settings.enabled;
  const emailRedirectTo = settings.redirectTo;
  const globalCcTo = settings.ccTo;

  // Normalize recipients to array
  const recipients = Array.isArray(to) ? to : [to];

  // Validate email addresses
  const validRecipients = recipients.filter(validateEmail);
  if (validRecipients.length === 0) {
    logger.error('No valid email recipients', { correlationId, recipients });
    throw new Error('No valid email recipients');
  }

  // Log invalid recipients if any were filtered
  const invalidRecipients = recipients.filter(r => !validateEmail(r));
  if (invalidRecipients.length > 0) {
    logger.warn('Filtered invalid email recipients', { correlationId, invalidRecipients });
  }

  // Redirect for testing if configured
  const actualRecipients = emailRedirectTo
    ? [emailRedirectTo]
    : validRecipients;

  // Check if email is disabled
  if (!emailEnabled) {
    logger.info('Email disabled - would have sent:', {
      correlationId,
      to: actualRecipients,
      subject,
      reservationId,
      fromAddress: EMAIL_FROM_ADDRESS
    });
    return { success: true, skipped: true, correlationId };
  }

  // Check for required config
  if (!process.env.EMAIL_CLIENT_SECRET) {
    logger.error('EMAIL_CLIENT_SECRET not configured', { correlationId });
    throw new Error('Email service not configured: missing EMAIL_CLIENT_SECRET');
  }

  logger.info('Sending email', {
    correlationId,
    to: actualRecipients,
    subject,
    reservationId,
    fromAddress: EMAIL_FROM_ADDRESS,
    redirected: !!emailRedirectTo
  });

  try {
    const token = await getAppAccessToken();

    const message = {
      message: {
        subject: emailRedirectTo
          ? `[TEST - Redirected] ${subject}`
          : subject,
        body: {
          contentType: 'HTML',
          content: htmlBody
        },
        toRecipients: actualRecipients.map(addr => ({
          emailAddress: { address: addr }
        })),
        ccRecipients: [...cc, ...(globalCcTo && !emailRedirectTo ? [globalCcTo] : [])]
          .filter((addr, i, arr) => validateEmail(addr) && arr.indexOf(addr) === i)
          .map(addr => ({
            emailAddress: { address: addr }
          })),
        from: {
          emailAddress: {
            address: EMAIL_FROM_ADDRESS,
            name: EMAIL_FROM_NAME
          }
        }
      },
      saveToSentItems: false
    };

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${EMAIL_FROM_ADDRESS}/sendMail`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(message)
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Graph API email error', {
        correlationId,
        status: response.status,
        error: errorText,
        fromAddress: EMAIL_FROM_ADDRESS
      });
      throw new Error(`Graph API error: ${response.status} - ${errorText}`);
    }

    logger.info('Email sent successfully', { correlationId, reservationId });
    return { success: true, correlationId };

  } catch (error) {
    logger.error('Email send failed', {
      correlationId,
      error: error.message,
      reservationId
    });
    throw error;
  }
}

/**
 * Get current email service configuration (for admin display)
 * Returns ENV defaults - DB overrides are merged in the API endpoint
 * @returns {Object} Configuration status
 */
function getEmailConfig() {
  return {
    enabled: ENV_EMAIL_ENABLED,
    fromAddress: EMAIL_FROM_ADDRESS,
    fromName: EMAIL_FROM_NAME,
    redirectTo: ENV_EMAIL_REDIRECT_TO,
    hasClientSecret: !!process.env.EMAIL_CLIENT_SECRET,
    hasAppId: !!APP_ID,
    hasTenantId: !!TENANT_ID
  };
}

// =============================================================================
// NOTIFICATION HELPER FUNCTIONS
// =============================================================================

/**
 * Get admin email addresses from database
 * @param {Object} db - MongoDB database connection
 * @returns {Promise<string[]>} Array of admin email addresses
 */
async function getAdminEmails(db) {
  try {
    const usersCollection = db.collection('templeEvents__Users');
    const admins = await usersCollection.find({ isAdmin: true }).toArray();
    const emails = admins
      .map(admin => admin.email || admin.userId)
      .filter(email => validateEmail(email));

    logger.debug('Found admin emails', { count: emails.length });
    return emails;
  } catch (error) {
    logger.error('Error fetching admin emails:', error);
    return [];
  }
}

/**
 * Send submission confirmation to requester
 * @param {Object} reservation - Reservation data
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendSubmissionConfirmation(reservation) {
  const reqData = reservation.roomReservationData || {};
  const requestedBy = reqData.requestedBy || {};
  const recipientEmail = requestedBy.email || reservation.requesterEmail || reservation.contactEmail;

  if (!recipientEmail) {
    logger.warn('No requester email for submission confirmation', {
      reservationId: reservation._id
    });
    return { success: false, error: 'No recipient email' };
  }

  const { subject, html } = await emailTemplates.generateSubmissionConfirmation(reservation);

  return sendEmail(recipientEmail, subject, html, {
    reservationId: reservation._id?.toString()
  });
}

/**
 * Send new request alert to all admins (single email, multiple recipients)
 * @param {Object} reservation - Reservation data
 * @param {string[]} adminEmails - Array of admin email addresses
 * @param {string} adminPanelUrl - Optional URL to admin review panel
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendAdminNewRequestAlert(reservation, adminEmails, adminPanelUrl = '') {
  if (!adminEmails || adminEmails.length === 0) {
    logger.warn('No admin emails for new request alert', {
      reservationId: reservation._id
    });
    return { success: false, error: 'No admin recipients' };
  }

  const { subject, html } = await emailTemplates.generateAdminNewRequestAlert(reservation, adminPanelUrl);

  // Send single email to all admins (not multiple emails)
  return sendEmail(adminEmails, subject, html, {
    reservationId: reservation._id?.toString()
  });
}

/**
 * Send publish notification to requester
 * @param {Object} reservation - Reservation data
 * @param {string} adminNotes - Optional notes from admin
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendPublishNotification(reservation, adminNotes = '', reviewChanges = []) {
  const reqData = reservation.roomReservationData || {};
  const requestedBy = reqData.requestedBy || {};
  const recipientEmail = requestedBy.email || reservation.requesterEmail || reservation.contactEmail;

  if (!recipientEmail) {
    logger.warn('No requester email for publish notification', {
      reservationId: reservation._id
    });
    return { success: false, error: 'No recipient email' };
  }

  const { subject, html } = await emailTemplates.generateApprovalNotification(reservation, adminNotes, reviewChanges);

  return sendEmail(recipientEmail, subject, html, {
    reservationId: reservation._id?.toString()
  });
}

/**
 * Send rejection notification to requester
 * @param {Object} reservation - Reservation data
 * @param {string} rejectionReason - Reason for rejection
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendRejectionNotification(reservation, rejectionReason = '') {
  const reqData = reservation.roomReservationData || {};
  const requestedBy = reqData.requestedBy || {};
  const recipientEmail = requestedBy.email || reservation.requesterEmail || reservation.contactEmail;

  if (!recipientEmail) {
    logger.warn('No requester email for rejection notification', {
      reservationId: reservation._id
    });
    return { success: false, error: 'No recipient email' };
  }

  const { subject, html } = await emailTemplates.generateRejectionNotification(reservation, rejectionReason);

  return sendEmail(recipientEmail, subject, html, {
    reservationId: reservation._id?.toString()
  });
}

/**
 * Send resubmission confirmation to requester
 * @param {Object} reservation - Reservation data
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendResubmissionConfirmation(reservation) {
  const reqData = reservation.roomReservationData || {};
  const requestedBy = reqData.requestedBy || {};
  const recipientEmail = requestedBy.email || reservation.requesterEmail || reservation.contactEmail;

  if (!recipientEmail) {
    logger.warn('No requester email for resubmission confirmation', {
      reservationId: reservation._id
    });
    return { success: false, error: 'No recipient email' };
  }

  const { subject, html } = await emailTemplates.generateResubmissionConfirmation(reservation);

  return sendEmail(recipientEmail, subject, html, {
    reservationId: reservation._id?.toString()
  });
}

/**
 * Send event updated notification to requester
 * Sent when an admin directly edits a published event's key fields
 * @param {Object} reservation - Reservation data
 * @param {Array} reviewChanges - Formatted changes from formatChangesForEmail()
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendEventUpdatedNotification(reservation, reviewChanges = []) {
  const reqData = reservation.roomReservationData || {};
  const requestedBy = reqData.requestedBy || {};
  const recipientEmail = requestedBy.email || reservation.requesterEmail || reservation.contactEmail;

  if (!recipientEmail) {
    logger.warn('No requester email for event updated notification', {
      reservationId: reservation._id
    });
    return { success: false, error: 'No recipient email' };
  }

  const { subject, html } = await emailTemplates.generateEventUpdatedNotification(reservation, reviewChanges);

  return sendEmail(recipientEmail, subject, html, {
    reservationId: reservation._id?.toString()
  });
}

/**
 * Send review started notification to requester (optional)
 * @param {Object} reservation - Reservation data
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendReviewStartedNotification(reservation) {
  const reqData = reservation.roomReservationData || {};
  const requestedBy = reqData.requestedBy || {};
  const recipientEmail = requestedBy.email || reservation.requesterEmail || reservation.contactEmail;

  if (!recipientEmail) {
    logger.warn('No requester email for review started notification', {
      reservationId: reservation._id
    });
    return { success: false, error: 'No recipient email' };
  }

  const { subject, html } = await emailTemplates.generateReviewStartedNotification(reservation);

  return sendEmail(recipientEmail, subject, html, {
    reservationId: reservation._id?.toString()
  });
}

// =============================================================================
// EDIT REQUEST EMAIL FUNCTIONS
// =============================================================================

/**
 * Send edit request submitted confirmation to requester
 * @param {Object} editRequest - Edit request data
 * @param {string} changeReason - Reason for the edit request
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendEditRequestSubmittedConfirmation(editRequest, changeReason = '') {
  const reqData = editRequest.roomReservationData || {};
  const requestedBy = reqData.requestedBy || {};
  const recipientEmail = requestedBy.email || editRequest.requesterEmail;

  if (!recipientEmail) {
    logger.warn('No requester email for edit request confirmation', {
      editRequestId: editRequest._id
    });
    return { success: false, error: 'No recipient email' };
  }

  const { subject, html } = await emailTemplates.generateEditRequestSubmittedConfirmation(editRequest, changeReason);

  return sendEmail(recipientEmail, subject, html, {
    editRequestId: editRequest._id?.toString()
  });
}

/**
 * Send edit request alert to admins
 * @param {Object} editRequest - Edit request data
 * @param {string} changeReason - Reason for the edit request
 * @param {string} adminPanelUrl - Optional URL to admin panel
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendAdminEditRequestAlert(editRequest, changeReason = '', adminPanelUrl = '') {
  const adminEmails = await getAdminEmails();

  if (adminEmails.length === 0) {
    logger.warn('No admin emails configured for edit request alert', {
      editRequestId: editRequest._id
    });
    return { success: false, error: 'No admin emails configured' };
  }

  const { subject, html } = await emailTemplates.generateAdminEditRequestAlert(editRequest, changeReason, adminPanelUrl);

  return sendEmail(adminEmails, subject, html, {
    editRequestId: editRequest._id?.toString()
  });
}

/**
 * Send edit request approved notification to requester
 * @param {Object} editRequest - Edit request data
 * @param {string} adminNotes - Optional notes from admin
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendEditRequestApprovedNotification(editRequest, adminNotes = '', reviewChanges = []) {
  const reqData = editRequest.roomReservationData || {};
  const requestedBy = reqData.requestedBy || {};
  const recipientEmail = requestedBy.email || editRequest.requesterEmail;

  if (!recipientEmail) {
    logger.warn('No requester email for edit request approval notification', {
      editRequestId: editRequest._id
    });
    return { success: false, error: 'No recipient email' };
  }

  const { subject, html } = await emailTemplates.generateEditRequestApprovedNotification(editRequest, adminNotes, reviewChanges);

  return sendEmail(recipientEmail, subject, html, {
    editRequestId: editRequest._id?.toString()
  });
}

/**
 * Send edit request rejected notification to requester
 * @param {Object} editRequest - Edit request data
 * @param {string} rejectionReason - Reason for rejection
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendEditRequestRejectedNotification(editRequest, rejectionReason = '') {
  const reqData = editRequest.roomReservationData || {};
  const requestedBy = reqData.requestedBy || {};
  const recipientEmail = requestedBy.email || editRequest.requesterEmail;

  if (!recipientEmail) {
    logger.warn('No requester email for edit request rejection notification', {
      editRequestId: editRequest._id
    });
    return { success: false, error: 'No recipient email' };
  }

  const { subject, html } = await emailTemplates.generateEditRequestRejectedNotification(editRequest, rejectionReason);

  return sendEmail(recipientEmail, subject, html, {
    editRequestId: editRequest._id?.toString()
  });
}

// =============================================================================
// ERROR NOTIFICATION EMAIL FUNCTIONS
// =============================================================================

/**
 * Send error notification email to admins
 * @param {Object} errorDoc - Error document from errorLoggingService
 * @param {Object} db - MongoDB database connection
 * @param {string} adminPanelUrl - Optional URL to admin error panel
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendErrorNotification(errorDoc, db, adminPanelUrl = '') {
  // Get admin emails
  const adminEmails = await getAdminEmails(db);

  if (!adminEmails || adminEmails.length === 0) {
    logger.warn('No admin emails configured for error notification', {
      correlationId: errorDoc.correlationId
    });
    return { success: false, error: 'No admin recipients' };
  }

  try {
    const { subject, html } = await emailTemplates.generateErrorNotification(errorDoc, adminPanelUrl);

    return sendEmail(adminEmails, subject, html, {
      correlationId: errorDoc.correlationId
    });
  } catch (error) {
    logger.error('Failed to send error notification:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Send acknowledgment email to user who submitted an issue report
 * @param {Object} reportDoc - User report document
 * @param {Object} userContext - User context with email
 * @returns {Promise<Object>} Send result with correlationId
 */
async function sendUserReportAcknowledgment(reportDoc, userContext = {}) {
  const recipientEmail = userContext.email;

  if (!recipientEmail || !validateEmail(recipientEmail)) {
    logger.warn('No valid email for user report acknowledgment', {
      correlationId: reportDoc.correlationId
    });
    return { success: false, error: 'No recipient email' };
  }

  try {
    const { subject, html } = await emailTemplates.generateUserReportAcknowledgment(reportDoc, userContext);

    return sendEmail(recipientEmail, subject, html, {
      correlationId: reportDoc.correlationId
    });
  } catch (error) {
    logger.error('Failed to send user report acknowledgment:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Record email send in communication history
 * @param {Object} collection - MongoDB collection
 * @param {string} reservationId - Reservation ID
 * @param {Object} emailResult - Result from sendEmail
 * @param {string} emailType - Type of email sent
 * @param {string[]} recipients - Email recipients
 * @param {string} subject - Email subject
 */
async function recordEmailInHistory(collection, reservationId, emailResult, emailType, recipients, subject) {
  try {
    await collection.updateOne(
      { _id: reservationId },
      {
        $push: {
          'roomReservationData.communicationHistory': {
            timestamp: new Date(),
            type: emailResult.success ? 'email_sent' : 'email_failed',
            correlationId: emailResult.correlationId,
            emailType: emailType,
            subject: subject,
            recipients: recipients,
            success: emailResult.success,
            skipped: emailResult.skipped || false,
            error: emailResult.error || null
          }
        }
      }
    );
    logger.debug('Recorded email in communication history', {
      reservationId,
      emailType,
      correlationId: emailResult.correlationId
    });
  } catch (error) {
    logger.error('Failed to record email in history:', error);
    // Don't throw - this is a secondary operation
  }
}

module.exports = {
  // Core functions
  sendEmail,
  validateEmail,
  generateCorrelationId,
  getAppAccessToken,
  getEmailConfig,

  // Database settings management
  setDbConnection,
  clearSettingsCache,
  getEffectiveSettings,

  // Notification helpers
  getAdminEmails,
  sendSubmissionConfirmation,
  sendAdminNewRequestAlert,
  sendPublishNotification,
  sendRejectionNotification,
  sendResubmissionConfirmation,
  sendReviewStartedNotification,
  sendEventUpdatedNotification,
  recordEmailInHistory,

  // Edit request notification helpers
  sendEditRequestSubmittedConfirmation,
  sendAdminEditRequestAlert,
  sendEditRequestApprovedNotification,
  sendEditRequestRejectedNotification,

  // Error notification helpers
  sendErrorNotification,
  sendUserReportAcknowledgment
};
