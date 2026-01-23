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
- **graphService.js**: Microsoft Graph API interactions for calendar data
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

## Event/Reservation Data Flow (CRITICAL)

When adding new fields to events or reservations, they must be added to ALL layers in the data transformation chain. Missing a layer causes fields to not appear in the form.

### Calendar Event Click → Edit Form Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. CALENDAR CLICK                                                           │
│    Calendar.jsx: handleEventClick(event)                                    │
│    └─> reviewModal.openModal(event)                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. REVIEW MODAL HOOK                                                        │
│    src/hooks/useReviewModal.jsx: openModal(event)                           │
│    └─> setCurrentItem(event)  // Raw event data, no transformation          │
│    └─> setEditableData(event)                                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. REVIEW COMPONENT ⚠️ KEY TRANSFORMATION POINT                             │
│    src/components/RoomReservationReview.jsx                                 │
│    └─> initialData = useMemo(() => { ... }, [reservation])                  │
│    └─> MUST map ALL fields from reservation to initialData                  │
│    └─> Line ~148-195: Field mapping happens here                            │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. FORM BASE COMPONENT                                                      │
│    src/components/RoomReservationFormBase.jsx                               │
│    └─> Receives initialData prop                                            │
│    └─> useState(formData) initialized with {...defaults, ...initialData}    │
│    └─> Form renders with formData                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Reservation Requests Admin → Edit Form Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. API FETCH                                                                │
│    Backend: GET /api/events?status=room-reservation-request                 │
│    └─> Returns full MongoDB documents (all fields)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. LIST TRANSFORMATION ⚠️ KEY TRANSFORMATION POINT                          │
│    src/components/ReservationRequests.jsx                                   │
│    └─> transformedNewEvents = events.map(event => { ... })                  │
│    └─> Line ~148-195: MUST include all fields needed by form                │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. UNIFIED EVENT FORM ⚠️ KEY TRANSFORMATION POINT                           │
│    src/components/UnifiedEventForm.jsx                                      │
│    └─> setInitialData({ ... }) for reservation mode (line ~255-295)         │
│    └─> setInitialData({ ... }) for event mode (line ~307-340)               │
│    └─> MUST map ALL fields for both modes                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. FORM BASE COMPONENT                                                      │
│    src/components/RoomReservationFormBase.jsx                               │
│    └─> Same as above                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Adding New Fields Checklist

When adding a new field to events/reservations, update ALL of these files:

1. **Backend** (`backend/api-server.js`):
   - Add to create endpoint request body destructuring
   - Add to update endpoint request body destructuring
   - Add to MongoDB insert/update operations
   - Add to conflict detection if relevant

2. **RoomReservationReview.jsx** (~line 148-195):
   - Add to `initialData = useMemo(...)` mapping
   - Example: `newField: reservation.newField || defaultValue`

3. **ReservationRequests.jsx** (~line 148-195):
   - Add to `transformedNewEvents` mapping
   - Example: `newField: event.newField || defaultValue`

4. **UnifiedEventForm.jsx**:
   - Add to reservation mode `setInitialData` (~line 255-295)
   - Add to event mode `setInitialData` (~line 307-340)
   - Example: `newField: reservation.newField || defaultValue`

5. **RoomReservationFormBase.jsx**:
   - Add to initial `formData` state (~line 95-125)
   - Add to sync useEffect if needed (~line 208-236)
   - Add UI elements to render the field

### Common Pitfalls

- **Field exists in MongoDB but not in form**: Missing from transformation layer
- **Field saves but doesn't load**: Missing from `initialData` mapping
- **Field works in one modal but not another**: Different components use different transformation paths
- **ObjectId comparison fails**: Use `String(id)` for comparisons

## Important Notes

- The app functions as both a standalone web app and Microsoft Teams/Outlook add-in
- User preferences are stored in MongoDB (not Office.js RoamingSettings)
- Event sync creates internal copies of Graph events for enrichment without modifying originals
- Multiple calendar support with real-time synchronization
- Export features include PDF generation and public API access
- All times are handled with proper timezone conversion
- Demo mode available for testing without live data