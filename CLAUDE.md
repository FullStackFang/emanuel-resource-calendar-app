# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Frontend (Root Directory)
```bash
npm run dev        # Start Vite dev server (https://localhost:5173)
npm run build      # Build production bundle
npm run lint       # Run ESLint
npm run preview    # Preview production build
```

### Backend API Server
```bash
cd backend
npm run dev        # Start with nodemon (auto-restart on changes)
npm start          # Start production server
```

### Generate Development Certificates
```bash
node generateCert.js  # Creates self-signed certs in /certs folder
```

### Migration Scripts
When creating migration scripts in the backend directory, use these conventions:

**Environment Variables:**
```javascript
const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
```

**Standard Pattern:**
- Support `--dry-run` flag to preview changes without modifying data
- Support `--verify` flag to check migration status
- Always show before/after counts
- Make scripts idempotent (safe to run multiple times)
- **IMPORTANT: Use batch processing** to avoid Cosmos DB rate limiting (Error 16500)

**Batch Processing Pattern (Required for Cosmos DB):**
```javascript
const BATCH_SIZE = 100;
const docsToProcess = await collection.find({ /* query */ }).toArray();

for (let i = 0; i < docsToProcess.length; i += BATCH_SIZE) {
  const batch = docsToProcess.slice(i, i + BATCH_SIZE);

  // Process batch
  await collection.updateMany(
    { _id: { $in: batch.map(d => d._id) } },
    { /* update */ }
  );

  // Progress bar
  const processed = Math.min(i + BATCH_SIZE, docsToProcess.length);
  const percent = Math.round((processed / docsToProcess.length) * 100);
  process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${docsToProcess.length})`);

  // Rate limit delay between batches
  if (i + BATCH_SIZE < docsToProcess.length) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```

**Running Scripts:**
```bash
cd backend
node <script-name>.js --dry-run    # Preview changes
node <script-name>.js              # Apply changes
node <script-name>.js --verify     # Verify results
```

## Architecture Overview

This is a Temple Events Calendar application with Microsoft 365 integration, consisting of:

### Frontend (React SPA)
- **Entry Point**: `src/main.jsx` → `src/App.jsx`
- **Authentication**: Azure AD/MSAL in `src/components/Authentication.jsx`
- **Configuration**: 
  - Auth config: `src/config/authConfig.js`
  - API endpoints: `src/config/config.js`
- **State Management**: React Context API (`UserPreferencesContext`, `TimezoneContext`)
- **UI Framework**: Microsoft Fluent UI components
- **Calendar Views**: Month, Week, and Day views with event overlap handling

### Backend API (Node.js/Express)
- **Entry Point**: `backend/api-server.js`
- **Database**: MongoDB (Azure Cosmos DB)
- **Collections**:
  - `templeEvents__Users`: User profiles and preferences
  - `templeEvents__Events`: Unified event storage with Graph data and internal enrichments
  - `templeEvents__CalendarDeltas`: Delta token storage for efficient syncing
  - `templeEvents__Locations`: Location and room data (replaces templeEvents__Rooms)
    - Locations with `isReservable: true` are available for room reservations
    - Also stores event locations from Graph API with alias management
  - `templeEvents__ReservationTokens`: Guest access tokens for public forms
  - `templeEvents__EventAttachments`: File attachments for events (GridFS)
  - `templeEvents__EventAuditHistory`: Event change tracking and audit logs
  - **DEPRECATED**: `templeEvents__Rooms` (migrated to templeEvents__Locations)
  - **DEPRECATED**: `templeEvents__InternalEvents` (consolidated into templeEvents__Events)
  - **DEPRECATED**: `templeEvents__EventCache` (consolidated into templeEvents__Events)
  - **DEPRECATED**: `templeEvents__RoomReservations` (consolidated into templeEvents__Events with roomReservationData)
- **Authentication**: JWT validation with JWKS

### Key Services
- **calendarDataService.js**: Enhanced event operations with caching and unified sync
- **unifiedEventService.js**: Delta sync for multiple calendars with conflict detection
- **graphService.js**: Frontend Graph API interactions (legacy, being phased out)
- **graphApiService.js**: Backend Graph API service using app-only authentication (preferred)
- **userPreferencesService.js**: User preference management with MongoDB persistence

### API Structure
- Protected endpoints require JWT bearer token
- Public endpoints at `/api/public/*` for external access
- Admin-only endpoints for sync operations

### Event Data Model
Events in `templeEvents__Events` combine Microsoft Graph data with internal enrichments:

**Document Structure:**
```javascript
{
  // TOP-LEVEL IDENTITY/STATUS FIELDS
  eventId, userId, calendarOwner, calendarId, status, isDeleted,

  // NESTED DATA STRUCTURES
  graphData: { /* Raw Microsoft Graph API data */ },
  calendarData: {
    eventTitle, eventDescription,
    startDateTime, endDateTime,  // Date range queries use these
    startDate, startTime, endDate, endTime,
    setupTime, teardownTime, doorOpenTime, doorCloseTime,
    locations, locationDisplayNames,
    categories, services, assignedTo,
    // ... all calendar/event fields
  },
  roomReservationData: { /* Reservation workflow data */ },
  internalData: { /* Legacy internal enrichments */ },

  // METADATA
  createdAt, createdBy, lastModifiedDateTime, ...
}
```

**Important: All calendar fields are in `calendarData`**
Date range queries use `calendarData.startDateTime` and `calendarData.endDateTime`:
```javascript
query['calendarData.startDateTime'] = { $lt: endDate };
query['calendarData.endDateTime'] = { $gt: startDate };
```

**calendarData Fields**:
- Event info: eventTitle, eventDescription, categories
- Timing: startDateTime/endDateTime, setupTime, teardownTime, doorOpenTime, doorCloseTime
- Location: locations (ObjectId array), locationDisplayNames, isOffsite, offsite* fields
- Requester: requesterName, requesterEmail, department, phone
- Services and assignments

### Authentication Flow
1. User logs in via MSAL popup
2. Acquires two tokens: Graph API token + Custom API token
3. Frontend includes API token in Authorization header
4. Backend validates token using JWKS from Azure AD

### Graph API Authentication (IMPORTANT)
The backend uses **app-only authentication** via `graphApiService.js` for all Graph API operations. This is a critical architectural decision:

- **DO NOT** use user's `graphToken` for backend Graph API calls
- **DO** use `graphApiService` with `calendarOwner` email for all Graph operations
- The frontend still passes `graphToken` in some places for backward compatibility, but it is ignored by the backend

**How it works:**
1. Backend uses Azure AD client credentials flow (app-only)
2. `graphApiService.js` obtains tokens automatically using `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`
3. Graph API calls use `/users/{calendarOwner}/...` pattern with app permissions
4. No user delegation required - the app acts on behalf of itself

**Example - Creating a calendar event:**
```javascript
// CORRECT: Use graphApiService with calendarOwner email
const event = await graphApiService.createCalendarEvent(
  calendarOwner,  // e.g., 'templeeventssandbox@emanuelnyc.org'
  calendarId,     // optional calendar ID, or null for default
  eventData
);

// WRONG: Don't use user's graphToken with direct fetch
// This pattern is deprecated and should not be used
```

**Endpoints using app-only auth:**
- `PUT /api/admin/events/:id/approve` - Creates Graph events on approval
- `PUT /api/admin/events/:id` - Syncs changes to Graph
- `GET /api/graph/*` - All Graph API proxy endpoints
- Delta sync operations

### Environment Configuration
- Development: `https://localhost:5173` (frontend), `http://localhost:3001` (backend)
- Production: Azure Web Apps with custom domains
- HTTPS required for Teams/Outlook add-in functionality
- Supports both demo mode (with sample data) and production mode

## Key Features

### Calendar Management
- **Multi-Calendar Support**: View and manage multiple calendars including shared mailboxes
- **Calendar Badges**: Visual indicators showing calendar sources with meaningful names
- **Smart Event Loading**: Hybrid approach using unified delta sync with cache fallback
- **Conflict Detection**: Automatic detection of overlapping events
- **Event Search**: Advanced filtering by date, categories, locations, and text

### Room Reservation System
- **Public Access**: Token-based guest access for external users
- **Feature-Based Filtering**: Filter rooms by required features (kitchen, AV equipment, etc.)
- **Icon-Based UI**: Visual feature selection with intuitive icons
- **Capacity Management**: Automatic filtering based on attendee count
- **Availability Checking**: Real-time conflict detection with existing events
- **Admin Workflow**: Approval/rejection system with notification support

### Event Enrichments
- **Custom Categories**: Dynamic category system with subcategories
- **Setup/Teardown Times**: Automatic buffer time management
- **Cost Tracking**: Budget management per event
- **Staff Assignments**: Track personnel requirements
- **Registration Management**: Handle event sign-ups and attendance

### Performance Optimizations
- **Smart Caching**: Intelligent event caching with automatic refresh
- **Reduced API Calls**: Batch operations and efficient data fetching
- **Optimized Logging**: Minimal console output for production
- **Race Condition Prevention**: Direct data passing to avoid state sync issues

### Export & Integration
- **PDF Export**: Generate calendar PDFs with custom styling
- **CSV Import/Export**: Bulk event management
- **Public API**: External access to event data
- **Teams/Outlook Add-in**: Seamless Microsoft 365 integration

## Development Best Practices

### Before Writing Any Code

Follow this verification-first workflow for all code changes:

1. **State verification method** - Before implementing, describe how you will verify the change works (unit test, integration test, bash command, browser check, API call, etc.)
2. **Write the test first** - Create the test or verification script that will confirm the implementation is correct
3. **Implement the code** - Write the actual implementation
4. **Run verification and iterate** - Execute the test/verification and continue iterating until it passes

**Example workflow:**
```
User: "Add a 'deleted' status tab to MyReservations"

1. Verification method: "I will verify by running the existing test suite
   and checking that the component renders the new tab with correct filtering"

2. Write test first:
   - Add test case for 'deleted' tab rendering
   - Add test case for filtering reservations by 'deleted' status
   - Add test case for excluding 'deleted' from 'All Requests' count

3. Implement: Update MyReservations.jsx and MyReservations.css

4. Run: `npm test -- --grep "MyReservations"` and iterate until green
```

This ensures changes are verifiable and reduces back-and-forth debugging.

### State Management
- Use React Context for global state (user preferences, timezone)
- Pass data directly to avoid race conditions with async state updates
- Minimize re-renders with proper useCallback/useMemo usage

### Error Handling
- Graceful fallbacks for API failures
- User-friendly error messages
- Automatic retry logic for transient failures

### Security
- JWT validation on all protected endpoints
- Token-based access for public forms
- Proper CORS configuration
- Input validation and sanitization

### Code Organization
- Component-specific CSS classes to avoid conflicts
- Centralized configuration management
- Reusable utility functions
- Clear separation of concerns

### UI Patterns

#### Destructive Actions (Delete, Remove, Cancel)
All destructive actions MUST follow this **in-button confirmation** pattern (NO browser dialogs like `window.confirm()`):

1. **First click** - Button text changes to "Confirm?" with visual emphasis (red background, pulse animation)
2. **Second click** - Performs the delete, button shows "Deleting..."
3. **Auto-reset** - If not confirmed within 3 seconds, button resets to "Delete"
4. **Disabled state** - Button disabled during the delete operation
5. **Success feedback** - Use `showSuccess()` notification on completion
6. **Error handling** - Use `showError()` notification on failure

```javascript
// Standard delete pattern with in-button confirmation
const [deletingId, setDeletingId] = useState(null);
const [confirmDeleteId, setConfirmDeleteId] = useState(null);

// First click sets confirm state, second click deletes
const handleDeleteClick = (item) => {
  if (confirmDeleteId === item._id) {
    // Already in confirm state, proceed with delete
    handleDelete(item);
  } else {
    // First click - enter confirm state
    setConfirmDeleteId(item._id);
    // Auto-reset after 3 seconds if not confirmed
    setTimeout(() => {
      setConfirmDeleteId(prev => prev === item._id ? null : prev);
    }, 3000);
  }
};

const handleDelete = async (item) => {
  try {
    setDeletingId(item._id);
    setConfirmDeleteId(null);
    await deleteApi(item._id);
    showSuccess(`"${item.name}" deleted successfully`);
    // Refresh data or remove from local state
  } catch (err) {
    showError(err, { context: 'ComponentName.handleDelete' });
  } finally {
    setDeletingId(null);
  }
};

// Button JSX
<button
  className={`delete-btn ${confirmDeleteId === item._id ? 'confirm' : ''}`}
  onClick={() => handleDeleteClick(item)}
  disabled={deletingId === item._id}
>
  {deletingId === item._id
    ? 'Deleting...'
    : confirmDeleteId === item._id
      ? 'Confirm?'
      : 'Delete'}
</button>

// Required CSS for confirm state
.delete-btn.confirm {
  background: var(--color-error-500);
  color: white;
  animation: pulse-confirm 1s ease-in-out infinite;
}
```

## Event/Reservation Data Flow (SIMPLIFIED)

The application uses a **centralized transform layer** for all event data transformation. When adding new fields to `templeEvents__Events`, you only need to update **2 places**.

### Centralized Transform Layer

**Single Source of Truth:** `src/utils/eventTransformers.js`

All components now use `transformEventToFlatStructure()` instead of inline transformation:

```javascript
import { transformEventToFlatStructure } from '../utils/eventTransformers';

// Used by: ReservationRequests.jsx, UnifiedEventForm.jsx, RoomReservationReview.jsx
const flatEvent = transformEventToFlatStructure(mongoEvent);
```

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           READ FLOW (Backend → Frontend)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  MongoDB ──> API Server ──> transformEventToFlatStructure() ──> Form/UI     │
│  (nested)    (raw docs)     (SINGLE transform layer)           (flat)       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           WRITE FLOW (Frontend → Backend)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Form ──> getProcessedFormData() ──> PUT /api/admin/events/:id ──> MongoDB  │
│  (flat)   (minimal processing)       (handles nested structure)   (nested)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Adding New Fields - Only 2 Places!

When adding a new field to events/reservations:

#### 1. Frontend Transform Layer (`src/utils/eventTransformers.js`)
Add field extraction in `transformEventToFlatStructure()`:
```javascript
return {
  // ... existing fields
  newField: event.newField || event.roomReservationData?.newField || defaultValue,
};
```

#### 2. Backend API (`backend/api-server.js`)
Add field handling in relevant endpoint(s):
- Request body destructuring
- MongoDB insert/update operations

### Common Pitfalls

- **Field exists in MongoDB but not in form**: Missing from `eventTransformers.js`
- **Field saves but doesn't load**: Missing from `transformEventToFlatStructure()`
- **ObjectId comparison fails**: Use `String(id)` for comparisons

### See Also
For detailed architecture documentation, see `architecture-notes.md`

## Important Notes

- The app functions as both a standalone web app and Microsoft Teams/Outlook add-in
- User preferences are stored in MongoDB (not Office.js RoamingSettings)
- Event sync creates internal copies of Graph events for enrichment without modifying originals
- Multiple calendar support with real-time synchronization
- Export features include PDF generation and public API access
- All times are handled with proper timezone conversion
- Demo mode available for testing without live data
- **Graph API calls from backend MUST use `graphApiService.js`** with app-only authentication, NOT user's `graphToken`

## Current In-Progress Work

### calendarData Migration (Phases 1-3 Complete)

**Status**: Phases 1-3 complete. Phase 4 (cleanup) should be run after 1-2 weeks in production.

**Background**: Restructured `templeEvents__Events` to consolidate ~40 scattered top-level fields into a `calendarData` nested object for cleaner schema organization.

**Completed** (2026-02-04):
- ✅ Phase 0: Migration script created and run (`backend/migrate-create-calendar-data.js`)
- ✅ Phase 0: All existing documents have `calendarData` object populated
- ✅ Phase 1: Backend writes to `calendarData` ONLY
- ✅ Phase 2: Frontend reads from `calendarData` with format-aware fallback for non-MongoDB inputs
- ✅ Phase 3: All tests pass (163 frontend, 32 backend graphApiService)
- ✅ Phase 4: Cleanup migration run - top-level fields removed
- ✅ Backend queries updated to use `calendarData.startDateTime`/`calendarData.endDateTime`

**Migration Complete**: All calendar/event fields now exclusively in `calendarData` object.

**Key Files**:
- `backend/api-server.js` - Write operations (updated)
- `src/utils/eventTransformers.js` - Read operations (updated)
- `backend/migrate-cleanup-calendar-data.js` - Cleanup script (ready to run)

**Updated Endpoints** (now write to `calendarData.*`):
- `POST /api/events/request` - Room reservation requests
- `POST /api/room-reservations/public/:token` - Public/guest reservation requests
- `POST /api/events/batch` - Batch event creation
- `POST /api/events/:eventId/audit-update` - Create/update via unified form
- `POST /api/room-reservations/drafts` - Draft reservations
- `PUT /api/admin/events/:id` - Admin event updates
- `PUT /api/admin/events/:id/approve-edit` - Approve edit requests
- `PUT /api/events/:id/department-fields` - Department-specific updates

---

## Context Preservation Protocol

**IMPORTANT**: Before clearing context or ending a session with pending work:

1. **Review recent changes** - Check git status and recent modifications
2. **Ask user for confirmation** - Confirm current state and next steps
3. **Update this section** - Update the "Current In-Progress Work" section above with latest status
4. **Reference plan file** - Point to the detailed plan file location

This ensures continuity across sessions and prevents loss of planned work.