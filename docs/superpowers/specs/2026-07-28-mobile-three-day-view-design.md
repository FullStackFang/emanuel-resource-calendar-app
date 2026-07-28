# Mobile 3-Day Calendar View — Design

**Date:** 2026-07-28
**Status:** Approved (pending implementation)
**Author:** Stephen Fang + Claude

## Context

The mobile shell (`src/components/mobile/`) currently offers a single calendar
presentation: the agenda list (`MobileAgenda`). This change adds a compact
3-day time grid — the multi-day view Outlook popularized — as a second,
switchable view on the calendar tab.

The visual spec originated as a design-system mockup prompt (phone shell,
`ui_kits/mobile/mobile.jsx`, `_ds_bundle.js` — none of which exist in this
repo). Decision: implement in the **production mobile app**, keeping the
mockup's visual rules for the grid and dropping the mockup-only chrome (the
372x760 phone shell; the header, week strip, and bottom tabs already exist in
production).

This work builds **on top of the uncommitted Requests-tab changes**
(Calendar/Requests tab set, richer `MobileEventDetail` with statusHistory +
withdraw, `eventTransformers` preserving `statusHistory`). `MobileAgenda.jsx`
is untouched by that work, so the refactor below does not collide with it.
`MobileRequests` is not modified here.

Incidental correction carried from that work: the earlier mobile-event-detail
spec says the sheet honours an 85dvh cap; it actually shipped as
`position: fixed`. This design does not change the sheet.

## Decisions (from brainstorming)

1. **Target**: production mobile app, not a standalone mockup.
2. **Switcher segments**: Agenda | 3 Day only. A single-Day view is a noted
   future variant (the grid can render 1 column), not in scope.
3. **FAB**: skipped entirely until a mobile create flow exists.
4. **Structure**: Approach A — lift shared state into a new
   `MobileCalendarTab` parent; Agenda and ThreeDay become sibling
   presentational views. No TanStack Query migration in this change.
5. **Hour range**: full 24-hour grid (deviation from the mockup's fixed
   8 AM-9 PM), initial scroll at 9 AM. A grid that cannot show a 7 AM minyan
   is a correctness bug.
6. **Window semantics**: `selectedDate` is the leftmost of the 3 columns.

## Architecture

```
MobileApp ('calendar' case now renders MobileCalendarTab)
└── MobileCalendarTab.jsx        NEW — owns shared state
    ├── state: selectedDate, activeView ('agenda' | 'threeDay'), selectedEvent
    ├── useMobileEvents.js       NEW hook — fetch/append/refresh logic moved
    │                            verbatim from MobileAgenda; returns events,
    │                            groupedEvents, eventDates, initialLoading,
    │                            refreshing, error, retry, refresh
    ├── MobileWeekStrip          existing, moved up from MobileAgenda
    ├── MobileViewSwitcher.jsx   NEW — segmented control, own right-aligned row
    ├── MobileAgenda             slimmed to a pure list (props: events,
    │                            groupedEvents, datesToShow, loading, error,
    │                            onEventTap, onRetry, pull-to-refresh kept)
    ├── MobileThreeDay.jsx       NEW — the time grid
    └── MobileEventDetail        existing, moved up; plain event/onClose form
```

- `activeView` persists to `localStorage` key `mobile-calendar-view`.
- Switching views never refetches; both views consume the same in-memory
  event window (existing selected-week +/- 1 range logic, unchanged).
- Data pipeline unchanged: `POST /events/load` → `prepareEventsForAgenda`
  → `transformEventToFlatStructure` → filter `published | pending`.

## The 3-day grid (MobileThreeDay)

Layout, per the mockup spec unless noted:

- 44px hour gutter left; **52px per hour**; hour labels 10px
  `--text-tertiary` medium, right-aligned, centred on their hour line.
- Three day columns `flex: 1`, `--border-subtle` left borders; hairline
  `--border-subtle` line each hour.
- Sticky day-header row above the scroll area: 10px uppercase day letter +
  28px number circle (today = `--color-primary-600` fill + inverse text).
- Today's column tinted `--color-primary-50`.
- Current-time indicator on today only: 1px `--color-error-500` line with a
  7px dot at the left edge; updated on a 1-minute interval.
- 8px top inset so the first hour label is not clipped; initial `scrollTop`
  lands on 9 AM exactly (whole-hour boundary).
- Scrollbars hidden (`scrollbar-width: none` + `::-webkit-scrollbar
  { display: none }`) so the grid columns stay aligned with the sticky
  header row.
- **Deviation**: hours run 12 AM-11 PM (24h), not 8 AM-9 PM.

Event blocks:

- Absolutely positioned by local start/end minutes (derived from the
  UTC `startDateTime`/`endDateTime` via Date, consistent with
  `appTimeUtils` usage elsewhere).
- App calendar idiom, not Outlook solid fills: **1px full outline in the
  category color over a ~13% alpha fill of the same color** (`color + '21'`
  hex alpha), `--radius-sm`.
- Inside: time at 9px `--font-semibold` `--text-secondary`, then title at
  10px `--font-medium` `--text-primary`, ellipsis clipping.
- Pending events at 0.9 opacity. (Drafts never reach mobile — pipeline
  filters to published | pending — so the mockup's 0.8 draft rule is moot.)
- Overlapping events split their column width side-by-side within the
  overlap cluster (same idiom as the desktop day view).
- Minimum block height 20px so short events stay tappable.
- Tap opens the shared `MobileEventDetail` sheet.

All-day events (mockup is silent; they exist in real data): a thin chip row
pinned under the sticky day headers, one chip per event, same
outline-over-wash idiom, tappable.

## Category colors

- New `src/utils/categoryColors.js`: exports the Outlook `preset0-24` → hex
  map and `buildCategoryColorResolver(outlookCategories)` returning
  `(categoryName) => hex`; `#cccccc` for uncategorized/unknown.
- `MobileCalendarTab` sources categories from the existing cached
  `useOutlookCategoriesQuery(apiToken, APP_CONFIG.DEFAULT_DISPLAY_CALENDAR)`
  (30-min staleTime, graceful `[]` fallback → everything renders gray).
- `Calendar.jsx` is **not** refactored to use the util in this change
  (surgical-change rule). Noted follow-up.

## Interactions

- **Switcher**: segmented control on `--bg-tertiary`, active pill
  `--bg-primary` + `--color-primary-600` + `--shadow-xs`, `--text-xs` medium
  labels, `white-space: nowrap`, right-aligned on its own row beneath the
  week strip (never beside the month label — that caret opens
  `MobileDatePicker`). Min 44px targets; press state `--bg-tertiary`; no
  hover states.
- **Week strip**: unchanged; chevrons/date picker/Today all move
  `selectedDate`; in 3-day mode that date is the left column. Event dots
  keep working off the shared `eventDates`.
- **Empty grid space**: no action in v1 (no create flow; FAB skipped).
- **Pull-to-refresh**: agenda-only. In a scrollable grid the gesture fights
  vertical panning.
- **No horizontal swipe paging** in v1; chevrons/week strip move the window.

## Visual rules (both new components)

No emoji. No colors outside the design tokens except the Outlook category
hexes. No purple/indigo gradients. Touch targets >= 44px. Straight quotes
only in copy.

## Testing (Vitest, existing mobile conventions)

1. `useMobileEvents.test.js` — extraction is behavior-preserving: range
   fetch, append/dedupe, error → retry, published/pending filter.
2. `MobileThreeDay.test.jsx` — 3 correct columns from `selectedDate`; block
   top/height match times; overlap cluster splits width; all-day chip row;
   pending opacity; tap fires `onEventTap`; current-time line only on today.
3. `MobileCalendarTab.test.jsx` — switcher toggles views without refetch;
   persists to localStorage; week strip drives both views; detail sheet
   opens from either view.
4. Existing mobile suites stay green (64 passing baseline from the
   Requests-tab work).

Final verification: `npm run dev` at phone-width viewport, walk the flow
(switch views, navigate days, tap events, check current-time line) per the
verify-app flow.

## Out of scope / follow-ups

- Single-Day segment (grid 1-column variant).
- Horizontal swipe paging between 3-day windows.
- FAB + mobile create flow.
- Refactoring `Calendar.jsx` to consume `categoryColors.js`.
- TanStack Query migration for mobile event fetching.
- Warm-reload persistence (separate deferred openspec change).
