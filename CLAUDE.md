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
  - `templeEvents__RoomReservations`: Room reservation requests
  - `templeEvents__ReservationTokens`: Guest access tokens for public forms
  - `templeEvents__EventAttachments`: File attachments for events (GridFS)
  - `templeEvents__EventAuditHistory`: Event change tracking and audit logs
  - **DEPRECATED**: `templeEvents__Rooms` (migrated to templeEvents__Locations)
  - **DEPRECATED**: `templeEvents__InternalEvents` (consolidated into templeEvents__Events)
  - **DEPRECATED**: `templeEvents__EventCache` (consolidated into templeEvents__Events)
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
Events combine Microsoft Graph data with internal enrichments:
- **External (Graph)**: subject, start/end times, location, organizer, categories
- **Internal Enrichments**: 
  - MEC categories with subcategories
  - Setup/teardown times
  - Staff assignments
  - Cost tracking
  - Custom schema extensions
  - Room associations
  - Registration requirements

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

## Recent Updates

### Graph API Authentication Migration (Completed)
- **Architecture Change**: Migrated from user-delegated `graphToken` to app-only authentication
- Backend now uses `graphApiService.js` for all Graph API operations
- `PUT /api/admin/events/:id/approve` updated to use `graphApiService.createCalendarEvent()`
- No longer requires user's Graph token - uses `calendarOwner` email instead
- Frontend still sends `graphToken` for backward compatibility but backend ignores it
- All new Graph API integrations should use `graphApiService` with app-only auth

### Room Reservation System (Completed)
- Implemented complete room reservation workflow
- Added icon-based feature selection UI
- Created admin management interfaces
- Fixed MongoDB indexing issues with temporary workaround

### Performance & Stability Improvements (Completed)
- Fixed calendar loading race conditions
- Reduced console logging by 67% (from ~200 to ~65 debug statements)
- Consolidated event loading logic
- Fixed duplicate API calls in search functionality

### UI/UX Enhancements (Completed)
- Fixed CSS conflicts between components
- Improved calendar badge display with meaningful identifiers
- Enhanced event search with better filtering
- Added visual room feature selection

### Database Consolidation (Completed)
- **Rooms & Locations Consolidation**: Unified `templeEvents__Rooms` and `templeEvents__Locations` into single collection
- Room data migrated to `templeEvents__Locations` with `isReservable: true` flag
- `/api/rooms` endpoint now queries locations collection (filtered by `isReservable`)
- Admin endpoints (POST/PUT/DELETE `/api/admin/rooms`) now use locations collection
- LocationContext simplified to single data source with backward compatibility
- Hardcoded room data replaced with database queries
- Migration script: `backend/migrate-rooms-to-locations.js`

## Known Issues & Pending Tasks

1. **Graph API Delta Sync**: Query parameter issues need resolution
2. **Rate Limiting**: DDOS protection for reservation endpoints pending
3. **Token Generation UI**: Staff interface for creating guest access tokens

## Development Best Practices

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