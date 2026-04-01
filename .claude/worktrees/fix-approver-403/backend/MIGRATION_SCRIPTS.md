# Migration & Cleanup Scripts

This document describes all migration and cleanup scripts in the backend folder, ordered by most recent use.

---

## Recently Used (CSV Import Migration)

### cleanup-csv-graph-duplicates.js
**Purpose:** Remove duplicate graph-sync events after running the CSV-to-Graph migration.

**Problem Solved:** After `migrate-csv-to-graph.js` links CSV imports to Graph API events, duplicate records may exist:
- CSV Import record (`source: "Resource Scheduler Import"`) - now has `graphData.id`
- Graph Sync record (`createdSource: "graph-sync"`) - created when calendar was synced via app

**Usage:**
```bash
cd backend

# Preview what would be deleted (no changes)
node cleanup-csv-graph-duplicates.js --dry-run

# Test with limited records
node cleanup-csv-graph-duplicates.js --dry-run --limit 10

# Run for real
node cleanup-csv-graph-duplicates.js
```

**Options:**
- `--dry-run` - Preview without making changes
- `--limit N` - Process only N records

**Collection:** `templeEvents__Events`

---

### migrate-csv-to-graph.js
**Purpose:** Link CSV-imported events (from Resource Scheduler) to their Graph API counterparts.

**Problem Solved:** CSV-imported events don't have real `graphData.id` values, preventing proper sync with Outlook.

**Prerequisites:**
```bash
npm install @azure/msal-node  # One-time install
```

**Usage:**
```bash
cd backend

# Preview matches (no changes)
node migrate-csv-to-graph.js --dry-run

# Test with limited records
node migrate-csv-to-graph.js --dry-run --limit 10

# Run for real
node migrate-csv-to-graph.js
```

**Matching Criteria (ALL must match):**
1. `calendarId` - Same calendar
2. `subject` - Case-insensitive exact match
3. `startDateTime` - Exact match (rounded to minute)
4. `endDateTime` - Exact match (rounded to minute)

**Authentication:** Uses MSAL device code flow - you'll be prompted to visit https://microsoft.com/devicelogin and enter a code.

**Options:**
- `--dry-run` - Preview without making changes
- `--limit N` - Process only N records

**Collection:** `templeEvents__Events`

---

## Event Field Migrations

### migrate-add-status-field.js
**Purpose:** Add `status` field to all events for consistent state management.

**Status Values:**
- `active` - Published/confirmed events (visible on calendar)
- `pending` - Awaiting approval (new room reservation requests)
- `inactive` - Archived/cancelled events

**Usage:**
```bash
node migrate-add-status-field.js
```

**Mapping:**
- Events without status → `active`
- `room-reservation-request` → `pending`
- `approved` → `active`
- `rejected` → `inactive`

**Collection:** `templeEvents__Events`

---

### migrate-add-top-level-fields.js
**Purpose:** Add top-level application fields (eventTitle, startDate, startTime, etc.) to eliminate runtime transformation.

**Fields Added:**
- `eventTitle`, `eventDescription`
- `startDate`, `startTime`, `startDateTime`
- `endDate`, `endTime`, `endDateTime`
- `setupTime`, `teardownTime`, `doorOpenTime`, `doorCloseTime`
- `setupTimeMinutes`, `teardownTimeMinutes`
- `setupNotes`, `doorNotes`, `eventNotes`
- `location`, `virtualMeetingUrl`, `virtualPlatform`
- `mecCategories`, `assignedTo`, `isAllDayEvent`

**Usage:**
```bash
# Preview changes
node migrate-add-top-level-fields.js --dry-run

# Apply changes
node migrate-add-top-level-fields.js
```

**Options:**
- `--dry-run` - Preview without making changes

**Collection:** `templeEvents__Events`

---

### migrate-add-creation-tracking.js
**Purpose:** Add creation tracking fields to identify when and how events were created.

**Fields Added:**
- `createdAt` - When record was first created
- `createdBy` - User ID
- `createdByEmail` - User email address
- `createdByName` - User display name
- `createdSource` - How event was created:
  - `unified-form` - Created via unified event form
  - `room-reservation` - Created via room reservation request
  - `graph-sync` - Synced from Microsoft Graph API
  - `csv-import` - Imported via CSV
  - `unknown` - Cannot determine source

**Usage:**
```bash
node migrate-add-creation-tracking.js
```

**Collection:** `templeEvents__Events`

---

### migrate-add-event-series-id.js
**Purpose:** Add `eventSeriesId` field for linking multi-day events.

**Field Values:**
- `null` - Single event (not part of a series)
- `<timestamp>-<random>` - Part of a multi-day event series

**Usage:**
```bash
node migrate-add-event-series-id.js
```

**Collection:** `templeEvents__Events`

---

### migrate-add-recurring-fields.js
**Purpose:** Add fields needed for Outlook-compatible recurring events.

**Fields Added:**
- `isRecurringMaster` - Identifies master events with recurrence patterns
- `recurrenceType` - `none`, `custom-multiday`, `outlook-recurring`
- `seriesMasterId` - Links instances to their master event
- `isException` - Marks modified occurrences
- `originalStartDateTime` - Preserves original time for exceptions
- `syncedFromOutlook` - Tracks source of recurring events

**Usage:**
```bash
node migrate-add-recurring-fields.js
```

**Collection:** `templeEvents__Events`

---

## Location Migrations

### migrate-location-structure.js
**Purpose:** Add new location fields to prepare for location refactoring.

**Fields Added:**
- `locations: []` - Empty array for future locationId assignments
- `locationDisplayNames` - Preserves current location text

**Usage:**
```bash
node migrate-location-structure.js
```

**Collection:** `templeEvents__Events`

---

### migrate-populate-location-displaynames.js
**Purpose:** Populate `locationDisplayNames` from `graphData.location.displayName` and detect virtual meetings.

**What It Does:**
- Copies location display names to top-level field
- Detects virtual meeting URLs (Zoom, Teams, Google Meet, etc.)
- Sets `virtualMeetingUrl` and `virtualPlatform` for virtual events
- Sets `locationDisplayNames: "Virtual Meeting"` for virtual events

**Prerequisites:** Run `create-virtual-location.js` first to create the Virtual Meeting location.

**Usage:**
```bash
node migrate-populate-location-displaynames.js
```

**Collection:** `templeEvents__Events`

---

### migrate-virtual-locations.js
**Purpose:** Update events with URL-based locations to use the "Virtual Meeting" location.

**Detected Platforms:**
- Zoom, Microsoft Teams, Google Meet
- Webex, GoToMeeting, BlueJeans
- Whereby, Jitsi Meet

**Prerequisites:** Run `create-virtual-location.js` first.

**Usage:**
```bash
node migrate-virtual-locations.js
```

**Collection:** `templeEvents__Events`

---

### migrate-add-parent-location.js
**Purpose:** Add `parentLocationId` field to link non-reservable locations to reservable ones.

**What It Does:**
- Adds `parentLocationId: null` to all locations
- Uses string similarity to match non-reservable locations to reservable parents
- Minimum 60% similarity required for automatic matching

**Usage:**
```bash
node migrate-add-parent-location.js
```

**Collection:** `templeEvents__Locations`

---

### migrate-rooms-to-locations.js
**Purpose:** Migrate hardcoded room data from `templeEvents__Rooms` to `templeEvents__Locations`.

**What It Does:**
- Inserts room data into locations collection
- Sets `isReservable: true` for all rooms
- Includes capacity, features, accessibility info

**Usage:**
```bash
node migrate-rooms-to-locations.js
```

**Collection:** `templeEvents__Locations`

---

## Room Reservation Migrations

### migrate-reservations.js
**Purpose:** Add resubmission fields and communication history to existing reservations.

**Fields Added:**
- `currentRevision` - Revision number for resubmissions
- `resubmissionAllowed` - Whether user can resubmit after rejection
- `communicationHistory[]` - Array of submission/approval/rejection entries

**Usage:**
```bash
node migrate-reservations.js
```

**Collection:** `templeEvents__RoomReservations`

---

### migrate-reorganize-room-reservation-data.js
**Purpose:** Reorganize `roomReservationData` structure - move requester/contact info into nested objects.

**Changes:**
- Move `requesterName`, `requesterEmail`, `department`, `phone` → `roomReservationData.requestedBy`
- Move `contactName`, `contactEmail`, `isOnBehalfOf` → `roomReservationData.contactPerson`
- Move `reviewNotes` → `roomReservationData.reviewNotes`
- Keep at top level: `attendeeCount`, `specialRequirements`, timing fields

**Usage:**
```bash
node migrate-reorganize-room-reservation-data.js
```

**Collection:** `templeEvents__Events`

---

## Cleanup Scripts

### cleanup-duplicate-events.js
**Purpose:** Remove duplicate event records (same `userId` + `graphData.id` with different `eventId`).

**Behavior:** Keeps the newest record (by `_id`), deletes older duplicates.

**Usage:**
```bash
node cleanup-duplicate-events.js
```

**Collection:** `templeEvents__Events`

---

### cleanup-recurring-duplicates.js
**Purpose:** Remove duplicate recurring event occurrences that were incorrectly stored.

**What It Removes:**
- Occurrence records missing `type`/`seriesMasterId` fields
- Records with `graphData.recurrence: null` and `graphData.seriesMasterId: null`
- Only removes `createdSource: 'graph-sync'` records

**Usage:**
```bash
node cleanup-recurring-duplicates.js
```

**Note:** Includes 5-second confirmation delay before deletion.

**Collection:** `templeEvents__Events`

---

## Deprecated Scripts

### migrate-remove-location-field.js
**Status:** DEPRECATED - Do not use

**Original Purpose:** Remove redundant `location` field from `templeEvents__InternalEvents` collection.

**Note:** This was for the old `templeEvents__InternalEvents` collection which has been consolidated into `templeEvents__Events`.

---

## General Notes

### Environment Variables
All scripts require these environment variables in `.env`:
```
MONGODB_CONNECTION_STRING=<your-connection-string>
# or
MONGODB_URI=<your-connection-string>

MONGODB_DATABASE_NAME=<database-name>
# or
DB_NAME=<database-name>
```

### Batch Processing
Most scripts process in batches of 50-100 records with delays to avoid Cosmos DB rate limiting (Error 16500).

### Safe to Re-run
Most migrations are idempotent and safe to run multiple times - they check for existing fields before updating.
