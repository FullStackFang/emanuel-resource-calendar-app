# Error Logging and Reporting System

A comprehensive error tracking system for the Temple Emanuel Resource Calendar application that captures, logs, and manages errors from both frontend and backend sources.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐    ┌───────────────────┐    ┌──────────────────────┐ │
│  │  ErrorBoundary   │    │ globalErrorHandlers│    │  ErrorReportModal    │ │
│  │  (React errors)  │    │ (JS exceptions)    │    │  (User reports)      │ │
│  └────────┬─────────┘    └─────────┬─────────┘    └──────────┬───────────┘ │
│           │                        │                          │             │
│           └────────────────────────┼──────────────────────────┘             │
│                                    │                                        │
│                        ┌───────────▼───────────┐                           │
│                        │ errorReportingService │                           │
│                        │  - reportError()      │                           │
│                        │  - submitUserReport() │                           │
│                        └───────────┬───────────┘                           │
│                                    │                                        │
└────────────────────────────────────┼────────────────────────────────────────┘
                                     │
                          HTTP POST (with JWT)
                                     │
┌────────────────────────────────────┼────────────────────────────────────────┐
│                              BACKEND (Express)                              │
├────────────────────────────────────┼────────────────────────────────────────┤
│                                    │                                        │
│  ┌─────────────────────────────────▼─────────────────────────────────────┐ │
│  │                         API Endpoints                                  │ │
│  │  POST /api/report-issue     - User-submitted reports                  │ │
│  │  POST /api/log-error        - Automatic error logging                 │ │
│  │  GET  /api/admin/error-logs - List errors (admin)                     │ │
│  │  GET  /api/admin/error-logs/stats - Statistics (admin)                │ │
│  │  GET  /api/admin/error-logs/:id - Error details (admin)               │ │
│  │  PUT  /api/admin/error-logs/:id/review - Mark reviewed (admin)        │ │
│  │  GET  /api/admin/error-settings - Get settings (admin)                │ │
│  │  PUT  /api/admin/error-settings - Update settings (admin)             │ │
│  └─────────────────────────────────┬─────────────────────────────────────┘ │
│                                    │                                        │
│                        ┌───────────▼───────────┐                           │
│                        │ errorLoggingService   │                           │
│                        │  - logError()         │                           │
│                        │  - logUserReport()    │                           │
│                        │  - deduplication      │                           │
│                        │  - shouldNotifyAdmin()│                           │
│                        └───────────┬───────────┘                           │
│                                    │                                        │
│              ┌─────────────────────┼─────────────────────┐                 │
│              │                     │                     │                 │
│              ▼                     ▼                     ▼                 │
│  ┌───────────────────┐  ┌─────────────────┐  ┌────────────────────────┐   │
│  │  MongoDB          │  │  emailService   │  │  templeEvents__        │   │
│  │  ErrorLogs        │  │  (notifications)│  │  SystemSettings        │   │
│  └───────────────────┘  └─────────────────┘  └────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### Frontend Components

#### 1. ErrorBoundary (`src/components/shared/ErrorBoundary.jsx`)

A React class component that catches JavaScript errors in its child component tree.

**Features:**
- Catches React component render errors
- Displays user-friendly fallback UI
- Automatically reports errors to backend
- Shows correlation ID for reference
- Provides "Try Again", "Refresh Page", and "Report Issue" buttons
- Shows error details in development mode

**Usage in `main.jsx`:**
```jsx
<ErrorBoundary apiToken={apiToken} onError={handleError}>
  <App />
</ErrorBoundary>
```

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| `apiToken` | string | JWT token for API authentication |
| `onError` | function | Callback when error occurs (for showing modal) |
| `onShowReportModal` | function | Callback to show the ErrorReportModal |
| `fallback` | function | Custom fallback UI renderer |
| `children` | ReactNode | Child components to wrap |

---

#### 2. Global Error Handlers (`src/utils/globalErrorHandlers.js`)

Captures uncaught JavaScript errors and unhandled promise rejections.

**Functions:**
- `initializeGlobalErrorHandlers(options)` - Set up `window.onerror` and `window.onunhandledrejection`
- `reportGlobalError(error, context)` - Manually report an error from anywhere
- `cleanupGlobalErrorHandlers()` - Remove handlers (on unmount)

**Initialization in `main.jsx`:**
```javascript
initializeGlobalErrorHandlers({
  getApiToken: () => window.__apiToken,
  onError: (errorInfo) => window.__showErrorModal?.(errorInfo)
});
```

---

#### 3. Error Reporting Service (`src/services/errorReportingService.js`)

Frontend service that handles error reporting to the backend API.

**Functions:**
| Function | Description |
|----------|-------------|
| `reportError(errorData, apiToken)` | Send automatic error report |
| `submitUserReport(reportData, apiToken)` | Submit user-initiated report |
| `collectBrowserContext()` | Gather browser/device info |
| `getRecentErrors()` | Get last 10 errors for context |
| `normalizeError(error, extra)` | Convert various error types to standard format |
| `clearRecentErrors()` | Clear stored errors (e.g., on logout) |

**Browser Context Collected:**
- User agent
- Current URL
- Referrer
- Screen size / viewport size
- Timezone
- Language
- Online status

**Debouncing:** Similar errors within 5 seconds are debounced to prevent spam.

---

#### 4. ErrorReportModal (`src/components/shared/ErrorReportModal.jsx`)

A popup modal that appears when an error occurs, allowing users to add context.

**Features:**
- Auto-detects category based on current URL
- Shows if error was auto-reported (with correlation ID)
- Optional description field (max 2000 chars)
- Category selection (Calendar, Reservations, Login, etc.)
- Auto-closes 3 seconds after successful submission

**Props:**
| Prop | Type | Description |
|------|------|-------------|
| `isOpen` | boolean | Whether modal is visible |
| `onClose` | function | Close handler |
| `error` | object | Error object with correlationId |
| `apiToken` | string | JWT token for API |

---

### Backend Components

#### 5. Error Logging Service (`backend/services/errorLoggingService.js`)

Core service for persisting and managing error logs in MongoDB.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `setDbConnection(db)` | Initialize with MongoDB connection |
| `logError(errorData, context)` | Log an error (with deduplication) |
| `logUserReport(reportData, userContext)` | Log user-submitted report |
| `getErrors(filters, pagination)` | Query errors for admin dashboard |
| `getErrorById(errorId)` | Get single error details |
| `updateErrorReview(errorId, reviewData, reviewer)` | Mark as reviewed |
| `getErrorStats()` | Get aggregated statistics |
| `getErrorSettings()` | Get notification settings |
| `updateErrorSettings(settings)` | Update notification settings |
| `shouldNotifyAdmin(errorDoc, settings)` | Check if notification should be sent |
| `markNotificationSent(errorId, fingerprint)` | Update notification status |

**Deduplication:**
Errors with the same fingerprint (hash of message + first 3 stack lines + source + endpoint) are deduplicated. Instead of creating duplicates, the occurrence count is incremented and the last 10 occurrences are tracked.

**Severity Determination:**
```javascript
- 500+ errors or unhandled exceptions → 'critical'
- 401/403 errors → 'medium'
- 400-499 errors → 'low'
- Other → 'high'
```

---

#### 6. Email Service Integration (`backend/services/emailService.js`)

**Functions added:**
- `sendErrorNotification(errorDoc, db, adminPanelUrl)` - Send email to admins
- `sendUserReportAcknowledgment(reportDoc, userContext)` - Acknowledge user report

---

### Admin Dashboard

#### 7. ErrorLogAdmin (`src/components/ErrorLogAdmin.jsx`)

Admin interface for viewing and managing error logs.

**Features:**
- Statistics cards (Critical, High, Medium, User Reports, Unreviewed, Today)
- Filtering by type, severity, source, reviewed status, search
- Paginated error list
- Click to view full error details
- Mark as reviewed with resolution and notes
- Settings modal for notification preferences

---

## Data Models

### Error Log Document (MongoDB)

**Collection:** `templeEvents__ErrorLogs`

```javascript
{
  _id: ObjectId,

  // Classification
  type: 'error' | 'warning' | 'user_report',
  severity: 'critical' | 'high' | 'medium' | 'low',
  source: 'frontend' | 'backend' | 'api' | 'graph_api',

  // Error details
  message: String,
  stack: String,
  endpoint: String,
  statusCode: Number,
  errorType: String,          // 'react_error', 'unhandledRejection', etc.
  componentStack: String,     // React component stack trace

  // Tracking
  requestId: String,
  correlationId: String,      // e.g., 'err-1705849200000-abc123def'
  fingerprint: String,        // MD5 hash for deduplication

  // Context
  userContext: {
    userId: String,
    email: String,
    name: String,
    isAdmin: Boolean
  },
  browserContext: {
    userAgent: String,
    url: String,
    screenSize: String,
    timezone: String,
    ...
  },
  requestContext: {
    method: String,
    path: String,
    query: Object,      // Sanitized
    body: Object        // Sanitized
  },

  // User report specific
  userDescription: String,
  userSelectedCategory: String,

  // Admin workflow
  notificationSent: Boolean,
  notificationSentAt: Date,
  reviewed: Boolean,
  resolution: String,         // 'fixed', 'wont_fix', 'duplicate', etc.
  notes: String,
  reviewedBy: { userId, email, name },
  reviewedAt: Date,

  // Deduplication
  occurrenceCount: Number,
  occurrences: [{
    timestamp: Date,
    requestId: String,
    userContext: Object
  }],                         // Last 10 occurrences
  lastOccurredAt: Date,

  // Timestamps
  createdAt: Date,
  updatedAt: Date
}
```

### Error Settings Document

**Collection:** `templeEvents__SystemSettings`
**Document ID:** `error-settings`

```javascript
{
  _id: 'error-settings',
  notificationsEnabled: Boolean,        // Default: true
  notifyOnSeverity: ['critical', 'high'], // Severities that trigger email
  emailCooldownMinutes: Number,         // Default: 15
  dailyEmailLimit: Number,              // Default: 50
  retentionDays: Number,                // Default: 90
  updatedAt: Date
}
```

---

## API Endpoints

### Public Endpoints (Authenticated Users)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/report-issue` | Submit user issue report |
| POST | `/api/log-error` | Log frontend error |

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/error-logs` | List errors with filters |
| GET | `/api/admin/error-logs/stats` | Get error statistics |
| GET | `/api/admin/error-logs/:id` | Get error details |
| PUT | `/api/admin/error-logs/:id/review` | Mark as reviewed |
| GET | `/api/admin/error-settings` | Get notification settings |
| PUT | `/api/admin/error-settings` | Update settings |

### Query Parameters for `/api/admin/error-logs`

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page (default: 50) |
| `type` | string | Filter by type |
| `severity` | string | Filter by severity |
| `source` | string | Filter by source |
| `reviewed` | boolean | Filter by review status |
| `search` | string | Search message, correlationId, email |
| `startDate` | ISO date | Filter by date range |
| `endDate` | ISO date | Filter by date range |

---

## Data Flow Examples

### Flow 1: React Component Error

```
1. Component throws error during render
2. ErrorBoundary.componentDidCatch() catches it
3. ErrorBoundary calls reportError() via errorReportingService
4. POST /api/log-error with error data + browser context
5. Backend errorLoggingService.logError() processes:
   - Generates correlationId
   - Generates fingerprint for deduplication
   - Checks for existing error with same fingerprint
   - If duplicate: increment count, update lastOccurredAt
   - If new: insert document
6. Backend checks if admin notification needed
7. If needed: emailService.sendErrorNotification()
8. ErrorBoundary shows fallback UI with correlationId
9. User can click "Report Issue" to add context via ErrorReportModal
```

### Flow 2: Unhandled Promise Rejection

```
1. Promise rejects without .catch()
2. window.onunhandledrejection fires (globalErrorHandlers)
3. handleError() normalizes and reports via errorReportingService
4. ErrorReportModal opens automatically (via window.__showErrorModal)
5. User optionally adds description and submits
6. POST /api/report-issue with user context
7. Backend logs as type: 'user_report'
```

### Flow 3: Admin Reviews Error

```
1. Admin navigates to /admin/error-logs
2. ErrorLogAdmin fetches GET /api/admin/error-logs
3. Admin clicks error row to see details
4. Admin selects resolution, adds notes
5. PUT /api/admin/error-logs/:id/review
6. Error marked as reviewed with timestamp
```

---

## Security Considerations

### Data Sanitization

The following sensitive fields are automatically redacted:
- password, token, secret, apikey, api_key, apiKey
- authorization, auth, credential, private, key
- accessToken, access_token, refreshToken, refresh_token
- x-graph-token, bearer

### Access Control

- All error logging endpoints require JWT authentication
- Admin endpoints verify `isAdmin` flag on user document
- Request bodies are sanitized before storage

### Rate Limiting

- Frontend debounces similar errors (5 second window)
- Backend deduplicates by fingerprint
- Daily email notification limit (default: 50)
- Email cooldown per error fingerprint (default: 15 minutes)

---

## Indexes

The following indexes are created on `templeEvents__ErrorLogs`:

```javascript
// Query by type and severity
{ type: 1, severity: 1, createdAt: -1 }

// Fingerprint deduplication
{ fingerprint: 1 }

// Query by source
{ source: 1, createdAt: -1 }

// Reviewed status filtering
{ reviewed: 1, createdAt: -1 }

// TTL for automatic cleanup (90 days default)
{ createdAt: 1 } (expireAfterSeconds: 7776000)
```

---

## Testing

### Test User Report Endpoint

```javascript
// Run in browser console (logged in)
fetch('http://localhost:3001/api/report-issue', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${window.__apiToken}`
  },
  body: JSON.stringify({
    description: 'Test report from console',
    category: 'general'
  })
}).then(r => r.json()).then(console.log);
```

### Test Error Modal (Trigger Unhandled Error)

```javascript
// Triggers global error handler and shows modal
setTimeout(() => { throw new Error('Test error modal'); }, 100);
```

### Test Promise Rejection Handler

```javascript
Promise.reject(new Error('Test promise rejection'));
```

### Test API Directly

```javascript
// Fetch error logs
fetch('http://localhost:3001/api/admin/error-logs', {
  headers: { 'Authorization': `Bearer ${window.__apiToken}` }
}).then(r => r.json()).then(console.log);

// Fetch stats
fetch('http://localhost:3001/api/admin/error-logs/stats', {
  headers: { 'Authorization': `Bearer ${window.__apiToken}` }
}).then(r => r.json()).then(console.log);
```

---

## Troubleshooting

### Errors not showing in Admin Dashboard

1. **Check API response:** Run the test API call above and check the response
2. **Verify admin status:** Ensure your user has `isAdmin: true` in the database
3. **Check Network tab:** Look for 403 (permission) or 500 (server error)
4. **Check backend logs:** Look for errors in the terminal running the backend

### Email notifications not sending

1. Verify `EMAIL_ENABLED=true` in `.env`
2. Check `notificationsEnabled` in error settings
3. Verify error severity is in `notifyOnSeverity` array
4. Check if daily email limit has been reached
5. Check cooldown (same error fingerprint within cooldown period)

### Errors not being logged

1. Verify `errorLoggingService.setDbConnection(db)` is called during startup
2. Check MongoDB connection is established
3. Look for "Error logging service not initialized" warnings in backend logs

---

## File Reference

| File | Purpose |
|------|---------|
| `backend/services/errorLoggingService.js` | Core error logging logic |
| `backend/services/emailService.js` | Email notification functions |
| `backend/services/emailTemplates.js` | Error notification email templates |
| `backend/api-server.js` | API endpoints and middleware |
| `src/services/errorReportingService.js` | Frontend error reporting |
| `src/utils/globalErrorHandlers.js` | Global JS error handlers |
| `src/components/shared/ErrorBoundary.jsx` | React error boundary |
| `src/components/shared/ErrorReportModal.jsx` | User report modal |
| `src/components/ErrorLogAdmin.jsx` | Admin dashboard |
| `src/main.jsx` | Initialization and wiring |
| `src/App.jsx` | Global error state and modal |
