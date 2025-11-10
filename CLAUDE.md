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
  - `templeEvents__InternalEvents`: Event data with internal enrichments
  - `templeEvents__Locations`: Location and room data (replaces templeEvents__Rooms)
    - Locations with `isReservable: true` are available for room reservations
    - Also stores event locations from Graph API with alias management
  - `templeEvents__Rooms`: **DEPRECATED** - Room data migrated to templeEvents__Locations
  - `templeEvents__RoomReservations`: Room reservation requests
  - `templeEvents__ReservationTokens`: Guest access tokens for public forms
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

## Important Notes

- The app functions as both a standalone web app and Microsoft Teams/Outlook add-in
- User preferences are stored in MongoDB (not Office.js RoamingSettings)
- Event sync creates internal copies of Graph events for enrichment without modifying originals
- Multiple calendar support with real-time synchronization
- Export features include PDF generation and public API access
- All times are handled with proper timezone conversion
- Demo mode available for testing without live data