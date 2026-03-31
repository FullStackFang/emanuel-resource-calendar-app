## 1. Provider Restructure

- [x] 1.1 Move the `deviceType === 'phone'` conditional in App.jsx from outside to inside the SSEProvider/TimezoneProvider/RoomProvider block — phone renders MobileApp inside providers, desktop renders existing layout
- [x] 1.2 Remove the old MobileLayout import and replace with MobileApp import in App.jsx
- [x] 1.3 Verify desktop app is completely unchanged at viewport > 1024px (all routes, modals, features work)
- [x] 1.4 Verify phone viewport (<=480px) renders MobileApp with access to useTimezone(), useLocations(), and SSE context

## 2. Mobile App Shell

- [x] 2.1 Create `src/components/mobile/MobileApp.jsx` — manages activeTab state, renders MobileHeader + active view + MobileBottomTabs
- [x] 2.2 Create `src/components/mobile/MobileApp.css` — full-height flex layout with fixed header, scrollable content area, fixed bottom tabs, safe area insets
- [x] 2.3 Create `src/components/mobile/MobileHeader.jsx` — compact header with "Temple Events" title, user avatar circle (initials), dropdown menu (sign out, open desktop version)
- [x] 2.4 Create `src/components/mobile/MobileHeader.css` — header styling, avatar circle, dropdown animation
- [x] 2.5 Create `src/components/mobile/MobileBottomTabs.jsx` — 3-tab bar (Calendar, My Events, Chat) with icons, active state, badge count placeholder
- [x] 2.6 Create `src/components/mobile/MobileBottomTabs.css` — fixed bottom bar, safe area padding, active tab highlight, 44px minimum touch targets

## 3. Agenda Calendar View

- [x] 3.1 Create `src/components/mobile/MobileWeekStrip.jsx` — horizontal scrollable week strip showing 7 days, event dot indicators, selected date highlight, today highlight, swipe navigation between weeks, "Today" button when navigated away
- [x] 3.2 Create `src/components/mobile/MobileWeekStrip.css` — horizontal scroll snap, day cells, dot indicators, selected/today styling
- [x] 3.3 Create `src/components/mobile/MobileAgenda.jsx` — date-grouped event list consuming events from API, loading skeleton, pull-to-refresh, scroll-to-date when week strip date tapped, 2-week incremental loading
- [x] 3.4 Create `src/components/mobile/MobileAgenda.css` — date section headers, list layout, pull-to-refresh indicator, loading skeleton, empty day state
- [x] 3.5 Create `src/components/mobile/MobileEventCard.jsx` — event card with start time, title, location, status dot, category tag, tap handler
- [x] 3.6 Create `src/components/mobile/MobileEventCard.css` — card styling using design tokens, status dot colors (green/yellow/gray/red), touch feedback

## 4. Event Detail Bottom Sheet

- [x] 4.1 Create `src/components/mobile/MobileEventDetail.jsx` — bottom sheet overlay with drag handle, event fields (title, status badge, date/time, location, requester, categories, description, timing details, attendee count), dismiss on tap-outside and drag-down
- [x] 4.2 Create `src/components/mobile/MobileEventDetail.css` — fixed overlay, translateY animation, backdrop dimming, max-height 85dvh, internal scroll, drag handle, status badge colors

## 5. Data Integration

- [x] 5.1 Wire MobileAgenda to load events via authenticated fetch from existing calendar data endpoint (GET /api/events/load or equivalent), transform with transformEventToFlatStructure, group by date
- [x] 5.2 Wire MobileWeekStrip event dot indicators — derive which dates have events from loaded data
- [x] 5.3 Wire MobileEventDetail — pass selected event from card tap to bottom sheet, display all available flat fields
- [x] 5.4 Implement pull-to-refresh — re-fetch events for current date range on pull gesture

## 6. Placeholder Tabs

- [x] 6.1 Create placeholder content for My Events tab — "Coming soon" message with icon, matching mobile design language
- [x] 6.2 Create placeholder content for Chat tab — "Coming soon" message with icon

## 7. Cleanup and Verification

- [x] 7.1 Delete old `src/components/mobile/MobileLayout.jsx` and `MobileLayout.css` (replaced by MobileApp)
- [x] 7.2 Update welcome landing in App.jsx if needed — ensure unauthenticated phone users still see the branded sign-in page
- [x] 7.3 Run frontend test suite (`npm run test:run`) — verify no regressions
- [x] 7.4 Run production build (`npm run build`) — verify clean build
- [x] 7.5 Test in Chrome DevTools at 375px (iPhone SE) and 428px (iPhone 14 Pro Max) — verify all views render correctly
