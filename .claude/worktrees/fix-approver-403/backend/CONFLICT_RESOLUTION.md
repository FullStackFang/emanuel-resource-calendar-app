# Conflict Resolution & Concurrency Control

This document explains the comprehensive conflict resolution strategy implemented for the Room Reservation System in the Temple Events Calendar application.

## Table of Contents
- [Overview](#overview)
- [Three-Layer Protection Strategy](#three-layer-protection-strategy)
- [ETag/ChangeKey Implementation](#etagchangekey-implementation)
- [Soft Hold System](#soft-hold-system)
- [Conflict Detection](#conflict-detection)
- [Workflow Diagrams](#workflow-diagrams)
- [Error Handling](#error-handling)
- [Admin Troubleshooting](#admin-troubleshooting)

---

## Overview

The Room Reservation System handles concurrent editing scenarios where multiple staff members may be reviewing or modifying the same reservation request simultaneously. Our solution combines **Outlook-style optimistic concurrency control** with **soft holds** and **proactive conflict detection** to provide a robust, user-friendly experience.

### Why This Matters

**Problem scenarios we prevent:**
1. **Lost Updates**: Two admins approve the same request with different modifications → one set of changes is lost
2. **Double Booking**: Admin A approves a room while Admin B is approving a conflicting reservation
3. **Review Collision**: Multiple admins editing the same request simultaneously, causing confusion
4. **Stale Data**: Admin makes a decision based on outdated information

**Design Goals:**
- Prevent data loss from concurrent edits
- Minimize user frustration with locks
- Provide clear feedback on conflicts
- Allow override when appropriate
- Scale to multiple concurrent reviewers

---

## Three-Layer Protection Strategy

Our implementation uses **three complementary layers** working together:

```
┌──────────────────────────────────────────────────────────┐
│  Layer 1: ETag/ChangeKey (Optimistic Concurrency)       │
│  ✓ Detects concurrent modifications                      │
│  ✓ Returns 409 Conflict if data changed                  │
│  ✓ Lightweight, no locks required                        │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│  Layer 2: Soft Holds (Review Lock)                       │
│  ✓ Prevents review collisions                            │
│  ✓ 30-minute auto-expiration                             │
│  ✓ Returns 423 Locked if someone else reviewing          │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│  Layer 3: Conflict Detection (Scheduling Validation)     │
│  ✓ Checks room availability before approval              │
│  ✓ Considers setup/teardown times                        │
│  ✓ Returns 409 Conflict with override option             │
└──────────────────────────────────────────────────────────┘
```

### When Each Layer Activates

| Scenario | Layer 1 (ETag) | Layer 2 (Soft Hold) | Layer 3 (Conflicts) |
|----------|---------------|---------------------|---------------------|
| Admin opens review modal | — | ✓ Acquires hold | ✓ Checks conflicts |
| Admin saves changes | ✓ Validates changeKey | — | — |
| Admin approves request | ✓ Validates changeKey | — | ✓ Re-checks conflicts |
| Another admin tries to review | — | ✓ Returns 423 Locked | — |
| Data changed elsewhere | ✓ Returns 409 Conflict | — | — |
| Auto-release after 30 min | — | ✓ Releases hold | — |

---

## ETag/ChangeKey Implementation

### What is an ETag?

An **ETag (Entity Tag)** is a version identifier used in HTTP for optimistic concurrency control. Microsoft Outlook uses this approach extensively via the `changeKey` property on calendar events.

**How it works:**
1. Every reservation has a unique `changeKey` (generated hash)
2. When client fetches data, server sends `changeKey` in response
3. When client updates data, it includes the `changeKey` it originally received
4. Server validates: if `changeKey` matches, update succeeds; if not, returns 409 Conflict

### Database Schema

```javascript
// roomReservations collection
{
  _id: ObjectId,
  // ... existing fields ...

  // Optimistic Concurrency Control
  changeKey: String,              // Version identifier (hash of critical fields)
  lastModified: Date,             // Timestamp of last modification
  lastModifiedBy: String,         // Email of user who made last change

  // Revision History
  revisions: [
    {
      revisionNumber: Number,
      changeKey: String,
      timestamp: Date,
      modifiedBy: String,
      changes: [
        {
          field: String,          // e.g., "eventTitle"
          oldValue: Mixed,
          newValue: Mixed
        }
      ]
    }
  ]
}
```

### ChangeKey Generation

```javascript
/**
 * Generates a unique changeKey based on reservation data
 * Similar to Outlook's ETag generation
 */
function generateChangeKey(reservation) {
  const crypto = require('crypto');

  // Include only fields that matter for version comparison
  const versionData = {
    eventTitle: reservation.eventTitle,
    startDateTime: reservation.startDateTime,
    endDateTime: reservation.endDateTime,
    selectedRooms: reservation.selectedRooms,
    setupTimeMinutes: reservation.setupTimeMinutes,
    teardownTimeMinutes: reservation.teardownTimeMinutes,
    attendeeCount: reservation.attendeeCount,
    status: reservation.status,
    lastModified: reservation.lastModified || new Date()
  };

  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(versionData))
    .digest('hex');

  return hash.substring(0, 16); // First 16 chars for brevity
}
```

### API Workflow

#### 1. GET /api/admin/room-reservations/:id

**Response:**
```javascript
HTTP/1.1 200 OK
ETag: "a3c5f8912bde4710"
Content-Type: application/json

{
  "_id": "...",
  "eventTitle": "Youth Group Meeting",
  "changeKey": "a3c5f8912bde4710",
  "lastModified": "2025-10-15T14:30:00Z",
  "lastModifiedBy": "admin@example.com",
  // ... other fields ...
}
```

#### 2. PUT /api/admin/room-reservations/:id (Update)

**Request:**
```javascript
PUT /api/admin/room-reservations/123
If-Match: "a3c5f8912bde4710"
Content-Type: application/json

{
  "eventTitle": "Youth Group Meeting (Updated)",
  "attendeeCount": 50
}
```

**Success Response:**
```javascript
HTTP/1.1 200 OK
ETag: "f7b2d3a84c6e1095"

{
  "_id": "123",
  "eventTitle": "Youth Group Meeting (Updated)",
  "changeKey": "f7b2d3a84c6e1095",  // NEW changeKey
  "lastModified": "2025-10-15T14:35:00Z",
  "lastModifiedBy": "staff@example.com"
}
```

**Conflict Response (if changeKey mismatch):**
```javascript
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "error": "ConflictError",
  "message": "This reservation was modified by another user. Please refresh and try again.",
  "currentChangeKey": "f7b2d3a84c6e1095",
  "lastModifiedBy": "otherperson@example.com",
  "lastModified": "2025-10-15T14:33:00Z",
  "changes": [
    {
      "field": "attendeeCount",
      "oldValue": 45,
      "newValue": 60
    }
  ]
}
```

#### 3. POST /api/admin/room-reservations/:id/approve (Approval)

**Request:**
```javascript
POST /api/admin/room-reservations/123/approve
If-Match: "f7b2d3a84c6e1095"
Content-Type: application/json

{
  "createCalendarEvent": true,
  "forceApprove": false  // Set to true to override conflicts
}
```

**Backend Logic:**
```javascript
async function approveReservation(req, res) {
  const { id } = req.params;
  const clientChangeKey = req.headers['if-match']?.replace(/"/g, '');
  const { createCalendarEvent, forceApprove } = req.body;

  // Step 1: Fetch current reservation
  const current = await roomReservationsCollection.findOne({ _id: ObjectId(id) });

  // Step 2: Optimistic concurrency check
  if (current.changeKey !== clientChangeKey) {
    return res.status(409).json({
      error: 'ConflictError',
      message: 'This reservation was modified by another user.',
      currentChangeKey: current.changeKey,
      lastModifiedBy: current.lastModifiedBy,
      lastModified: current.lastModified
    });
  }

  // Step 3: Check for scheduling conflicts
  const conflicts = await checkRoomConflicts(current);

  if (conflicts.length > 0 && !forceApprove) {
    return res.status(409).json({
      error: 'SchedulingConflict',
      message: 'This reservation conflicts with existing approved events.',
      conflicts: conflicts,
      requiresOverride: true
    });
  }

  // Step 4: Atomic approval with changeKey validation
  const newChangeKey = generateChangeKey({
    ...current,
    status: 'approved',
    lastModified: new Date()
  });

  const result = await roomReservationsCollection.updateOne(
    {
      _id: ObjectId(id),
      changeKey: clientChangeKey  // Double-check in update query
    },
    {
      $set: {
        status: 'approved',
        approvedBy: req.user.email,
        approvedAt: new Date(),
        changeKey: newChangeKey,
        lastModified: new Date(),
        lastModifiedBy: req.user.email,
        reviewStatus: 'completed'
      },
      $push: {
        revisions: {
          revisionNumber: (current.revisions?.length || 0) + 1,
          changeKey: newChangeKey,
          timestamp: new Date(),
          modifiedBy: req.user.email,
          changes: [
            { field: 'status', oldValue: current.status, newValue: 'approved' }
          ]
        }
      }
    }
  );

  // If matchedCount === 0, another update happened between steps 2 and 4
  if (result.matchedCount === 0) {
    return res.status(409).json({
      error: 'ConflictError',
      message: 'Reservation was modified during approval process.'
    });
  }

  // Step 5: Create calendar event if requested
  if (createCalendarEvent) {
    await createGraphCalendarEvent(current);
  }

  return res.status(200).json({
    success: true,
    changeKey: newChangeKey
  });
}
```

---

## Soft Hold System

### What is a Soft Hold?

A **soft hold** is a temporary, time-limited lock that indicates someone is actively reviewing a reservation. Unlike hard locks (which prevent all access), soft holds:
- ✓ Allow viewing by others
- ✓ Prevent concurrent editing
- ✓ Auto-expire after 30 minutes (no manual cleanup needed)
- ✓ Can be forcibly released by admins

### Database Schema

```javascript
// roomReservations collection
{
  _id: ObjectId,
  // ... existing fields ...

  // Soft Hold System
  reviewStatus: String,           // 'not_started' | 'reviewing' | 'completed'
  reviewingBy: String,            // Email of current reviewer
  reviewStartedAt: Date,          // When review began
  reviewExpiresAt: Date,          // Auto-release time (reviewStartedAt + 30min)

  // Hold History
  reviewHistory: [
    {
      reviewingBy: String,
      startedAt: Date,
      completedAt: Date,
      releasedBy: String,         // 'auto-timeout' | email
      outcome: String             // 'approved' | 'rejected' | 'abandoned' | 'expired'
    }
  ]
}
```

### API Endpoints

#### 1. POST /api/admin/room-reservations/:id/start-review

**Purpose**: Acquire a soft hold when admin opens review modal

**Request:**
```javascript
POST /api/admin/room-reservations/123/start-review
Authorization: Bearer <token>
```

**Backend Logic:**
```javascript
async function startReview(req, res) {
  const { id } = req.params;
  const reviewerEmail = req.user.email;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (30 * 60 * 1000)); // 30 minutes

  const current = await roomReservationsCollection.findOne({ _id: ObjectId(id) });

  // Check if someone else is currently reviewing
  if (
    current.reviewStatus === 'reviewing' &&
    current.reviewExpiresAt > now &&
    current.reviewingBy !== reviewerEmail
  ) {
    const minutesRemaining = Math.ceil(
      (current.reviewExpiresAt - now) / (60 * 1000)
    );

    return res.status(423).json({
      error: 'ResourceLocked',
      message: `Currently being reviewed by ${current.reviewingBy}`,
      reviewingBy: current.reviewingBy,
      reviewStartedAt: current.reviewStartedAt,
      reviewExpiresAt: current.reviewExpiresAt,
      minutesRemaining: minutesRemaining
    });
  }

  // Acquire hold (or renew if it's the same user)
  await roomReservationsCollection.updateOne(
    { _id: ObjectId(id) },
    {
      $set: {
        reviewStatus: 'reviewing',
        reviewingBy: reviewerEmail,
        reviewStartedAt: now,
        reviewExpiresAt: expiresAt
      }
    }
  );

  return res.status(200).json({
    success: true,
    reviewExpiresAt: expiresAt,
    durationMinutes: 30
  });
}
```

**Success Response:**
```javascript
HTTP/1.1 200 OK

{
  "success": true,
  "reviewExpiresAt": "2025-10-15T15:05:00Z",
  "durationMinutes": 30
}
```

**Locked Response:**
```javascript
HTTP/1.1 423 Locked

{
  "error": "ResourceLocked",
  "message": "Currently being reviewed by admin@example.com",
  "reviewingBy": "admin@example.com",
  "reviewStartedAt": "2025-10-15T14:40:00Z",
  "reviewExpiresAt": "2025-10-15T15:10:00Z",
  "minutesRemaining": 25
}
```

#### 2. POST /api/admin/room-reservations/:id/release-review

**Purpose**: Manually release hold when admin closes modal or completes review

**Request:**
```javascript
POST /api/admin/room-reservations/123/release-review
Authorization: Bearer <token>
```

**Backend Logic:**
```javascript
async function releaseReview(req, res) {
  const { id } = req.params;
  const reviewerEmail = req.user.email;

  const current = await roomReservationsCollection.findOne({ _id: ObjectId(id) });

  // Only the current reviewer can release (or admins via force flag)
  if (current.reviewingBy !== reviewerEmail && !req.body.force) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Only the current reviewer can release this hold'
    });
  }

  // Record in history
  await roomReservationsCollection.updateOne(
    { _id: ObjectId(id) },
    {
      $set: {
        reviewStatus: 'not_started',
        reviewingBy: null,
        reviewStartedAt: null,
        reviewExpiresAt: null
      },
      $push: {
        reviewHistory: {
          reviewingBy: current.reviewingBy,
          startedAt: current.reviewStartedAt,
          completedAt: new Date(),
          releasedBy: req.body.force ? reviewerEmail : current.reviewingBy,
          outcome: 'abandoned'
        }
      }
    }
  );

  return res.status(200).json({ success: true });
}
```

#### 3. Background Job: Auto-Release Expired Holds

**Runs every 5 minutes via cron job or setTimeout loop:**

```javascript
async function releaseExpiredHolds() {
  const now = new Date();

  const expiredHolds = await roomReservationsCollection.find({
    reviewStatus: 'reviewing',
    reviewExpiresAt: { $lt: now }
  }).toArray();

  if (expiredHolds.length === 0) {
    console.log('[Hold Cleanup] No expired holds found');
    return;
  }

  console.log(`[Hold Cleanup] Releasing ${expiredHolds.length} expired holds`);

  for (const reservation of expiredHolds) {
    await roomReservationsCollection.updateOne(
      { _id: reservation._id },
      {
        $set: {
          reviewStatus: 'not_started',
          reviewingBy: null,
          reviewStartedAt: null,
          reviewExpiresAt: null
        },
        $push: {
          reviewHistory: {
            reviewingBy: reservation.reviewingBy,
            startedAt: reservation.reviewStartedAt,
            completedAt: now,
            releasedBy: 'auto-timeout',
            outcome: 'expired'
          }
        }
      }
    );
  }

  console.log('[Hold Cleanup] Cleanup complete');
}

// Start background job
setInterval(releaseExpiredHolds, 5 * 60 * 1000); // Every 5 minutes
```

### Frontend Integration

```javascript
// ReservationRequests.jsx

const [reviewHold, setReviewHold] = useState(null);
const [holdTimer, setHoldTimer] = useState(null);

// Acquire hold when modal opens
const openReviewModal = async (reservation) => {
  try {
    const response = await fetch(
      `${API_BASE}/admin/room-reservations/${reservation._id}/start-review`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    if (response.status === 423) {
      const data = await response.json();
      alert(`This reservation is currently being reviewed by ${data.reviewingBy}. ` +
            `The hold will expire in ${data.minutesRemaining} minutes.`);
      return;
    }

    const data = await response.json();
    setReviewHold({
      expiresAt: new Date(data.reviewExpiresAt),
      durationMinutes: data.durationMinutes
    });

    // Set up countdown timer
    const timer = setInterval(() => {
      const remaining = Math.max(0, data.reviewExpiresAt - Date.now());
      if (remaining === 0) {
        alert('Your review session has expired. Please reopen the modal to continue.');
        closeReviewModal();
      }
    }, 60000); // Check every minute

    setHoldTimer(timer);

    // Open modal with reservation data
    setSelectedReservation(reservation);
    setShowReviewModal(true);

  } catch (error) {
    console.error('Failed to acquire review hold:', error);
    alert('Failed to start review. Please try again.');
  }
};

// Release hold when modal closes
const closeReviewModal = async () => {
  if (holdTimer) {
    clearInterval(holdTimer);
  }

  if (selectedReservation) {
    try {
      await fetch(
        `${API_BASE}/admin/room-reservations/${selectedReservation._id}/release-review`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
    } catch (error) {
      console.error('Failed to release hold:', error);
    }
  }

  setShowReviewModal(false);
  setSelectedReservation(null);
  setReviewHold(null);
};

// Render hold status in modal
<div className="review-hold-status">
  {reviewHold && (
    <div className="hold-indicator">
      🔒 You have this reservation locked for review
      <span className="hold-timer">
        Expires in {Math.ceil((reviewHold.expiresAt - Date.now()) / 60000)} minutes
      </span>
    </div>
  )}
</div>
```

---

## Conflict Detection

### What We Detect

**Scheduling conflicts occur when:**
1. **Room overlap**: Same room requested for overlapping time periods
2. **Setup/Teardown overlap**: Core event times don't overlap, but setup/teardown buffers do
3. **Approved vs Pending**: Both approved and pending reservations count as conflicts

### Conflict Check Algorithm

```javascript
/**
 * Checks for scheduling conflicts with a given reservation
 * @param {Object} reservation - The reservation to check
 * @returns {Array} Array of conflicting reservations
 */
async function checkRoomConflicts(reservation) {
  const setupMinutes = reservation.setupTimeMinutes || 0;
  const teardownMinutes = reservation.teardownTimeMinutes || 0;

  // Calculate total time window (core event + buffers)
  const startWithSetup = new Date(
    reservation.startDateTime.getTime() - (setupMinutes * 60 * 1000)
  );
  const endWithTeardown = new Date(
    reservation.endDateTime.getTime() + (teardownMinutes * 60 * 1000)
  );

  // Query overlapping reservations
  const potentialConflicts = await roomReservationsCollection.find({
    _id: { $ne: reservation._id },  // Exclude self
    status: { $in: ['approved', 'pending'] },

    // Date overlap check (broad range for efficiency)
    startDateTime: { $lt: endWithTeardown },
    endDateTime: { $gt: startWithSetup },

    // Room overlap check
    selectedRooms: {
      $elemMatch: {
        roomId: { $in: reservation.selectedRooms.map(r => r.roomId) }
      }
    }
  }).toArray();

  // Filter to exact conflicts (considering setup/teardown)
  const conflicts = potentialConflicts.filter(other => {
    const otherSetupMinutes = other.setupTimeMinutes || 0;
    const otherTeardownMinutes = other.teardownTimeMinutes || 0;

    const otherStart = new Date(
      other.startDateTime.getTime() - (otherSetupMinutes * 60 * 1000)
    );
    const otherEnd = new Date(
      other.endDateTime.getTime() + (otherTeardownMinutes * 60 * 1000)
    );

    // Check for ANY time overlap
    return startWithSetup < otherEnd && endWithTeardown > otherStart;
  });

  return conflicts.map(conflict => ({
    reservationId: conflict._id,
    eventTitle: conflict.eventTitle,
    startDateTime: conflict.startDateTime,
    endDateTime: conflict.endDateTime,
    setupTimeMinutes: conflict.setupTimeMinutes || 0,
    teardownTimeMinutes: conflict.teardownTimeMinutes || 0,
    status: conflict.status,
    conflictingRooms: reservation.selectedRooms.filter(room =>
      conflict.selectedRooms.some(other => other.roomId === room.roomId)
    ).map(room => room.roomName)
  }));
}
```

### When Conflicts Are Checked

1. **On review modal open**: Show conflicts immediately
2. **On field changes**: Re-check if time/room fields modified
3. **Before approval**: Final validation before changing status
4. **On save**: Validate and record in `conflictDetails` field

### Conflict Display in UI

```jsx
// ReservationRequests.jsx - Conflict section in modal

<div className="conflict-section">
  <h3>⚠️ Scheduling Conflicts</h3>

  {conflicts.length === 0 ? (
    <div className="no-conflicts">
      ✓ No scheduling conflicts detected
    </div>
  ) : (
    <div className="conflicts-list">
      {conflicts.map((conflict, idx) => (
        <div key={idx} className="conflict-item">
          <div className="conflict-header">
            <strong>{conflict.eventTitle}</strong>
            <span className={`status-badge ${conflict.status}`}>
              {conflict.status}
            </span>
          </div>

          <div className="conflict-details">
            <div>
              📅 {new Date(conflict.startDateTime).toLocaleString()} -
              {new Date(conflict.endDateTime).toLocaleString()}
            </div>

            {(conflict.setupTimeMinutes > 0 || conflict.teardownTimeMinutes > 0) && (
              <div className="conflict-buffers">
                Setup: {conflict.setupTimeMinutes}min |
                Teardown: {conflict.teardownTimeMinutes}min
              </div>
            )}

            <div className="conflicting-rooms">
              🚪 {conflict.conflictingRooms.join(', ')}
            </div>
          </div>
        </div>
      ))}

      <div className="conflict-override">
        <label>
          <input
            type="checkbox"
            checked={forceApprove}
            onChange={(e) => setForceApprove(e.target.checked)}
          />
          <strong>Override conflicts and approve anyway</strong>
          <div className="override-warning">
            ⚠️ This will create a double-booking. Ensure you have confirmed
            alternative arrangements with the requester.
          </div>
        </label>
      </div>
    </div>
  )}
</div>
```

---

## Workflow Diagrams

### 1. Normal Approval Workflow (No Conflicts)

```
┌─────────────┐
│  Admin A    │
│ Opens Modal │
└──────┬──────┘
       │
       ↓
┌─────────────────────────────────────────┐
│ POST /start-review                      │
│ ✓ No active holds                       │
│ ✓ Acquire 30-min soft hold              │
│ ✓ Check conflicts → None found          │
└──────┬──────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────┐
│ Admin reviews & edits details           │
│ - Changes attendee count                │
│ - Adds internal notes                   │
└──────┬──────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────┐
│ PUT /room-reservations/:id              │
│ If-Match: "a3c5f8912bde4710"            │
│ ✓ ChangeKey matches                     │
│ ✓ Update succeeds                       │
│ ✓ New changeKey: "f7b2d3a84c6e1095"     │
└──────┬──────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────┐
│ Admin clicks "Approve"                  │
│ POST /approve                           │
│ If-Match: "f7b2d3a84c6e1095"            │
│ forceApprove: false                     │
└──────┬──────────────────────────────────┘
       │
       ↓
┌─────────────────────────────────────────┐
│ Backend Validation                      │
│ 1. ✓ ChangeKey matches                  │
│ 2. ✓ Re-check conflicts → Still none    │
│ 3. ✓ Atomic update with changeKey check │
│ 4. ✓ Create calendar event in Graph API │
│ 5. ✓ Release soft hold                  │
└──────┬──────────────────────────────────┘
       │
       ↓
┌─────────────┐
│ ✓ APPROVED  │
└─────────────┘
```

### 2. Concurrent Edit Scenario (409 Conflict)

```
┌─────────────┐                    ┌─────────────┐
│  Admin A    │                    │  Admin B    │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ Opens modal (14:30)              │
       ↓                                  │
┌──────────────────┐                      │
│ Acquires hold    │                      │
│ changeKey: "abc" │                      │
└──────┬───────────┘                      │
       │                                  │
       │ Edits attendee count             │
       │ 45 → 60                          │
       ↓                                  │
┌──────────────────┐                      │
│ PUT /update      │                      │
│ ✓ Success        │                      │
│ changeKey: "def" │                      │
└──────────────────┘                      │
       │                                  │
       │ Hold expires (15:00)             │
       │ Auto-released                    │
       │                                  │
       │                                  │ Opens modal (15:05)
       │                                  ↓
       │                           ┌──────────────────┐
       │                           │ Acquires hold    │
       │                           │ changeKey: "def" │
       │                           │ (latest version) │
       │                           └──────┬───────────┘
       │                                  │
       │                                  │ Edits attendee count
       │                                  │ 60 → 70
       │                                  ↓
       │                           ┌──────────────────┐
       │                           │ PUT /update      │
       │                           │ If-Match: "def"  │
       │                           │ ✓ Success        │
       │                           │ changeKey: "ghi" │
       │                           └──────────────────┘
       │                                  │
       │ Comes back (15:10)               │
       │ Tries to approve                 │
       ↓                                  │
┌──────────────────┐                      │
│ POST /approve    │                      │
│ If-Match: "abc"  │ ← STALE!             │
└──────┬───────────┘                      │
       │                                  │
       ↓                                  │
┌──────────────────────────────────────┐  │
│ 409 Conflict                         │  │
│ "Modified by admin-b@example.com"    │  │
│ Current changeKey: "ghi"             │  │
│ Changes:                             │  │
│ - attendeeCount: 60 → 70             │  │
└──────┬───────────────────────────────┘  │
       │                                  │
       ↓                                  │
┌──────────────────┐                      │
│ Refresh modal    │                      │
│ Load latest data │                      │
│ changeKey: "ghi" │                      │
└──────────────────┘                      │
                                          ↓
                                   ┌──────────────┐
                                   │ Admin B      │
                                   │ approves     │
                                   │ ✓ Success    │
                                   └──────────────┘
```

### 3. Soft Hold Timeout Scenario

```
┌─────────────┐
│  Admin A    │
│ Opens modal │
└──────┬──────┘
       │
       ↓
┌─────────────────────────────────┐
│ Acquires hold (14:30)           │
│ Expires at: 15:00               │
└──────┬──────────────────────────┘
       │
       │ Reviews reservation...
       │ (gets distracted, walks away)
       │
       ↓
     (time passes)
       │
       ↓
┌─────────────────────────────────┐
│ 15:00 - Hold expires            │
│ Background job runs             │
│ ✓ Auto-release hold             │
│ reviewStatus: 'not_started'     │
│ reviewingBy: null               │
└─────────────────────────────────┘
       │
       ↓
┌─────────────┐                    ┌─────────────┐
│  Admin A    │                    │  Admin B    │
│ Comes back  │                    │ Opens modal │
│ (15:05)     │                    │ (15:03)     │
└──────┬──────┘                    └──────┬──────┘
       │                                  │
       │ Tries to save changes            │
       ↓                                  ↓
┌──────────────────┐             ┌────────────────────┐
│ PUT /update      │             │ ✓ Acquires hold    │
│ ✓ Still works!   │             │ ✓ Reviewing freely │
│ (no hold needed  │             └────────────────────┘
│  for saves)      │
└──────────────────┘

Note: Admin A can still save changes (ETag validation handles conflicts)
      but Admin B now has the soft hold for review
```

### 4. Conflict Detection & Override

```
┌─────────────┐
│  Admin      │
│ Opens modal │
└──────┬──────┘
       │
       ↓
┌──────────────────────────────────────┐
│ Check conflicts on load              │
│ ✓ Found 2 conflicting reservations:  │
│   1. "Board Meeting" (approved)      │
│   2. "Staff Training" (pending)      │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│ Display conflicts in UI              │
│ [ ] Override conflicts and approve   │
└──────┬───────────────────────────────┘
       │
       │ Option 1: Fix conflicts
       ↓
┌──────────────────────────────────────┐
│ Admin edits time/room to avoid       │
│ conflict                             │
│ → Re-check conflicts                 │
│ ✓ No conflicts found                 │
│ → Approve normally                   │
└──────────────────────────────────────┘

       │ Option 2: Override
       ↓
┌──────────────────────────────────────┐
│ Admin checks override checkbox       │
│ ✓ Acknowledges double-booking risk   │
│ → POST /approve with forceApprove    │
└──────┬───────────────────────────────┘
       │
       ↓
┌──────────────────────────────────────┐
│ Backend bypasses conflict check      │
│ ✓ Approved with conflicts recorded   │
│ conflictDetails: [...2 conflicts]    │
└──────────────────────────────────────┘
```

---

## Error Handling

### HTTP Status Codes

| Code | Error | Meaning | User Action |
|------|-------|---------|-------------|
| 409  | ConflictError | Data was modified by another user | Refresh and try again |
| 409  | SchedulingConflict | Room conflicts with other reservations | Modify time/room or override |
| 423  | ResourceLocked | Another user is reviewing | Wait or contact reviewer |
| 412  | PreconditionFailed | If-Match header missing or malformed | Technical error - report to admin |

### Frontend Error Display

```javascript
// Handle 409 Conflict (ETag mismatch)
if (response.status === 409 && data.error === 'ConflictError') {
  const message = `
    This reservation was modified by ${data.lastModifiedBy} while you were editing.

    Changes made:
    ${data.changes.map(c => `- ${c.field}: ${c.oldValue} → ${c.newValue}`).join('\n')}

    Your changes have NOT been saved. Would you like to:
    1. Refresh to see the latest version (your changes will be lost)
    2. Copy your changes and manually merge them
  `;

  if (confirm(message)) {
    await refreshReservation(reservationId);
  }
}

// Handle 409 Conflict (Scheduling conflict)
if (response.status === 409 && data.error === 'SchedulingConflict') {
  setConflicts(data.conflicts);
  alert(`Cannot approve: ${data.conflicts.length} scheduling conflict(s) detected. ` +
        `Please review conflicts below and either modify the reservation or ` +
        `check "Override conflicts" to force approval.`);
}

// Handle 423 Locked (Soft hold)
if (response.status === 423) {
  const minutesRemaining = Math.ceil(
    (new Date(data.reviewExpiresAt) - Date.now()) / 60000
  );

  alert(`This reservation is currently being reviewed by ${data.reviewingBy}. ` +
        `The hold will automatically expire in ${minutesRemaining} minutes. ` +
        `You can view the reservation but cannot edit it at this time.`);
}
```

### Retry Logic

```javascript
/**
 * Retries an operation with exponential backoff on transient errors
 */
async function retryWithBackoff(operation, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const isTransient = [502, 503, 504].includes(error.status);
      const isLastAttempt = attempt === maxRetries;

      if (!isTransient || isLastAttempt) {
        throw error;
      }

      const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000);
      console.log(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

// Usage
await retryWithBackoff(async () => {
  const response = await fetch(`${API_BASE}/admin/room-reservations/${id}/approve`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'If-Match': changeKey
    },
    body: JSON.stringify({ createCalendarEvent: true })
  });

  if (!response.ok) {
    const error = new Error('Approval failed');
    error.status = response.status;
    error.data = await response.json();
    throw error;
  }

  return response.json();
});
```

---

## Admin Troubleshooting

### Common Issues

#### Issue 1: "I approved a reservation but it shows up as pending"

**Possible causes:**
- ETag conflict (someone else modified it)
- Scheduling conflict without override
- Background job hasn't updated status yet

**Diagnosis:**
```javascript
// Check recent changes
db.templeEvents__RoomReservations.findOne(
  { _id: ObjectId("...") },
  { revisions: { $slice: -5 }, lastModified: 1, status: 1 }
);

// Check for conflicts
const reservation = db.templeEvents__RoomReservations.findOne({ _id: ObjectId("...") });
// Run checkRoomConflicts(reservation) manually
```

**Resolution:**
1. Refresh reservation data
2. Check conflict section
3. If conflicts exist, resolve or use override
4. Try approval again

#### Issue 2: "Hold won't release - stuck in 'reviewing' state"

**Possible causes:**
- Background job not running
- Modal closed without calling release endpoint
- Network error during release

**Diagnosis:**
```javascript
// Check current holds
db.templeEvents__RoomReservations.find({
  reviewStatus: 'reviewing'
}, {
  reviewingBy: 1,
  reviewStartedAt: 1,
  reviewExpiresAt: 1
}).pretty();

// Check if expired
db.templeEvents__RoomReservations.find({
  reviewStatus: 'reviewing',
  reviewExpiresAt: { $lt: new Date() }
}).count();
```

**Resolution:**
```javascript
// Manually release hold
db.templeEvents__RoomReservations.updateOne(
  { _id: ObjectId("...") },
  {
    $set: {
      reviewStatus: 'not_started',
      reviewingBy: null,
      reviewStartedAt: null,
      reviewExpiresAt: null
    },
    $push: {
      reviewHistory: {
        reviewingBy: "previous-reviewer@example.com",
        startedAt: ISODate("..."),
        completedAt: new Date(),
        releasedBy: "manual-admin-release",
        outcome: "expired"
      }
    }
  }
);

// Ensure background job is running
// Check api-server.js logs for "[Hold Cleanup]" messages
```

#### Issue 3: "ChangeKey mismatch but I'm the only one editing"

**Possible causes:**
- Multiple browser tabs open
- Mobile app + web app simultaneously
- Automated sync process updating changeKey

**Diagnosis:**
```javascript
// Check revision history
db.templeEvents__RoomReservations.findOne(
  { _id: ObjectId("...") },
  {
    revisions: 1,
    changeKey: 1,
    lastModifiedBy: 1
  }
).revisions.slice(-10);  // Last 10 revisions
```

**Resolution:**
1. Close all other tabs/apps
2. Refresh to get latest changeKey
3. Make changes again
4. If persists, check for background sync processes

#### Issue 4: "Conflicts showing for reservations in different rooms"

**Possible causes:**
- Multiple rooms selected (check all selected rooms)
- Setup/teardown times causing overlap
- Data corruption (selectedRooms array malformed)

**Diagnosis:**
```javascript
const reservation = db.templeEvents__RoomReservations.findOne({ _id: ObjectId("...") });

console.log("Selected rooms:", reservation.selectedRooms);
console.log("Setup time:", reservation.setupTimeMinutes);
console.log("Teardown time:", reservation.teardownTimeMinutes);

// Calculate effective time range
const startWithSetup = new Date(
  reservation.startDateTime.getTime() - (reservation.setupTimeMinutes * 60 * 1000)
);
const endWithTeardown = new Date(
  reservation.endDateTime.getTime() + (reservation.teardownTimeMinutes * 60 * 1000)
);

console.log("Effective range:", startWithSetup, "to", endWithTeardown);
```

**Resolution:**
- Verify room selections are correct
- Check if setup/teardown times are reasonable
- Re-run conflict check with corrected data

### Monitoring & Logging

**Key metrics to track:**

```javascript
// Daily conflict statistics
db.templeEvents__RoomReservations.aggregate([
  {
    $match: {
      createdAt: { $gte: new Date(Date.now() - 24*60*60*1000) }
    }
  },
  {
    $group: {
      _id: null,
      totalReservations: { $sum: 1 },
      withConflicts: {
        $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ["$conflictDetails", []] } }, 0] }, 1, 0] }
      },
      forceApproved: {
        $sum: { $cond: [{ $eq: ["$approvedWithOverride", true] }, 1, 0] }
      }
    }
  }
]);

// ETag conflict rate
db.templeEvents__RoomReservations.aggregate([
  {
    $unwind: "$revisions"
  },
  {
    $match: {
      "revisions.timestamp": { $gte: new Date(Date.now() - 24*60*60*1000) }
    }
  },
  {
    $group: {
      _id: null,
      totalUpdates: { $sum: 1 },
      conflictRetries: {
        $sum: { $cond: [{ $eq: ["$revisions.outcome", "conflict-retry"] }, 1, 0] }
      }
    }
  }
]);

// Hold usage statistics
db.templeEvents__RoomReservations.aggregate([
  {
    $unwind: "$reviewHistory"
  },
  {
    $match: {
      "reviewHistory.startedAt": { $gte: new Date(Date.now() - 24*60*60*1000) }
    }
  },
  {
    $group: {
      _id: "$reviewHistory.outcome",
      count: { $sum: 1 },
      avgDurationMinutes: {
        $avg: {
          $divide: [
            { $subtract: ["$reviewHistory.completedAt", "$reviewHistory.startedAt"] },
            60000
          ]
        }
      }
    }
  }
]);
```

**Recommended alerts:**

1. **High conflict rate**: If >20% of approvals have conflicts
2. **Frequent force approvals**: If >10% use override
3. **Expired holds**: If >5 holds expire per day (indicates UX issues)
4. **ETag conflict spikes**: If >15% of updates fail with 409

---

## Summary

This conflict resolution system provides **comprehensive protection** against data loss and scheduling conflicts through:

1. **ETag/ChangeKey (Outlook-style optimistic concurrency)**
   - Lightweight, no locks
   - Detects concurrent modifications
   - Preserves both users' work with clear conflict messages

2. **Soft Holds (Review locks)**
   - Prevents review collisions
   - Auto-expires after 30 minutes
   - Doesn't block viewing or other operations

3. **Conflict Detection (Scheduling validation)**
   - Proactive room availability checking
   - Considers setup/teardown times
   - Allows override when needed

**Key benefits:**
- ✓ Zero data loss from concurrent edits
- ✓ Clear user feedback on conflicts
- ✓ Minimal lock contention
- ✓ Scales to multiple reviewers
- ✓ Admin override capability for urgent situations

**Testing recommendations:**
1. Simulate concurrent edits with two browser windows
2. Test hold expiration by waiting 30+ minutes
3. Create intentional scheduling conflicts
4. Verify 409/423 error handling in UI
5. Monitor conflict rates in production

For questions or issues, contact the development team or refer to the troubleshooting section above.
