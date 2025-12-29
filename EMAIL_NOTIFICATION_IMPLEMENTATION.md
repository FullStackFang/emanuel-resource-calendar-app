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
- **Recipient**: All admin users
- **Content**: Quick summary, requester info, link to admin review panel

### 3. Approval Notification
- **Trigger**: Admin approves a reservation
- **Recipient**: Requester (+ contact person if applicable)
- **Content**: Approval confirmation, event details, admin notes, calendar info

### 4. Rejection Notification
- **Trigger**: Admin rejects a reservation
- **Recipient**: Requester (+ contact person if applicable)
- **Content**: Rejection notice, reason provided, resubmission instructions

### 5. Resubmission Confirmation
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

### 1.2 Create Client Secret

1. In the App Registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description (e.g., "Email Service")
4. Set expiration (recommended: 24 months)
5. Click **Add**
6. **IMPORTANT**: Copy the secret value immediately (shown only once)
7. Store securely in backend `.env` file

### 1.3 Verify/Create Shared Mailbox

1. Go to Microsoft 365 Admin Center
2. Navigate to **Teams & groups** > **Shared mailboxes**
3. Verify `reservations@emanuelnyc.org` exists, or create it
4. No additional license required for shared mailboxes
5. Application permissions allow sending as any mailbox in the tenant

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
 */
async function sendEmail(to, subject, htmlBody, cc = []) {
  if (!EMAIL_ENABLED) {
    logger.info('Email disabled - would have sent:', { to, subject });
    return { success: true, skipped: true };
  }

  const token = await getAppAccessToken();

  const message = {
    message: {
      subject,
      body: {
        contentType: 'HTML',
        content: htmlBody
      },
      toRecipients: Array.isArray(to)
        ? to.map(addr => ({ emailAddress: { address: addr } }))
        : [{ emailAddress: { address: to } }],
      ccRecipients: cc.map(addr => ({ emailAddress: { address: addr } })),
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
    throw new Error(`Graph API error: ${response.status} - ${error}`);
  }

  return { success: true };
}

// Export notification functions
module.exports = {
  sendEmail,
  sendSubmissionConfirmation,
  sendAdminNewRequestAlert,
  sendApprovalNotification,
  sendRejectionNotification,
  sendResubmissionConfirmation,
  getAdminEmails
};
```

### 2.2 Create Email Templates Module

**File**: `/backend/services/emailTemplates.js`

Templates for each notification type with HTML formatting and placeholder substitution.

---

## Phase 3: Environment Configuration

### 3.1 Add to Backend `.env`

```bash
# Email Notification Configuration
EMAIL_ENABLED=true
EMAIL_FROM_ADDRESS=reservations@emanuelnyc.org
EMAIL_FROM_NAME=Temple Emanuel Reservations

# Azure AD Client Credentials (for app-only authentication)
APP_ID=c2187009-796d-4fea-b58c-f83f7a89589e
TENANT_ID=fcc71126-2b16-4653-b639-0f1ef8332302
CLIENT_SECRET=<your-client-secret-from-azure-portal>
```

### 3.2 Update `.env.example`

Add documentation for new variables with placeholder values.

---

## Phase 4: Integration Points

### 4.1 Endpoints to Modify

| Endpoint | Location | Email Actions |
|----------|----------|---------------|
| `POST /api/room-reservations` | api-server.js ~11029 | Submission confirmation + Admin alert |
| `POST /api/room-reservations/public/:token` | api-server.js ~11180 | Submission confirmation + Admin alert |
| `PUT /api/admin/room-reservations/:id/approve` | api-server.js ~13438 | Approval notification |
| `PUT /api/admin/room-reservations/:id/reject` | api-server.js ~13552 | Rejection notification |
| `PUT /api/room-reservations/:id/resubmit` | api-server.js ~11750 | Resubmission confirmation + Admin alert |
| `PUT /api/admin/events/:id/approve` | api-server.js ~15200 | Approval notification |
| `PUT /api/admin/events/:id/reject` | api-server.js ~15310 | Rejection notification |

### 4.2 Integration Pattern

```javascript
// After successful database operation, add non-blocking email send:
try {
  const adminEmails = await emailService.getAdminEmails(db);
  await emailService.sendSubmissionConfirmation(reservation);
  await emailService.sendAdminNewRequestAlert(reservation, adminEmails);
  logger.info('Email notifications sent successfully');
} catch (emailError) {
  logger.error('Email notification failed:', emailError);
  // Do NOT throw - main operation already succeeded
}
```

---

## Phase 5: Error Handling

### Non-Blocking Pattern
- Email failures should **NEVER** block the main reservation operation
- Log all email errors for debugging
- Main operation returns success even if email fails

### Graph API Error Handling

| Status | Meaning | Action |
|--------|---------|--------|
| 401 | Token expired | Re-acquire token (MSAL handles automatically) |
| 403 | Permission denied | Log error, check Azure AD config |
| 429 | Rate limited | Implement exponential backoff |
| 400 | Bad request | Log full error for debugging |

---

## Files Summary

| File | Action | Description |
|------|--------|-------------|
| `backend/services/emailService.js` | CREATE | Core email sending logic |
| `backend/services/emailTemplates.js` | CREATE | HTML email templates |
| `backend/api-server.js` | MODIFY | Add email calls to endpoints |
| `backend/.env` | MODIFY | Add email config variables |
| `.env.example` | MODIFY | Document new variables |

---

## Testing Checklist

- [ ] Azure AD app permission granted and admin consent provided
- [ ] Client secret created and stored in `.env`
- [ ] Shared mailbox exists and accessible
- [ ] Token acquisition test succeeds
- [ ] Submit reservation - confirmation email received
- [ ] Submit public reservation - confirmation email received
- [ ] Approve reservation - approval email received
- [ ] Reject reservation - rejection email with reason received
- [ ] Resubmit reservation - resubmission email received
- [ ] Admin alerts sent to all admin users
- [ ] Emails render correctly in Outlook/Gmail/mobile
- [ ] From address shows shared mailbox name

---

## Security Considerations

1. **Client Secret Protection**
   - Store `CLIENT_SECRET` only in backend `.env`
   - Never commit secrets to source control
   - Rotate secrets before expiration

2. **Content Sanitization**
   - Escape HTML special characters in user-provided content
   - Limit length of user messages in templates
   - Validate email addresses before sending

3. **Development Safety**
   - Use `EMAIL_ENABLED=false` in development
   - Log email contents instead of sending during testing

---

## Dependencies

The `@azure/msal-node` package (v3.8.3) is already installed in the backend. No additional dependencies required.

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
- **Application**: `Mail.Send` (allows sending as any user in the tenant)
