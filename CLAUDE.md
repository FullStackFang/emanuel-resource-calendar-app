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

### Testing
```bash
cd backend
npm test                           # Run all tests (173 tests)
npm run test:unit                  # Run unit tests only
npm run test:integration           # Run integration tests only
npm test -- eventApprove.test.js   # Run specific test file
npm test -- --testNamePattern="Approver"  # Run tests matching pattern
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

  // TOP-LEVEL CALENDAR FIELDS (authoritative for app)
  eventTitle, eventDescription,
  startDateTime, endDateTime,  // Date range queries use these
  startDate, startTime, endDate, endTime,
  setupTime, teardownTime, doorOpenTime, doorCloseTime,
  locations, locationDisplayNames,
  categories, services, assignedTo,
  // Recurring event metadata
  eventType,        // 'singleInstance' | 'seriesMaster' | 'occurrence'
  seriesMasterId,   // Graph ID of series master (for occurrences)
  recurrence,       // Recurrence pattern (for series masters)

  // NESTED DATA STRUCTURES
  graphData: { /* Raw Microsoft Graph API data - do NOT read for display */ },
  roomReservationData: { /* Reservation workflow data */ },
  internalData: { /* Legacy internal enrichments */ },

  // METADATA
  createdAt, createdBy, lastModifiedDateTime, ...
}
```

**Important: All calendar fields are at top level**
Date range queries use top-level `startDateTime` and `endDateTime`:
```javascript
query['startDateTime'] = { $lt: endDate };
query['endDateTime'] = { $gt: startDate };
```

**Top-level Calendar Fields**:
- Event info: eventTitle, eventDescription, categories
- Timing: startDateTime/endDateTime, setupTime, teardownTime, doorOpenTime, doorCloseTime
- Location: locations (ObjectId array), locationDisplayNames, isOffsite, offsite* fields
- Requester: requesterName, requesterEmail, department, phone
- Recurring: eventType, seriesMasterId, recurrence
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

#### Button Action Standard (ALL Significant Actions)
**ALL significant button actions** (delete, restore, cancel, approve, reject, etc.) MUST follow this **in-button confirmation** pattern. This provides consistent UX across the entire application. **NO browser dialogs like `window.confirm()`**.

1. **First click** - Button text changes to "Confirm?" with visual emphasis (colored background, pulse animation)
2. **Second click** - Performs the action, button shows "[Action]ing..." (e.g., "Deleting...", "Restoring...")
3. **Auto-reset** - If not confirmed within 3 seconds, button resets to original text
4. **Disabled state** - Button disabled during the operation
5. **Success feedback** - Use `showSuccess()` toast notification on completion
6. **Error handling** - Use `showError()` toast notification on failure

**Color by action type:**
- Destructive (delete, cancel): `var(--color-error-500)` (red)
- Constructive (restore, approve): `var(--color-success-500)` (green)
- Neutral (reject, update): `var(--color-warning-500)` or `var(--color-info-500)`

```javascript
// Standard action pattern with in-button confirmation
const [actionId, setActionId] = useState(null);
const [confirmActionId, setConfirmActionId] = useState(null);

// First click sets confirm state, second click performs action
const handleActionClick = (item) => {
  if (confirmActionId === item._id) {
    // Already in confirm state, proceed with action
    handleAction(item);
  } else {
    // First click - enter confirm state
    setConfirmActionId(item._id);
    // Auto-reset after 3 seconds if not confirmed
    setTimeout(() => {
      setConfirmActionId(prev => prev === item._id ? null : prev);
    }, 3000);
  }
};

const handleAction = async (item) => {
  try {
    setActionId(item._id);
    setConfirmActionId(null);
    await performAction(item._id);
    showSuccess(`"${item.name}" action completed`);
    // Update local state
  } catch (err) {
    showError(err, { context: 'ComponentName.handleAction' });
  } finally {
    setActionId(null);
  }
};

// Button JSX (example: Restore)
<button
  className={`restore-btn ${confirmActionId === item._id ? 'confirm' : ''}`}
  onClick={() => handleActionClick(item)}
  disabled={actionId === item._id}
>
  {actionId === item._id
    ? 'Restoring...'
    : confirmActionId === item._id
      ? 'Confirm?'
      : 'Restore'}
</button>

// Required CSS for confirm state (adjust color per action type)
.action-btn.confirm {
  background: var(--color-success-500); /* or error-500 for destructive */
  color: white;
  animation: pulse-confirm 1s ease-in-out infinite;
}

@keyframes pulse-confirm {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.8; }
}
```

#### Actions That Require In-Button Confirmation
The following action types MUST use the in-button confirmation pattern above:
- **Delete** / **Remove** - Destructive, uses red confirm state
- **Restore** - Constructive, uses green confirm state
- **Cancel** - Destructive, uses red confirm state
- **Approve** / **Reject** - Significant state change, uses appropriate color
- **Submit** - When submitting for review/approval

#### Actions That DON'T Require Confirmation
Simple navigation or non-destructive actions can skip confirmation:
- **Edit** / **View Details** - Opens a form/modal
- **Close** / **Cancel** (modal close) - Just closes UI
- **Save Draft** - Non-destructive, can be undone

#### Toast Notification Import
```javascript
const { showSuccess, showError, showWarning } = useNotification();
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

### Initial Load Performance Optimization - Phase 1 In Progress

**Status**: Planning complete 2026-02-04. Ready for implementation.

**Goal**: Reduce initial app load time by removing blocking imports, adding visual feedback, and eliminating unused dependencies.

**Problem Identified:**
- ~680KB blocking imports in main chunk (MSAL, Sentry, React Query, DatePicker, Loader)
- 3-4 sequential API call waterfalls before content renders
- Duplicate API calls (`/users/current` fetched multiple times)
- No loading UI - blank screen during provider initialization
- Dead dependencies - lodash (~70KB) unused

**Phase 1 Tasks (Quick Wins - This Session):**
| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Remove unused deps (lodash, @react-pdf/renderer) | `package.json` | Pending |
| 2 | Add skeleton screen | `src/App.jsx`, `src/App.css` | Pending |
| 3 | Defer Sentry init with requestIdleCallback | `src/main.jsx` | Pending |
| 4 | Replace react-loader-spinner with CSS | `src/components/shared/LoadingSpinner.jsx`, `LoadingSpinner.css` | Pending |

**Expected Results:**
- ~120KB bundle size reduction
- Immediate visual feedback instead of blank screen
- Low risk, all changes isolated

**Future Phases (Not This Session):**
- Phase 2: API call parallelization in Calendar.jsx, dedupe user calls
- Phase 3: Lazy load react-datepicker, optimize Vite chunks
- Phase 4: Stale-while-revalidate for events

**Plan File**: `/home/fullstackfang/.claude/plans/smooth-kindling-river.md`

**Verification:**
```bash
# Baseline bundle size
npm run build && ls -la dist/assets/*.js | awk '{sum += $5} END {print "Total:", sum/1024, "KB"}'

# After changes - run tests
cd backend && npm test  # 173 tests should pass

# Performance check (Chrome DevTools)
# - First Contentful Paint (FCP)
# - Time to Interactive (TTI)
```

---

### Event Workflow Test Suite - Phase 1 Complete

**Status**: Phase 1 Complete 2026-02-04. All 173 tests passing.

**Goal**: Create comprehensive test suite to verify event workflow state machine, role-based access control, and cross-role interactions.

**Event State Machine:**
```
CREATE DRAFT → DRAFT → SUBMIT → PENDING → APPROVE → APPROVED
                 │                  │                   │
                 │                  └─→ REJECT → REJECTED │
                 │                                        │
                 └─────────── DELETE ←───────────────────┘
                                │
                            DELETED → RESTORE → Previous State
```

**Statuses**: `draft` | `pending` | `approved` | `rejected` | `deleted`

**Test Categories (93 planned tests):**
| Category | Test IDs | Count |
|----------|----------|-------|
| Viewer Role | V-1 to V-11 | 11 |
| Requester Role | R-1 to R-29 | 29 |
| Approver Role | A-1 to A-23 | 23 |
| Admin Role | AD-1 to AD-3 | 3 |
| Cross-Role | X-1 to X-10 | 10 |
| Edge Cases | E-1 to E-13 | 13 |
| Notifications | N-1 to N-4 | 4 |

**Test Infrastructure Files:**
```
backend/__tests__/__helpers__/
├── testSetup.js       # mongodb-memory-server lifecycle (Windows ARM64 compatible)
├── testConstants.js   # Status terminology mapping
├── userFactory.js     # Create mock users for each role
├── eventFactory.js    # Create events in each state
├── authHelpers.js     # JWT mock token generation (jose)
├── graphApiMock.js    # Mock Graph API service with call tracking
├── dbHelpers.js       # Database seeding + audit assertion
├── testApp.js         # Express test app with all workflow endpoints
└── globalSetup.js     # Jest global setup for mongodb-memory-server
```

**Integration Test Files:**
```
backend/__tests__/integration/
├── roles/
│   ├── viewerAccess.test.js      # V-1 to V-11 (17 tests)
│   └── requesterWorkflow.test.js # R-1 to R-29 (27 tests)
└── events/
    ├── eventApprove.test.js      # A-7 (8 tests)
    ├── eventReject.test.js       # A-8, A-9 (8 tests)
    ├── eventDelete.test.js       # A-13, A-19-A-23 (14 tests)
    └── editRequest.test.js       # A-14 to A-17 (12 tests)
```

**Verification Commands:**
```bash
cd backend && npm test                                  # All tests (173 passing)
cd backend && npm run test:unit                         # Unit only
cd backend && npm run test:integration                  # Integration only
cd backend && npm test -- eventApprove.test.js          # Specific file
```

**Completed Tests (173 passing):**
- **Permission Unit Tests**: 44 tests for permissionUtils (role hierarchy, permissions, department fields)
- **Viewer Access Tests (V-1 to V-11)**: 17 tests verifying viewers cannot perform privileged actions
- **Requester Workflow Tests (R-1 to R-29)**: 27 tests for ownership and state transitions
- **Event Approval Tests (A-7)**: 8 tests for pending→approved workflow with Graph API mock
- **Event Rejection Tests (A-8, A-9)**: 8 tests for pending→rejected workflow with reason validation
- **Event Delete/Restore Tests (A-13, A-19-A-23)**: 14 tests for soft delete and restore
- **Edit Request Tests (A-14 to A-17)**: 12 tests for edit request workflow
- **Error Logging Service Tests**: 12 tests for sanitizeData and generateCorrelationId
- **Graph API Service Tests**: 31 tests for Graph API service functionality

**Test Infrastructure Created:**
- `backend/__tests__/__helpers__/testConstants.js` - Status/role/endpoint constants
- `backend/__tests__/__helpers__/testSetup.js` - MongoDB memory server lifecycle with Windows ARM64 detection
- `backend/__tests__/__helpers__/userFactory.js` - User fixtures for all roles
- `backend/__tests__/__helpers__/eventFactory.js` - Event fixtures for all states
- `backend/__tests__/__helpers__/authHelpers.js` - JWT token generation with jose RSA key pairs
- `backend/__tests__/__helpers__/graphApiMock.js` - Mock Graph API service with call history tracking
- `backend/__tests__/__helpers__/dbHelpers.js` - Audit assertion helpers
- `backend/__tests__/__helpers__/testApp.js` - Express test app implementing all workflow endpoints

**Windows ARM64 Compatibility:**
The test suite automatically detects Windows ARM64 and uses x64 MongoDB binary emulation since MongoDB doesn't provide ARM64 Windows builds. This is handled in `testSetup.js` via `getServerOptions()`.

**Remaining Work:**
- Cross-role tests (X-1 to X-10)
- Edge case tests (E-1 to E-13)
- Notification tests (N-1 to N-4)
- E2E tests with Playwright

**Plan File**: `/home/fullstackfang/.claude/plans/piped-percolating-adleman.md`

---

### Move Recurring Event Metadata to calendarData - COMPLETED

**Status**: Completed 2026-02-04

**Goal**: Move recurring event fields (`type`, `seriesMasterId`, `recurrence`) from `graphData` to top-level authoritative fields to complete the graphData isolation cleanup.

**Completed Tasks:**
- [x] **Backend**: Updated `upsertUnifiedEvent()` in `backend/api-server.js` to add `eventType`, `seriesMasterId`, `recurrence` at top level
- [x] **Backend**: Created migration script `backend/migrate-add-recurrence-to-calendardata.js` (supports `--dry-run`, `--verify`)
- [x] **Frontend**: Updated `src/utils/eventTransformers.js` to extract `eventType`, `seriesMasterId` with fallback
- [x] **Frontend**: Updated `src/components/Calendar.jsx` (6 locations) to use top-level fields with fallback
- [x] **Frontend**: Updated `src/components/WeekView.jsx` recurring indicator check
- [x] **Frontend**: Updated `src/components/DayEventPanel.jsx` recurring indicator check
- [x] **Frontend**: Updated `src/components/RoomReservationReview.jsx` series master ID extraction
- [x] **Testing**: Added 7 new test cases in `src/__tests__/unit/utils/eventTransformers.test.js` (all 46 tests pass)

**Migration**: Run `cd backend && node migrate-add-recurrence-to-calendardata.js --dry-run` to preview, then without flag to apply.

---

### graphData Isolation Cleanup (Code Review Findings) - COMPLETED

**Status**: Completed 2026-02-04.

**Completed Tasks:**
- [x] **Task 1**: Updated approve endpoint to read from `calendarData` instead of `graphData`
- [x] **Task 2**: Removed backend bidirectional sync (form edits no longer sync to `graphData`)
- [x] **Task 3**: Updated view components (Calendar, WeekView, DayView, MonthView, DayEventPanel) to use `calendarData.categories`
- [x] **Task 4**: Updated EventForm.jsx to read description from `calendarData.eventDescription`
- [x] **Task 5**: Updated EventSearch.jsx and EventSearchExport.jsx to use `calendarData` fields
- [x] **Task 6**: Updated MyReservations.jsx to use `transformEventsToFlatStructure()`

---

### Data Architecture Rules (Reference)

**calendarData** (Authoritative for application):
- All event/calendar fields live here
- Frontend reads via `transformEventToFlatStructure()`
- Backend writes here on create/update
- All queries use `calendarData.*` fields

**graphData** (Graph API integration only):
- Raw Microsoft Graph API responses
- Written once during sync from Outlook
- Read ONLY when publishing to Outlook (approve, update, delete operations still call Graph API)
- Frontend should NEVER read for display

**Recurring Events:** (RESOLVED 2026-02-04)
- Recurring event metadata now stored at top level: `eventType`, `seriesMasterId`, `recurrence`
- All components use top-level fields with `graphData` fallback for backward compatibility
- Migration script available: `backend/migrate-add-recurrence-to-calendardata.js`

---

## Context Preservation Protocol

**IMPORTANT**: Before clearing context or ending a session with pending work:

1. **Review recent changes** - Check git status and recent modifications
2. **Ask user for confirmation** - Confirm current state and next steps
3. **Update this section** - Update the "Current In-Progress Work" section above with latest status
4. **Reference plan file** - Point to the detailed plan file location

This ensures continuity across sessions and prevents loss of planned work.