# Emanuel Resource Calendar App

A comprehensive calendar management system built with React and Microsoft Graph API integration, designed for Temple Emanuel to manage events, resources, and scheduling.

## 🏗️ Architecture Overview

### System Design

This application follows a **three-tier architecture**:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React SPA)                      │
│  - Vite + React 19                                              │
│  - Microsoft Fluent UI Components                               │
│  - MSAL Authentication                                          │
│  - React Router for client-side routing                         │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTPS
┌────────────────────┴────────────────────────────────────────────┐
│                    Backend API (Node.js/Express)                 │
│  - RESTful API + Server-Sent Events (SSE)                      │
│  - JWT Authentication with JWKS                                │
│  - MongoDB Connection Pool                                      │
│  - CSV Processing & Streaming                                   │
└────────────────────┬────────────────────────────────────────────┘
                     │
┌────────────────────┴────────────────────────────────────────────┐
│                    Data Layer                                   │
├─────────────────────────────┬───────────────────────────────────┤
│   MongoDB (Azure CosmosDB)  │    Microsoft Graph API           │
│   - Event Storage           │    - Calendar Operations        │
│   - User Preferences        │    - Authentication             │
│   - Cache Layer             │    - Real-time Sync             │
└─────────────────────────────┴───────────────────────────────────┘
```

### Single Page Application (SPA) Architecture

The application is built as a **true SPA** with the following characteristics:

- **Client-Side Routing**: Uses React Router v7 for navigation without page reloads
- **Component-Based Architecture**: Modular React components with clear separation of concerns
- **State Management**: React Context API for global state (authentication, preferences, timezone)
- **Lazy Loading**: Code splitting and dynamic imports for optimized bundle sizes
- **Progressive Enhancement**: Works offline for cached data, online features enhance functionality

## 📊 Data Architecture

### Data Storage Strategy

The application uses a **hybrid storage model**:

#### 1. **MongoDB Collections** (Primary Storage)

```javascript
// Collection: templeEvents__Events (Unified Events)
{
  userId: "user-guid",
  calendarId: "calendar-guid",
  eventId: "event-guid",
  graphData: {
    // Microsoft Graph event data
    id, subject, start, end, location, 
    categories, organizer, attendees, etc.
  },
  internalData: {
    // Temple-specific enrichments
    mecCategories: [],
    setupMinutes: 0,
    teardownMinutes: 0,
    assignedTo: "",
    setupStatus: "pending",
    estimatedCost: null
  },
  sourceCalendars: [],
  lastSyncedAt: Date,
  isDeleted: false
}

// Collection: templeEvents__Users
{
  userId: "user-guid",
  email: "user@temple.org",
  preferences: {
    defaultView: "week",
    startOfWeek: "Monday",
    preferredTimeZone: "America/New_York",
    createEvents: true,
    editEvents: true,
    deleteEvents: false,
    isAdmin: false
  }
}

// Collection: templeEvents__Events (Unified Event Storage)
{
  eventId: "event-guid",
  userId: "user-id",
  calendarId: "calendar-id",
  graphData: {
    // Original Graph API event data
  },
  internalData: {
    // Extended event metadata and enrichments
  },
  lastSyncedAt: Date,
  isDeleted: false
}

// DEPRECATED Collections (no longer used):
// - templeEvents__InternalEvents (consolidated into templeEvents__Events)
// - templeEvents__EventCache (consolidated into templeEvents__Events)
```

#### 2. **Microsoft Graph API** (Source of Truth for Calendar Data)
- Real-time calendar data
- User authentication
- Calendar permissions
- Event CRUD operations

### Data Flow & Synchronization

```
User Action → Frontend → Backend API → Graph API
                ↓                         ↓
            Local Cache ← MongoDB ← Sync Process
```

1. **Create/Update Flow**:
   - User creates/edits event in UI
   - Frontend sends to Graph API via batch request
   - Backend fetches complete event data
   - Sync process saves to MongoDB with enrichments
   - Cache invalidated and refreshed

2. **Read Flow**:
   - Check cache first (15-minute TTL)
   - Fallback to MongoDB
   - Background sync with Graph API
   - Delta sync for efficiency

3. **Delete Flow**:
   - Delete from Graph API first
   - Clean up MongoDB records
   - Invalidate cache entries

## 🔄 Loading & Performance Management

### Multi-Level Loading Strategy

1. **Initial Load Optimization**:
   ```javascript
   // Progressive loading sequence
   1. Load user authentication
   2. Fetch user preferences
   3. Load available calendars
   4. Cache-first event loading
   5. Background delta sync
   ```

2. **Cache Layers**:
   - **Browser Memory**: React Query for API responses
   - **MongoDB Cache**: 15-minute TTL for event data
   - **Service Worker**: Offline capability (planned)

3. **Loading States**:
   ```javascript
   loadingState = {
     user: false,
     categories: false,
     extensions: false,
     events: false
   }
   ```

4. **Streaming for Large Operations**:
   - CSV imports use Server-Sent Events (SSE)
   - Progress updates in real-time
   - Chunked processing (50 records at a time)

## 🔐 Authentication & Security

### Multi-Layer Authentication

1. **Frontend Authentication** (MSAL):
   ```javascript
   // Azure AD Configuration
   - Client ID: Temple-specific
   - Authority: Azure AD tenant
   - Scopes: ["User.Read", "Calendars.ReadWrite"]
   ```

2. **Backend Authentication** (JWT + JWKS):
   ```javascript
   // Token validation flow
   Frontend Token → Backend Verify → JWKS Validation → User Context
   ```

3. **Permission Model**:
   - Role-based access control (RBAC)
   - Calendar-level permissions
   - Feature flags per user

## 🚀 Key Features & Implementation

### 1. **Event Management**
- Full CRUD operations with Microsoft Graph
- Rich text editing with categories and locations
- Setup/teardown time management
- Registration event linking

### 2. **Calendar Views**
- Day/Week/Month views with zoom controls
- Filtering by categories, locations, virtual/physical
- Multi-calendar support with toggle
- Print-optimized layouts

### 3. **Import/Export**
- CSV bulk import with streaming
- PDF export with jsPDF
- Public API for external systems
- iCalendar format support

### 4. **Admin Features**
- User management with permissions
- Event synchronization dashboard
- Cache management tools
- Schema extension configuration

### 5. **Teams/Outlook Integration**
- Functions as Outlook add-in
- Teams app compatibility
- Manifest.xml configuration
- Cross-platform event creation

## 🛠️ Development Setup

### Prerequisites
- Node.js 18+
- MongoDB instance (local or Azure CosmosDB)
- Azure AD app registration
- SSL certificates for HTTPS

### Environment Configuration

#### Frontend (.env)
```bash
VITE_CLIENT_ID=your-azure-client-id
VITE_AUTHORITY=https://login.microsoftonline.com/your-tenant
VITE_API_BASE_URL=http://localhost:3001
```

#### Backend (.env)
```bash
MONGODB_URI=mongodb://localhost:27017/templeEvents
TENANT_ID=your-tenant-id
CLIENT_ID=your-client-id
PORT=3001
```

### Installation & Running

```bash
# Install dependencies
npm install
cd backend && npm install

# Generate SSL certificates
node generateCert.js

# Start development servers
npm run dev          # Frontend (https://localhost:5173)
cd backend && npm run dev  # Backend (http://localhost:3001)
```

## 📁 Project Structure

```
emanuel-resource-calendar-app/
├── src/
│   ├── components/         # React components
│   │   ├── Calendar.jsx    # Main calendar component
│   │   ├── EventForm.jsx   # Event creation/editing
│   │   └── ...
│   ├── context/           # React Context providers
│   ├── services/          # API service layers
│   ├── utils/             # Helper functions
│   └── config/            # Configuration files
├── backend/
│   ├── api-server.js      # Express server
│   ├── utils/             # Backend utilities
│   └── ...
├── public/                # Static assets
└── certs/                 # SSL certificates
```

## 🔧 Technology Stack

### Frontend
- **Framework**: React 19 with Vite
- **UI Library**: Microsoft Fluent UI
- **Authentication**: MSAL (Microsoft Authentication Library)
- **State Management**: React Context API + React Query
- **Routing**: React Router v7
- **PDF Generation**: jsPDF
- **Date Handling**: Native JavaScript Date + react-datepicker

### Backend
- **Runtime**: Node.js with Express
- **Database**: MongoDB with native driver
- **Authentication**: JWT with JWKS-RSA
- **File Processing**: Multer + CSV Parser
- **Logging**: Custom logger with levels
- **CORS**: Configured for cross-origin requests

### Infrastructure
- **Hosting**: Azure Web Apps
- **Database**: Azure CosmosDB (MongoDB API)
- **CDN**: Azure Front Door (production)
- **SSL**: Let's Encrypt certificates

## 🚦 Performance Optimizations

1. **Code Splitting**: Dynamic imports for large components
2. **Memoization**: React.memo for expensive renders
3. **Virtual Scrolling**: For large event lists (planned)
4. **Debouncing**: Search and filter operations
5. **Batch Operations**: Graph API batch requests
6. **Connection Pooling**: MongoDB connection reuse

## 🔍 Monitoring & Debugging

- **Frontend Logging**: Custom logger with debug levels
- **Backend Logging**: Structured logging with timestamps
- **Error Boundaries**: Graceful error handling in React
- **Performance Monitoring**: React DevTools Profiler
- **Network Monitoring**: Browser DevTools integration

## 🚧 Upcoming Features

- [ ] Recurring event templates
- [ ] Resource booking system
- [ ] Email notifications
- [ ] Mobile app
- [ ] Offline mode with service workers
- [ ] Advanced analytics dashboard

## 📄 License

Private repository - Temple Emanuel internal use only

## 👥 Contributors

- Temple Emanuel IT Team
- Microsoft Graph API Integration Team

---

For detailed API documentation, see [API_DOCS.md](./API_DOCS.md)
For deployment instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md)