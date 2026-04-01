# Email Notification Implementation Plan

## Overview

This document outlines the implementation plan for adding email notifications to the Temple Emanuel Resource Calendar application using Microsoft Graph Mail.Send API.

## Requirements

| Requirement | Decision |
|-------------|----------|
| Email Method | Microsoft Graph Mail.Send API |
| Sender | Shared/service mailbox (e.g., `reservations@emanuelnyc.org`) |
| Authentication | Application permissions with client credentials flow |

## Notification Types

### 1. Submission Confirmation
- **Trigger**: User submits a room reservation request
- **Recipient**: Requester (+ contact person if "on behalf of")
- **Content**: Confirmation of receipt, event details, expected review timeframe

### 2. Admin New Request Alert
- **Trigger**: New pending reservation submitted
- **Recipient**: All admin users (single email with multiple recipients)
- **Content**: Quick summary, requester info, link to admin review panel

### 3. Review Started (Optional)
- **Trigger**: Admin starts reviewing a reservation (soft hold acquired)
- **Recipient**: Requester
- **Content**: Brief notification that request is being reviewed

### 4. Approval Notification
- **Trigger**: Admin approves a reservation
- **Recipient**: Requester (+ contact person if applicable)
- **Content**: Approval confirmation, event details, admin notes, calendar info

### 5. Rejection Notification
- **Trigger**: Admin rejects a reservation
- **Recipient**: Requester (+ contact person if applicable)
- **Content**: Rejection notice, reason provided, resubmission instructions

### 6. Resubmission Confirmation
- **Trigger**: User resubmits a previously rejected reservation
- **Recipient**: Requester + all admins
- **Content**: Revision confirmation, summary of changes

---

## Phase 1: Azure AD Configuration (Manual Steps)

### 1.1 Add Application Permission

1. Navigate to Azure Portal > Azure Active Directory > App Registrations
2. Select app: `c2187009-796d-4fea-b58c-f83f7a89589e`
3. Go to **API Permissions**
4. Click **Add a permission** > **Microsoft Graph** > **Application permissions**
5. Search for and select **Mail.Send**
6. Click **Grant admin consent for [Tenant]**

### 1.2 Restrict Mail.Send Scope (Security Best Practice)

The `Mail.Send` application permission grants send-as-any-user rights across the entire tenant. To limit the blast radius if credentials leak, restrict the app to only send from the reservations mailbox:

```powershell
# In Exchange Online PowerShell
New-ApplicationAccessPolicy -AppId "c2187009-796d-4fea-b58c-f83f7a89589e" `
  -PolicyScopeGroupId "reservations@emanuelnyc.org" `
  -AccessRight RestrictAccess `
  -Description "Limit email sending to reservations mailbox only"
```

This ensures the app can ONLY send as `reservations@emanuelnyc.org`, not any other mailbox.

### 1.3 Create Client Secret

1. In the App Registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description (e.g., "Email Service")
4. Set expiration (recommended: 24 months)
5. Click **Add**
6. **IMPORTANT**: Copy the secret value immediately (shown only once)
7. Store securely in backend `.env` file

### 1.4 Verify/Create Shared Mailbox

1. Go to Microsoft 365 Admin Center
2. Navigate to **Teams & groups** > **Shared mailboxes**
3. Verify `reservations@emanuelnyc.org` exists, or create it
4. No additional license required for shared mailboxes

---

## Phase 2: Backend Email Service

### 2.1 Create Email Service Module

**File**: `/backend/services/emailService.js`

```javascript
const msal = require('@azure/msal-node');
const logger = require('../utils/logger');

// Environment configuration
const EMAIL_ENABLED = process.env.EMAIL_ENABLED === 'true';
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'reservations@emanuelnyc.org';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Temple Emanuel Reservations';
const EMAIL_REDIRECT_TO = process.env.EMAIL_REDIRECT_TO || null; // For testing - redirect all emails

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// MSAL Configuration for Client Credentials Flow
const msalConfig = {
  auth: {
    clientId: process.env.APP_ID,
    authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`,
    clientSecret: process.env.CLIENT_SECRET
  }
};

// Singleton MSAL client (caches tokens automatically)
const cca = new msal.ConfidentialClientApplication(msalConfig);

/**
 * Validate email address format
 */
function validateEmail(email) {
  return EMAIL_REGEX.test(email);
}

/**
 * Generate correlation ID for tracking
 */
function generateCorrelationId() {
  return `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Acquire access token using client credentials flow
 */
async function getAppAccessToken() {
  const result = await cca.acquireTokenByClientCredential({
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
 */
async function sendEmail(to, subject, htmlBody, options = {}) {
  const { cc = [], reservationId = null } = options;
  const correlationId = generateCorrelationId();

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
  const actualRecipients = EMAIL_REDIRECT_TO
    ? [EMAIL_REDIRECT_TO]
    : validRecipients;

  if (!EMAIL_ENABLED) {
    logger.info('Email disabled - would have sent:', {
      correlationId,
      to: actualRecipients,
      subject,
      reservationId
    });
    return { success: true, skipped: true, correlationId };
  }

  logger.info('Sending email', {
    correlationId,
    to: actualRecipients,
    subject,
    reservationId,
    redirected: !!EMAIL_REDIRECT_TO
  });

  const token = await getAppAccessToken();

  const message = {
    message: {
      subject: EMAIL_REDIRECT_TO
        ? `[REDIRECTED] ${subject}`
        : subject,
      body: {
        contentType: 'HTML',
        content: htmlBody
      },
      toRecipients: actualRecipients.map(addr => ({
        emailAddress: { address: addr }
      })),
      ccRecipients: cc.filter(validateEmail).map(addr => ({
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
    const error = await response.text();
    logger.error('Graph API email error', { correlationId, status: response.status, error });
    throw new Error(`Graph API error: ${response.status} - ${error}`);
  }

  logger.info('Email sent successfully', { correlationId, reservationId });
  return { success: true, correlationId };
}

// Export notification functions
module.exports = {
  sendEmail,
  validateEmail,
  generateCorrelationId,
  sendSubmissionConfirmation,
  sendAdminNewRequestAlert,
  sendReviewStartedNotification,
  sendApprovalNotification,
  sendRejectionNotification,
  sendResubmissionConfirmation,
  getAdminEmails
};
```

### 2.2 Create Email Templates Module

**File**: `/backend/services/emailTemplates.js`

```javascript
const escapeHtml = require('escape-html'); // npm install escape-html

/**
 * Safely render template with escaped user content
 */
function renderTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = data[key];
    if (value === undefined || value === null) return '';
    return escapeHtml(String(value));
  });
}

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

// Template definitions...
const templates = {
  submissionConfirmation: `
    <h2>Room Reservation Request Received</h2>
    <p>Thank you for submitting your reservation request.</p>
    <h3>Event Details</h3>
    <ul>
      <li><strong>Event:</strong> {{eventTitle}}</li>
      <li><strong>Date:</strong> {{formattedDate}}</li>
      <li><strong>Location:</strong> {{locationDisplayNames}}</li>
    </ul>
    <p>Your request is now pending review. You will receive another email once it has been approved or if additional information is needed.</p>
  `,
  // ... other templates
};

module.exports = {
  renderTemplate,
  formatDateTime,
  templates,
  escapeHtml
};
```

### 2.3 Dependencies

Add to `backend/package.json`:
```json
{
  "dependencies": {
    "escape-html": "^1.0.3"
  }
}
```

The `@azure/msal-node` package (v3.8.3) is already installed.

---

## Phase 3: Environment Configuration

### 3.1 Add to Backend `.env`

```bash
# Email Notification Configuration
EMAIL_ENABLED=true
EMAIL_FROM_ADDRESS=reservations@emanuelnyc.org
EMAIL_FROM_NAME=Temple Emanuel Reservations

# Testing: Redirect all emails to this address (leave empty for production)
EMAIL_REDIRECT_TO=

# Azure AD Client Credentials (for app-only authentication)
APP_ID=c2187009-796d-4fea-b58c-f83f7a89589e
TENANT_ID=fcc71126-2b16-4653-b639-0f1ef8332302
CLIENT_SECRET=<your-client-secret-from-azure-portal>
```

### 3.2 Environment Variables Explained

| Variable | Purpose | Example |
|----------|---------|---------|
| `EMAIL_ENABLED` | Master toggle for email sending | `true` or `false` |
| `EMAIL_FROM_ADDRESS` | Shared mailbox to send from | `reservations@emanuelnyc.org` |
| `EMAIL_FROM_NAME` | Display name for sender | `Temple Emanuel Reservations` |
| `EMAIL_REDIRECT_TO` | Redirect all emails for testing | `stephen@emanuelnyc.org` |
| `CLIENT_SECRET` | Azure AD app secret | From Azure Portal |

---

## Phase 4: Integration Points

### 4.1 Endpoints to Modify

| Endpoint | Location | Email Actions |
|----------|----------|---------------|
| `POST /api/events/request` | api-server.js | Submission confirmation + Admin alert |
| `POST /api/room-reservations` | api-server.js | Submission confirmation + Admin alert |
| `POST /api/room-reservations/public/:token` | api-server.js | Submission confirmation + Admin alert |
| `POST /api/admin/room-reservations/:id/start-review` | api-server.js | Review started notification (optional) |
| `PUT /api/admin/room-reservations/:id/approve` | api-server.js | Approval notification |
| `PUT /api/admin/room-reservations/:id/reject` | api-server.js | Rejection notification |
| `PUT /api/room-reservations/:id/resubmit` | api-server.js | Resubmission confirmation + Admin alert |
| `PUT /api/admin/events/:id/approve` | api-server.js | Approval notification |
| `PUT /api/admin/events/:id/reject` | api-server.js | Rejection notification |

### 4.2 Integration Pattern

```javascript
// After successful database operation, add non-blocking email send:
try {
  const adminEmails = await emailService.getAdminEmails(db);

  // Send confirmation to requester
  const confirmResult = await emailService.sendSubmissionConfirmation(reservation);

  // Send single email to all admins (not multiple emails)
  const adminResult = await emailService.sendAdminNewRequestAlert(reservation, adminEmails);

  // Log to communication history for audit trail
  await unifiedEventsCollection.updateOne(
    { _id: reservation._id },
    {
      $push: {
        'roomReservationData.communicationHistory': {
          timestamp: new Date(),
          type: 'email_sent',
          correlationId: confirmResult.correlationId,
          emailType: 'submission_confirmation',
          recipients: [reservation.requesterEmail]
        }
      }
    }
  );

  logger.info('Email notifications sent successfully');
} catch (emailError) {
  logger.error('Email notification failed:', emailError);
  // Do NOT throw - main operation already succeeded
}
```

### 4.3 Admin Alert Optimization

Send a single email to multiple admins instead of multiple emails:

```javascript
// Good: Single email with multiple recipients
await emailService.sendEmail(
  adminEmails, // Array of admin emails
  `[ACTION REQUIRED] New Reservation: ${reservation.eventTitle}`,
  htmlBody,
  { reservationId: reservation._id }
);

// Avoid: Multiple separate emails
// adminEmails.forEach(email => sendEmail(email, ...)); // DON'T DO THIS
```

---

## Phase 5: Error Handling

### Non-Blocking Pattern
- Email failures should **NEVER** block the main reservation operation
- Log all email errors with correlation IDs for debugging
- Main operation returns success even if email fails

### Graph API Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 400 | Bad request (invalid email) | Log error, email validation should catch most |
| 401 | Token expired | MSAL handles re-acquisition automatically |
| 403 | Permission denied | Log error, check Azure AD config & ApplicationAccessPolicy |
| 429 | Rate limited | Unlikely (~10k/10min limit), implement backoff if needed |

### Rate Limiting Notes

Graph API limits for Mail.Send are approximately 10,000 messages per 10 minutes per mailbox. Normal operation won't hit this, but for safety:

```javascript
// Simple retry with exponential backoff for 429 errors
async function sendEmailWithRetry(to, subject, body, options = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await sendEmail(to, subject, body, options);
    } catch (error) {
      if (error.message.includes('429') && attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        logger.warn(`Rate limited, retrying in ${delay}ms`, { attempt });
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}
```

---

## Phase 6: Delivery Tracking

### Communication History Integration

Store email send attempts in the existing `communicationHistory` array:

```javascript
// After successful email send
await collection.updateOne(
  { _id: reservationId },
  {
    $push: {
      'roomReservationData.communicationHistory': {
        timestamp: new Date(),
        type: 'email_sent',
        correlationId: result.correlationId,
        emailType: 'approval_notification', // or 'rejection', 'submission', etc.
        subject: emailSubject,
        recipients: recipientEmails,
        success: true
      }
    }
  }
);

// On email failure
await collection.updateOne(
  { _id: reservationId },
  {
    $push: {
      'roomReservationData.communicationHistory': {
        timestamp: new Date(),
        type: 'email_failed',
        correlationId: correlationId,
        emailType: 'approval_notification',
        error: error.message,
        recipients: recipientEmails,
        success: false
      }
    }
  }
);
```

This integrates with the existing audit trail and can be displayed in the CommunicationHistory component.

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `backend/services/emailService.js` | CREATE | Core email sending logic with validation |
| `backend/services/emailTemplates.js` | CREATE | HTML templates with secure rendering |
| `backend/api-server.js` | MODIFY | Add email calls to endpoints |
| `backend/package.json` | MODIFY | Add `escape-html` dependency |
| `backend/.env` | MODIFY | Add email config variables |
| `.env.example` | MODIFY | Document new variables |

---

## Implementation Order (Recommended)

### Step 1: Azure AD Setup
- Add Mail.Send permission
- Create ApplicationAccessPolicy to restrict scope
- Create client secret
- Verify shared mailbox exists

### Step 2: Basic Email Service
- Create `emailService.js` with just `sendEmail` function
- Create one template (submission confirmation)
- Add environment variables

### Step 3: First Integration
- Integrate into `POST /api/events/request` (single endpoint)
- Test with `EMAIL_REDIRECT_TO=your-email@emanuelnyc.org`
- Verify end-to-end flow works

### Step 4: Full Integration
- Add remaining templates
- Integrate into other endpoints
- Add communication history tracking

### Step 5: Production
- Remove `EMAIL_REDIRECT_TO`
- Set `EMAIL_ENABLED=true`
- Test with real recipients
- Monitor logs for any issues

---

## Testing Checklist

- [ ] Azure AD app permission granted and admin consent provided
- [ ] ApplicationAccessPolicy restricts to reservations mailbox only
- [ ] Client secret created and stored in `.env`
- [ ] Shared mailbox exists and accessible
- [ ] Token acquisition test succeeds
- [ ] `EMAIL_REDIRECT_TO` redirects emails correctly in staging
- [ ] Email validation rejects malformed addresses
- [ ] Submit reservation - confirmation email received
- [ ] Approve reservation - approval email received
- [ ] Reject reservation - rejection email with reason received
- [ ] Resubmit reservation - resubmission email received
- [ ] Admin alerts send single email to multiple recipients
- [ ] Communication history records email sends
- [ ] Correlation IDs appear in logs for tracking
- [ ] Emails render correctly in Outlook/Gmail/mobile
- [ ] From address shows shared mailbox name
- [ ] Production: `EMAIL_ENABLED=true`, `EMAIL_REDIRECT_TO` empty

---

## Security Considerations

1. **Permission Scope Restriction**
   - Use ApplicationAccessPolicy to limit Mail.Send to reservations mailbox only
   - If credentials leak, attacker can only send as that one mailbox

2. **Client Secret Protection**
   - Store `CLIENT_SECRET` only in backend `.env`
   - Never commit secrets to source control
   - Rotate secrets before expiration

3. **Content Sanitization**
   - Use `escape-html` library for all user-provided content in templates
   - Limit length of user messages in templates
   - Validate email addresses before sending

4. **Development Safety**
   - Use `EMAIL_ENABLED=false` to disable completely
   - Use `EMAIL_REDIRECT_TO` to test full pipeline safely
   - Log email contents instead of sending during development

---

## Graph API Reference

### Send Mail Endpoint
```
POST https://graph.microsoft.com/v1.0/users/{user-id-or-upn}/sendMail
```

### Request Body
```json
{
  "message": {
    "subject": "Email Subject",
    "body": {
      "contentType": "HTML",
      "content": "<html>...</html>"
    },
    "toRecipients": [
      {
        "emailAddress": {
          "address": "recipient@example.com",
          "name": "Recipient Name"
        }
      }
    ],
    "from": {
      "emailAddress": {
        "address": "sender@example.com",
        "name": "Sender Name"
      }
    }
  },
  "saveToSentItems": false
}
```

### Required Permission
- **Application**: `Mail.Send` (with ApplicationAccessPolicy restriction)

### Rate Limits
- Approximately 10,000 messages per 10 minutes per mailbox
- 429 response if exceeded (implement exponential backoff)

---

## Alternative: Graph SDK (Optional)

Instead of raw `fetch`, you can use the Graph SDK for consistency with frontend patterns:

```javascript
const { Client } = require('@microsoft/microsoft-graph-client');

const client = Client.init({
  authProvider: (done) => {
    getAppAccessToken().then(token => done(null, token));
  }
});

await client.api(`/users/${EMAIL_FROM_ADDRESS}/sendMail`).post(message);
```

This provides better error parsing but requires adding `@microsoft/microsoft-graph-client` to backend dependencies. The `fetch` approach works equally well.
