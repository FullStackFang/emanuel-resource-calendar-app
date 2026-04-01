# Status Field Implementation Guide

## Overview
This guide documents the changes needed to implement a consistent `status` field across all events in the `templeEvents__Events` collection.

## Status Values

- **"active"**: Published/confirmed events (visible on calendar)
  - Regular calendar events from Graph sync
  - Approved room reservations
  - Manually created events

- **"pending"**: Awaiting approval/action
  - New room reservation requests
  - Events awaiting review

- **"inactive"**: Archived/cancelled events
  - Deleted events (soft delete)
  - Cancelled/rejected room reservations

**Default for new events**: `"pending"` (for reservations) or `"active"` (for Graph sync)

---

## Migration Steps

### Step 1: Run Migration Script

```bash
cd backend
node migrate-add-status-field.js
```

This will:
1. Set all existing regular events to `status: "active"`
2. Map old statuses:
   - `"room-reservation-request"` → `"pending"`
   - `"approved"` → `"active"`
   - `"rejected"` → `"inactive"`

---

## Backend Code Changes Required

### 1. Graph API Event Sync (Multiple Locations)

**Search for:** Places where Graph events are inserted/updated in `unifiedEventsCollection`

**Common patterns to find:**
```javascript
// Pattern 1: Direct insertOne
await unifiedEventsCollection.insertOne({
  eventId: graphEvent.id,
  userId: userId,
  // ... other fields
});

// Pattern 2: updateOne with upsert
await unifiedEventsCollection.updateOne(
  { eventId: graphEvent.id, userId: userId },
  { $set: { /* fields */ } },
  { upsert: true }
);

// Pattern 3: bulkWrite operations
unifiedEventsCollection.bulkWrite([
  {
    updateOne: {
      filter: { eventId: event.id, userId: userId },
      update: { $set: { /* fields */ } },
      upsert: true
    }
  }
]);
```

**Add to all Graph sync operations:**
```javascript
status: "active"  // Graph events are always active
```

**Likely locations in api-server.js:**
- Delta sync endpoint (`/api/unified/delta-sync` or similar)
- Full sync operations
- Event creation/update handlers
- Bulk import operations

### 2. Room Reservation Creation

**File:** `backend/api-server.js`
**Search for:** `evt-request-` (custom event ID pattern)

**Find code like:**
```javascript
const newEvent = {
  eventId: `evt-request-${timestamp}-${randomId}`,
  userId: userId,
  source: 'Room Reservation System',
  roomReservationData: { /* ... */ },
  // ...
};
```

**Change old status:**
```javascript
// OLD:
status: 'room-reservation-request'

// NEW:
status: 'pending'
```

### 3. Approval Handler

**Search for:** Reservation approval logic

**Find code like:**
```javascript
// When approving a reservation
await unifiedEventsCollection.updateOne(
  { eventId: reservationEventId },
  {
    $set: {
      status: 'approved',  // OLD
      // ...
    }
  }
);
```

**Change to:**
```javascript
$set: {
  status: 'active',  // NEW
  // ...
}
```

### 4. Rejection Handler

**Search for:** Reservation rejection logic

**Find code like:**
```javascript
// When rejecting a reservation
await unifiedEventsCollection.updateOne(
  { eventId: reservationEventId },
  {
    $set: {
      status: 'rejected',  // OLD
      // ...
    }
  }
);
```

**Change to:**
```javascript
$set: {
  status: 'inactive',  // NEW
  // ...
}
```

### 5. Event Deletion (Soft Delete)

**Search for:** Event deletion logic

**Find code like:**
```javascript
await unifiedEventsCollection.updateOne(
  { eventId: eventId },
  {
    $set: {
      isDeleted: true,
      // ...
    }
  }
);
```

**Add status update:**
```javascript
$set: {
  isDeleted: true,
  status: 'inactive',  // NEW - mark as inactive when deleted
  // ...
}
```

---

## Frontend Code Changes

### Update AttachmentsSection ReadOnly Logic

**File:** `src/components/UnifiedEventForm.jsx`
**Line:** ~1204

**Change from:**
```jsx
<AttachmentsSection
  resourceId={reservation?.eventId}
  resourceType="event"
  apiToken={apiToken}
  readOnly={reservation?.status !== 'pending'}  // OLD - assumes status exists
/>
```

**Change to (Option 1 - After migration):**
```jsx
<AttachmentsSection
  resourceId={reservation?.eventId}
  resourceType="event"
  apiToken={apiToken}
  readOnly={reservation?.status !== 'active' && reservation?.status !== 'pending'}
  // Allow editing if active OR pending
/>
```

**Or (Option 2 - Simpler):**
```jsx
<AttachmentsSection
  resourceId={reservation?.eventId}
  resourceType="event"
  apiToken={apiToken}
  readOnly={reservation?.status === 'inactive'}
  // Only read-only if inactive (rejected/cancelled)
/>
```

---

## Verification Checklist

After implementation, verify:

- [ ] Migration script runs successfully
- [ ] All events have a `status` field
- [ ] No events have old status values (`"room-reservation-request"`, `"approved"`, `"rejected"`)
- [ ] New Graph sync events get `status: "active"`
- [ ] New room reservations get `status: "pending"`
- [ ] Approved reservations change to `status: "active"`
- [ ] Rejected reservations change to `status: "inactive"`
- [ ] Attachments are editable for active events
- [ ] Attachments are editable for pending reservations
- [ ] Attachments are read-only for inactive events

---

## MongoDB Queries for Testing

```javascript
// Count events by status
db.templeEvents__Events.aggregate([
  { $group: { _id: "$status", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]);

// Find events without status (should be 0 after migration)
db.templeEvents__Events.countDocuments({ status: { $exists: false } });

// Find events with old status values (should be 0 after migration)
db.templeEvents__Events.countDocuments({
  status: { $in: ["room-reservation-request", "approved", "rejected"] }
});

// Sample active events
db.templeEvents__Events.find({ status: "active" }).limit(5);

// Sample pending reservations
db.templeEvents__Events.find({
  status: "pending",
  roomReservationData: { $exists: true }
}).limit(5);
```

---

## Rollback Plan

If migration causes issues:

```javascript
// Revert status field changes
db.templeEvents__Events.updateMany(
  { status: "pending", roomReservationData: { $exists: true } },
  { $set: { status: "room-reservation-request" } }
);

db.templeEvents__Events.updateMany(
  { status: "active", roomReservationData: { $exists: true } },
  { $set: { status: "approved" } }
);

db.templeEvents__Events.updateMany(
  { status: "inactive", roomReservationData: { $exists: true } },
  { $set: { status: "rejected" } }
);

// Remove status from regular events if needed
db.templeEvents__Events.updateMany(
  { status: "active", roomReservationData: { $exists: false } },
  { $unset: { status: "" } }
);
```

---

## Notes

- Keep `roomReservationData` as undefined for regular events (this is correct)
- Status field should exist on ALL events after migration
- Frontend code should always check status, not roomReservationData existence
- Old status values should be completely phased out
