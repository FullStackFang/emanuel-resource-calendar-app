## Why

The PWA prerequisites are in place (mobile auth, service worker, device detection) but phone users see only a "coming soon" placeholder. This change delivers the first usable mobile experience: browsing all Temple Emanuel events in an agenda list and viewing event details. Read-only — no editing, no approvals. This is the foundation that the next phase (My Events, AI Chat) builds on.

## What Changes

- **Provider restructure**: Move the phone device fork inside the SSEProvider/TimezoneProvider/RoomProvider chain in App.jsx so mobile views have access to all existing hooks and contexts
- **Mobile app shell**: Replace MobileLayout placeholder with MobileApp component — compact header with user avatar/menu, bottom tab bar (3 tabs: Calendar, My Events, Chat), active tab state
- **Agenda calendar view**: Collapsible week strip date picker (Google Calendar style), scrollable date-grouped event list showing all calendar events, event cards with time/title/location/status, empty day states
- **Event detail bottom sheet**: Tap an event card to open a sliding bottom sheet with read-only event details (title, date/time, location, status, requester, categories, description, setup/teardown, attendee count)
- **Mobile header**: Compact header with "Temple Events" title, user avatar initial circle, dropdown menu (sign out, "Open Desktop Version" link)
- **Pull-to-refresh**: Standard mobile refresh pattern on the agenda list
- **My Events and Chat tabs**: Render placeholder content for now — functional views come in Phase 2

## Capabilities

### New Capabilities
- `mobile-app-shell`: Bottom tab navigation, mobile header with avatar menu, tab state management, and the overall mobile app container
- `mobile-agenda`: Agenda-style calendar view with week strip date picker, date-grouped event list, event cards, pull-to-refresh, and data loading from existing calendar endpoints
- `mobile-event-detail`: Bottom sheet component for read-only event detail display, including all key fields and status badge styling

### Modified Capabilities
- `device-detection`: The phone layout fork in App.jsx moves from outside to inside the provider chain (SSEProvider, TimezoneProvider, RoomProvider)

## Impact

- **App.jsx**: Restructure the device fork to be inside the authenticated provider block instead of before it. Desktop code path unchanged.
- **src/components/mobile/**: MobileLayout.jsx replaced by MobileApp.jsx and several new components (MobileHeader, MobileAgenda, MobileEventCard, MobileEventDetail, MobileBottomTabs)
- **Existing hooks reused**: useAuthenticatedFetch, useDeviceType, useTimezone (via TimezoneProvider), useLocations (via RoomProvider)
- **Existing utils reused**: transformEventToFlatStructure from eventTransformers.js
- **No backend changes**: Uses existing GET /api/events/load and GET /api/events/list endpoints
- **No new dependencies**: Pure React components with CSS, no external libraries
