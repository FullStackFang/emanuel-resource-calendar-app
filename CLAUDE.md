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

**IMPORTANT: Do NOT run the full test suite (`npm test`) after every change.** The full suite has ~1,650 backend tests and takes several minutes. Instead, run only the specific test file(s) directly related to your changes. Only run the full suite when explicitly asked by the user.

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

**Output Rules:**
- **Always include a progress bar** using `\r` carriage return (see batch pattern below)
- **No per-document logging** during normal execution — only the progress bar. Per-doc detail is only for `--dry-run` mode.
- Keep normal-mode output to: config summary, counts before/after, progress bar, and final summary

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

### Retry Loop Safety

Any loop that retries on failure must use `retryWithBackoff` from `backend/utils/retryWithBackoff.js` or have an explicit max iteration cap. Error paths in loops must advance the loop state or exit.

```javascript
// Bad: retries forever on persistent failure
while (processed < total) {
  try { await db.deleteMany(...); processed += batch.length; }
  catch (e) { errors.push(e); } // processed never advances — infinite loop
}

// Good: shared retry utility with bounded attempts
const { batchDelete } = require('./utils/batchDelete');
await batchDelete(collection, query, { batchSize: 100 });
```

For batch operations, use `batchDelete` from `backend/utils/batchDelete.js` which handles retry, progress callbacks, and bounded failure.

### Common React Mistakes in This Codebase

**Unstable useCallback dependencies**: If a `useCallback` depends on a prop passed as an inline arrow from the parent, it recreates every render. Use a ref to break the chain (see `SchedulingAssistant` `onConflictChange` pattern with `useLayoutEffect` + ref).

**Ref-stored closures go stale**: A function stored in a `useRef` at mount time captures mount-time state in its closure. If the underlying state changes (e.g., `formData`), the ref still holds the old function. Keep refs in sync: `useEffect(() => { ref.current = latestFn }, [latestFn])`.

**setState bailout semantics**: `setState(0)` when state is already `0` bails out (Object.is for primitives). `setState(() => fn)` when storing a function NEVER bails out — function references are never Object.is equal. Know which you are dealing with before classifying a re-render bug.

### UI Patterns

#### Button Action Standard (ALL Significant Actions)
**ALL significant button actions** (delete, restore, cancel, publish, reject, etc.) MUST follow this **in-button confirmation** pattern. This provides consistent UX across the entire application. **NO browser dialogs like `window.confirm()`**.

1. **First click** - Button text changes to "Confirm?" with visual emphasis (colored background, pulse animation)
2. **Second click** - Performs the action, button shows "[Action]ing..." (e.g., "Deleting...", "Restoring...")
3. **Persistent** - Confirmation state persists until user confirms, clicks another action, or navigates away (no auto-reset timeout)
4. **Disabled state** - Button disabled during the operation
5. **Success feedback** - Use `showSuccess()` toast notification on completion
6. **Error handling** - Use `showError()` toast notification on failure

**Color by action type:**
- Destructive (delete, cancel): `var(--color-error-500)` (red)
- Constructive (restore, publish): `var(--color-success-500)` (green)
- Neutral (reject, update): `var(--color-warning-500)` or `var(--color-info-500)`

**State pattern:** `actionId` (loading), `confirmActionId` (confirm state). First click sets confirm, second click calls handler. No auto-reset — confirmation persists until user acts. Use `showSuccess()`/`showError()` for feedback. See existing components (e.g., `EventManagement.jsx`, `MyReservations.jsx`) for full implementations.

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
- **Requester withdrawing own pending**: Uses `DELETE /api/admin/events/:id` with `reason` required. Backend scoping: own pending only, 403 for anything else. UI shows "Withdraw Request" button via `EventReviewExperience`.
- **Notification**: Requester is notified when someone else deletes their event.

### EventReviewExperience (Unified Modal Layer)
`src/components/shared/EventReviewExperience.jsx` is the **single shared component** that all entry points (Calendar, MyReservations, ReservationRequests) use to render ReviewModal + RoomReservationReview + ConflictDialogs. Permission-gated actions are computed here, NOT in each caller.

**Key permission gates inside EventReviewExperience:**
- `onApprove`/`onReject` — gated by `canApproveReservations`
- `onSave` — gated by `canEditEvents`
- `onDelete` — gated by `effectiveCanDelete` (= `canDeleteEvents || (isRequesterOnly && isPending)`)
- `onRestore` — gated by raw `canDeleteEvents` (requesters cannot restore)

**Adding new permission-gated actions:** Put the logic in `EventReviewExperience`, not in individual callers. Callers pass raw permissions from `usePermissions()` and caller-specific props (handlers, state). The component computes derived flags like `effectiveCanDelete` so behavior is consistent everywhere.

### Scheduling Conflict Detection
`checkRoomConflicts()` runs on publish, admin save, owner edit, and restore endpoints. Returns 409 `SchedulingConflict` with conflict details. Admins can force-override; owners cannot.

### graphData.id Gate
`graphData.id` only exists on published events (set when Graph event is created). It gates all Graph API sync operations. Events without `graphData.id` skip Graph sync entirely.

### React Query loading primitives (TanStack v5)
List components that consume a TanStack Query result MUST follow this convention to prevent the "first-paint blank flash" bug (empty-state rendering for one tick before the spinner takes over).

**Derive the primitives from the shared helper — do not hand-roll them.** `deriveListLoadingState(query, { countsQuery, enabled })` in `src/utils/listLoadingState.js` is the single, unit-tested definition of `isFirstLoad` + `isSilentRefreshing` (locked by `listLoadingState.test.js`). Bind `loading = isFirstLoad`. Pass `enabled` ONLY for views that intentionally skip the fetch on some tabs/filters (e.g. ReservationRequests' all-tab). Pass `countsQuery` so a background counts refetch dims rather than blanks. The bullets below explain WHY the helper is shaped the way it is:

- **`query.isPending`** — first-load gate. `true` whenever `status === 'pending'`, regardless of `fetchStatus`. Covers both the `pending && idle` window (the tick after `enabled` flips to `true`, before the request starts) and the `pending && fetching` window. Use this as the `loading` binding.
- **`query.isFetching && !query.isPending`** — silent-refresh detector. `true` only when a fetch is in progress AND prior data has already resolved. Use this as the `isSilentRefreshing` binding to suppress the empty-state during background refetches (SSE invalidations, polling, mutation invalidations).
- **`query.isLoading`** — DO NOT use as the first-load gate. Defined as `isPending && isFetching`, so it is `false` during the `pending && idle` tick. Components that gate their spinner on `isLoading` will render the empty-state for one render cycle before the fetch starts.
- **Empty-state predicate**: render `<EmptyState/>` if and only if `!query.isPending && data.length === 0 && !isSilentRefreshing`. Anything looser causes flashes.
- **Recovery affordance**: list-view empty states MUST render `<EmptyStateRefreshButton onClick={handleManualRefresh} isRefreshing={isManualRefreshing} />` from `src/components/shared/EmptyStateRefreshButton.jsx` so users have a user-actionable recovery path for any blank state that slips through. The calendar grid surfaces the same CTA inside an absolutely-positioned card (see `Calendar.jsx`, predicate excludes `initializing`, `isNavigating`, `loading`, and the `emptyStateNotice` banner).

Reference implementations (all consume `deriveListLoadingState`): `MyReservations.jsx`, `EventManagement.jsx` (with `countsQuery`), `ReservationRequests.jsx` (with `enabled: listQueryEnabled`). Locked by `MyReservations.firstPaint.test.jsx`, `ReservationRequests.firstPaint.test.jsx`, `EventManagement.firstPaint.test.jsx`, and the helper's own `listLoadingState.test.js`.

**`EventSearch.jsx` is the deliberate exception to "spinner while disabled".** Its `enabled` is a user action (the Search button), so its idle state is a legitimate "enter criteria" prompt, NOT a spinner. It derives `isSearching = deriveListLoadingState({ isPending, isFetching }, { enabled: shouldRunSearch && !!apiToken }).isFirstLoad` and gates the results pane on `isSearching || isFetching` so the `pending && idle` tick after a Search click shows "Searching…" instead of flashing "No events found".

**Calendar cold-reload empty (the home grid).** The Calendar does NOT use a TanStack query for its event list, so the above does not apply to it. Its analogue is `shouldVerifyZeroResult()` in `calendarLoadDecision.js`: a fresh reload has no cached events to preserve, so the first cold (non-silent, non-retry) `0`-result per calendar selection is verified with one retry — keeping the loading overlay up via `verifyPendingRef` — before the "No events to display" card is allowed to render. Locked by `calendarLoadDecision.test.js`.

### Testing
- **1,659 backend tests** (128 suites) — Jest with MongoDB Memory Server
- **1,175 frontend tests** (82 files) — Vitest
- **The suite is RED on main and has been for a while** (2026-07-27: 229 backend failures
  across 38 suites, 10 frontend failures across 3 files). There is no CI catching them.
  Treat those as untriaged bugs, not noise — but before blaming your own change, measure the
  baseline: `git stash push -u` → run → `git stash pop` → run, and compare counts.
- `retryWithBackoff.test.js` has two wall-clock-sensitive cases (RB-13 honours a 3s
  RetryAfterMs; RB-14 measures jitter bounds) that flake under full-suite load and pass in
  isolation. Re-run the file alone before investigating.
- Test helpers in `backend/__tests__/__helpers__/` (testSetup, userFactory, eventFactory, authHelpers, graphApiMock, testApp)
- **Graph failures in tests MUST be built with `graphApiMock.graphError(status, msg)` or
  `graphNetworkError(code)`**, never hand-rolled. Both delegate to the same `buildGraphError`
  production throws with, so a predicate that only understands the mock cannot pass.
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

### PWA install affordance (implemented 2026-08-14)

Spec: `openspec/changes/pwa-install-prompt/`. Frontend-only; no endpoint,
schema, query key, or PWA plumbing change — `vite.config.js`'s VitePWA
manifest and the `registerSW` call were already there and are untouched. 17/18
tasks; only 6.5 (on-device manual) outstanding.

**The gap it closes:** the app has been an installable PWA for a while and
nothing in the UI ever said so. Discovery depended on knowing that a browser
overflow menu hides an Install item — which on iPhone it does not.

**Shipped:**
- **`src/utils/pwaInstall.js`** — all platform knowledge, no React.
  `isRunningStandalone()`, `detectPlatform()`, `shouldShowNudge()`, the
  storage wrappers, and the module-scoped `beforeinstallprompt` /
  `appinstalled` capture behind `initInstallCapture()`.
- **Capture runs at module scope from `main.jsx`**, beside the
  `vite:preloadError` handler. Chrome dispatches `beforeinstallprompt` during
  initial page load, so a listener registered from an effect inside the lazily
  imported mobile tree misses it — and misses it ONLY in production, because
  dev hot-reload re-fires listeners after mount. Same "must run before React"
  reason as the deep-link capture above it.
- **`detectPlatform` checks the captured event BEFORE the UA** (`prompt` /
  `ios-safari` / `ios-other` / `manual`), so UA sniffing only picks which
  instructions to print and never gates capability. iPadOS 13+ (`MacIntel` +
  `maxTouchPoints > 1`) counts as iOS.
- **Installed state self-heals**: `appinstalled` sets the flag,
  `beforeinstallprompt` CLEARS it — the browser only fires it for an origin
  that is not currently installed, so an uninstall restores the entry with no
  timer or version check. On iOS neither event fires, so the entry always
  shows; Safari genuinely cannot report an existing install.
- **Storage failure degrades asymmetrically (D7)** and this is the whole
  mechanism, not a branch at the call sites: `readInstalledFlag()` returns
  false when storage throws (entry shown), `readNudgeDone()` returns true
  (nudge hidden). A storage failure must never remove the only route to
  installing, nor turn a once-ever banner into a nag.
- **One sheet for every platform** (`InstallAppSheet`): identical chrome —
  app mark, title 'Install Temple Events', numbered step pills, ghost +
  primary row — with only subtitle / steps / primary label varying. Android
  deliberately opens this sheet rather than firing Chrome's dialog straight
  from the menu (D3): one extra tap, one describable flow on both platforms.
  The sheet holds the ONLY platform branch in the feature.
- **`MobileApp` is the single owner (D9)**: holds `usePwaInstall()` + the
  sheet's open state, passes `showInstall` / `onInstall` to `MobileHeader`,
  renders nudge and sheet. **`recordVisit()` runs in a `useState` initializer,
  not an effect** — child effects run before the parent's, so an effect would
  hand the nudge last session's count and delay it a full visit. It is
  idempotent per session (sessionStorage guard), so a StrictMode double-invoke
  is harmless.
- Nudge: second signed-in session only, either button retires it forever.

**Tests:** new `pwaInstall.test.js` (29), `usePwaInstall.test.jsx` (13),
`InstallAppSheet.test.jsx` (15), `InstallAppNudge.test.jsx` (9);
`MobileHeader.test.jsx` 7 (was 3). Mobile suites 295/295. Mutation-checked:
removing `clearInstalledFlag()` from the `beforeinstallprompt` handler fails
UPI-4; removing `initInstallCapture()` from `main.jsx` fails UPI-1's companion
UPI-0 (a `?raw` source assertion — main.jsx boots MSAL, Sentry and the whole
app on import, so behavioural coverage of the bootstrap line is impossible in
jsdom; the assertion matches a bare `initInstallCapture();` statement so a
mention in a comment does not satisfy it). Full frontend suite 10 failures /
3 files, identical to the documented baseline.

**Outstanding:** task 6.5 — manual on real devices: Android install through
the sheet end to end, entry disappears, uninstall restores it; iPhone Safari
steps match what Safari actually shows and home-screen launch hides
everything; nudge on the second signed-in session and never again.

### Room conflict report (implemented 2026-08-05)

Spec: `openspec/changes/room-conflict-report/`. 42/43 tasks; only 11.3
(manual e2e) outstanding.

**The gap it closes:** every conflict check in the system is *one-vs-many* —
`checkRoomConflicts()` answers "given this candidate, what does it hit?" and
runs at write time. Nothing answered "across the calendar, what is
double-booked?". Graph delta sync writes Outlook events straight into
`templeEvents__Events` with NO conflict check, forced publishes deliberately
write into a known conflict, and approved events can be edited into one. All
three leave a real double-booking invisible until two groups show up.

**Shipped:**
- **`backend/utils/concurrencyRules.js`** — `isRealConflict(sideA, sideB,
  categoryMap)`, pure. The bilateral category grant + legacy per-event fallback
  lifted verbatim out of `checkRoomConflicts()`. **THREE call sites converted,
  not the two the design named**: the `actualConflicts` filter, the pending-edit
  loop, and `isFilteredByConcurrency` inside `checkRecurringRoomConflicts()`
  (the third is the exact complement — "filtered out" = "not a conflict").
  The eager category id/allow-list precompute in `checkRoomConflicts` is gone;
  it existed only to feed the inlined copies.
- **The extraction preserves an ASYMMETRY, deliberately** (pinned by CRU-12):
  the `aAllowsConcurrent` branch is reached only after the `bAllowsConcurrent`
  branch declined, so side A's `allowedConcurrentCategories` restriction list
  is never consulted. That is what publish does today. Changing it changes what
  the system lets people book and belongs in its own change.
- **`backend/services/conflictReportService.js`** — three bounded reads
  (published non-masters in window / masters by `eventType` / exception+addition
  children for suppression), then all comparison in memory: normalize → bucket
  by `(roomId, dayKey)` → per-bucket sweep-line → dedup by canonical pair key.
  Deps injected (collection, categoryMap, retry, roomNamesById), matching
  syncHealthService — api-server assigns collection handles at connect time.
- **A side is inserted into EVERY day-bucket its effective window touches.**
  Bucketing on the effective start-day alone silently drops midnight-spanning
  pairs. Cross-bucket dedup keys on the pair, so a pair meeting in two buckets
  reports once, dated by its overlap start.
- **`GET /api/admin/reports/conflicts`** — `verifyToken` + the same
  `isAdmin || canApproveReservations` gate as sync-health. `days` ∈
  {30,90,180,365}, default 90, **400 not clamped** (a clamped window misstates
  its own coverage). No cache (D7). Zero writes, asserted by CR-13-writes.
- **Frontend**: `ConflictReport.jsx` / `.css`, route `/admin/reports/conflicts`,
  `RequireSyncHealth` renamed `RequireApproverReport` and shared by both report
  routes. Nav mirrors Sync Health (top-level for non-admin approvers, Admin
  dropdown for admins). Drill-in mounts ONE `EventReviewExperience` fed by
  `exp.navigateToEvent(id)` — whose `/room-reservations/:id` → `/events/:id`
  404 fallback is **mandatory** here, since Outlook-synced sides carry no
  `roomReservationData`.
- **Honest states**: `degraded[]` banners incompleteness ABOVE the list, a
  total read failure throws (never an empty list), `truncated` banners the
  20,000-occurrence cap, and the empty state is gated on
  `!isFirstLoad && !isSilentRefreshing`. On a defect list the empty state reads
  "no conflicts were found" — flashing it before the scan resolves tells an
  approver the calendar is clean when nobody checked.

**Tests:** new `concurrencyRules.test.js` (12, CRU-1..12), new
`conflictReport.test.js` (53, CR-1..16 + endpoint), new
`ConflictReport.test.jsx` (16), `ConflictReport.firstPaint.test.jsx` (5),
`ConflictReport.route.test.jsx` (6). Extraction verified pure by baseline
identity — same 5 failures with the same names in `architecturalBugs.test.js`
before and after. Mutation-checked: removing the buffer extension fails CR-4
(and 3 others), removing exception-date suppression fails both CR-9 variants,
binding the loading gate to `query.isLoading` fails CRFP-1, reintroducing a
second route guard fails CRR-6. Full frontend suite identical to baseline
(10 failures / 3 files, pre-existing).

**Gotcha for future fixtures:** the buffer chain uses `??`, not `||`, so an
explicit `calendarData.reservationEndMinutes: 0` SHADOWS the
`teardownTimeMinutes` fallback. A fixture that always writes 0 tests a shape no
legacy event has. See the `published()` helper comment in `conflictReport.test.js`.

**Outstanding:** task 11.3 — manual end-to-end on dev with a live MSAL session:
open as approver and as admin, confirm a known Outlook-created collision
appears, change window and calendar filter, open both sides of one conflict
including an Outlook-synced side, resolve one and confirm it leaves the list on
close, confirm a non-approver is redirected.

### Scheduling Assistant series mode (implemented 2026-08-05)

Spec: `openspec/changes/scheduling-assistant-series-mode/`. Frontend-only;
`POST /rooms/recurring-conflicts` consumed unchanged. Supersedes the
presentation layer of conflict-resolution-workflow's panel: the standalone
`RecurringConflictSummary` component is DELETED and its surface now lives
inside the SchedulingAssistant.

- **`useRecurringConflicts` hook** (`src/hooks/useRecurringConflicts.js`)
  owns the fetch extracted from the retired panel (signature-keyed effect,
  1200ms edit-mode debounce, readOnly single-shot, abort). New occurrence
  model: merges server expansion with `recurrence.exclusions` (saved AND
  session-pending, `pending` flag via `pendingSkippedDates`) in date order —
  skipped wins over server state. `lastKnownBlockers` session map lets a
  skipped date warn that restoring re-flags its conflict.
- **`SchedulingAssistant` takes an optional `series` prop** and composes two
  new presentational components: `SeriesOccurrenceBand` (date chips, series
  verdict carrying the locked 'N of M occurrences have room conflicts'
  phrasing, All/Conflicts focus toggle, conflict stepper; the all-dates row
  is ALWAYS exactly one row — capacity is MEASURED from the row width
  (ResizeObserver + pure computeChipCapacity, SOB-23; fallback 12 pre-
  measurement/jsdom), with ellipsis chips ('+N', red-tinted when conflicts
  hide behind them) that PAGE the window (click or horizontal swipe; there
  is NO expanded state at all, SOB-19/20/22); selection changes re-anchor
  the window to keep the selected chip visible; Conflicts focus lists ONLY
  conflicted chips with one quiet placeholder pill per run of clear dates
  (SOB-6/21) — never windowed; dense >60 drops labels, compact >150
  collapses to summary + conflict list) between header and room tabs, and `SeriesVerdictBand` (per-day blocker detail with
  open-blocker via the existing `onOpenBlockingEvent` threading, two-step
  Skip, two-step Restore, last-occurrence skip refusal) below the timeline.
  `series={null}` renders the assistant exactly as before.
- **View date is form-base state** (`seriesViewDate`, null = follow
  `formData.startDate`): chip clicks retarget `selectedDate`, the
  day-availability fetch, and the 30s auto-refresh WITHOUT touching form
  fields or dirty state (mobile's intent-vs-observation separation). A
  structural reset effect clears it when the recurrence stops containing it.
  `onConflictChange` is nulled while browsing a non-start date so occurrence
  #7's conflicts can't flip first-occurrence gating.
- **Restore = mirror of skip**: `handleRestoreOccurrence` removes the date
  from `recurrence.exclusions` (pending or previously saved) through the same
  dirty path; the signature-keyed refetch re-checks it — no free pass by
  construction.
- **Honest empty states (post-implementation bug fix)**: the band NEVER
  claims a verdict without data — skeleton while `!hasData`, error box +
  Retry on fetch failure (`/rooms/recurring-conflicts` is `verifyToken`-gated,
  so an expired token 401s), and an explicit 'add times' instruction when the
  form has no time window at all (`inputsIncomplete`). The first cut rendered
  'All 0 occurrences are clear' in those states, which made a genuinely
  conflicted series read as conflict-free. Locked by SOB-15..18 and the
  integration-seam suite `RoomReservationFormBase.seriesIntegration.test.jsx`
  (real hook, real form base, network mocked: INT-1 blocked round-trip, INT-2
  401 → error not clear, INT-3 below).
- **Conflict window falls back to reservation times (bug found live)**:
  drafts may carry ONLY a reservation window (times optional for drafts), and
  `transformEventToFlatStructure` deliberately never surfaces reservation
  times as event times — so the hook's start/end were null and a
  reservation-times-only draft silently never got its series checked (the old
  panel had the same blind spot). The form base now windows the check on
  `startTime || reservationStartTime` (mirrors the backend's
  `effectiveStartTime` fallback). INT-3 reproduces with a REAL saved draft
  document (`src/__tests__/__fixtures__/draft-series-repro.json`, sanitized):
  reservation-only draft → conflict request fires windowed 11:30-12:30.
- **Open blocking event ALWAYS opens a new tab (revised 2026-08-05)**: a
  plain `target='_blank'` link to `/?eventId=<mongo _id>` (Calendar's
  deep-link effect matches `String(e._id)`). The form under review stays
  open; the visibilitychange re-check refreshes its conflicts on return.
  The in-modal navigation path (requestModalNavigation / return bar) is no
  longer driven from this surface — its wiring survives upstream but has no
  caller; candidate for cleanup. Locked by SVB-12.
- **Focus freshness**: a blocker edited in another tab or by another user is
  invisible to this form's signature-keyed conflict fetch, so on
  `visibilitychange → visible` the form base re-runs the conflicts check
  (series only) and the day-availability query. Locked by FRS-1/FRS-2.
- **lazyWithRetry loop guard hardened (found while chasing the above)**: the
  chunk-failure reload guard was a boolean CLEARED by any successful import,
  so 'most chunks load, one persistently fails' rebooted the page forever
  (~12s full-boot loop). Now a timestamp + 60s cooldown shared by
  `loadWithReload` and main.jsx's `vite:preloadError` handler; a persistent
  chunk failure surfaces one ErrorBoundary screen instead of looping. Locked
  by the rewritten `lazyWithRetry.test.js` (LOOP GUARD case).

**Tests:** new `useRecurringConflicts.test.jsx` (11),
`SeriesOccurrenceBand.test.jsx` (14), `SeriesVerdictBand.test.jsx` (11),
`SchedulingAssistant.seriesMode.test.jsx` (3);
`RoomReservationFormBase.test.jsx` 52 (was 47: +5 SVD/RST, RCP/SKP rewritten
to hook-input + series-prop threading); `RecurringConflictSummary.test.jsx`
(22) deleted with its component. Mutation-checked: disabling confirm arming
fails SVB-6/8, disabling restore's exclusion removal fails RST-1/2. Full
frontend suite identical to baseline (10 failures / 3 files, pre-existing);
lint counts on touched legacy files identical to HEAD.

**Outstanding:** task 6.3 — manual end-to-end on dev (live MSAL session):
band chip states vs a real conflicted series, chip click retargeting timeline
+ badges, conflicts focus + stepper, skip and restore round-trips (including
re-flag of a still-booked date and a saved-exclusion restore), readOnly
review modal, single events unchanged.

### Reassign modal + clergy grid row (implemented 2026-08-04)

Spec: `openspec/changes/reassign-modal-clergy-grid/`. Frontend-only UI rework;
no backend surface. Supersedes the presentation half of D8
(conflict-resolution-workflow) and D7's display cell:

- **ReassignOwnerControl opens a centered modal** (reuses the
  `category-modal-*` base like ClergySelectorModal, scoped
  `.reassign-owner-modal`) instead of expanding inline — the full-span
  `.reassign-owner-cell` is gone and the trigger link now lives inside the
  Requester info-cell. Internals unchanged (lazy user fetch, 5-match cap +
  overflow count, pending transfer, two-step confirm, one-line 409). ESC /
  overlay / X / Cancel all close and reset; `useScrollLock` while open.
- **Clergy is a full-width row in the Submitter Information grid**
  (`clergy-cell-submitter` kept) with Rabbis | Cantors sub-columns (em-dash
  per empty role — both headers always render). The Additional Information
  `⛪ Clergy` button/summary/Clear block is REMOVED (Clear All lives in the
  modal); the Event Details tab button is untouched.
- **Cell headers ARE the action (D4)**: 'Requester' and 'Clergy' render as
  `.info-cell-action-header` chips (label typography + 1px border + shared
  pencil glyph `InfoCellEditIcon`) opening the reassign/clergy modals;
  testids `reassign-owner-trigger` / `clergy-edit-submitter` live on the
  headers. Plain `.info-cell-label` fallback when non-approver / unsaved /
  `fieldsDisabled`. `ReassignOwnerControl` takes `triggerClassName` /
  `triggerContent` / `triggerAriaLabel`; its wrapper is `display: contents`.

**Tests:** `RoomReservationFormBase.test.jsx` 47/47 (was 45: -5 CL block,
+3 RA-14..16 modal presentation, +4 CG grid clergy; CLS series rewritten for
two columns; ClergySelectorModal probe mock gained an onSave clear hook).

**Outstanding:** manual dev check — Reassign modal round-trip, clergy Edit
from the grid, mobile single-column collapse of `.clergy-cell-columns`.

### Conflict resolution workflow (implemented 2026-08-04)

Spec: `openspec/changes/conflict-resolution-workflow/`. Builds on
`recurring-publish-conflict-blocking`: the block now has ways out instead of
being a dead end. 31/32 tasks complete; only 8.4 (manual e2e) outstanding.

**Shipped:**
- **Conflict records carry `requestedBy`** (name only, null for Outlook-synced
  events — D6): both push sites in `checkRecurringRoomConflicts()` plus
  `'roomReservationData.requestedBy.name'` added to `CONFLICT_PROJECTION` —
  without the projection line the field would silently always be null.
  `flattenRecurringConflicts()` carries it via spread. RCC-15..18.
- **`navigateToEvent` fallback (D4)**: primary stays
  `/api/room-reservations/:id`; a 404 falls back to `GET /api/events/:id`
  adapted by exported `adaptEventToReservationShape()` (mirrors the server
  transform at api-server.js ~17756; key-parity locked by NAV-4b). Mandatory
  because conflict targets include Outlook-synced events with no
  `roomReservationData`.
- **Single-entry `navigationOrigin` (D3)** + guard: `requestModalNavigation`
  parks a dirty-form navigation in `pendingModalNav` and resolves it through
  ReviewModal's previously-dead `showDiscardDialog` prop chain (it had no
  producer — the hook now owns it via `getReviewModalProps`). `returnToOrigin`
  cold-fetches the origin by id. Ordinary navigation CLEARS the origin slot
  (the disappearing return bar is the honest signal). Cleared on close.
- **Return bar** at the top of `ReviewModal` (`navigationOrigin` +
  `onReturnToOrigin` props): names the origin, the occurrence being resolved,
  and the outstanding count.
- **`RecurringConflictSummary` rebuilt as a resolution surface**: verdict
  header ('publishing is blocked', kept the 'N of M occurrences have room
  conflicts' fragment so the locked RCS-1/2/4 assertions still pass),
  occurrence strip (one square per occurrence; conflicted/clear/skipped;
  dense >60, compact summary >150 per D9), single-open drawer (D2) with
  per-blocker detail, requester name or 'Synced from Outlook' badge, 'Open
  blocking event' and 'Skip this date instead'. Fetch machinery untouched.
- **Skip is a form-state mutation (D1), no endpoint**: `handleSkipOccurrence`
  in `RoomReservationFormBase` appends to `recurrence.exclusions` via
  `setRecurrencePattern` + `setHasChanges` + `notifyDataChange`; the panel's
  signature-keyed fetch re-runs itself. `pendingSkippedDates` derives from
  current-vs-`initialData` exclusions (skipped dates leave `allOccurrences`
  after refetch, so the strip merges them back in as skipped-unsaved). Skip
  handler is null when `fieldsDisabled`; last remaining occurrence refused.
  Threading: EventReviewExperience builds `onOpenBlockingEvent` from
  `exp.requestModalNavigation` → RoomReservationReview → form base → panel.
- **Reassign picker rebuilt (D8)**: own full-span cell
  (`.reassign-owner-cell`, `grid-column: 1 / -1`) below the Requester cell;
  at most 5 matches with an honest overflow count ('N more — keep typing'),
  no max-height/overflow; selection collapses to the pending transfer
  (current → chosen + Change link); commit renders only after selection.
  Inset side-stripe removed. Two-step confirm + 409 behavior unchanged
  (RA-1..10 pass; RA-9/10 selectors tightened to the info-cell because the
  pending-transfer view also names the current owner).
- **Clergy cell in Submitter Information (D7)**: display-only, ALWAYS
  rendered (N/A distinguishes 'nobody assigned' from a load failure), reads
  the same `assignedRabbi`/`assignedCantor` arrays; deliberately not a third
  editable control.

**Tests:** backend `recurringConflict.test.js` 23/23 (+RCC-15..18),
`publishRecurringConflict.test.js` 5/5, `eventReassignment.test.js` 19/19.
Frontend: new `useReviewModal.navigation.test.jsx` (14), new
`ReviewModal.returnBar.test.jsx` (4), `RecurringConflictSummary.test.jsx` 22
(5 locked + 17 new), `RoomReservationFormBase.test.jsx` 45 (was 32: +4 skip,
+3 reassign presentation, +6 clergy cell). Full frontend suite identical to
baseline (10 failures / 3 files, all pre-existing). Mutation-checked: breaking
the 404 fallback fails NAV-2/NAV-4; removing the skip state write fails
SKP-1/SKP-2.

**Outstanding:** task 8.4 — manual end-to-end on dev (live MSAL session):
conflicted series strip marks the right weeks, drawer round-trip to a blocking
event and back via the return bar, skip persists through save and clears the
block, fallback verified against a real Outlook-synced blocker.

### Recurring publish conflict blocking (implemented 2026-08-04)

Spec: `openspec/changes/recurring-publish-conflict-blocking/`.

**The incident:** an approved recurring class series silently double-booked a
room. `PUT /api/admin/events/:id/publish` was deliberately non-blocking for
recurring events, the admin-save recurring gate checked phantom fields
(`totalHardConflicts` — never existed), `RecurringConflictSummary.jsx` was
dead code, and the `canForce` 409 path had no frontend consumer.

**Shipped:**
- **Recurring publish now blocks**: 409 (`conflictTier: 'hard'`, grouped
  `recurringConflicts` + flattened `hardConflicts` with `occurrenceDate`,
  `canForce: true`, `forceField: 'forcePublish'`, `_version`) when
  `conflictingOccurrences > 0` and not forcing. The check runs **even under
  `forcePublish`** (D3) so forced publishes still record
  `recurringConflictSnapshot` and the post-publish warning toasts fire.
  Fail-open on check errors stamps `recurringConflictCheckError: true` (D2) —
  queryable, not silent. Shared `flattenRecurringConflicts()` helper next to
  `checkRecurringRoomConflicts()`.
- **Admin-save gate fixed**: phantom fields → `conflictingOccurrences`, plus
  the same flattened parity arrays (`forceField: 'forceUpdate'`).
- **`RecurringConflictSummary` revived**: mounted in `RoomReservationFormBase`
  below the SchedulingAssistant when a recurrence with `pattern`+`range` and
  ≥1 room is active. **Passes `recurrence={recurrencePattern}` (the resolved
  variable, line ~262) — `formData.recurrence` is undefined and would
  silently no-op.** Component hardened first: fetch effect keyed on a
  serialized request signature (not callback identity — unstable parent refs
  refetched forever in readOnly mode), new `calendarOwner` prop in the
  request body (multi-mailbox scoping).
- **Force-publish affordance (revives the dead `canForce` path)**: after a
  hard 409 with `canForce`, `useReviewModal` arms `pendingForcePublish`
  (**admin-gated in the hook**; `ReviewModal` adds a defense-in-depth
  `isAdmin` gate on display). Button shows warning-color pulsing
  'Publish Anyway?'; the armed click IS the confirmation (skips the two-step
  cycle) and resends with `[forceField]: true`. Covers both the publish-step
  409 (`forcePublish`) and the save-step 409 (`forceUpdate`) — one mechanism,
  singles included. Hard-409 toasts now prefer the server `message`
  (occurrence counts). Disarmed on cancel-X and modal close.

**Tests:** `publishRecurringConflict.test.js` REWRITTEN (it previously
asserted the non-blocking bug as intended behavior) — PRC-1/2 assert the 409,
PRC-3 asserts forced-publish snapshot, PRC-4/5 unchanged regression guards.
`recurringConflict.test.js` +RCC-12 (approver force → 403), RCC-13 (admin
save into conflict → 409), RCC-14 (check failure → 200 + error marker,
induced via `Collection.prototype.find` spy per publishRollback precedent).
New frontend: `RecurringConflictSummary.test.jsx` (5),
`useReviewModal.forcePublish.test.jsx` (4), `ReviewModal.forcePublish.test.jsx`
(4), +4 mount tests in `RoomReservationFormBase.test.jsx` (32 total).
Baselines identical before/after: `recurringPublish.test.js` 18F/27P
(pre-existing red), publishRollback 8/8, frontend review-chain suites green.

**Outstanding:** task 4.2 — manual end-to-end on dev (live MSAL session):
panel visible in the review modal for a conflicted series, blocking toast,
'Publish Anyway?' round-trip as admin, SSE refresh after forced publish.

### Approver event reassignment + clergy on Additional Info (implemented 2026-08-04)

Spec: `openspec/changes/approver-event-reassignment/`.

**Shipped:**
- **`PUT /api/admin/events/:id/reassign`** (approver+) replaces
  `roomReservationData.requestedBy` — the canonical ownership field — with an
  identity block built from the target's `templeEvents__Users` record. The
  client sends only `{ targetUserId, expectedVersion }`; client-supplied
  identity is ignored, because `requestedBy.email` is the join key for every
  ownership query and a spoofed/typo'd address would orphan the event.
- **Email is lowercased on write.** `view=my-events` matches a lowercased token
  email, so a mixed-case write would hide the event from both users' lists.
- Guards per design D3: 403 non-approver, 404 unknown event/target, 400
  `EVENT_DELETED` / `ALREADY_OWNER` (case-insensitive) / `TARGET_USER_INCOMPLETE`
  / `INVALID_TARGET_EVENT_TYPE`, 409 `VERSION_CONFLICT` via `conditionalUpdate`.
- **Series masters cascade to non-deleted children** via a plain `updateMany` —
  NOT `cascadeStatusUpdate`, which hardcodes a `status` `$set` and a
  `statusHistory` `$push` that reassignment must not perform. The shared concept
  is the child-selection query, not the update.
- Audit entry `action: 'ownership-reassigned'` with `{from, to}` metadata;
  **new owner only** is emailed (new `ownership-reassigned` template + CTA_CONFIG
  entry — `TEMPLATE_IDS` additions are locked by EU-14); SSE `action: 'updated'`.
  Audit and email failures never fail the transfer.
- `PUT /api/admin/events/:id` never writes `requestedBy`, so a stale open form
  cannot revert a transfer — verified, no extra guard needed.
- **Frontend**: `src/components/shared/ReassignOwnerControl.jsx` in the Requester
  cell of Submitter Information. Lazy `GET /api/users` on first open (the call is
  approver-gated, so it must never fire for other sessions), current owner
  excluded, two-step in-button confirmation, warning-color confirm state.
  A 409 gets one line of text plus a parent reload — deliberately not the full
  `ConflictDialog`, same simplification as the mobile withdraw flow.
- **The gate reads `canApproveReservations` from `usePermissions()` directly**,
  not a threaded prop. It is a raw permission, not a derived flag; the form base
  already consumes the hook, and two sources for one gate can silently disagree.
  The `EventReviewExperience` contract governs *derived* flags, and there is no
  derivation here. What IS threaded is `eventVersion` + `onOwnershipChanged`
  (EventReviewExperience → RoomReservationReview → form base), because
  `RoomReservationReview` holds the authoritative post-save `_version` that
  `initialData` goes stale against.
- **Clergy on the Additional Information tab** — a second `⛪ Clergy` button and
  summary row, redundant by design, driving the same single-mounted
  `ClergySelectorModal` and the same `assignedRabbi`/`assignedCantor` state.
  Zero backend surface.

**Tests:** new `backend/__tests__/integration/eventReassignment.test.js` 19/19;
`RoomReservationFormBase.test.jsx` 28/28 (was 13) — RA-2 (permission gate) and
RA-7 (two-step confirm) were mutation-checked. Baseline measured by stash:
`integration/events/` is identical before and after (34 failed suites / 195
failed / 661 passed), so this change adds no regressions to the red main.

**Outstanding:** task 4.2 — manual end-to-end on dev. Needs a live MSAL session
and writes to real reservations: browser round-trip of the picker, the toast,
the SSE refresh of both users' My Reservations lists, and the real outbound
email. The list move, audit entry, and new-owner-only email are already covered
in-process by ER-3 / ER-16 / ER-17.

### Mobile agenda infinite scroll (implemented 2026-07-29)

Spec: `openspec/changes/mobile-agenda-infinite-scroll/`. Frontend-only; no
endpoint, schema, or query-key change. `POST /events/load` is called with the
same body shape, only narrower ranges.

**The bug:** `getWeekRange(selectedDate)` was doing two jobs — the fetch window
AND the rendered day list — so the agenda rendered exactly 14 days and
dead-ended. Scrolling could never extend it, because scroll observation writes
`visibleDate`, never `selectedDate`, by design.

**Shipped:**
- **`renderedRange` is now its own state in `MobileCalendarTab`**, and
  `datesToShow` derives from it. Scrolling within one viewport (600px) of either
  end appends/prepends two weeks, without bound. `getWeekRange` survives
  unchanged but is no longer the rendered list.
- **Three states, not two.** `selectedDate` (intent) / `visibleDate`
  (observation) / `renderedRange` (extent). Loop-freedom holds for the same
  structural reason as before: nothing that reads `renderedRange` causes a
  scroll, and the scroll-into-view effect is keyed on the selected day, which
  extension never writes.
- **Scroll extension commits on success; selection jumps render optimistically.**
  Deliberate asymmetry — a tap is stated intent, a scroll is not, so the list
  never shows days labelled 'No events' that it has no data for. Consequence:
  in the scroll path the rendered range never exceeds the loaded range, so
  there is no optimistic state to roll back.
- **`coverRange` fetches only uncovered spans.** Necessary (whole-window
  refetch is quadratic once the range grows) and it also removes the old
  whole-window refetch on every Sunday crossing. `ensureRange` returns
  `'covered' | 'suppressed' | 'error'` — suppressed retries on the next scroll,
  error gets an affordance.
- **Fixed a latent bug in passing:** `loadedRangeRef` was a single min/max
  interval, so a distant jump made it claim to cover the skipped gap and
  navigating back fetched nothing. Disjoint targets now re-anchor it. **Exact
  adjacency is not disjoint** — ranges are whole-day aligned, so a 1ms tolerance
  is required or two windows anchored two Sundays apart get discarded.
- **Extension follows direction of travel, not just proximity.** The list opens
  at scrollTop 0, so a proximity-only rule prefetches a fortnight of history on
  every session's first downward flick.
- **Scroll anchoring is node-based**, not `scrollHeight`-delta based, so the
  spinner and retry rows above the reader are corrected by the same rule.
  Requires `overflow-anchor: none` on `.mobile-agenda-list` — Chrome and Firefox
  would otherwise correct it too and double the shift; Safari would not at all.
- Pull-to-refresh now reloads the **entire** loaded range. Refreshing only the
  selected week would leave a grown list showing pre-refresh data.

**Tests:** mobile suites 254/254 (baseline was 231/231). 10 new in
`useMobileEvents.test.jsx` (19 total), 9 new in `MobileCalendarTab.test.jsx`
(28 total), 8 new in `MobileAgenda.test.jsx` (19 total). Full frontend suite
unchanged at 10 failures / 3 files. The prepend-anchoring test was
mutation-checked — disabling the correction fails it.

**Outstanding:** tasks 6.3 / 6.4 — on-device verification. Needs a real phone:
scroll a month each way and confirm no dead end, no viewport jump on backward
extension, that the week strip still tracks the top day throughout, and that
pull-to-refresh after extending updates every rendered day.

**Note:** one pre-existing lint warning in `MobileCalendarTab.test.jsx` (an
unused `no-await-in-loop` disable directive, present on HEAD before this change)
was left alone.

### Mobile 3-day elastic axis (implemented 2026-07-28)

Spec: `openspec/changes/mobile-three-day-elastic-axis/`. Frontend-only; no
endpoint, schema, query-key, or `useMobileEvents` change.

**Shipped:**
- **The 3-day grid's vertical axis is no longer uniform.** `buildTimeScale()` in
  `MobileThreeDay.jsx` sizes each hour from the max concurrency observed in that
  hour *per column, then maxed* — 52px at one booking (deliberately unchanged),
  74 at two, 96 at three or more, 20 for an isolated empty hour, and 26px total
  for a run of 2+ empty hours however long the run is. One scale for all three
  columns; a per-column scale would destroy the only reason the view exists.
- `minutesToY` / `yToMinutes` are pure, exported, and mutually inverse.
  **Run heights are distributed as integers** so every offset stays an integer —
  that is what keeps the pixel-exact test assertions honest instead of drifting.
- **Clusters of 3+ stop splitting the column and render as a stack**: one
  container over the cluster envelope, one full-width row each (dot, title,
  `time · room`), truncating to `+N more`. Two still split 50/50.
- **Tap-to-expand**, one `expandedRange` with two triggers (a stack, a gap band).
  Tagged with the window key rather than cleared by an effect, so "cleared when
  the date moves" is structural and cannot render stale for a frame.
- Scroll anchors to clock time across a scale change (layout effect, previous
  scale in a ref). Initial scroll opens at the first event hour, 9 AM fallback.
- Blocks and all-day chips: full 1px category border over a 12% wash, replacing
  the 3px rail over 8%. The time range returns on `tall` blocks only; the
  `aria-label` still carries the time in every tier.
- `MobileThreeDay` now takes `axisRef` (optional) — the second consumer of the
  swipe axis lock after `MobileAgenda`'s pull-to-refresh.

**Resolved a design/spec conflict:** design.md D5 says every hour in an expanded
range renders at `EXPANDED_HOUR_HEIGHT` (168px); the spec scenario says a tapped
empty band expands "to their uncollapsed height". The spec's reading is
implemented — populated hours get 168px, empty hours get 20px — because 168px
across a 6-hour midnight run is ~1000px of void. An **expanded stack is also
allowed to outgrow its envelope** (four events inside 45 minutes cannot fit four
rows in three quarters of an hour), which is the only place in the grid where a
container is not strictly its own time extent.

**Tests:** 39 new in `timeScale.test.js`, `MobileThreeDay.test.jsx` rewritten to
78 (was 32), 2 added to `MobileCalendarTab.test.jsx`. Mobile suites 231/231
(baseline was 144/144). Full frontend suite unchanged at 10 failures / 3 files.

**Outstanding:** tasks 8.3 / 8.4 — on-device verification. Needs a real phone:
confirm the 4-9 PM window is legible with a 3+ cluster present, that swiping does
not displace the viewport, that a diagonal drag neither expands nor opens, and
that the expand transition behaves under normal and reduced-motion settings.
`EXPANDED_HOUR_HEIGHT = 168` covers a four-way cluster; whether five-way clusters
actually occur is the open question that would make it dynamic.

### Mobile Requests tab (implemented 2026-07-28)

Spec: `openspec/changes/mobile-requests-tab/`. Frontend-only; no endpoint, schema, or
backend change.

**Shipped:**
- Mobile tab set is now **Calendar / Requests** — the `chat` placeholder is gone and
  `my-events` renders real content. `MobileBottomTabs` takes a `permissions` prop and
  filters on a per-tab `requires` key, so the future Approvals tab is one array entry.
- **The tab id stays `my-events`.** Only the label changed. `?view=my-events`,
  `keys.events.list({ view: 'my-events', includeDeleted: true })`, and the four
  MyReservations test suites are untouched. Locked by `MobileBottomTabs.test.jsx` MBT-3.
- `MobileRequests.jsx` — the **requester's** view (the naming in this repo is inverted:
  `ReservationRequests.jsx` is the approver's inbox). Shares MyReservations' exact cache
  key, which is only sound because both queryFns resolve to the same shape (a flat array
  from `transformEventsToFlatStructure`). **Do not return a wrapper object from either.**
- `MobileEventDetail` gained reservation context behind `showReservationContext`: a
  `statusHistory[]` timeline, the rejection reason, and its first mutating action —
  withdraw, gated to the viewer's own pending request. A `409 VERSION_CONFLICT` is
  reported as one sentence plus a refetch, deliberately not the desktop `ConflictDialog`.
- `eventTransformers.js` now preserves `statusHistory` (it was dropped; the backend's
  `EVENT_LIST_PROJECTION` has always returned it).

**Deferred / blocked:**
- **Approvals tab** — its own change. Should be *triage, not adjudication*: who asked,
  what, when, where, does it collide; approve and reject-with-reason; anything needing a
  change routes to desktop. Reuse `useCurrentUserGates`, not the desktop
  `EventReviewExperience` component.
- **Conflict context on a rejected request** (task 3.3) — **blocked, scenario removed
  from the spec.** Scheduling conflicts are transient: `checkRoomConflicts()` returns
  them in a `409 SchedulingConflict` body and nothing persists them on the event
  document (`conflictDetails` is an rsched staging field only). Prerequisite is
  persisting a conflict snapshot at rejection time.
- The mobile reservation request wizard is **cut**, not deferred.

**Outstanding:** tasks 6.1 / 6.2 — on-device verification of the list, filters, detail
sheet, and the withdraw round-trip, plus the cold-reload no-flash check. Needs a live
MSAL session and writes to a real reservation.

**Note for the calendarData-removal refactor:** the mobile detail sheet's 85dvh cap no
longer exists — the sheet ships as `position: fixed; inset: 0`. The
`mobile-event-detail` spec still says 85dvh and should be corrected when next revised.

### Sync Health Hardening + Reconcile v1 (implemented 2026-07-27)

Spec: `openspec/changes/sync-health-hardening-and-reconcile/`. Architecture:
`docs/superpowers/specs/2026-07-27-sync-health-reconciliation-design.md`.

**Report hardening (all shipped):**
- Deleted-docs query now `$or`s `graphData.id` with `graphEventId`, so deleted
  exception/addition CHILD documents (created with `graphData: null`) finally reach the
  failed-deletion check. This was the `additions` bug class the report was built to catch.
- `runSyncHealthCheck` scopes by `calendarOwner` and projects (`REPORT_PROJECTION`) in the
  database. Case-insensitivity via `$in` over `distinct('calendarOwner')` — **not** `$regex`,
  which Cosmos handles unreliably. Locked by a parity test that runs the same fixtures with
  and without the projection and asserts identical findings.
- `outlookOnly` in `syncHealthGrouping.reconcile()` now comes from `untracked.length`, not
  `outlookFound - matched`. `reconcile()` takes the whole calendar entry, not its `counts`.
- `buildAppSide` returns `nullDateMongoIds`; a null local date logs at error level and sets
  `calendar.degraded` (a banner, deliberately NOT `error`, which suppresses all findings).

**Graph retry/breaker (new `backend/utils/graphRetry.js`, `backend/utils/graphError.js`):**
- Every inlined Graph retry predicate was dead: production throws `err.status`, all five
  copies read `err.statusCode`. Consolidated into `withGraphRetry` / `isRetryableGraphError`.
- undici's `fetch` puts the OS error code on `err.cause.code`, never `err.code` (verified
  against Node 22 — table in graphRetry.js). `AbortSignal.timeout` yields a DOMException
  whose `code` is the NUMBER 23, hence the string-check before comparison.
- Graph gets its **own** circuit breaker. `retryWithBackoff` accepts `options.breaker`
  (defaults to the shared Cosmos one) — a Graph 429 burst can no longer halt Cosmos retries.
- `graphApiMock` builds all HTTP failures with the same exported `buildGraphError` the
  service throws with. Hand-rolled mock errors are what hid the predicate bug; use
  `graphApiMock.graphError(status, msg)` / `graphNetworkError(code)`.

**Reconcile v1 (new):** `POST /api/admin/sync-health/reconcile/plan` and `/apply`,
admin-only. Pure decisions in `backend/utils/syncReconcilePlan.js`, orchestration in
`backend/services/syncReconcileService.js` (injected deps), create-then-link mechanics
shared with the republish endpoint via `backend/services/republishCore.js`.
- Stateless fingerprint handshake: `apply` re-observes and re-plans from scratch, then
  deep-compares against `expectedState`; any drift → `409 STALE_FINDING` with **zero**
  writes. 10-minute soft `expiresAt`.
- Actions: `shouldNotBeInOutlook` → `deleteOutlook` (server-enforced `confirmIrreversible`,
  series-master guard, attendee warning, pre-delete snapshot in audit, 404 → `alreadyGone`);
  `untethered` → `archive` / `linkExisting` / `publish`. Publish refuses `seriesMaster`.
- Duplicate guard: subject+date match against untracked entries on that day (`[Hold]` prefix
  normalized away); candidates flip the recommendation to link, and publish needs
  `allowDuplicate` or gets `422 DUPLICATE_CANDIDATE`.
- Audit entry per apply (`source: 'SyncHealthReconcile'`); `statusHistory` + SSE on Mongo writes.
- UI: admin-only "Fix…" panel in `SyncHealthReport.jsx` rendering the server plan **verbatim**
  (never a client paraphrase), in-button confirmation, scoped re-run after apply/stale.

**Deferred:** v1.5 seriesMaster publish (needs `syncRecurrenceExclusionsToGraph` +
`syncExceptionDocumentsToGraph` extracted to `graphSeriesSync.js`, else publishing a master
immediately manufactures new `shouldNotBeInOutlook` findings for every excluded date).
v2 `missingFromOutlook` actions and bulk per-category reconcile. Untracked adoption is an
import feature, out of scope. Bulk cleanup of the 46 legacy untethered docs stays
script-only, blocked on the archive-vs-publish product decision.

**Outstanding:** task 8.2 — manual verification against the sandbox mailbox (run the report,
confirm the previously invisible deleted-child findings appear, exercise one archive and one
link end-to-end). Not done: it needs live Graph credentials and writes to a real mailbox.

**calendarData-removal refactor checklist — add these call sites:**
- `syncHealthService.localDateOf` (reads `calendarData.startDateTime` first)
- `syncHealthService.titleOf` (`calendarData.eventTitle` fallback)
- `syncHealthService.buildAppSide` master expansion (`calendarData.startDateTime/endDateTime`)
- `syncHealthService.REPORT_PROJECTION` (three `calendarData.*` entries)
- `syncReconcileService.observe` (`calendarData.startTime/endTime` for subject derivation)
- `graphEventBuilder.buildGraphEventDataFromRecord` (whole payload reads `event.calendarData`)
- `conflictReportService.bufferMinutes` (the fallback chain reads
  `calendarData.reservationStartMinutes` / `reservationEndMinutes` /
  `setupTimeMinutes` / `teardownTimeMinutes` — **`??` not `||`**, so a
  top-level `0` must keep shadowing the nested fallback exactly as it does now)
- `conflictReportService.normalizeSide` / `roomIdsOf` (`calendarData.locations`,
  `locationDisplayNames`, `categories`, `eventTitle`, `startDateTime`,
  `endDateTime`)
- `conflictReportService.REPORT_PROJECTION` (eleven `calendarData.*` entries)
- `conflictReportService.runConflictReport` read 1 (the window `$or` matches on
  `calendarData.startDateTime` / `calendarData.endDateTime`)
The null-date guard above exists specifically so this refactor fails loudly here.

### Loading-Experience Standardization (Phases 1-2 done 2026-05-30; Phase 3 deferred)

**Goal**: eliminate the "no data on reload, which is incorrect" flashes and standardize a smooth, consistent loading experience across all data views.

**Done + committed:**
- **Phase 1 — Calendar cold-reload false-empty** (commit `5cbba26`): `shouldVerifyZeroResult()` in `calendarLoadDecision.js` verifies the first cold (non-silent, non-retry) 0-result per calendar selection with one retry before showing "No events to display", holding the loading overlay up via `verifyPendingRef`. Fixes a transient cold Cosmos query / replica lag / 429 blanking the home grid.
- **Phase 2 — shared loading primitives + EventSearch fix**: `deriveListLoadingState()` in `src/utils/listLoadingState.js` is the single tested definition of `isFirstLoad`/`isSilentRefreshing`; MyReservations, EventManagement, ReservationRequests migrated to it (behavior-preserving); EventSearch's `isLoading` anti-pattern fixed (gates on `isSearching || isFetching`). See the updated "React Query loading primitives" section above.

**Deferred (Phase 3):** warm reloads via React Query `sessionStorage` persistence (stale-while-revalidate) — spec at `openspec/changes/warm-reload-query-persistence/`. Prerequisite: commit the in-progress `eventTransformers` `calendarData`-removal refactor first. The `<DataBoundary>` visual component was evaluated and **dropped** as over-engineering (list views already share `LoadingSpinner` + `EmptyStateRefreshButton`).

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
- **Exception-as-Document architecture**: Recurring event overrides stored as separate `exception`/`addition` documents with `resolveSeriesMaster`, `createExceptionDocument`, `updateExceptionDocument` in `exceptionDocumentService.js`; DELETE handler cascades; `recurrence.exclusions` maintained on occurrence delete. **Children are the unit of rendering but not the unit of approval** — they are hidden from the Approval Queue and My Reservations (`eventType: { $nin: ['exception', 'addition'] }` filter on `/api/events/list` and counts for both views), and `PUT /api/admin/events/:id/publish` / `:id/reject` return 400 `INVALID_TARGET_EVENT_TYPE` when targeted at a child. The master's publish/reject cascades status via `cascadeStatusUpdate` to every non-deleted child. **Server enrichment**: `enrichSeriesMastersWithOverrides` (shared helper) spreads child override data onto each master's `occurrenceOverrides` array for both `/api/events/load` and `/api/events/list`. The secondary `seriesMasterEventId` query is cross-partition and has been observed to return silently-empty results on the first call in Cosmos DB (index metadata warming); the helper retries the query once when masters exist but children come back empty — **do not remove this retry without a repro against Cosmos**.
- **Recurring event date semantics**: Series master read-only date inputs display `recurrence.range` (series span) not first-occurrence date; clicking a single occurrence shows the clicked day's date (fixed `getEventField` calendarData leak for non-overridden virtual occurrences); occurrence recurrence tab renders read-only compact summary; `formatRecurrenceSummaryCompact` utility alongside existing `formatRecurrenceSummary`; occurrence dates immutable via structural `DATE_IMMUTABLE` guard inside `createExceptionDocument`/`updateExceptionDocument`; `getOccurrenceDateKey` normalizes extraction across 4 `useReviewModal` sites
- **Calendar markers (Holidays & Office Closures)**: day-level annotations in a dedicated `templeEvents__CalendarMarkers` collection — fully isolated from events (no leak into queues/counts/search/conflicts/export). Admin- or Events-department CRUD (gate `requireMarkerManager` = `canManageCalendarMarkers`: admin OR `department === 'events'`, role-independent; `/api/calendar-markers` GET open to all, writes gated, no OCC by design — Decision 9), date-only `YYYY-MM-DD` storage with `{startDate,endDate,active}` index + 5-min cache. Renders as a transparent-wash ribbon (gold holiday / red closed) across Month/Week/Day via shared `CalendarMarkerRibbon` + `markersByDate` map; management screen at `/admin/calendar-markers` (route-guarded by `RequireCalendarMarkers`; non-admin Events-dept members get a top-level nav link, admins keep it in the Admin dropdown); soft non-blocking booking advisory (`warnOnReservation`) via `ReservationMarkerAdvisory`. `pushToOutlook` materializes an all-day Graph event (`buildGraphMarkerEventData`, exclusive UTC end, `showAs` oof/free) via the create/patch/delete state matrix, failure-isolated

---

## Context Preservation Protocol

**IMPORTANT**: Before clearing context or ending a session with pending work:

1. **Review recent changes** - Check git status and recent modifications
2. **Ask user for confirmation** - Confirm current state and next steps
3. **Update this section** - Update the "Current In-Progress Work" section above with latest status
4. **Reference plan file** - Point to the detailed plan file location

This ensures continuity across sessions and prevents loss of planned work.