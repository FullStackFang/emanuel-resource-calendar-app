# Architecture Notes

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

### 2. Backend Storage (MongoDB - templeEvents__InternalEvents)
**Format**: Top-level fields WITH 'Z' suffix (UTC), graphData preserves original

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
- `backend/api-server.js` (lines 2504-2514, 3533-3540, 4173-4183, 4255-4265, 14807-14813)

### Frontend
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
