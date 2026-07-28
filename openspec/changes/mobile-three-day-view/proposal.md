# Mobile 3-Day Calendar View

## Why

The mobile calendar tab has a single presentation — the agenda list — which is good for scanning but poor for judging a day's shape: gaps, overlaps, and how long events actually run. A compact 3-day time grid (the multi-day view Outlook popularized) gives schedulers that at-a-glance density on a phone.

## What Changes

- Add a view switcher (segmented control: Agenda | 3 Day) to the mobile calendar tab, on its own right-aligned row beneath the week strip; last-used view persists across sessions.
- Add a 3-day time grid view: 24-hour scrollable grid at 52px/hour, a 28px compact hour gutter, sticky day headers, today column tint, current-time indicator, all-day chip row, and event blocks positioned by start/end time.
- Blocks carry no visible start time (the Y axis states it; the time stays in the accessible name), are identified by a 3px category-colour rail over a light wash, and adapt their text to their rendered height: one clamped title line on short blocks, two on medium, two plus the location on hour-plus blocks.
- Restructure the calendar tab so agenda and 3-day views share one data window: new `MobileCalendarTab` parent owns `selectedDate`, event fetching (extracted verbatim into a `useMobileEvents` hook), the week strip, and the shared `MobileEventDetail` sheet. `MobileAgenda` slims to a presentational list; its user-visible behavior is unchanged.
- Extract the Outlook `preset0-24` -> hex color map into a shared `src/utils/categoryColors.js`, fed on mobile by the existing cached `useOutlookCategoriesQuery`. `Calendar.jsx` is not refactored to consume it in this change.
- Out of scope: FAB/create flow, single-Day segment, horizontal swipe paging, pull-to-refresh inside the grid, TanStack Query migration for mobile fetching.

## Capabilities

### New Capabilities

- `mobile-three-day-view`: the 3-day time grid — window semantics (selected date = leftmost column), grid layout and scroll behavior, event block rendering and colors, overlap handling, all-day row, current-time indicator, and the calendar-tab view switcher with persistence.

### Modified Capabilities

None. `mobile-agenda` requirements (grouping, cards, week strip behavior while the agenda is active, incremental data loading, pull-to-refresh) are preserved verbatim; the restructure moves state ownership without changing spec-level behavior. The week strip's behavior while the 3-day view is active is a requirement of the new capability.

## Impact

- **Frontend only.** No backend/API changes; data continues to flow through `POST /events/load` -> `prepareEventsForAgenda` -> `transformEventToFlatStructure` -> published/pending filter.
- New: `src/components/mobile/MobileCalendarTab.jsx`, `MobileThreeDay.jsx` (+ CSS), `MobileViewSwitcher.jsx` (+ CSS), `src/hooks/useMobileEvents.js`, `src/utils/categoryColors.js`.
- Modified: `src/components/mobile/MobileApp.jsx` (calendar case renders `MobileCalendarTab`), `MobileAgenda.jsx` (+ CSS) slimmed to presentational.
- Builds on the uncommitted mobile-requests-tab baseline; `MobileRequests` untouched.
- Tests: new Vitest suites for the hook extraction, the grid, and the tab container; existing mobile suites (64 passing baseline) must stay green.
