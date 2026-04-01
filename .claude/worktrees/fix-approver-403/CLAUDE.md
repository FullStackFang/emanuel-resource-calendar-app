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

**IMPORTANT: Do NOT run the full test suite (`npm test`) after every change.** The full suite has 472 backend tests and takes ~2 minutes. Instead, run only the specific test file(s) directly related to your changes. Only run the full suite when explicitly asked by the user.

**Backend (Jest):**
```bash
cd backend
npm test -- editRequest.test.js    # Run specific test file (PREFERRED)
npm test -- --testNamePattern="Approver"  # Run tests matching pattern
npm run test:unit                  # Run unit tests only
npm run test:integration           # Run integration tests only
npm test                           # Run ALL tests (472 tests) — ONLY when asked
```

**Frontend (Vitest):**
```bash
npm test                  # Run frontend unit tests (interactive)
npm run test:run          # Run once (CI-friendly)
npm run test:coverage     # Run with coverage report
```

### Generate Development Certificates
```bash
node generateCert.js  # Creates self-signed certs in /certs folder
```

### Deployment (Azure Web Apps)
```bash
npm run deploy                  # Frontend: build + zip + az webapp deploy
cd backend && npm run deploy    # Backend: build-info + az webapp up
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
  - `templeEvents__Events`: Unified event storage with Graph data and reservation workflow
  - `templeEvents__CalendarDeltas`: Delta token storage for efficient syncing
  - `templeEvents__Locations`: Location and room data (replaces templeEvents__Rooms)
    - Locations with `isReservable: true` are available for room reservations
    - Also stores event locations from Graph API with alias management
  - `templeEvents__ReservationTokens`: Guest access tokens for public forms
  - `templeEvents__EventAttachments`: File attachments for events (GridFS)
  - `templeEvents__EventAuditHistory`: Event change tracking and audit logs
  - `templeEvents__Categories`: Event categories and subcategories
  - `templeEvents__SystemSettings`: System-wide settings (email config, error logging)
  - `templeEvents__RoomCapabilityTypes`: Room capability/feature definitions
  - `templeEvents__EventServiceTypes`: Event service type definitions
  - `templeEvents__FeatureCategories`: Feature category groupings
  - `templeEvents__ReservationAuditHistory`: Reservation-specific audit trail
  - `templeEvents__ReservationAttachments`: Reservation file tracking
  - `templeEvents__Files` (GridFS): File binary storage
  - **DEPRECATED**: `templeEvents__Rooms` (migrated to templeEvents__Locations)
  - **DEPRECATED**: `templeEvents__InternalEvents` (consolidated into templeEvents__Events)
  - **DEPRECATED**: `templeEvents__EventCache` (consolidated into templeEvents__Events)
  - **DEPRECATED**: `templeEvents__RoomReservations` (consolidated into templeEvents__Events with roomReservationData)
- **Authentication**: JWT validation with JWKS

### Key Services
- **calendarDataService.js**: Enhanced event operations with caching and unified sync
- **unifiedEventService.js**: Delta sync for multiple calendars with conflict detection
- **graphApiService.js**: Backend Graph API service using app-only authentication (preferred)
- **emailService.js**: Email notifications via Graph API (approval, rejection, edit requests)
- **emailTemplates.js**: HTML email template generation with change tracking tables
- **errorLoggingService.js**: Centralized error logging with Sentry integration
- **userPreferencesService.js**: User preference management with MongoDB persistence
- **utils/changeDetection.js**: Approver change tracking for email notifications
- **utils/concurrencyUtils.js**: `conditionalUpdate()` for optimistic concurrency control
- ~~**graphService.js**~~: Frontend Graph API interactions (legacy, fully deprecated)

### API Structure
- Protected endpoints require JWT bearer token
- Public endpoints at `/api/public/*` for external access
- Admin-only endpoints for sync operations

### Event Data Model
Events in `templeEvents__Events` use top-level calendar fields with nested workflow data:

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
  roomReservationData: {
    requestedBy: { name, email, department, phone, userId }, // Canonical requester source
    // ... reservation workflow fields (reviewNotes, reviewedAt, etc.)
  },

  // VERSIONING & HISTORY
  _version,          // Optimistic concurrency control (incremented on each write)
  statusHistory: [   // Array of { status, changedAt, changedBy, ... }
    { status, changedAt, changedBy, reason }
  ],

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
- Recurring: eventType, seriesMasterId, recurrence
- Services and assignments
- **Requester info**: Lives in `roomReservationData.requestedBy` (NOT top-level)

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
- `PUT /api/admin/events/:id/publish` - Creates Graph events on publish
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

### Text Formatting
- **Never use curly/smart quotes** (`"` `"` `'` `'`). Always use straight quotes (`"` and `'`). Smart quotes break git commit messages and shell commands.

### Before Writing Any Code

- **If something goes sideways, STOP and re-plan immediately** - don't keep pushing down a broken path.
- **Write detailed specs upfront to reduce ambiguity** - clarify requirements, edge cases, and expected behavior before writing implementation code.

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

### After Each Implementation

Once a task is complete and verified, **always provide a ready-to-use git commit message**. Format:

```
<type>(<scope>): <short summary>

- Key change 1
- Key change 2
- Tests: <count> new/updated, <total> passing
```

**Types**: `feat`, `fix`, `refactor`, `test`, `chore`, `docs`, `perf`
**Scope**: component or area affected (e.g., `MyReservations`, `api-server`, `calendar`)

Keep the summary line under 72 chars. Body bullets should cover what changed and why, not how. Include test counts when tests were added or modified.

### Git Commit Message Quoting Rule
- **NEVER use double quotes (`"`) in suggested or generated git commit messages.** Use single quotes (`'`) instead when quoting values.
- This applies to the summary line, body, and all bullet points.
- Example: `feat(calendar): add 'draft' status badge` (correct) vs `feat(calendar): add "draft" status badge` (wrong)

### State Management
- Use React Context for global state (user preferences, timezone)
- Pass data directly to avoid race conditions with async state updates
- Minimize re-renders with proper useCallback/useMemo usage

### UI Patterns

#### Button Action Standard (ALL Significant Actions)
**ALL significant button actions** (delete, restore, cancel, publish, reject, etc.) MUST follow this **in-button confirmation** pattern. This provides consistent UX across the entire application. **NO browser dialogs like `window.confirm()`**.

1. **First click** - Button text changes to "Confirm?" with visual emphasis (colored background, pulse animation)
2. **Second click** - Performs the action, button shows "[Action]ing..." (e.g., "Deleting...", "Restoring...")
3. **Auto-reset** - If not confirmed within 3 seconds, button resets to original text
4. **Disabled state** - Button disabled during the operation
5. **Success feedback** - Use `showSuccess()` toast notification on completion
6. **Error handling** - Use `showError()` toast notification on failure

**Color by action type:**
- Destructive (delete, cancel): `var(--color-error-500)` (red)
- Constructive (restore, publish): `var(--color-success-500)` (green)
- Neutral (reject, update): `var(--color-warning-500)` or `var(--color-info-500)`

**State pattern:** `actionId` (loading), `confirmActionId` (confirm state). First click sets confirm, second click calls handler. 3-second auto-reset timeout. Use `showSuccess()`/`showError()` for feedback. See existing components (e.g., `EventManagement.jsx`, `MyReservations.jsx`) for full implementations.

```css
/* Confirm state CSS (adjust color per action type) */
.action-btn.confirm {
  background: var(--color-success-500); /* or error-500 for destructive */
  color: white;
  animation: pulse-confirm 1s ease-in-out infinite;
}
```

#### Actions That Require In-Button Confirmation
The following action types MUST use the in-button confirmation pattern above:
- **Delete** / **Remove** - Destructive, uses red confirm state
- **Restore** - Constructive, uses green confirm state
- **Cancel** - Destructive, uses red confirm state
- **Publish** / **Reject** - Significant state change, uses appropriate color
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
- **Times display incorrectly**: Datetime strings MUST have `Z` suffix for UTC. Backend adds `Z` during storage; frontend reads `event.start.dateTime` (constructed by API). See `architecture-notes.md` for full DateTime Data Architecture.

### See Also
For detailed architecture documentation, see `architecture-notes.md`

## Key Architectural Patterns

### Event Status Machine
```
draft → pending → published → deleted
                → rejected  → deleted
          draft → deleted
```
**Statuses**: `draft` | `pending` | `published` | `rejected` | `deleted`
Restore walks `statusHistory[]` backwards to find previous status.

### Optimistic Concurrency Control (OCC)
Every write endpoint uses `conditionalUpdate()` with `_version` field. Clients send `expectedVersion` in request body. On conflict, backend returns 409 with `VERSION_CONFLICT` code and field-level diff snapshot. Frontend shows `ConflictDialog` with three modes: `status_changed`, `data_changed`, `already_actioned`.

### Requester Canonical Source
Requester info lives in `roomReservationData.requestedBy` (name, email, department, phone, userId). **NOT** in top-level `calendarData` fields. Ownership queries use `roomReservationData.requestedBy.email`.

### Delete Permissions (Scoped by Role)
- **Admin**: Can delete any event in any status
- **Approver**: Can delete own events (any status) + any published event. Cannot delete other users' draft/pending/rejected events.
- **Requester deleting own pending**: Uses the same delete endpoint but reason is required (replaces old cancel flow). UI shows "Withdraw Request" button.
- **Notification**: Requester is notified when someone else deletes their event.

### Scheduling Conflict Detection
`checkRoomConflicts()` runs on publish, admin save, owner edit, and restore endpoints. Returns 409 `SchedulingConflict` with conflict details. Admins can force-override; owners cannot.

### graphData.id Gate
`graphData.id` only exists on published events (set when Graph event is created). It gates all Graph API sync operations. Events without `graphData.id` skip Graph sync entirely.

### Testing
- **472 backend tests** (31 suites) — Jest with MongoDB Memory Server
- **169 frontend tests** — Vitest
- Test helpers in `backend/__tests__/__helpers__/` (testSetup, userFactory, eventFactory, authHelpers, graphApiMock, testApp)
- MongoDB Memory Server auto-detects Windows ARM64 and uses x64 emulation

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

### Initial Load Performance Optimization (Planned)

**Status**: Planned 2026-02-04. No implementation started yet.

**Goal**: Reduce initial app load time (~680KB blocking imports, sequential API waterfalls, no loading UI).

**Phase 1 (Quick Wins):** Remove unused deps (lodash, @react-pdf/renderer), add skeleton screen, defer Sentry init, replace react-loader-spinner with CSS spinner. Expected ~120KB reduction.

**Future Phases:** API call parallelization, lazy-load react-datepicker, optimize Vite chunks, stale-while-revalidate.

**Plan File**: `/home/fullstackfang/.claude/plans/smooth-kindling-river.md`

---

### Completed Architectural Work (Reference)

- **Event data architecture cleanup**: Eliminated `internalData`, removed placeholder `graphData`, deduplicated requester info into `roomReservationData.requestedBy`
- **Status rename**: `approved` → `published` across entire codebase (database, API, frontend, tests)
- **Optimistic concurrency control**: `_version` field with `conditionalUpdate()`, 409 conflict responses with field-level diffs
- **Status history tracking**: `statusHistory[]` array on all events, restore walks history backwards
- **Scheduling conflict detection**: `checkRoomConflicts()` on publish, save, edit, and restore endpoints
- **Email notifications**: Approval/rejection emails with approver change tracking (`reviewChanges`)
- **graphData isolation**: Frontend reads top-level fields only, `graphData` is raw Graph API cache
- **Recurring event metadata**: `eventType`, `seriesMasterId`, `recurrence` at top level

---

## Context Preservation Protocol

**IMPORTANT**: Before clearing context or ending a session with pending work:

1. **Review recent changes** - Check git status and recent modifications
2. **Ask user for confirmation** - Confirm current state and next steps
3. **Update this section** - Update the "Current In-Progress Work" section above with latest status
4. **Reference plan file** - Point to the detailed plan file location

This ensures continuity across sessions and prevents loss of planned work.