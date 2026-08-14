---
name: emanu-backend
description: Backend development patterns for Node.js/Express with Azure Cosmos DB, Microsoft Graph API, SSE, and optimistic concurrency control
---

# Emanuel Backend Development Guide

## Purpose

Quick-reference patterns and checklists for backend work in this codebase. Covers the most common operations and the gotchas that trip you up.

## When This Skill Activates

- Adding/modifying API endpoints in `backend/api-server.js`
- Working with MongoDB/Cosmos DB queries
- Integrating with Microsoft Graph API
- Implementing SSE (Server-Sent Events)
- Writing migration scripts
- Adding email notifications
- Writing backend tests

---

## Adding a New Endpoint - Checklist

```
[ ] 1. Define route in api-server.js (group with related endpoints)
[ ] 2. Add JWT auth middleware (verifyToken) unless public endpoint
[ ] 3. Destructure request body with explicit field list
[ ] 4. Add role/permission check if restricted (getPermissions helper)
[ ] 5. Use conditionalUpdate() for any write operation (OCC)
[ ] 6. Push to statusHistory[] on any status change
[ ] 7. Emit SSE event if change is observable by other users
[ ] 8. Return consistent response shape: { success, data?, error?, message? }
[ ] 9. Write integration test in backend/__tests__/integration/
```

### Endpoint Pattern

```javascript
// CORRECT: Standard endpoint with OCC and audit trail
app.put('/api/admin/events/:id/your-action', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { expectedVersion, ...updateFields } = req.body;
    const userId = req.user.oid;

    // Permission check
    const permissions = await getPermissions(userId, db);
    if (permissions.role !== 'admin' && permissions.role !== 'approver') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Build update with OCC
    const updateOps = {
      $set: { ...updateFields, lastModifiedDateTime: new Date().toISOString() },
      $push: { statusHistory: { status: 'newStatus', changedAt: new Date().toISOString(), changedBy: userId } },
      $inc: { _version: 1 }
    };

    const result = await conditionalUpdate(
      db.collection('templeEvents__Events'),
      { _id: new ObjectId(id) },
      updateOps,
      expectedVersion
    );

    if (result.conflict) {
      return res.status(409).json({ code: 'VERSION_CONFLICT', ...result });
    }

    // SSE notification
    broadcastSSE({ type: 'event-updated', eventId: id });

    res.json({ success: true, data: result.value });
  } catch (error) {
    console.error('your-action error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

---

## Cosmos DB / MongoDB Patterns

### Batch Processing (Required for Cosmos DB)

Cosmos DB returns Error 16500 (rate limiting) on bulk operations. Always batch:

```javascript
// CORRECT: Batch with rate limit delay
const BATCH_SIZE = 100;
const docs = await collection.find(query).toArray();

for (let i = 0; i < docs.length; i += BATCH_SIZE) {
  const batch = docs.slice(i, i + BATCH_SIZE);
  await collection.updateMany(
    { _id: { $in: batch.map(d => d._id) } },
    updateOps
  );

  // Progress bar (migrations only)
  const processed = Math.min(i + BATCH_SIZE, docs.length);
  process.stdout.write(`\r   [Progress] ${Math.round((processed / docs.length) * 100)}% (${processed}/${docs.length})`);

  // Rate limit pause between batches
  if (i + BATCH_SIZE < docs.length) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```

```javascript
// NEVER: Unbounded loop without retry cap
while (processed < total) {
  try { await db.deleteMany(...); processed += batch.length; }
  catch (e) { errors.push(e); } // processed never advances = infinite loop
}
```

### Optimistic Concurrency Control (OCC)

Every write uses `conditionalUpdate()` from `backend/utils/concurrencyUtils.js`:

```javascript
// CORRECT: Use OCC wrapper
const result = await conditionalUpdate(collection, filter, updateOps, expectedVersion);
if (result.conflict) return res.status(409).json({ code: 'VERSION_CONFLICT', ...result });

// NEVER: Direct updateOne without version check
await collection.updateOne(filter, updateOps); // Loses concurrent changes silently
```

### Date Queries

Top-level `startDateTime` and `endDateTime` are the query fields:

```javascript
// CORRECT: Range query on top-level date fields
query['startDateTime'] = { $lt: rangeEnd };
query['endDateTime'] = { $gt: rangeStart };

// NEVER: Query nested graphData or calendarData date fields
query['graphData.start.dateTime'] = ...; // Wrong source
```

### Connection String

```javascript
const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
```

---

## Microsoft Graph API - Critical Rules

### Rule 1: Always Use graphApiService (App-Only Auth)

```javascript
// CORRECT: Backend app-only authentication
const graphApiService = require('./services/graphApiService');
const event = await graphApiService.createCalendarEvent(calendarOwner, calendarId, eventData);
const updated = await graphApiService.updateCalendarEvent(calendarOwner, eventId, changes);

// NEVER: Use user's graphToken from frontend
const response = await fetch(`https://graph.microsoft.com/v1.0/...`, {
  headers: { Authorization: `Bearer ${req.headers['x-graph-token']}` }
}); // DEPRECATED - do not use
```

### Rule 2: calendarOwner Pattern

Graph API calls use `/users/{calendarOwner}/...` with app permissions:
- `calendarOwner` = email of the shared mailbox (e.g., `templeeventssandbox@emanuelnyc.org`)
- Set by `getDefaultCalendarOwner()` based on `CALENDAR_CONFIG.DEFAULT_MODE`

### Rule 3: graphData.id Gate

Only published events have `graphData.id`. This gates all sync operations:

```javascript
// CORRECT: Check before Graph sync
if (event.graphData?.id) {
  await graphApiService.updateCalendarEvent(calendarOwner, event.graphData.id, changes);
}

// NEVER: Assume graphData.id exists (drafts/pending don't have it)
await graphApiService.updateCalendarEvent(calendarOwner, event.graphData.id, changes); // Crashes on drafts
```

---

## SSE (Server-Sent Events)

### Emitting Events

```javascript
// Broadcast to all connected clients
broadcastSSE({ type: 'event-updated', eventId: id, data: { status: 'published' } });
broadcastSSE({ type: 'event-created', eventId: newEvent._id });
broadcastSSE({ type: 'event-deleted', eventId: id });

// Types: event-updated, event-created, event-deleted, reservation-updated
```

### Payload Best Practice

Push changed data in SSE payloads for targeted cache invalidation (avoid full wipe):

```javascript
// CORRECT: Include relevant data for targeted UI update
broadcastSSE({
  type: 'event-updated',
  eventId: id,
  data: { status: newStatus, lastModifiedDateTime: new Date().toISOString() }
});

// AVOID: Empty payload forces full cache reload
broadcastSSE({ type: 'event-updated', eventId: id });
```

---

## Email Service Patterns

```javascript
const { sendApprovalEmail, sendRejectionEmail, sendEditRequestEmail } = require('./services/emailService');

// Approval with optional changes tracked
await sendApprovalEmail(event, approverEmail, { reviewChanges });

// Rejection with notes
await sendRejectionEmail(event, approverEmail, { reviewNotes: 'Room unavailable on that date' });
```

### Change Detection for Emails

When an approver modifies fields during review, use `changeDetection.js`:

```javascript
const { detectChanges } = require('./utils/changeDetection');
const reviewChanges = detectChanges(originalEvent, updatedEvent);
// Returns: [{ field, oldValue, newValue }]
```

---

## Migration Script Standard

All migration scripts follow this pattern:

```javascript
// Required flags
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

// Required structure
async function main() {
  // 1. Connect to DB
  // 2. Count documents to process
  // 3. If --verify: show counts and exit
  // 4. If --dry-run: show what would change (per-doc detail OK here)
  // 5. Otherwise: batch process with progress bar only
  // 6. Show final summary
}

// Required behavior:
// - Idempotent (safe to run multiple times)
// - BATCH_SIZE = 100 with 1000ms delay
// - Progress bar via \r carriage return
// - No per-document logging in normal mode
```

---

## Testing Patterns

### Test File Location

```
backend/__tests__/
  integration/         # Full endpoint tests with HTTP + DB
    roles/             # Role-based access tests
  unit/                # Isolated function tests
    utils/             # Utility function tests
  __helpers__/         # Shared test infrastructure
    testSetup.js       # MongoDB Memory Server + Express app
    userFactory.js     # Create test users with roles
    eventFactory.js    # Create test events with defaults
    authHelpers.js     # JWT token generation
    graphApiMock.js    # Graph API mock responses
    testApp.js         # Test Express app with all routes
```

### Writing an Integration Test

```javascript
const { setupTestEnvironment } = require('../__helpers__/testSetup');
const { createTestUser } = require('../__helpers__/userFactory');
const { createTestEvent } = require('../__helpers__/eventFactory');
const { getAuthHeaders } = require('../__helpers__/authHelpers');

describe('Feature Name', () => {
  let db, app;

  beforeAll(async () => {
    ({ db, app } = await setupTestEnvironment());
  });

  it('XX-1: should do the expected thing', async () => {
    // Arrange
    const user = await createTestUser(db, { role: 'admin' });
    const event = await createTestEvent(db, { status: 'pending', userId: user.oid });
    const headers = getAuthHeaders(user);

    // Act
    const res = await request(app)
      .put(`/api/admin/events/${event._id}/publish`)
      .set(headers)
      .send({ expectedVersion: event._version });

    // Assert
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
```

### Key Test Rules

- Always include positive AND negative test cases
- Test IDs follow pattern: `XX-1`, `XX-2` (prefix per feature)
- Use `createTestEvent` defaults but override explicitly for validation tests
- Check `_version` incremented on writes
- Check `statusHistory` pushed on state transitions
- For conflict tests: set top-level `startDateTime`/`endDateTime` (not just nested)

---

## Retry Safety

Any retry logic MUST use `retryWithBackoff` from `backend/utils/retryWithBackoff.js`:

```javascript
const { retryWithBackoff } = require('./utils/retryWithBackoff');

const result = await retryWithBackoff(
  () => graphApiService.createCalendarEvent(owner, calId, data),
  { maxAttempts: 3, baseDelayMs: 1000, jitter: true }
);
```

For batch deletions, use `batchDelete` from `backend/utils/batchDelete.js` which handles retry + progress + bounded failure internally.

---

## Quick Reference: Status Machine

```
draft -> pending -> published -> deleted
                 -> rejected  -> deleted
         draft   -> deleted

Restore walks statusHistory[] backwards to find previous status.
```

## Quick Reference: Collections

| Collection | Purpose |
|---|---|
| templeEvents__Events | All events (unified storage) |
| templeEvents__Users | User profiles + preferences |
| templeEvents__Locations | Rooms + event locations |
| templeEvents__CalendarDeltas | Delta sync tokens |
| templeEvents__Categories | Event categories |
| templeEvents__SystemSettings | System config |
| templeEvents__EventAuditHistory | Audit trail |
