# Emanuel Resource Calendar - Current Implementation Summary

## Overview

The Emanuel Resource Calendar is a Temple Events Calendar application with Microsoft 365 integration. It provides calendar management, room reservation workflows, and event enrichment capabilities for Temple Emanuel.

---

## Architecture

### Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | React SPA with Vite |
| UI Framework | Microsoft Fluent UI |
| Authentication | Azure AD / MSAL |
| Data Fetching | TanStack Query (React Query) |
| Backend | Node.js / Express |
| Database | MongoDB (Azure Cosmos DB) |
| External APIs | Microsoft Graph API |

### Application Structure

```
/
├── src/                          # Frontend React application
│   ├── components/               # React components
│   ├── services/                 # API and data services
│   ├── context/                  # React Context providers
│   ├── hooks/                    # Custom React hooks
│   │   ├── useLocationsQuery.js  # TanStack Query hook for locations
│   │   ├── useCategoriesQuery.js # TanStack Query hooks for categories
│   │   └── ...
│   ├── utils/                    # Utility functions
│   │   ├── logger.js             # Environment-aware logging utility
│   │   └── ...
│   └── config/                   # Configuration files
│       ├── queryClient.js        # TanStack Query client with localStorage persistence
│       └── ...
├── backend/                      # Backend API server
│   ├── api-server.js             # Main Express server
│   ├── utils/                    # Backend utilities
│   │   ├── logger.js             # Environment-aware logging utility
│   │   └── ...
│   └── csv-imports/              # CSV import scripts
├── public/                       # Static assets
└── certs/                        # SSL certificates for development
```

---

## Authentication Flow

### Dual Token System

1. **Graph Token**: For Microsoft Graph API operations (calendar, user data)
   - Scopes: `User.Read`, `Calendars.Read`, `Calendars.ReadWrite`, `Calendars.Read.Shared`, `Calendars.ReadWrite.Shared`

2. **API Token**: For custom backend API authentication
   - Scope: `api://c2187009-796d-4fea-b58c-f83f7a89589e/access_as_user`

### Azure AD Configuration

| Setting | Value |
|---------|-------|
| App ID | `c2187009-796d-4fea-b58c-f83f7a89589e` |
| Tenant ID | `fcc71126-2b16-4653-b639-0f1ef8332302` |
| Authority | `https://login.microsoftonline.com/{tenant}` |

---

## Database Collections

### Primary Collections

| Collection | Purpose |
|------------|---------|
| `templeEvents__Users` | User profiles, preferences, and permissions |
| `templeEvents__Events` | Unified event storage (Graph data + internal enrichments) |
| `templeEvents__Locations` | Location/room data with reservable flag |
| `templeEvents__RoomReservations` | Room reservation requests (legacy) |
| `templeEvents__CalendarDeltas` | Delta tokens for efficient sync |
| `templeEvents__ReservationTokens` | Guest access tokens for public forms |
| `templeEvents__EventAttachments` | File attachments (GridFS) |
| `templeEvents__EventAuditHistory` | Event change tracking and audit logs |

### Deprecated Collections

| Collection | Migrated To |
|------------|-------------|
| `templeEvents__Rooms` | `templeEvents__Locations` (with `isReservable: true`) |
| `templeEvents__InternalEvents` | `templeEvents__Events` |
| `templeEvents__EventCache` | `templeEvents__Events` |

---

## Room Reservation System

### Reservation Workflow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  User       │     │  Pending    │     │  Approved   │
│  Submits    │────▶│  Review     │────▶│  (Calendar  │
│  Request    │     │  by Admin   │     │   Created)  │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐     ┌─────────────┐
                    │  Rejected   │────▶│  Resubmit   │
                    │  (Reason)   │     │  (Revised)  │
                    └─────────────┘     └─────────────┘
```

### Status Values

| Status | Description |
|--------|-------------|
| `pending` | Awaiting admin review |
| `approved` | Approved, calendar event may be created |
| `rejected` | Rejected with reason, can resubmit |
| `active` | Confirmed/published (regular events) |
| `inactive` | Archived/cancelled |

### Reservation Data Structure

```javascript
{
  // Requester Information
  requesterId: String,        // Azure AD user ID
  requesterName: String,
  requesterEmail: String,
  department: String,
  phone: String,

  // Delegation (on behalf of)
  isOnBehalfOf: Boolean,
  contactName: String,
  contactEmail: String,

  // Event Details
  eventTitle: String,
  eventDescription: String,
  startDateTime: Date,
  endDateTime: Date,
  attendeeCount: Number,

  // Room Selection
  requestedRooms: [ObjectId],
  requiredFeatures: [String],
  specialRequirements: String,

  // Timing
  setupTimeMinutes: Number,
  teardownTimeMinutes: Number,
  effectiveStart: Date,       // Includes setup buffer
  effectiveEnd: Date,         // Includes teardown buffer

  // Status & Tracking
  status: String,
  currentRevision: Number,
  communicationHistory: [{ timestamp, type, author, message }],

  // Audit
  submittedAt: Date,
  lastModified: Date,
  lastModifiedBy: String
}
```

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/room-reservations` | Submit authenticated reservation |
| POST | `/api/room-reservations/public/:token` | Submit guest reservation |
| GET | `/api/room-reservations` | List user's reservations |
| PUT | `/api/room-reservations/:id/resubmit` | Resubmit rejected reservation |
| PUT | `/api/admin/room-reservations/:id/approve` | Approve reservation |
| PUT | `/api/admin/room-reservations/:id/reject` | Reject reservation |
| POST | `/api/admin/room-reservations/:id/start-review` | Acquire soft hold |
| POST | `/api/admin/room-reservations/:id/release-review` | Release hold |
| POST | `/api/admin/room-reservations/:id/check-conflicts` | Check for conflicts |

---

## Event System

### Unified Event Model

Events combine Microsoft Graph data with internal enrichments:

```javascript
{
  // Identifiers
  eventId: String,            // Unique internal ID
  graphData: {
    id: String,               // Graph event ID
    subject: String,
    start: { dateTime, timeZone },
    end: { dateTime, timeZone },
    location: Object,
    organizer: { emailAddress: { address, name } },
    attendees: [{ emailAddress, status }],
    categories: [String],
    bodyPreview: String
  },

  // Internal Enrichments
  mecCategories: [{ category, subcategory }],
  setupTime: Number,
  teardownTime: Number,
  staffAssignments: [String],
  costTracking: Object,
  registrationRequired: Boolean,

  // Room Reservation Data (if applicable)
  roomReservationData: {
    requestedBy: { userId, email, name },
    requestedRooms: [ObjectId],
    status: String,
    reviewedBy: { userId, name, reviewedAt },
    reviewNotes: String
  },

  // Metadata
  source: String,             // 'graph-sync', 'unified-form', 'csv-import'
  calendarId: String,
  createdByEmail: String,
  createdAt: Date,
  lastModified: Date
}
```

### Calendar Sync

- **Delta Sync**: Efficient incremental sync using Graph delta tokens
- **Multi-Calendar Support**: Sync from multiple calendars including shared mailboxes
- **Cache Strategy**: Hybrid approach with unified sync and cache fallback

---

## Location Management

### Location Data Structure

```javascript
{
  _id: ObjectId,
  name: String,               // Display name
  code: String,               // Short code
  displayName: String,        // Full display name

  // Reservability
  isReservable: Boolean,      // Can be reserved for events
  capacity: Number,           // Maximum attendees

  // Features (for reservable rooms)
  features: [String],         // e.g., ['kitchen', 'av_equipment', 'projector']

  // Hierarchy
  parentLocation: ObjectId,   // Parent location reference

  // Graph API Data
  graphLocationId: String,    // If synced from Graph
  aliases: [String],          // Alternative names

  // Metadata
  isActive: Boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/locations` | List all locations |
| GET | `/api/rooms` | List reservable locations |
| POST | `/api/admin/rooms` | Create reservable room |
| PUT | `/api/admin/rooms/:id` | Update room |
| DELETE | `/api/admin/rooms/:id` | Delete room |

---

## User Management

### User Data Structure

```javascript
{
  _id: ObjectId,
  userId: String,             // Azure AD Object ID
  email: String,
  name: String,

  // Permissions
  isAdmin: Boolean,
  permissions: {
    canViewAllReservations: Boolean,
    canManageCategories: Boolean,
    canManageLocations: Boolean
  },

  // Preferences
  preferences: {
    defaultView: String,      // 'week', 'month', 'day'
    defaultGroupBy: String,
    preferredTimeZone: String,
    startOfWeek: String,
    selectedLocations: [String],
    selectedCategories: [String]
  },

  // Timestamps
  createdAt: Date,
  updatedAt: Date,
  lastLogin: Date
}
```

### Admin Detection

```javascript
const isAdmin = user?.isAdmin ||
                userEmail.includes('admin') ||
                userEmail.endsWith('@emanuelnyc.org');
```

---

## Guest Access System

### Token-Based Access

External users can submit reservations via token-based URLs:

```javascript
{
  token: String,              // Hashed unique token
  createdBy: String,          // Staff email who created
  sponsoredBy: String,        // Sponsor email
  expiresAt: Date,            // TTL for automatic cleanup
  currentUses: Number,
  metadata: {
    eventName: String,
    description: String
  }
}
```

### Public Endpoint

```
POST /api/room-reservations/public/:token
```

---

## Key Frontend Components

### Calendar Views

| Component | Purpose |
|-----------|---------|
| `MonthView.jsx` | Monthly calendar grid |
| `WeekView.jsx` | Weekly calendar view |
| `DayView.jsx` | Daily schedule view |
| `DayTimelineModal.jsx` | Timeline view for a single day |
| `WeekTimelineModal.jsx` | Timeline view for a week |
| `RoomTimeline.jsx` | Room availability timeline |

### Reservation Components

| Component | Purpose |
|-----------|---------|
| `RoomReservationForm.jsx` | New reservation submission |
| `RoomReservationFormBase.jsx` | Reusable form fields |
| `ReservationRequests.jsx` | Admin reservation management |
| `ResubmissionForm.jsx` | Resubmit rejected reservations |
| `RoomReservationReview.jsx` | Admin review interface |
| `SchedulingAssistant.jsx` | Room availability helper |

### Event Management

| Component | Purpose |
|-----------|---------|
| `EventForm.jsx` | Event creation/editing |
| `UnifiedEventForm.jsx` | Unified event form with enrichments |
| `EventDetailsModal.jsx` | Event detail popup |
| `EventSearch.jsx` | Advanced event search |
| `UnifiedEventsAdmin.jsx` | Admin event management |

### Admin Components

| Component | Purpose |
|-----------|---------|
| `CategoryManagement.jsx` | Manage event categories |
| `CalendarConfigAdmin.jsx` | Calendar configuration |
| `EventSyncAdmin.jsx` | Sync management |
| `UserAdmin.jsx` | User management |
| `FeatureManagement.jsx` | Feature flags |
| `LocationReview.jsx` | Location management |

---

## Services

### Frontend Services

| Service | Purpose |
|---------|---------|
| `calendarDataService.js` | Event loading with caching |
| `unifiedEventService.js` | Delta sync and unified operations |
| `graphService.js` | Microsoft Graph API wrapper |
| `userPreferencesService.js` | User preference management |
| `featureConfigService.js` | Feature flag management |

### Key Service Functions

**calendarDataService.js:**
- `loadEvents()` - Load events with caching
- `createEvent()` / `updateEvent()` / `deleteEvent()`
- `getEventById()`

**unifiedEventService.js:**
- `setGraphToken()` - Set Graph token for API calls
- `loadEvents()` - Delta sync with multiple calendars
- `syncCalendar()` - Trigger manual sync

**graphService.js:**
- `getGraphClient()` - Initialize Graph SDK
- `getUserDetails()` - Get current user
- `getCalendars()` - List calendars
- `getCalendarEvents()` - Query events
- `createCalendarEvent()` - Create event in Graph
- `createLinkedEvents()` - Setup/teardown linked events
- `createCalendarWebhook()` - Subscribe to changes

---

## Context Providers & Data Fetching

### React Context Providers

| Context | Purpose |
|---------|---------|
| `UserPreferencesContext` | User preferences state |
| `TimezoneContext` | Timezone handling |
| `LocationContext` | Location/room data (uses TanStack Query internally) |
| `RoleSimulationContext` | Admin role simulation for testing |

### TanStack Query (React Query)

TanStack Query provides automatic caching and background data fetching for categories and locations.

**Query Client Configuration** (`src/config/queryClient.js`):
- 5-minute stale time (data considered fresh)
- 30-minute garbage collection time
- Automatic refetch on window focus
- localStorage persistence (24-hour max age)

**Query Hooks**:

| Hook | Query Key | Purpose |
|------|-----------|---------|
| `useLocationsQuery` | `['locations']` | Fetch locations from `/api/locations` |
| `useBaseCategoriesQuery` | `['baseCategories']` | Fetch categories from `/api/categories` |
| `useOutlookCategoriesQuery` | `['outlookCategories']` | Fetch Outlook categories from Graph API |

**Benefits**:
- Cached data shown instantly on return visits
- Background refetch updates data without loading state
- Request deduplication (multiple components share one API call)
- Automatic retries on failure
- React Query DevTools for debugging (development only)

---

## API Structure

### Protected Endpoints
- Require JWT bearer token in `Authorization` header
- Token validated against Azure AD JWKS

### Public Endpoints
- Located at `/api/public/*`
- Token-based access for external users

### Admin Endpoints
- Located at `/api/admin/*`
- Require admin permissions

### Graph Token Passthrough
- Frontend passes Graph token via `X-Graph-Token` header
- Backend uses for Graph API operations on user's behalf

---

## Key Features

### Calendar Management
- Multi-calendar support with shared mailboxes
- Calendar badges showing source
- Smart event loading with delta sync
- Conflict detection for overlapping events

### Room Reservation
- Public guest access via tokens
- Feature-based room filtering
- Capacity management
- Real-time availability checking
- Admin approval workflow

### Event Enrichments
- Custom MEC categories with subcategories
- Setup/teardown time buffers
- Staff assignments
- Cost tracking
- Registration management

### Export & Integration
- PDF calendar export
- CSV import/export
- Public API access
- Microsoft Teams/Outlook add-in support

---

## Environment Configuration

### Frontend (Vite)

```bash
VITE_DEBUG=false
VITE_API_BASE_URL=http://localhost:3001/api
```

### Backend

```bash
NODE_ENV=development
DEBUG=false
MONGODB_CONNECTION_STRING=<connection-string>
MONGODB_DATABASE_NAME=emanuelnyc
CALENDAR_MODE=sandbox
```

---

## Development Commands

### Frontend
```bash
npm run dev        # Start Vite dev server (https://localhost:5173)
npm run build      # Production build
npm run lint       # ESLint
npm run preview    # Preview production build
```

### Backend
```bash
cd backend
npm run dev        # Start with nodemon (auto-restart)
npm start          # Production server
```

### Certificates
```bash
node generateCert.js  # Generate self-signed certs
```

---

## Current Limitations

1. **No Email Notifications**: UI promises email confirmations but not implemented
2. **Graph API Delta Sync**: Query parameter issues need resolution
3. **Rate Limiting**: DDOS protection for public endpoints pending
4. **Token Generation UI**: Staff interface for guest tokens needed

---

## Recent Improvements

### December 2024 - Data Caching & Logging

**TanStack Query Integration**:
- Added TanStack Query for categories and locations data fetching
- Implemented localStorage persistence for instant UI on return visits
- Categories and locations now load from cache immediately while fresh data fetches in background
- Prevents incorrect event grouping when API is slow
- React Query DevTools available in development for cache debugging

**Logger Migration**:
- Migrated console.log statements to centralized logger utility
- Debug logs automatically suppressed in production (`NODE_ENV=production`)
- Error and warning logs always visible for troubleshooting
- Override available via `VITE_DEBUG=true` (frontend) or `DEBUG=true` (backend)

**Files Added**:
- `src/config/queryClient.js` - TanStack Query client configuration
- `src/hooks/useLocationsQuery.js` - Locations query hook
- `src/hooks/useCategoriesQuery.js` - Categories query hooks

**Files Updated**:
- `src/App.jsx` - Added QueryClientProvider wrapper
- `src/context/LocationContext.jsx` - Uses useLocationsQuery internally
- `src/components/Calendar.jsx` - Uses category query hooks
- Multiple components migrated from console.log to logger

### Previous Improvements

- Room/Location consolidation into single collection
- Fixed calendar loading race conditions
- Enhanced event search with better filtering
- Icon-based room feature selection
- Communication history tracking for reservations

---

## Logging System

### Environment-Aware Logger

Both frontend and backend use a centralized logger that automatically suppresses debug output in production.

**Frontend** (`src/utils/logger.js`):
```javascript
import { logger } from '../utils/logger';

logger.log('General info');     // Suppressed in production
logger.debug('Debug info');     // Suppressed in production, adds [DEBUG] prefix
logger.error('Error message');  // Always shown
logger.warn('Warning message'); // Always shown
```

**Backend** (`backend/utils/logger.js`):
```javascript
const logger = require('./utils/logger');

logger.log('General info');     // Suppressed in production
logger.debug('Debug info');     // Suppressed in production
logger.error('Error message');  // Always shown
logger.warn('Warning message'); // Always shown
logger.request('GET', '/api/events'); // API request logging
logger.db('find', 'events');    // Database operation logging
```

**Environment Detection**:
| Environment | Debug Logs | Error/Warning Logs |
|-------------|------------|-------------------|
| Development | Shown | Shown |
| Production | Suppressed | Shown |
| Production + DEBUG=true | Shown | Shown |
