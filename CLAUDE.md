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
- **State Management**: React Context API (`UserPreferencesContext`)
- **UI Framework**: Microsoft Fluent UI components

### Backend API (Node.js/Express)
- **Entry Point**: `backend/api-server.js`
- **Database**: MongoDB (Azure Cosmos DB)
- **Collections**:
  - `templeEvents__Users`: User profiles and preferences
  - `templeEvents__InternalEvents`: Event data with internal enrichments
- **Authentication**: JWT validation with JWKS

### Key Services
- **eventDataService.js**: Handles all event operations (fetch, create, update, delete)
- **graphService.js**: Microsoft Graph API interactions for calendar data
- **userPreferencesService.js**: User preference management

### API Structure
- Protected endpoints require JWT bearer token
- Public endpoints at `/api/public/*` for external access
- Admin-only endpoints for sync operations

### Event Data Model
Events combine Microsoft Graph data with internal enrichments:
- External: subject, start/end times, location, organizer
- Internal: MEC categories, setup/teardown times, staff assignments, costs, custom fields

### Authentication Flow
1. User logs in via MSAL popup
2. Acquires two tokens: Graph API token + Custom API token
3. Frontend includes API token in Authorization header
4. Backend validates token using JWKS from Azure AD

### Environment Configuration
- Development: `https://localhost:5173` (frontend), `http://localhost:3001` (backend)
- Production: Azure Web Apps with custom domains
- HTTPS required for Teams/Outlook add-in functionality

## Important Notes

- The app functions as both a standalone web app and Microsoft Teams/Outlook add-in
- User preferences are stored in MongoDB (not Office.js RoamingSettings)
- Event sync creates internal copies of Graph events for enrichment without modifying originals
- Multiple calendar support with real-time synchronization
- Export features include PDF generation and public API access