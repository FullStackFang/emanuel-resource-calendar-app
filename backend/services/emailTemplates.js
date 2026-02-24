/**
 * Email Templates for Temple Emanuel Resource Calendar
 * Provides HTML templates and rendering utilities for notification emails
 * Supports database overrides for customization via admin UI
 */

const escapeHtml = require('escape-html');
const logger = require('../utils/logger');

// Database connection for fetching template overrides
let dbConnection = null;

/**
 * Set database connection for fetching template overrides
 * @param {Object} db - MongoDB database connection
 */
function setDbConnection(db) {
  dbConnection = db;
}

/**
 * Template IDs for all email templates
 */
const TEMPLATE_IDS = {
  SUBMISSION_CONFIRMATION: 'submission-confirmation',
  ADMIN_NEW_REQUEST: 'admin-new-request',
  APPROVAL: 'approval',
  REJECTION: 'rejection',
  RESUBMISSION: 'resubmission',
  REVIEW_STARTED: 'review-started',
  // Edit Request templates
  EDIT_REQUEST_SUBMITTED: 'edit-request-submitted',
  ADMIN_EDIT_REQUEST_ALERT: 'admin-edit-request-alert',
  EDIT_REQUEST_APPROVED: 'edit-request-approved',
  EDIT_REQUEST_REJECTED: 'edit-request-rejected',
  // Event update notification
  EVENT_UPDATED: 'event-updated',
  // Error notification templates
  ERROR_NOTIFICATION: 'error-notification',
  USER_REPORT_ACKNOWLEDGMENT: 'user-report-acknowledgment'
};

/**
 * Default templates - used when no database override exists
 * These contain the subject and body with {{variable}} placeholders
 */
const DEFAULT_TEMPLATES = {
  [TEMPLATE_IDS.SUBMISSION_CONFIRMATION]: {
    id: TEMPLATE_IDS.SUBMISSION_CONFIRMATION,
    name: 'Submission Confirmation',
    description: 'Sent to requester when they submit a reservation request',
    subject: 'Reservation Request Received: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #2d3748;">Reservation Request Received</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Dear {{requesterName}},
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Thank you for submitting your reservation request. We have received your request and it is now pending review by our team.
</p>

<div style="background-color: #f7fafc; border-left: 4px solid #4299e1; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Event Details</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Event:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{eventTitle}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Date/Time:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{startTime}} - {{endTime}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Location(s):</td>
      <td style="padding: 8px 0; color: #2d3748;">{{locations}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Attendees:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{attendeeCount}}</td>
    </tr>
  </table>
</div>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  <strong>What happens next?</strong><br>
  Our team will review your request and you will receive another email once it has been approved or if we need additional information.
</p>

<p style="color: #718096; font-size: 14px; margin-top: 30px;">
  If you have any questions, please contact our office.
</p>`,
    variables: ['eventTitle', 'requesterName', 'startTime', 'endTime', 'locations', 'attendeeCount']
  },

  [TEMPLATE_IDS.ADMIN_NEW_REQUEST]: {
    id: TEMPLATE_IDS.ADMIN_NEW_REQUEST,
    name: 'Admin New Request Alert',
    description: 'Sent to admins when a new reservation request is submitted',
    subject: '[ACTION REQUIRED] New Reservation: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #c53030;">
  <span style="background-color: #fed7d7; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px;">ACTION REQUIRED</span>
  New Reservation Request
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  A new reservation request has been submitted and requires your review.
</p>

<div style="background-color: #fffaf0; border-left: 4px solid #ed8936; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Request Summary</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Event:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{eventTitle}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Requester:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{requesterName}} ({{requesterEmail}})</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Date/Time:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{startTime}} - {{endTime}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Location(s):</td>
      <td style="padding: 8px 0; color: #2d3748;">{{locations}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Attendees:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{attendeeCount}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Submitted:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{submittedAt}}</td>
    </tr>
  </table>
</div>

{{#adminPanelUrl}}
<p style="text-align: center; margin: 30px 0;">
  <a href="{{adminPanelUrl}}" style="display: inline-block; background-color: #4299e1; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600;">
    Review Request
  </a>
</p>
{{/adminPanelUrl}}

<p style="color: #718096; font-size: 14px;">
  Please review this request at your earliest convenience.
</p>`,
    variables: ['eventTitle', 'requesterName', 'requesterEmail', 'startTime', 'endTime', 'locations', 'attendeeCount', 'submittedAt', 'adminPanelUrl']
  },

  [TEMPLATE_IDS.APPROVAL]: {
    id: TEMPLATE_IDS.APPROVAL,
    name: 'Approval Notification',
    description: 'Sent to requester when their reservation is approved',
    subject: 'Reservation Published: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #276749;">
  <span style="background-color: #c6f6d5; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px;">PUBLISHED</span>
  Your Reservation Has Been Published
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Dear {{requesterName}},
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Great news! Your reservation request has been published. The event has been added to the calendar.
</p>

<div style="background-color: #f0fff4; border-left: 4px solid #48bb78; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Confirmed Event Details</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Event:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{eventTitle}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Date/Time:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{startTime}} - {{endTime}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Location(s):</td>
      <td style="padding: 8px 0; color: #2d3748;">{{locations}}</td>
    </tr>
  </table>
</div>

{{#reviewChanges}}
<div style="background-color: #fffaf0; border-left: 4px solid #ed8936; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Changes Made During Review:</h4>
  <p style="margin: 0 0 10px 0; color: #4a5568; font-size: 14px; font-style: italic;">
    The reviewer made the following adjustments to your request. The details above reflect the final confirmed values.
  </p>
  {{changesTable}}
</div>
{{/reviewChanges}}

{{#adminNotes}}
<div style="background-color: #f7fafc; border-left: 4px solid #718096; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Notes from Admin:</h4>
  <p style="margin: 0; color: #4a5568;">{{adminNotes}}</p>
</div>
{{/adminNotes}}

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  If you need to make any changes to your reservation, please contact our office.
</p>

<p style="color: #718096; font-size: 14px; margin-top: 30px;">
  Thank you for using Temple Emanuel's reservation system.
</p>`,
    variables: ['eventTitle', 'requesterName', 'startTime', 'endTime', 'locations', 'adminNotes', 'reviewChanges', 'changesTable']
  },

  [TEMPLATE_IDS.REJECTION]: {
    id: TEMPLATE_IDS.REJECTION,
    name: 'Rejection Notification',
    description: 'Sent to requester when their reservation is not approved',
    subject: 'Reservation Update: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #c53030;">
  <span style="background-color: #fed7d7; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px;">NOT APPROVED</span>
  Reservation Request Update
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Dear {{requesterName}},
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  We regret to inform you that your reservation request could not be approved at this time.
</p>

<div style="background-color: #fff5f5; border-left: 4px solid #fc8181; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Request Details</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Event:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{eventTitle}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Date/Time:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{startTime}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Location(s):</td>
      <td style="padding: 8px 0; color: #2d3748;">{{locations}}</td>
    </tr>
  </table>
</div>

{{#rejectionReason}}
<div style="background-color: #f7fafc; border-left: 4px solid #718096; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Reason:</h4>
  <p style="margin: 0; color: #4a5568;">{{rejectionReason}}</p>
</div>
{{/rejectionReason}}

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  <strong>What can you do?</strong><br>
  If you would like to discuss this decision or submit a revised request, please contact our office. We're happy to help you find an alternative that works.
</p>

<p style="color: #718096; font-size: 14px; margin-top: 30px;">
  Thank you for your understanding.
</p>`,
    variables: ['eventTitle', 'requesterName', 'startTime', 'locations', 'rejectionReason']
  },

  [TEMPLATE_IDS.RESUBMISSION]: {
    id: TEMPLATE_IDS.RESUBMISSION,
    name: 'Resubmission Confirmation',
    description: 'Sent to requester when they resubmit a revised request',
    subject: 'Revised Request Received: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #2b6cb0;">
  <span style="background-color: #bee3f8; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px;">RESUBMITTED</span>
  Revised Request Received
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Dear {{requesterName}},
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  We have received your revised reservation request. It has been placed back in the review queue.
</p>

<div style="background-color: #ebf8ff; border-left: 4px solid #4299e1; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Updated Event Details</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Event:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{eventTitle}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Date/Time:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{startTime}} - {{endTime}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Location(s):</td>
      <td style="padding: 8px 0; color: #2d3748;">{{locations}}</td>
    </tr>
  </table>
</div>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Our team will review the updated information and you will receive another email with our decision.
</p>

<p style="color: #718096; font-size: 14px; margin-top: 30px;">
  Thank you for your patience.
</p>`,
    variables: ['eventTitle', 'requesterName', 'startTime', 'endTime', 'locations']
  },

  [TEMPLATE_IDS.REVIEW_STARTED]: {
    id: TEMPLATE_IDS.REVIEW_STARTED,
    name: 'Review Started',
    description: 'Optional notification when admin begins reviewing a request',
    subject: 'Request Under Review: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #2b6cb0;">Your Request Is Being Reviewed</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Dear {{requesterName}},
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Good news! Your reservation request for <strong>{{eventTitle}}</strong> is currently being reviewed by our team.
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  You will receive another email shortly with the final decision.
</p>

<p style="color: #718096; font-size: 14px; margin-top: 30px;">
  Thank you for your patience.
</p>`,
    variables: ['eventTitle', 'requesterName']
  },

  // =========================================================================
  // EDIT REQUEST TEMPLATES
  // =========================================================================

  [TEMPLATE_IDS.EDIT_REQUEST_SUBMITTED]: {
    id: TEMPLATE_IDS.EDIT_REQUEST_SUBMITTED,
    name: 'Edit Request Submitted',
    description: 'Sent to requester when they submit an edit request for an existing event',
    subject: 'Edit Request Received: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #2b6cb0;">
  <span style="background-color: #bee3f8; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px;">EDIT REQUEST</span>
  Edit Request Received
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Dear {{requesterName}},
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Your request to edit the event <strong>{{eventTitle}}</strong> has been received and is now pending review.
</p>

<div style="background-color: #ebf8ff; border-left: 4px solid #4299e1; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Requested Changes</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Event:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{eventTitle}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">New Date/Time:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{startTime}} - {{endTime}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Location(s):</td>
      <td style="padding: 8px 0; color: #2d3748;">{{locations}}</td>
    </tr>
  </table>
</div>

{{#changeReason}}
<div style="background-color: #f7fafc; border-left: 4px solid #718096; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Your Reason for Changes:</h4>
  <p style="margin: 0; color: #4a5568;">{{changeReason}}</p>
</div>
{{/changeReason}}

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  <strong>What happens next?</strong><br>
  Our team will review your edit request. The original event will remain unchanged until your request is approved.
</p>

<p style="color: #718096; font-size: 14px; margin-top: 30px;">
  If you have any questions, please contact our office.
</p>`,
    variables: ['eventTitle', 'requesterName', 'startTime', 'endTime', 'locations', 'changeReason']
  },

  [TEMPLATE_IDS.ADMIN_EDIT_REQUEST_ALERT]: {
    id: TEMPLATE_IDS.ADMIN_EDIT_REQUEST_ALERT,
    name: 'Admin Edit Request Alert',
    description: 'Sent to admins when an edit request is submitted',
    subject: '[ACTION REQUIRED] Edit Request: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #c53030;">
  <span style="background-color: #fed7d7; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px;">ACTION REQUIRED</span>
  Edit Request Received
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  An edit request has been submitted for an existing published event and requires your review.
</p>

<div style="background-color: #fffaf0; border-left: 4px solid #ed8936; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Edit Request Summary</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Event:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{eventTitle}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Requester:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{requesterName}} ({{requesterEmail}})</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">New Date/Time:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{startTime}} - {{endTime}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Location(s):</td>
      <td style="padding: 8px 0; color: #2d3748;">{{locations}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Submitted:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{submittedAt}}</td>
    </tr>
  </table>
</div>

{{#changeReason}}
<div style="background-color: #f7fafc; border-left: 4px solid #718096; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Reason for Changes:</h4>
  <p style="margin: 0; color: #4a5568;">{{changeReason}}</p>
</div>
{{/changeReason}}

{{#adminPanelUrl}}
<p style="text-align: center; margin: 30px 0;">
  <a href="{{adminPanelUrl}}" style="display: inline-block; background-color: #4299e1; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600;">
    Review Edit Request
  </a>
</p>
{{/adminPanelUrl}}

<p style="color: #718096; font-size: 14px;">
  Please review this edit request at your earliest convenience.
</p>`,
    variables: ['eventTitle', 'requesterName', 'requesterEmail', 'startTime', 'endTime', 'locations', 'submittedAt', 'changeReason', 'adminPanelUrl']
  },

  [TEMPLATE_IDS.EDIT_REQUEST_APPROVED]: {
    id: TEMPLATE_IDS.EDIT_REQUEST_APPROVED,
    name: 'Edit Request Approved',
    description: 'Sent to requester when their edit request is approved',
    subject: 'Edit Request Approved: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #276749;">
  <span style="background-color: #c6f6d5; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px;">APPROVED</span>
  Your Edit Request Has Been Approved
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Dear {{requesterName}},
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Great news! Your request to edit the event <strong>{{eventTitle}}</strong> has been approved. The changes have been applied to the calendar.
</p>

<div style="background-color: #f0fff4; border-left: 4px solid #48bb78; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Updated Event Details</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Event:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{eventTitle}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Date/Time:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{startTime}} - {{endTime}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Location(s):</td>
      <td style="padding: 8px 0; color: #2d3748;">{{locations}}</td>
    </tr>
  </table>
</div>

{{#reviewChanges}}
<div style="background-color: #fffaf0; border-left: 4px solid #ed8936; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Changes Applied:</h4>
  <p style="margin: 0 0 10px 0; color: #4a5568; font-size: 14px; font-style: italic;">
    The following changes were made to your event. The details above reflect the final values.
  </p>
  {{changesTable}}
</div>
{{/reviewChanges}}

{{#adminNotes}}
<div style="background-color: #f7fafc; border-left: 4px solid #718096; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Notes from Admin:</h4>
  <p style="margin: 0; color: #4a5568;">{{adminNotes}}</p>
</div>
{{/adminNotes}}

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  If you need to make any further changes, please submit a new edit request.
</p>

<p style="color: #718096; font-size: 14px; margin-top: 30px;">
  Thank you for using Temple Emanuel's reservation system.
</p>`,
    variables: ['eventTitle', 'requesterName', 'startTime', 'endTime', 'locations', 'adminNotes', 'reviewChanges', 'changesTable']
  },

  [TEMPLATE_IDS.EDIT_REQUEST_REJECTED]: {
    id: TEMPLATE_IDS.EDIT_REQUEST_REJECTED,
    name: 'Edit Request Rejected',
    description: 'Sent to requester when their edit request is not approved',
    subject: 'Edit Request Update: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #c53030;">
  <span style="background-color: #fed7d7; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px;">NOT APPROVED</span>
  Edit Request Update
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Dear {{requesterName}},
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  We regret to inform you that your request to edit the event <strong>{{eventTitle}}</strong> could not be approved at this time. The original event remains unchanged.
</p>

<div style="background-color: #fff5f5; border-left: 4px solid #fc8181; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Edit Request Details</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Event:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{eventTitle}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Requested Date/Time:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{startTime}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Location(s):</td>
      <td style="padding: 8px 0; color: #2d3748;">{{locations}}</td>
    </tr>
  </table>
</div>

{{#rejectionReason}}
<div style="background-color: #f7fafc; border-left: 4px solid #718096; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Reason:</h4>
  <p style="margin: 0; color: #4a5568;">{{rejectionReason}}</p>
</div>
{{/rejectionReason}}

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  <strong>What can you do?</strong><br>
  If you would like to discuss this decision or submit a revised edit request, please contact our office.
</p>

<p style="color: #718096; font-size: 14px; margin-top: 30px;">
  Thank you for your understanding.
</p>`,
    variables: ['eventTitle', 'requesterName', 'startTime', 'locations', 'rejectionReason']
  },

  // =========================================================================
  // EVENT UPDATE NOTIFICATION TEMPLATE
  // =========================================================================

  [TEMPLATE_IDS.EVENT_UPDATED]: {
    id: TEMPLATE_IDS.EVENT_UPDATED,
    name: 'Event Updated Notification',
    description: 'Sent to requester when an admin directly edits their published event',
    subject: 'Event Updated: {{eventTitle}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #2b6cb0;">
  <span style="background-color: #bee3f8; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px;">UPDATED</span>
  Your Event Has Been Updated
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Dear {{requesterName}},
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  An administrator has updated the following details for your event. Please review the changes below.
</p>

<div style="background-color: #ebf8ff; border-left: 4px solid #4299e1; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Updated Event Details</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Event:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{eventTitle}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Date/Time:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{startTime}} - {{endTime}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Location(s):</td>
      <td style="padding: 8px 0; color: #2d3748;">{{locations}}</td>
    </tr>
  </table>
</div>

{{#reviewChanges}}
<div style="background-color: #ebf8ff; border-left: 4px solid #4299e1; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Changes Made:</h4>
  {{changesTable}}
</div>
{{/reviewChanges}}

{{#adminNotes}}
<div style="background-color: #f7fafc; border-left: 4px solid #718096; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Notes from Admin:</h4>
  <p style="margin: 0; color: #4a5568;">{{adminNotes}}</p>
</div>
{{/adminNotes}}

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  If you have any questions about these changes, please contact our office.
</p>

<p style="color: #718096; font-size: 14px; margin-top: 30px;">
  Thank you for using Temple Emanuel's reservation system.
</p>`,
    variables: ['eventTitle', 'requesterName', 'startTime', 'endTime', 'locations', 'adminNotes', 'reviewChanges', 'changesTable']
  },

  // =========================================================================
  // ERROR NOTIFICATION TEMPLATES
  // =========================================================================

  [TEMPLATE_IDS.ERROR_NOTIFICATION]: {
    id: TEMPLATE_IDS.ERROR_NOTIFICATION,
    name: 'Error Notification',
    description: 'Sent to admins when a critical error occurs',
    subject: '[{{severity}}] System Error: {{message}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #c53030;">
  <span style="background-color: #fed7d7; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px; text-transform: uppercase;">{{severity}}</span>
  System Error Detected
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  An error has been detected in the Temple Emanuel Resource Calendar application that requires your attention.
</p>

<div style="background-color: #fff5f5; border-left: 4px solid #fc8181; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Error Details</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Severity:</td>
      <td style="padding: 8px 0; color: #c53030; font-weight: 600; text-transform: uppercase;">{{severity}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Source:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{source}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Message:</td>
      <td style="padding: 8px 0; color: #2d3748; font-weight: 600;">{{message}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Timestamp:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{timestamp}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Correlation ID:</td>
      <td style="padding: 8px 0; color: #2d3748; font-family: monospace;">{{correlationId}}</td>
    </tr>
  </table>
</div>

{{#endpoint}}
<div style="background-color: #f7fafc; border-left: 4px solid #718096; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Request Info</h4>
  <p style="margin: 0; color: #4a5568; font-family: monospace;">{{endpoint}}</p>
</div>
{{/endpoint}}

{{#userEmail}}
<div style="background-color: #ebf8ff; border-left: 4px solid #4299e1; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">User Context</h4>
  <p style="margin: 0; color: #4a5568;">User: {{userEmail}}</p>
</div>
{{/userEmail}}

{{#stack}}
<div style="background-color: #f7fafc; padding: 15px 20px; margin: 20px 0; border-radius: 4px;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Stack Trace</h4>
  <pre style="margin: 0; color: #4a5568; font-size: 12px; font-family: monospace; white-space: pre-wrap; word-wrap: break-word; overflow-x: auto;">{{stack}}</pre>
</div>
{{/stack}}

{{#adminPanelUrl}}
<p style="text-align: center; margin: 30px 0;">
  <a href="{{adminPanelUrl}}" style="display: inline-block; background-color: #c53030; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600;">
    View Error Details
  </a>
</p>
{{/adminPanelUrl}}

<p style="color: #718096; font-size: 14px;">
  This error has been logged and can be reviewed in the admin dashboard.
</p>`,
    variables: ['severity', 'source', 'message', 'timestamp', 'correlationId', 'endpoint', 'userEmail', 'stack', 'adminPanelUrl']
  },

  [TEMPLATE_IDS.USER_REPORT_ACKNOWLEDGMENT]: {
    id: TEMPLATE_IDS.USER_REPORT_ACKNOWLEDGMENT,
    name: 'User Report Acknowledgment',
    description: 'Sent to user when they submit an issue report',
    subject: 'Issue Report Received - {{correlationId}}',
    body: `<h2 style="margin: 0 0 20px 0; color: #2b6cb0;">
  <span style="background-color: #bee3f8; padding: 4px 12px; border-radius: 4px; font-size: 14px; margin-right: 10px;">RECEIVED</span>
  Your Issue Report Has Been Received
</h2>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Dear {{userName}},
</p>

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  Thank you for reporting an issue with the Temple Emanuel Resource Calendar. Your feedback helps us improve the application.
</p>

<div style="background-color: #ebf8ff; border-left: 4px solid #4299e1; padding: 15px 20px; margin: 20px 0;">
  <h3 style="margin: 0 0 15px 0; color: #2d3748; font-size: 18px;">Report Summary</h3>
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 8px 0; color: #718096; width: 120px;">Reference:</td>
      <td style="padding: 8px 0; color: #2d3748; font-family: monospace;">{{correlationId}}</td>
    </tr>
    <tr>
      <td style="padding: 8px 0; color: #718096;">Submitted:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{timestamp}}</td>
    </tr>
    {{#category}}
    <tr>
      <td style="padding: 8px 0; color: #718096;">Category:</td>
      <td style="padding: 8px 0; color: #2d3748;">{{category}}</td>
    </tr>
    {{/category}}
  </table>
</div>

{{#userDescription}}
<div style="background-color: #f7fafc; border-left: 4px solid #718096; padding: 15px 20px; margin: 20px 0;">
  <h4 style="margin: 0 0 10px 0; color: #2d3748;">Your Description:</h4>
  <p style="margin: 0; color: #4a5568;">{{userDescription}}</p>
</div>
{{/userDescription}}

<p style="color: #4a5568; font-size: 16px; line-height: 1.6;">
  <strong>What happens next?</strong><br>
  Our technical team has been notified and will review your report. If we need additional information, we will contact you.
</p>

<p style="color: #718096; font-size: 14px; margin-top: 30px;">
  Please keep your reference number (<strong>{{correlationId}}</strong>) for future correspondence about this issue.
</p>`,
    variables: ['userName', 'correlationId', 'timestamp', 'category', 'userDescription']
  }
};

/**
 * Format datetime for email display
 */
function formatDateTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  });
}

/**
 * Format date only (no time)
 */
function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Format time only
 */
function formatTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });
}

/**
 * Get template override from database
 * @param {string} templateId - Template ID
 * @returns {Promise<Object|null>} Template override or null
 */
async function getTemplateOverride(templateId) {
  if (!dbConnection) return null;

  try {
    const override = await dbConnection.collection('templeEvents__SystemSettings')
      .findOne({ _id: `email-template-${templateId}` });
    return override;
  } catch (error) {
    logger.warn('Could not fetch template override:', error.message);
    return null;
  }
}

/**
 * Get all templates (defaults merged with any database overrides)
 * @returns {Promise<Object[]>} Array of all templates
 */
async function getAllTemplates() {
  const templates = [];

  for (const [id, defaultTemplate] of Object.entries(DEFAULT_TEMPLATES)) {
    const override = await getTemplateOverride(id);
    templates.push({
      ...defaultTemplate,
      subject: override?.subject || defaultTemplate.subject,
      body: override?.body || defaultTemplate.body,
      isCustomized: !!override,
      updatedAt: override?.updatedAt,
      updatedBy: override?.updatedBy
    });
  }

  return templates;
}

/**
 * Get a single template by ID
 * @param {string} templateId - Template ID
 * @returns {Promise<Object|null>} Template or null
 */
async function getTemplate(templateId) {
  const defaultTemplate = DEFAULT_TEMPLATES[templateId];
  if (!defaultTemplate) return null;

  const override = await getTemplateOverride(templateId);
  return {
    ...defaultTemplate,
    subject: override?.subject || defaultTemplate.subject,
    body: override?.body || defaultTemplate.body,
    isCustomized: !!override,
    updatedAt: override?.updatedAt,
    updatedBy: override?.updatedBy
  };
}

/**
 * Get default templates (for display/reset)
 * @returns {Object} All default templates
 */
function getDefaultTemplates() {
  return DEFAULT_TEMPLATES;
}

/**
 * Replace template variables with actual values
 * Supports {{variable}} and {{#variable}}...{{/variable}} for conditionals
 * @param {string} template - Template string with {{variables}}
 * @param {Object} variables - Key-value pairs of variable replacements
 * @returns {string} Rendered template
 */
/**
 * Decode HTML entities back to plain text (for email subjects)
 */
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/');
}

function renderTemplate(template, variables) {
  let result = template;

  // Handle conditional blocks: {{#variable}}content{{/variable}}
  // Only show content if variable is truthy
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, varName, content) => {
    const value = variables[varName];
    if (value && value !== '') {
      // Replace variables inside the conditional block too
      return content.replace(/\{\{(\w+)\}\}/g, (m, v) => {
        return variables[v] !== undefined ? variables[v] : m;
      });
    }
    return '';
  });

  // Handle regular variables: {{variable}}
  result = result.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    const value = variables[varName];
    return value !== undefined ? value : match;
  });

  return result;
}

/**
 * Common email wrapper/layout
 */
function wrapEmailTemplate(content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Temple Emanuel Notification</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color: #1a365d; padding: 20px 30px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px;">Temple Emanuel</h1>
              <p style="margin: 5px 0 0 0; color: #a0aec0; font-size: 14px;">Resource Calendar Notification</p>
            </td>
          </tr>
          <!-- Content -->
          <tr>
            <td style="padding: 30px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f7fafc; padding: 20px 30px; border-radius: 0 0 8px 8px; border-top: 1px solid #e2e8f0;">
              <p style="margin: 0; color: #718096; font-size: 12px; text-align: center;">
                This is an automated message from the Temple Emanuel Resource Calendar system.<br>
                Please do not reply directly to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Extract variables from reservation data
 *
 * Data source priority (post-cleanup architecture):
 * - Requester info: roomReservationData.requestedBy (single canonical source)
 * - Event fields: top-level fields (eventTitle, startDateTime, etc.) which mirror calendarData
 * - Fallback: calendarData for events that haven't been fully migrated
 * - graphData is NOT used (only exists for published events, not authoritative for display)
 *
 * The reservationForEmail objects built at each endpoint already extract
 * the right fields, so this function primarily handles direct-from-DB objects.
 */
function extractVariables(reservation, extras = {}) {
  const reqData = reservation.roomReservationData || {};
  const cd = reservation.calendarData || {};
  const requestedBy = reqData.requestedBy || {};

  // Event title: top-level > calendarData
  const eventTitle = reservation.eventTitle || cd.eventTitle || 'Untitled Event';

  // Requester info: requestedBy is the single canonical source
  const requesterName = requestedBy.name || reservation.requesterName || 'Guest';
  const requesterEmail = requestedBy.email || reservation.requesterEmail || '';

  // Date/time: top-level > calendarData
  const startDateTime = reservation.startDateTime || reservation.startTime || cd.startDateTime;
  const endDateTime = reservation.endDateTime || reservation.endTime || cd.endDateTime;

  // Locations: top-level locationDisplayNames > calendarData
  let locationsStr = 'TBD';
  const displayNames = reservation.locationDisplayNames ?? cd.locationDisplayNames;
  if (displayNames != null && displayNames !== '') {
    const resolved = Array.isArray(displayNames) ? displayNames.join(', ') : String(displayNames);
    if (resolved) locationsStr = resolved;
  }

  // Attendee count: top-level > calendarData (use != null to allow 0)
  const rawAttendeeCount = reservation.attendeeCount ?? cd.attendeeCount;
  const attendeeCount = (rawAttendeeCount != null && rawAttendeeCount !== 0) ? rawAttendeeCount : 'Not specified';

  // Created/submitted date
  const createdAt = reservation.createdAt || reqData.createdAt || new Date();

  return {
    eventTitle: escapeHtml(eventTitle),
    requesterName: escapeHtml(requesterName),
    requesterEmail: escapeHtml(requesterEmail),
    startTime: formatDateTime(startDateTime),
    endTime: formatTime(endDateTime),
    locations: escapeHtml(locationsStr),
    attendeeCount: String(attendeeCount),
    submittedAt: formatDateTime(createdAt),
    ...extras
  };
}

/**
 * Generate email from template
 * @param {string} templateId - Template ID
 * @param {Object} variables - Variables to replace in template
 * @returns {Promise<Object>} { subject, html }
 */
async function generateFromTemplate(templateId, variables) {
  const template = await getTemplate(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  // Subject is plain text — decode HTML entities so "Rodney&#39;s" becomes "Rodney's"
  const subject = decodeHtmlEntities(renderTemplate(template.subject, variables));
  const body = renderTemplate(template.body, variables);

  return {
    subject,
    html: wrapEmailTemplate(body)
  };
}

// =============================================================================
// BACKWARD-COMPATIBLE GENERATOR FUNCTIONS
// =============================================================================

/**
 * Generate submission confirmation email
 */
async function generateSubmissionConfirmation(reservation) {
  const variables = extractVariables(reservation);
  return generateFromTemplate(TEMPLATE_IDS.SUBMISSION_CONFIRMATION, variables);
}

/**
 * Generate admin new request alert email
 */
async function generateAdminNewRequestAlert(reservation, adminPanelUrl = '') {
  const variables = extractVariables(reservation, {
    adminPanelUrl: adminPanelUrl ? escapeHtml(adminPanelUrl) : ''
  });
  return generateFromTemplate(TEMPLATE_IDS.ADMIN_NEW_REQUEST, variables);
}

/**
 * Generate approval notification email
 * @param {Object} reservation - Reservation data
 * @param {string} adminNotes - Optional notes from admin
 * @param {Array} reviewChanges - Optional array of {displayName, oldValue, newValue} from changeDetection
 */
async function generateApprovalNotification(reservation, adminNotes = '', reviewChanges = []) {
  const extras = {
    adminNotes: adminNotes ? escapeHtml(adminNotes) : ''
  };

  // Build review changes HTML table if there are changes
  if (reviewChanges && reviewChanges.length > 0) {
    extras.reviewChanges = 'true'; // Truthy string to enable conditional block
    extras.changesTable = buildChangesTableHtml(reviewChanges);
  }

  const variables = extractVariables(reservation, extras);
  return generateFromTemplate(TEMPLATE_IDS.APPROVAL, variables);
}

/**
 * Generate rejection notification email
 */
async function generateRejectionNotification(reservation, rejectionReason = '') {
  const variables = extractVariables(reservation, {
    rejectionReason: rejectionReason ? escapeHtml(rejectionReason) : ''
  });
  return generateFromTemplate(TEMPLATE_IDS.REJECTION, variables);
}

/**
 * Generate resubmission confirmation email
 */
async function generateResubmissionConfirmation(reservation) {
  const variables = extractVariables(reservation);
  return generateFromTemplate(TEMPLATE_IDS.RESUBMISSION, variables);
}

/**
 * Generate review started notification
 */
async function generateReviewStartedNotification(reservation) {
  const variables = extractVariables(reservation);
  return generateFromTemplate(TEMPLATE_IDS.REVIEW_STARTED, variables);
}

/**
 * Generate event updated notification email
 * Sent to requester when an admin directly edits a published event
 */
async function generateEventUpdatedNotification(reservation, reviewChanges = []) {
  const extras = {};

  // Build review changes HTML table if there are changes
  if (reviewChanges && reviewChanges.length > 0) {
    extras.reviewChanges = 'true'; // Truthy string to enable conditional block
    extras.changesTable = buildChangesTableHtml(reviewChanges);
  }

  const variables = extractVariables(reservation, extras);
  return generateFromTemplate(TEMPLATE_IDS.EVENT_UPDATED, variables);
}

// =============================================================================
// EDIT REQUEST GENERATOR FUNCTIONS
// =============================================================================

/**
 * Generate edit request submitted confirmation email
 */
async function generateEditRequestSubmittedConfirmation(editRequest, changeReason = '') {
  const variables = extractVariables(editRequest, {
    changeReason: changeReason ? escapeHtml(changeReason) : ''
  });
  return generateFromTemplate(TEMPLATE_IDS.EDIT_REQUEST_SUBMITTED, variables);
}

/**
 * Generate admin edit request alert email
 */
async function generateAdminEditRequestAlert(editRequest, changeReason = '', adminPanelUrl = '') {
  const variables = extractVariables(editRequest, {
    changeReason: changeReason ? escapeHtml(changeReason) : '',
    adminPanelUrl: adminPanelUrl ? escapeHtml(adminPanelUrl) : ''
  });
  return generateFromTemplate(TEMPLATE_IDS.ADMIN_EDIT_REQUEST_ALERT, variables);
}

/**
 * Generate edit request approved notification email
 */
async function generateEditRequestApprovedNotification(editRequest, adminNotes = '', reviewChanges = []) {
  const extras = {
    adminNotes: adminNotes ? escapeHtml(adminNotes) : ''
  };

  // Build review changes HTML table if there are changes
  if (reviewChanges && reviewChanges.length > 0) {
    extras.reviewChanges = 'true'; // Truthy string to enable conditional block
    extras.changesTable = buildChangesTableHtml(reviewChanges);
  }

  const variables = extractVariables(editRequest, extras);
  return generateFromTemplate(TEMPLATE_IDS.EDIT_REQUEST_APPROVED, variables);
}

/**
 * Generate edit request rejected notification email
 */
async function generateEditRequestRejectedNotification(editRequest, rejectionReason = '') {
  const variables = extractVariables(editRequest, {
    rejectionReason: rejectionReason ? escapeHtml(rejectionReason) : ''
  });
  return generateFromTemplate(TEMPLATE_IDS.EDIT_REQUEST_REJECTED, variables);
}

// =============================================================================
// ERROR NOTIFICATION GENERATOR FUNCTIONS
// =============================================================================

/**
 * Generate error notification email for admins
 * @param {Object} errorData - Error document from errorLoggingService
 * @param {string} adminPanelUrl - URL to error details in admin panel
 */
async function generateErrorNotification(errorData, adminPanelUrl = '') {
  const variables = {
    severity: errorData.severity ? errorData.severity.toUpperCase() : 'HIGH',
    source: errorData.source || 'backend',
    message: escapeHtml(errorData.message || 'Unknown error'),
    timestamp: formatDateTime(errorData.createdAt || new Date()),
    correlationId: errorData.correlationId || 'N/A',
    endpoint: errorData.endpoint ? escapeHtml(errorData.endpoint) : '',
    userEmail: errorData.userContext?.email ? escapeHtml(errorData.userContext.email) : '',
    stack: errorData.stack ? escapeHtml(errorData.stack.substring(0, 2000)) : '',
    adminPanelUrl: adminPanelUrl ? escapeHtml(adminPanelUrl) : ''
  };
  return generateFromTemplate(TEMPLATE_IDS.ERROR_NOTIFICATION, variables);
}

/**
 * Generate user report acknowledgment email
 * @param {Object} reportData - User report document
 * @param {Object} userContext - User context
 */
async function generateUserReportAcknowledgment(reportData, userContext = {}) {
  const variables = {
    userName: escapeHtml(userContext.name || userContext.email || 'User'),
    correlationId: reportData.correlationId || 'N/A',
    timestamp: formatDateTime(reportData.createdAt || new Date()),
    category: reportData.userSelectedCategory ? escapeHtml(reportData.userSelectedCategory) : '',
    userDescription: reportData.userDescription ? escapeHtml(reportData.userDescription) : ''
  };
  return generateFromTemplate(TEMPLATE_IDS.USER_REPORT_ACKNOWLEDGMENT, variables);
}

/**
 * Preview a template with sample data
 */
async function previewTemplate(templateId, customSubject = null, customBody = null) {
  const sampleData = {
    eventTitle: 'Annual Board Meeting',
    requesterName: 'John Smith',
    requesterEmail: 'john.smith@example.com',
    startTime: formatDateTime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)), // 1 week from now
    endTime: formatTime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000)), // +2 hours
    locations: 'Main Sanctuary, Meeting Room A',
    attendeeCount: '50',
    submittedAt: formatDateTime(new Date()),
    adminNotes: 'Please arrive 15 minutes early for setup.',
    rejectionReason: 'The requested space is not available on this date.',
    adminPanelUrl: 'https://example.com/admin/reservations'
  };

  const template = await getTemplate(templateId);
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  const subjectToRender = customSubject || template.subject;
  const bodyToRender = customBody || template.body;

  return {
    subject: decodeHtmlEntities(renderTemplate(subjectToRender, sampleData)),
    html: wrapEmailTemplate(renderTemplate(bodyToRender, sampleData)),
    sampleData
  };
}

/**
 * Build HTML table for review changes in approval email
 * @param {Array<{displayName: string, oldValue: string, newValue: string}>} changes
 * @returns {string} HTML table string
 */
function buildChangesTableHtml(changes) {
  if (!changes || changes.length === 0) return '';

  const rows = changes.map(change =>
    `<tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 8px; color: #2d3748; font-weight: 500;">${escapeHtml(change.displayName)}</td>
      <td style="padding: 8px; color: #718096; text-decoration: line-through;">${escapeHtml(change.oldValue)}</td>
      <td style="padding: 8px; color: #2d3748; font-weight: 600;">${escapeHtml(change.newValue)}</td>
    </tr>`
  ).join('\n      ');

  return `<table style="width: 100%; border-collapse: collapse; margin-top: 8px;">
    <thead>
      <tr style="background-color: #f7fafc;">
        <th style="padding: 8px; text-align: left; color: #718096; font-weight: 600; font-size: 13px;">Field</th>
        <th style="padding: 8px; text-align: left; color: #718096; font-weight: 600; font-size: 13px;">Original</th>
        <th style="padding: 8px; text-align: left; color: #718096; font-weight: 600; font-size: 13px;">Updated</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

module.exports = {
  // Database
  setDbConnection,

  // Template management
  TEMPLATE_IDS,
  DEFAULT_TEMPLATES,
  getAllTemplates,
  getTemplate,
  getDefaultTemplates,
  previewTemplate,
  renderTemplate,

  // Utility functions
  formatDateTime,
  formatDate,
  formatTime,
  wrapEmailTemplate,
  extractVariables,
  escapeHtml,
  buildChangesTableHtml,

  // Generator functions (backward compatible)
  generateSubmissionConfirmation,
  generateAdminNewRequestAlert,
  generateApprovalNotification,
  generateRejectionNotification,
  generateResubmissionConfirmation,
  generateReviewStartedNotification,
  generateEventUpdatedNotification,
  generateFromTemplate,

  // Edit request generator functions
  generateEditRequestSubmittedConfirmation,
  generateAdminEditRequestAlert,
  generateEditRequestApprovedNotification,
  generateEditRequestRejectedNotification,

  // Error notification generator functions
  generateErrorNotification,
  generateUserReportAcknowledgment
};
