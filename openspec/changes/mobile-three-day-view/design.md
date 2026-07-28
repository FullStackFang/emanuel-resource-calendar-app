# Design: Mobile 3-Day Calendar View

## Context

The mobile shell (`src/components/mobile/`) has one calendar presentation: `MobileAgenda`, which owns `selectedDate`, the event fetch (a manual two-week rolling window over `POST /events/load`), the `MobileWeekStrip`, and the `MobileEventDetail` sheet. The visual spec for the 3-day grid originated as a design-system mockup prompt (`ui_kits/`, phone shell) from a separate workspace; the grid's visual rules are adopted, the mockup-only chrome is not.

This change builds on the uncommitted mobile-requests-tab baseline (Calendar/Requests tabs, richer `MobileEventDetail`). `MobileAgenda.jsx` is untouched by that work, so the restructure here does not collide with it. `MobileRequests` is not modified.

Design was brainstormed and approved in conversation on 2026-07-28 (target, switcher segments, FAB, structure, hour range, and window semantics were explicit user decisions).

## Goals / Non-Goals

**Goals:**
- A 3-day time grid on the calendar tab, switchable with the agenda, sharing one in-memory event window (no refetch on switch, selected date preserved).
- Follow the app's calendar idiom for event blocks: 1px outline in the category color over a ~13% alpha wash of the same color — not Outlook's solid pastel fills.
- Keep `MobileAgenda`'s user-visible behavior byte-identical through the restructure.

**Non-Goals:**
- FAB / mobile create flow (no create flow exists; a dead button is worse than none).
- Single-Day segment, horizontal swipe paging, pull-to-refresh inside the grid.
- TanStack Query migration of mobile fetching; refactoring `Calendar.jsx` to the shared color util.

## Decisions

### 1. Lift state into `MobileCalendarTab` (vs self-contained view, vs TanStack migration)

```
MobileApp ('calendar' case renders MobileCalendarTab)
└── MobileCalendarTab.jsx        NEW — owns shared state
    ├── state: selectedDate, activeView ('agenda' | 'threeDay'), selectedEvent
    ├── useMobileEvents.js       NEW hook — MobileAgenda's fetch/append/refresh
    │                            logic moved verbatim; returns events,
    │                            groupedEvents, eventDates, initialLoading,
    │                            refreshing, error, retry, refresh
    ├── MobileWeekStrip          existing, moved up from MobileAgenda
    ├── MobileViewSwitcher.jsx   NEW — segmented control, own right-aligned row
    ├── MobileAgenda             slimmed to a pure presentational list
    ├── MobileThreeDay.jsx       NEW — the time grid
    └── MobileEventDetail        existing, moved up; plain event/onClose form
```

Alternatives rejected: a self-contained `MobileThreeDay` duplicating fetch + week strip (double network, selected date resets on switch); doing the lift plus a TanStack Query migration (drags in query-key/caching conventions — scope creep, deferred).

`activeView` persists to localStorage key `mobile-calendar-view`. Switching views never refetches. Data pipeline is unchanged: `POST /events/load` -> `prepareEventsForAgenda` -> `transformEventToFlatStructure` -> filter `published | pending`.

### 2. Full 24-hour grid (deviation from the mockup's 8 AM-9 PM)

Real temple data has early/late events (morning minyan, evening programs); a grid that silently cannot render a 7 AM event is a correctness bug. Hours run 12 AM-11 PM at 52px/hour; initial `scrollTop` lands exactly on 9 AM per the mockup. Extra hours are only visible when scrolled to. Alternatives rejected: fixed 8 AM-9 PM (hides events), dynamic range per window (layout shifts as you navigate).

### 3. Window semantics: `selectedDate` is the leftmost column

Week strip taps, chevrons, date picker, and Today all just move `selectedDate`; the grid follows. One source of truth, zero week-strip changes.

### 4. Grid rendering rules

- 44px hour gutter; hour labels 10px `--text-tertiary` medium, right-aligned, centred on their hour line. Day columns `flex: 1`, `--border-subtle` left borders, hairline per hour.
- Sticky day-header row: 10px uppercase day letter + 28px number circle (today = `--color-primary-600` fill + inverse text). Today's column tinted `--color-primary-50`.
- Current-time indicator on today only: 1px `--color-error-500` line, 7px dot at the left edge, updated on a 1-minute interval.
- 8px top inset so the first hour label is not clipped. Scrollbars hidden (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) so columns stay aligned with the sticky header.
- Event blocks: absolutely positioned by local start/end minutes (derived from UTC `startDateTime`/`endDateTime` via `Date`, consistent with `appTimeUtils` usage). 1px outline in category color over `color + '21'` fill, `--radius-sm`; 9px semibold time (`--text-secondary`), 10px medium title (`--text-primary`), ellipsis. Pending at 0.9 opacity (drafts never reach mobile — pipeline filters them, so the mockup's 0.8 draft rule is moot). Minimum block height 20px for tappability. Tap opens the shared detail sheet.
- Overlapping events split their column width side-by-side within the overlap cluster (desktop day-view idiom).
- All-day events (mockup is silent; they exist in real data): a thin chip row pinned under the sticky day headers, same outline-over-wash idiom, tappable.

### 5. Category colors via shared util fed by the existing query

New `src/utils/categoryColors.js` exports the Outlook `preset0-24` -> hex map (extracted from `Calendar.jsx`'s inline `getCategoryColor`) and `buildCategoryColorResolver(outlookCategories)` -> `(categoryName) => hex`, `#cccccc` fallback. `MobileCalendarTab` feeds it from the already-cached `useOutlookCategoriesQuery(apiToken, APP_CONFIG.DEFAULT_DISPLAY_CALENDAR)` (30-min staleTime, graceful `[]` fallback — everything renders gray if Graph is down). `Calendar.jsx` keeps its inline copy for now (surgical-change rule); consolidation is a follow-up.

### 6. Interaction details

- Switcher: `--bg-tertiary` track, active pill `--bg-primary` + `--color-primary-600` + `--shadow-xs`, `--text-xs` medium labels, `white-space: nowrap`, right-aligned on its own row beneath the week strip (never beside the month label — that caret opens `MobileDatePicker`). Targets >= 44px; press state `--bg-tertiary`; no hover states; no emoji; no colors outside tokens except the Outlook category hexes.
- Empty grid space does nothing in v1. Pull-to-refresh stays agenda-only (the gesture fights vertical panning in a grid).

## Risks / Trade-offs

- [Restructure regresses agenda behavior] -> hook extraction is verbatim (no logic edits); dedicated behavior-parity tests; existing mobile suites (64 passing baseline) must stay green.
- [Timezone drift between block position and day grouping] -> both derive from the same flat-structure fields already used by the agenda (`startDate` for grouping, `startDateTime` for position); grid tests pin known UTC fixtures to expected pixel offsets.
- [Overlap algorithm complexity balloons] -> cluster-split only (equal widths within a cluster); no Outlook-style cascading offsets in v1.
- [Categories query returns empty (Graph down)] -> resolver falls back to `#cccccc`; the grid remains fully functional, just uncolored.
- [Uncommitted mobile-requests-tab baseline shifts underneath] -> this change touches `MobileApp.jsx` only at the `'calendar'` case and does not touch `MobileRequests`/`MobileEventDetail`; rebase surface is one line.

## Migration Plan

Frontend-only, additive; no data or API migration. Ship behind nothing — the agenda remains the default view for first-time users (`localStorage` empty). Rollback = revert the commit; `MobileAgenda`'s presentational slimming is the only non-additive edit.

## Open Questions

None — all decision points were resolved with the user during brainstorming (2026-07-28).
