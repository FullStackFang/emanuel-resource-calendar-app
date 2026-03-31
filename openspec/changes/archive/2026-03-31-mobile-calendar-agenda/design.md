## Context

The mobile PWA prerequisites are complete: MSAL redirect auth works on phones, the PWA manifest enables "Add to Home Screen," and `useDeviceType()` detects phone viewports. Currently, phone users see a branded placeholder. The next step is replacing it with a functional agenda calendar.

The existing desktop Calendar.jsx (6,362 lines) uses a complex grid layout with month/week/day views. This is not adaptable to phone screens. Instead, mobile gets purpose-built components that share the same backend data and transform layer but present events as a scrollable date-grouped list.

**Current architecture problem**: The device fork in App.jsx renders `<MobileLayout />` *before* the SSEProvider/TimezoneProvider/RoomProvider block, so mobile has no access to timezone, room, or real-time event contexts. This must be restructured.

## Goals / Non-Goals

**Goals:**
- Phone users can browse all Temple Emanuel events in an agenda list
- Phone users can tap any event to see its full details
- The mobile app feels like a native app (bottom tabs, smooth transitions, pull-to-refresh)
- Zero impact on the existing desktop experience
- Reuse existing backend endpoints and frontend transform utilities
- Establish the mobile component architecture that Phase 2 (My Events, Chat) builds on

**Non-Goals:**
- Event editing or creation (desktop only, except via AI chat in Phase 2)
- Approval/rejection workflow (desktop/tablet only)
- Offline data caching (future enhancement)
- Push notifications
- Tablet-specific layouts
- New backend API endpoints

## Decisions

### 1. Provider Restructure: Fork Inside Providers

**Decision:** Move the `deviceType === 'phone'` check inside the SSEProvider/TimezoneProvider/RoomProvider block, not before it.

**Rationale:** Mobile views need `useTimezone()` for time display, `useLocations()` for room name lookups, and SSE for real-time updates. Wrapping mobile inside existing providers means zero duplication of context logic.

**Alternatives considered:**
- *Create mobile-specific lightweight providers:* More code, divergent behavior, maintenance burden
- *Pass data as props from App.jsx:* Breaks hook patterns, prop drilling across many components

**Implementation:** In App.jsx, the authenticated block currently renders:
```
{phone ? <MobileLayout /> : <SSEProvider>...<desktop/>...</SSEProvider>}
```
Change to:
```
<SSEProvider>...<RoomProvider>{phone ? <MobileApp /> : <desktop/>}</RoomProvider>...</SSEProvider>
```
Desktop rendering path is identical — just the conditional moves inward.

### 2. Tab State: React State, Not Router

**Decision:** Use React state (`activeTab`) for bottom tab navigation instead of React Router routes.

**Rationale:** The mobile views are a single-page experience with tab switching, not separate URL-addressable pages. Using state avoids URL changes when switching tabs, prevents browser back-button confusion, and keeps the mobile navigation self-contained. The desktop router continues unchanged.

**Alternatives considered:**
- *React Router nested routes:* Would create URLs like `/m/calendar`, `/m/events` — adds complexity and potential conflicts with desktop routes
- *Hash-based routing:* Workaround feel, no real benefit over state

### 3. Data Loading: Reuse Calendar Data Service

**Decision:** Use the same `GET /api/events/load` endpoint that Calendar.jsx uses, with `transformEventToFlatStructure` for normalization.

**Rationale:** This endpoint returns all events for a date range across all calendars — exactly what the agenda view needs. Using `transformEventToFlatStructure` ensures mobile and desktop display identical data. No new endpoint needed.

**Data flow:**
```
GET /api/events/load?start=...&end=...
  → Raw MongoDB events
  → transformEventToFlatStructure() (per event)
  → Group by date (YYYY-MM-DD key)
  → Render date sections with event cards
```

**Date range strategy:** Load 2 weeks at a time (current week + next week). When user scrolls near the end, load the next 2 weeks. When user navigates backward via week strip, load previous weeks.

### 4. Week Strip: Horizontal Scroll with Snap

**Decision:** Implement the date picker as a horizontal scrollable week strip (like Google Calendar mobile) that collapses/expands to a full month grid.

**Rationale:** This is the established convention in mobile calendar apps. Users immediately understand the interaction pattern. The strip shows 7 days with event dots, and expands to a full month on pull-down gesture.

**Implementation:** CSS `scroll-snap-type: x mandatory` with `scroll-snap-align: start` on week containers. Each week is a full-width snap point. Swipe left/right navigates weeks. Tap "Today" button returns to current date.

### 5. Bottom Sheet: CSS Transform, Not Portal

**Decision:** Implement the event detail bottom sheet as a `position: fixed` overlay using CSS `transform: translateY()` with transitions, not a React Portal or separate route.

**Rationale:** Bottom sheets are the standard mobile pattern for contextual detail. Using CSS transforms with `will-change: transform` enables hardware-accelerated animation. A fixed overlay means the sheet slides up over the agenda view, and tapping outside or swiping down dismisses it.

**States:**
- Hidden: `translateY(100%)`
- Visible: `translateY(0)` with `max-height: 85dvh` and overflow scroll
- Drag-to-dismiss via touch event tracking on the sheet handle

### 6. Component Architecture

**Decision:** All mobile components live in `src/components/mobile/` with a `Mobile` prefix.

```
src/components/mobile/
├── MobileApp.jsx          — App shell (header + active view + tabs)
├── MobileApp.css
├── MobileHeader.jsx       — Compact header with avatar menu
├── MobileHeader.css
├── MobileBottomTabs.jsx   — 3-tab navigation bar
├── MobileBottomTabs.css
├── MobileAgenda.jsx       — Week strip + date-grouped event list
├── MobileAgenda.css
├── MobileEventCard.jsx    — Single event card in the agenda list
├── MobileEventCard.css
├── MobileEventDetail.jsx  — Bottom sheet detail view
├── MobileEventDetail.css
├── MobileWeekStrip.jsx    — Collapsible week/month date picker
└── MobileWeekStrip.css
```

**Rationale:** Clear separation from desktop components, consistent naming, each component has its own CSS file (matching existing project convention).

## Risks / Trade-offs

**[Risk] Event loading performance on slow mobile networks** → Mitigation: Load 2 weeks at a time (not the full year like desktop). Show skeleton loading states. Use the same cached query client that desktop uses (React Query).

**[Risk] Provider restructure breaks desktop** → Mitigation: The only change is moving the `{phone ? ... : ...}` conditional one level deeper. Desktop hits the exact same code path. Verify with existing frontend tests.

**[Risk] Bottom sheet gesture conflicts with page scroll** → Mitigation: Only enable drag-to-dismiss on the sheet handle bar (top 40px), not the entire sheet body. Sheet body scrolls normally.

**[Risk] Week strip date navigation out of sync with event list** → Mitigation: Selected date in week strip drives the scroll position. Scroll position updates the selected date in the strip. Single source of truth: `selectedDate` state.

**[Trade-off] My Events and Chat tabs show placeholders** → Acceptable for Phase 1. The tabs are visible so users understand the app structure, but tapping them shows "Coming soon" content. This avoids shipping a single-view app with no navigation affordance.
