# Architecture Notes

## Table of Contents
1. [Event Data Transform Architecture](#event-data-transform-architecture)
2. [Graph API Authentication](#graph-api-authentication)
3. [DateTime Data Architecture](#datetime-data-architecture)

---

## Event Data Transform Architecture

### Overview
The application uses a **centralized transform layer** to convert between MongoDB's nested document structure and the flat structure used by UI forms. This simplifies field management - when adding a new field, you only need to update **two places**.

### The Problem (Before)
Previously, event data transformation was scattered across multiple components:
- `ReservationRequests.jsx` had inline transformation
- `UnifiedEventForm.jsx` had its own transformation
- `RoomReservationReview.jsx` had different transformation logic
- Each component could have different field mappings, causing bugs

### The Solution: Centralized Transform Layer

**Single Source of Truth:** `src/utils/eventTransformers.js`

```javascript
// CORRECT: Use the centralized transformer
import { transformEventToFlatStructure } from '../utils/eventTransformers';

const flatEvent = transformEventToFlatStructure(mongoEvent);
```

### Adding New Fields - Only 2 Places!

When adding a new field to `templeEvents__Events`, update:

#### 1. Frontend Transform Layer (`src/utils/eventTransformers.js`)
Add the field extraction in `transformEventToFlatStructure()`:
```javascript
return {
  // ... existing fields
  newField: event.newField || event.roomReservationData?.newField || defaultValue,
};
```

#### 2. Backend API (`backend/api-server.js`)
Add the field in relevant endpoint(s):
- Request body destructuring
- MongoDB insert/update operations
- Response construction (if needed)

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           READ FLOW (Backend → Frontend)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────────┐  │
│  │   MongoDB    │───>│  API Server  │───>│  transformEventToFlatStructure │  │
│  │   (nested)   │    │  (raw docs)  │    │  (single transform layer)      │  │
│  └──────────────┘    └──────────────┘    └───────────────┬──────────────┘  │
│                                                          │                  │
│                                          ┌───────────────┴───────────────┐  │
│                                          ▼                               ▼  │
│                               ┌──────────────────┐           ┌──────────────┐│
│                               │  Form Components │           │   Calendar   ││
│                               │  (flat structure)│           │    Views     ││
│                               └──────────────────┘           └──────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           WRITE FLOW (Frontend → Backend)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────┐    ┌─────────────────────┐    ┌──────────────────────┐│
│  │  Form Components │───>│ getProcessedFormData │───>│   PUT /api/events    ││
│  │  (flat structure)│    │ (minimal processing) │    │   (stores to Mongo)  ││
│  └──────────────────┘    └─────────────────────┘    └──────────────────────┘│
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### MongoDB Document Structure

Events in `templeEvents__Events` have a hybrid structure:

```javascript
{
  // === TOP-LEVEL FIELDS (Authoritative) ===
  eventId: "evt-...",
  _id: ObjectId("..."),
  status: "pending" | "approved" | "rejected" | "draft",

  // Datetime fields (with Z suffix for UTC)
  startDateTime: "2025-01-24T16:30:00Z",
  endDateTime: "2025-01-24T17:00:00Z",
  startDate: "2025-01-24",
  startTime: "16:30",

  // Event details
  eventTitle: "Event Name",
  eventDescription: "Description",
  categories: ["Category1"],
  locations: [ObjectId("...")],
  locationDisplayNames: "Room Name",

  // Timing
  setupTime: "16:00",
  teardownTime: "18:00",
  doorOpenTime: "16:15",
  doorCloseTime: "17:00",

  // === NESTED STRUCTURES (For specific contexts) ===
  graphData: {
    // Microsoft Graph API format (for sync)
    subject: "Event Name",
    start: { dateTime: "...", timeZone: "America/New_York" },
    end: { dateTime: "...", timeZone: "America/New_York" },
    location: { displayName: "Room Name" },
    categories: [...]
  },

  roomReservationData: {
    // Room reservation workflow data
    requestedBy: { userId, name, email },
    reviewedBy: { userId, name, reviewedAt },
    communicationHistory: [...]
  },

  internalData: {
    // Legacy internal enrichments (being phased out)
    mecCategories: [...],
    setupMinutes: 0
  }
}
```

### Components Using Transform Layer

| Component | Usage |
|-----------|-------|
| `ReservationRequests.jsx` | `transformEventsToFlatStructure(events)` |
| `UnifiedEventForm.jsx` | `transformEventToFlatStructure(event)` |
| `RoomReservationReview.jsx` | `transformEventToFlatStructure(reservation)` |
| `Calendar.jsx` views | Events already have `start.dateTime` from API |

---

## Graph API Authentication

### Overview
The backend uses **app-only authentication** (client credentials flow) for all Microsoft Graph API operations. User-delegated tokens (`graphToken`) are **NOT used** on the backend.

### Architecture Decision

| Aspect | Old Approach (Deprecated) | New Approach (Current) |
|--------|---------------------------|------------------------|
| Token Source | User's `graphToken` passed from frontend | App-only token via `graphApiService.js` |
| Auth Flow | User delegation | Client credentials |
| Required Data | `graphToken` in request body | `calendarOwner` email on event |
| Graph API Pattern | `/me/calendars/...` | `/users/{email}/calendars/...` |

### How It Works

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend  │────>│  Backend API    │────>│ graphApiService │
│  (apiToken) │     │  (validates JWT)│     │  (app-only auth)│
└─────────────┘     └─────────────────┘     └────────┬────────┘
                                                     │
                                                     ▼
                                            ┌─────────────────┐
                                            │ Microsoft Graph │
                                            │      API        │
                                            └─────────────────┘
```

1. Frontend sends `apiToken` (JWT) in Authorization header
2. Backend validates JWT, extracts user info
3. Backend uses `graphApiService.js` to call Graph API
4. `graphApiService` uses Azure AD client credentials (app-only)
5. Graph API calls use `/users/{calendarOwner}/...` pattern

### Code Example

```javascript
// CORRECT: Use graphApiService with calendarOwner
const event = await graphApiService.createCalendarEvent(
  calendarOwner,  // e.g., 'templeeventssandbox@emanuelnyc.org'
  calendarId,     // optional, or null for default calendar
  eventData
);

// WRONG: Don't use user's graphToken (deprecated)
// This pattern should NOT be used in backend code
const response = await fetch(url, {
  headers: { 'Authorization': `Bearer ${graphToken}` }
});
```

### Endpoints Using App-Only Auth

- `PUT /api/admin/events/:id/approve` - Creates Graph events on approval
- `PUT /api/admin/events/:id` - Syncs changes to Graph
- `GET /api/graph/*` - All Graph API proxy endpoints
- Delta sync operations

### Environment Variables Required

```env
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_TENANT_ID=your-tenant-id
```

### Frontend Backward Compatibility

The frontend still passes `graphToken` in some API calls for backward compatibility, but the backend **ignores** it. No frontend changes are required - the backend simply uses app-only auth instead.

---

## DateTime Data Architecture

### Overview
This document describes how datetime data flows through the application from Microsoft Graph API to MongoDB storage to frontend display, with emphasis on timezone handling and data standardization.

---

## Data Flow

### 1. Microsoft Graph API (Source)
**Format**: Graph API returns datetimes WITHOUT 'Z' suffix, with separate timezone field

```javascript
{
  start: {
    dateTime: "2025-11-11T19:00:00.0000000",  // No Z suffix
    timeZone: "UTC"                            // Separate timezone field
  },
  end: {
    dateTime: "2025-11-11T20:00:00.0000000",  // No Z suffix
    timeZone: "UTC"
  }
}
```

**Why**: Graph API uses Windows timezone identifiers and expects clients to handle timezone conversion.

---

### 2. Backend Storage (MongoDB - templeEvents__Events)
**Format**: Top-level fields WITH 'Z' suffix (UTC), graphData preserves original

**Note**: Previously stored in `templeEvents__InternalEvents` (now deprecated and consolidated into `templeEvents__Events`)

```javascript
{
  // APPLICATION STANDARD - Single Source of Truth
  startDateTime: "2025-11-11T19:00:00.0000000Z",  // ✓ WITH Z (UTC)
  endDateTime: "2025-11-11T20:00:00.0000000Z",    // ✓ WITH Z (UTC)
  startDate: "2025-11-11",                         // Extracted date
  startTime: "19:00",                              // Extracted time (UTC)
  endDate: "2025-11-11",
  endTime: "20:00",

  // AUDIT TRAIL - Preserves original Graph API format
  graphData: {
    start: {
      dateTime: "2025-11-11T19:00:00.0000000",    // Without Z (original)
      timeZone: "UTC"
    },
    end: {
      dateTime: "2025-11-11T20:00:00.0000000",    // Without Z (original)
      timeZone: "UTC"
    }
  }
}
```

**Backend Processing** (`backend/api-server.js`):

#### Event Storage (Lines 2504-2514)
```javascript
// Convert to UTC strings with Z suffix
const utcStartString = startDateTime ?
  (startDateTime.endsWith('Z') ? startDateTime : `${startDateTime}Z`) : '';
const utcEndString = endDateTime ?
  (endDateTime.endsWith('Z') ? endDateTime : `${endDateTime}Z`) : '';

// Store datetime with Z suffix to ensure UTC interpretation
unifiedEvent.startDateTime = utcStartString;
unifiedEvent.endDateTime = utcEndString;

// Extract date and time in UTC
unifiedEvent.startDate = utcStartString ?
  new Date(utcStartString).toISOString().split('T')[0] : '';
unifiedEvent.startTime = utcStartString ?
  new Date(utcStartString).toISOString().slice(11, 16) : '';
```

#### Delta Sync (Lines 4173-4183)
Same Z suffix logic applied during synchronization from Graph API.

#### Update Operations (Lines 4255-4265)
Same Z suffix logic applied during event updates.

#### Room Reservations (Lines 14807-14813)
Same Z suffix logic applied for reservation events.

---

### 3. Backend API Response (Dynamically Constructed)
**Format**: API constructs `start`/`end` objects from top-level fields for frontend consistency

**API Response Construction** (`backend/api-server.js:3533-3540`):
```javascript
// Construct Graph-like format from application standard
start: {
  dateTime: event.startDateTime,  // Use top-level WITH Z
  timeZone: event.graphData?.start?.timeZone || 'UTC'
},
end: {
  dateTime: event.endDateTime,    // Use top-level WITH Z
  timeZone: event.graphData?.end?.timeZone || 'UTC'
}
```

**Frontend Receives**:
```javascript
{
  start: {
    dateTime: "2025-11-11T19:00:00.0000000Z",  // Constructed from top-level
    timeZone: "UTC"
  },
  startDateTime: "2025-11-11T19:00:00.0000000Z",  // Also included
  startDate: "2025-11-11",
  startTime: "19:00",
  graphData: { ... }  // Original preserved
}
```

---

### 4. Frontend Usage (Standardized)
**Rule**: Frontend ONLY uses `event.start.dateTime` (API-constructed field)

#### Files Standardized (Completed 2025-11-13):
1. **EventDetailsModal.jsx**: Uses `event.start.dateTime` / `event.end.dateTime`
2. **Calendar.jsx**: Removed fallback patterns, uses `event.start.dateTime` directly
3. **DayTimelineModal.jsx**: Uses `event.start.dateTime` / `event.end.dateTime`
4. **WeekTimelineModal.jsx**: Updated all 5 instances to use standardized fields
5. **CSVImportWithCalendar.jsx**: Added fallback for CSV preview data

#### Timezone Display (`src/utils/timezoneUtils.jsx`):
```javascript
export const formatEventTime = (dateString, timezone, eventSubject) => {
  // Parse datetime string as UTC (backend ensures Z suffix)
  const date = new Date(dateString);  // Correctly parses as UTC with Z

  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: getSafeTimezone(timezone),  // Convert to user's timezone
  });
};
```

---

## Key Architectural Decisions

### 1. Why Z Suffix as Standard?
- **JavaScript Safety**: Strings with Z parse as UTC; without Z parse as local time
- **Industry Standard**: ISO 8601 with Z is the international standard
- **Single Transformation**: One conversion point (Graph API → Storage)
- **Fewer Bugs**: Explicit timezone handling reduces ambiguity

### 2. Why Preserve graphData?
- **Audit Trail**: Keep original Graph API format for reference
- **Debugging**: Compare application standard vs. original
- **Backward Compatibility**: Some features may still reference original
- **Data Integrity**: Never lose source data

### 3. Why Dynamic API Construction?
- **Frontend Consistency**: Always use `event.start.dateTime` regardless of source
- **Separation of Concerns**: Database schema != API response format
- **Flexibility**: Can change storage without breaking frontend
- **Migration Safety**: Gradual transition from old to new format

---

## Data Flow Diagram

```
┌─────────────────────┐
│  Graph API          │
│  (No Z suffix)      │
│  "...19:00:00"      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Backend Processing │
│  (Adds Z suffix)    │
│  "...19:00:00Z"     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  MongoDB Storage    │
│  ┌─────────────────┐│
│  │ Top-level: Z    ││  ← Single Source of Truth
│  │ graphData: No Z ││  ← Audit Trail
│  └─────────────────┘│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  API Response       │
│  (Constructs start) │
│  start.dateTime: Z  │  ← Uses top-level
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Frontend Display   │
│  event.start.dateTime│ ← Standardized access
│  + user timezone    │
└─────────────────────┘
```

---

## Exception: Demo Data

**Demo Data** (uploaded JSON files) uses top-level `startDateTime` without nested structure:
```javascript
{
  startDateTime: "2025-11-11T19:00:00.0000000Z",  // Direct field
  endDateTime: "2025-11-11T20:00:00.0000000Z"     // Direct field
}
```

**Files handling demo data** (`src/services/calendarDataService.js`):
- `_getDemoEvents()`: Uses `event.startDateTime` directly (correct for demo data)
- `_convertDemoEventToCalendarFormat()`: Converts demo format to application format

---

## Testing Checklist

### Backend (MongoDB)
- [ ] All `startDateTime`/`endDateTime` fields have Z suffix
- [ ] `graphData.start.dateTime` preserves original (no Z)
- [ ] `startDate` is in "YYYY-MM-DD" format
- [ ] `startTime` is in "HH:MM" format (UTC)

### API Response
- [ ] `start.dateTime` constructed from top-level field
- [ ] `start.timeZone` preserved from graphData
- [ ] Response includes both nested and top-level fields

### Frontend
- [ ] All components use `event.start.dateTime` (not `event.startDateTime`)
- [ ] Timezone selector changes display correctly
- [ ] Times display in user's selected timezone
- [ ] Demo data still works correctly

---

## Related Files

### Backend
- `backend/api-server.js` - Main API server with all endpoints
- `backend/services/graphApiService.js` - App-only Graph API authentication service

### Frontend - Transform Layer
- `src/utils/eventTransformers.js` - **SINGLE SOURCE OF TRUTH** for event data transformation

### Frontend - Datetime
- `src/utils/timezoneUtils.jsx` (timezone conversion utilities)
- `src/context/TimezoneContext.jsx` (user timezone preference)
- `src/components/EventDetailsModal.jsx`
- `src/components/Calendar.jsx`
- `src/components/DayTimelineModal.jsx`
- `src/components/WeekTimelineModal.jsx`
- `src/components/CSVImportWithCalendar.jsx`
- `src/services/calendarDataService.js` (demo data handling)

---

## Troubleshooting

### Problem: Times display incorrectly
**Check**: Does the datetime string have a Z suffix?
```javascript
// ✓ Correct - JavaScript parses as UTC
"2025-11-11T19:00:00.0000000Z"

// ✗ Wrong - JavaScript parses as local time
"2025-11-11T19:00:00.0000000"
```

### Problem: Timezone changes don't update display
**Check**: Is the component using `event.start.dateTime` or `event.startDateTime`?
```javascript
// ✓ Correct - Standardized field
const time = formatEventTime(event.start.dateTime, userTimezone);

// ✗ Wrong - Direct top-level access
const time = formatEventTime(event.startDateTime, userTimezone);
```

### Problem: Events missing after sync
**Check**: Does the backend storage code add Z suffix before creating Date objects?
```javascript
// ✓ Correct - Add Z first
const utcString = dateTime.endsWith('Z') ? dateTime : `${dateTime}Z`;
const date = new Date(utcString);

// ✗ Wrong - Create Date without Z
const date = new Date(dateTime);  // May parse as local time!
```

---

## Change Log

### 2026-01-23: Graph API Authentication Migration
- **Architecture Change**: Migrated from user-delegated `graphToken` to app-only authentication
- **Backend**: All Graph API calls now use `graphApiService.js` with client credentials flow
- **Approve Endpoint**: `PUT /api/admin/events/:id/approve` updated to use `graphApiService.createCalendarEvent()`
- **Pattern Change**: Uses `/users/{calendarOwner}/...` instead of `/me/...` pattern
- **Backward Compatible**: Frontend still sends `graphToken` but backend ignores it

### 2026-01-23: Centralized Transform Layer
- **New File**: `src/utils/eventTransformers.js` - single source of truth for event transformation
- **Simplified Updates**: Adding new fields now requires only 2 places (transform layer + backend)
- **Components Updated**: `ReservationRequests.jsx`, `UnifiedEventForm.jsx`, `RoomReservationReview.jsx` now use shared transformer
- **Removed**: Inline transformation logic from individual components

### 2025-11-13: DateTime Standardization
- **Backend**: All storage operations now add Z suffix before creating Date objects
- **API**: Response construction uses top-level fields (with Z) instead of graphData
- **Frontend**: Standardized all components to use `event.start.dateTime`
- **Files Changed**: 5 frontend components, 1 backend file
- **Console Cleanup**: Removed verbose filter logging (Calendar.jsx, calendarDebug.js)

### Future Considerations
- **Migration Script**: May need to add Z suffix to existing events without it
- **Validation**: Add database constraints to ensure Z suffix on all datetime fields
- **Documentation**: Update API documentation with datetime format requirements
- **Frontend Cleanup**: Remove `graphToken` from frontend code (currently ignored by backend)
