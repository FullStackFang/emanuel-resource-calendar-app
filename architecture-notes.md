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
All datetimes in this application use the **Graph API format**: naive local-time strings
(representing America/New_York wall-clock time) with the timezone stored separately.
This matches what Microsoft Graph API expects and avoids UTC-conversion bugs.

---

## The Standard

| Aspect | Format | Example |
|--------|--------|---------|
| **Storage** | Local-time string, NO Z suffix, always with seconds | `"2026-03-25T16:30:00"` |
| **Timezone** | Stored separately (IANA or Outlook name) | `"America/New_York"` / `"Eastern Standard Time"` |
| **Graph API** | Same format + Outlook timezone | `{ dateTime: "2026-03-25T16:30:00", timeZone: "Eastern Standard Time" }` |

### Parsing Rules
1. **NEVER** append Z to stored datetime strings - they are NOT UTC
2. **NEVER** use `new Date(storedDateTimeStr)` to extract date/time components - browser timezone varies
3. **DO** extract via string operations: `.split('T')[0]` for date, regex/split for time
4. **DO** use `dateTimeToDecimalHours()` from `src/utils/timezoneUtils.js` for positioning
5. **DO** use `Intl.DateTimeFormat` with known source timezone for cross-timezone display

### Utility Files
- `src/utils/timezoneUtils.js` - Timezone-safe string parsing (parseTimeFromString, parseDateFromString, dateTimeToDecimalHours, formatTimeFromDateTimeString, normalizeDateTimeSeconds)
- `src/utils/timezoneUtils.jsx` - React timezone components and display formatting (formatEventTime, formatDateTimeWithTimezone, TimezoneSelector)

---

## Data Flow

### 1. Microsoft Graph API (Source)
Graph API returns datetimes WITHOUT Z suffix, with separate timezone field:
```javascript
{
  start: {
    dateTime: "2026-03-25T16:30:00.0000000",  // No Z suffix
    timeZone: "Eastern Standard Time"          // Separate timezone field
  }
}
```

### 2. Backend Storage (MongoDB - calendarData)
Backend strips Z suffix and stores as local-time strings. The `calendarData` object
in `templeEvents__Events` is the single source of truth:
```javascript
{
  calendarData: {
    startDateTime: "2026-03-25T16:30:00",  // Local time, NO Z
    endDateTime: "2026-03-25T17:30:00",    // Local time, NO Z
    startDate: "2026-03-25",               // Extracted date
    startTime: "16:30",                    // Extracted time (HH:MM)
    endDate: "2026-03-25",
    endTime: "17:30",
  },
  graphData: {                             // Raw Graph API data (audit trail)
    start: { dateTime: "2026-03-25T16:30:00.0000000", timeZone: "Eastern Standard Time" },
    end: { ... }
  }
}
```

All creation/update endpoints explicitly strip Z: `startDateTime.replace(/Z$/, '')`

### 3. Backend API Response
API constructs `start`/`end` wrappers from calendarData for frontend compatibility:
```javascript
start: {
  dateTime: event.calendarData?.startDateTime,  // Local-time string, no Z
  timeZone: event.graphData?.start?.timeZone || 'America/New_York'
}
```

### 4. Frontend Usage
Frontend accesses `event.start.dateTime` (local-time string) and `event.start.timeZone`:
- **Same timezone display**: Regex-extract time from string (no Date object needed)
- **Cross-timezone display**: Compute UTC offset via Intl.DateTimeFormat, then format
- **Form population**: String extraction via regex (`/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/`)
- **Positioning (SA, WeekView, DayView)**: Use decimal hours from string

---

## Key Architectural Decisions

### 1. Why Local-Time Strings (Not UTC)?
- **Matches Graph API**: No conversion needed for Graph API communication
- **Human-Readable**: "16:30" in the database IS "4:30 PM Eastern"
- **DST-Safe**: No UTC-to-local conversion means no DST boundary bugs
- **String Comparison**: MongoDB date-range queries work with string comparison

### 2. Why Preserve graphData?
- **Audit Trail**: Keep original Graph API format for debugging
- **Data Integrity**: Never lose source data
- **Timezone Source**: `graphData.start.timeZone` provides the authoritative timezone

### 3. Why String Extraction Over Date Parsing?
- **Browser-Independent**: `"2026-03-25T16:30:00".split('T')` gives the same result everywhere
- **No Timezone Ambiguity**: `new Date("2026-03-25T16:30:00")` interprets differently per browser timezone
- **Simpler**: Regex is faster and more predictable than Date parsing + formatting

---

## Data Flow Diagram

```
┌─────────────────────────┐
│  Graph API              │
│  "...16:30:00"          │
│  timeZone: "Eastern..." │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Backend Processing     │
│  Strips Z suffix        │
│  Stores as local-time   │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  MongoDB (calendarData) │
│  "2026-03-25T16:30:00"  │  ← Source of truth (local time, no Z)
│  graphData preserved    │  ← Audit trail
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  API Response           │
│  start.dateTime (no Z)  │
│  start.timeZone         │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Frontend Display       │
│  String extraction      │  ← No new Date() on stored strings
│  + user timezone pref   │
└─────────────────────────┘
```
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
