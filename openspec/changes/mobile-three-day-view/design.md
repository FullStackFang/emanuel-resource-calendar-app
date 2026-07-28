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

- 28px hour gutter; compact hour labels (`7a`, `12p`, `12a`) 10px `--text-tertiary` medium, right-aligned, centred on their hour line. Day columns `flex: 1`, `--border-subtle` left borders, hairline per hour. (Was 44px, sized to fit "10:00 AM" — see Decision 7.)
- Sticky day-header row: 10px uppercase day letter + 28px number circle (today = `--color-primary-600` fill + inverse text). Today's column tinted `--color-primary-50`.
- Current-time indicator on today only: 1px `--color-error-500` line, 7px dot at the left edge, updated on a 1-minute interval.
- 8px top inset so the first hour label is not clipped. Scrollbars hidden (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) so columns stay aligned with the sticky header.
- Event blocks: absolutely positioned by local start/end minutes. These are parsed out of the `startDateTime` **string** via `appTimeUtils.parseTimeFromString`, never `new Date()` — stored datetimes are naive local-time strings, so constructing a `Date` reinterprets them in the browser's timezone and slides every block by the offset. This is the same parse `MobileEventCard` uses, which is what keeps a block's position and its time from disagreeing. Styling and text content are Decision 7. Pending at 0.9 opacity (drafts never reach mobile — pipeline filters them, so the mockup's 0.8 draft rule is moot). Minimum block height 20px for tappability. Tap opens the shared detail sheet.
- Overlapping events split their column width side-by-side within the overlap cluster (desktop day-view idiom).
- All-day events (mockup is silent; they exist in real data): a thin chip row pinned under the sticky day headers, same outline-over-wash idiom, tappable.

### 5. Category colors via shared util fed by the existing query

New `src/utils/categoryColors.js` extracts `Calendar.jsx`'s inline `getCategoryColor` — **all three of its branches**, which is the correction made on 2026-07-28 after the mobile grid shipped rendering every event gray. The resolver is registered-preset -> gray-if-uncategorized -> **stable hashed color** for everything else, plus the hash palette from `getDynamicCategoryColor`. Only the first branch was extracted originally; collapsing the other two into `#cccccc` made every block gray, because most real event categories are not registered Outlook categories and the master list is empty outright whenever Graph is down. Desktop never showed the symptom precisely because it hashes. The hash and its 15-color palette are duplicated verbatim so the two surfaces assign the same color to the same category name; a parity test pins this. `MobileCalendarTab` feeds it from the already-cached `useOutlookCategoriesQuery(apiToken, APP_CONFIG.DEFAULT_DISPLAY_CALENDAR)` (30-min staleTime, graceful `[]` fallback — everything renders gray if Graph is down). `Calendar.jsx` keeps its inline copy for now (surgical-change rule); consolidation is a follow-up.

### 6. Interaction details

- Switcher: `--bg-tertiary` track, active pill `--bg-primary` + `--color-primary-600` + `--shadow-xs`, `--text-xs` medium labels, `white-space: nowrap`, right-aligned on its own row beneath the week strip (never beside the month label — that caret opens `MobileDatePicker`). Targets >= 44px; press state `--bg-tertiary`; no hover states; no emoji; no colors outside tokens except the Outlook category hexes.
- Empty grid space does nothing in v1. Pull-to-refresh stays agenda-only (the gesture fights vertical panning in a grid).

### 7. Block density: colour rail + height-adaptive text (revised 2026-07-28)

The first implementation printed a 9px start time above a 10px title inside every block. At phone
width that fails on the most common block in real data: a 30-minute event is 26px tall, which is
22px of content after border and padding, and time (~11px) + title (~12px) does not fit. The line
that survived was the time — so half-hour events told you *when* and not *what*, while the grid's
Y axis was already saying when. Reviewed against rendered mockups at 370px; user chose the
combined option.

- **No time text on blocks.** The Y position is the time. The start time moves into the block's
  `aria-label` only, where it becomes load-bearing rather than decorative: with the visual time
  gone, that label is the sole source of the time for assistive technology.
- **Colour rail instead of outline.** `border-left: 3px solid <category>`, no other border, wash
  down from `color + '21'` (13%) to `color + '14'` (8%). The rail carries identification, so the
  fill no longer has to, and the lighter wash stops adjacent blocks muddying together. Title goes
  semibold to hold against the lighter background.
- **Three density tiers by rendered height** — `short` <34px: one clamped line of title at 9.5px;
  `med` 34-49px: two clamped lines at 10px; `tall` >=50px: two lines plus the location at 9px.
  Tier is computed in `layoutDayEvents` beside `top`/`height`, so it is a pure function of geometry
  and unit-testable; the component only maps tier to a class.
- **`-webkit-line-clamp`, not bare `overflow: hidden`.** Both truncate, but clamp ends on an
  ellipsis at a line boundary. Raw overflow slices a glyph in half and reads as a rendering bug —
  this was the visible failure of the "just fit as much as possible" alternative.
- **Gutter 44px -> 28px** with compact labels (`7a`, `12p`). 44px existed only to fit the string
  "10:00 AM" — 13% of the phone's width spent on labels read once. The 16px returns ~5px to every
  column, roughly one extra character per line on every block simultaneously. The `all-day` text
  label in the gutter spacer is dropped: it cannot render legibly at 28px, and a chip row pinned
  under the day headers does not need naming.
- All-day chips take the same rail treatment so the two rows read as one system.

Rejected: shrinking the type alone (buys characters, not lines — the 30-minute block still cannot
fit two lines); raising the hour height above 52px (helps short blocks but lengthens the scroll for
everyone); dropping to a 2-day window (the 3-day window was an explicit user decision).

Unchanged by this revision: 52px hour height, 20px minimum block height, the overlap cluster
algorithm, the current-time indicator, and the entire agenda view.

## Risks / Trade-offs

- [Restructure regresses agenda behavior] -> hook extraction is verbatim (no logic edits); dedicated behavior-parity tests; existing mobile suites (64 passing baseline) must stay green.
- [Timezone drift between block position and day grouping] -> both derive from the same flat-structure fields already used by the agenda (`startDate` for grouping, `startDateTime` for position); grid tests pin known UTC fixtures to expected pixel offsets.
- [Overlap algorithm complexity balloons] -> cluster-split only (equal widths within a cluster); no Outlook-style cascading offsets in v1.
- [Removing the visible time regresses accessibility] -> the start time stays in each block's `aria-label`, and a scenario asserts it; the aria-label is now the only source of the time, so it must not be weakened later.
- [Colour rail is the sole category signal on short blocks] -> the wash keeps a second, weaker cue, and every block still opens the detail sheet on tap; unknown categories resolve to gray rather than vanishing.
- [Categories query returns empty (Graph down)] -> resolver hashes unregistered names to a stable color, so the grid stays fully colored. (Originally specified as "falls back to `#cccccc`, just uncolored" — that was wrong: it is the *normal* case, not a rare one, and it renders every event identically.)
- [Uncommitted mobile-requests-tab baseline shifts underneath] -> this change touches `MobileApp.jsx` only at the `'calendar'` case and does not touch `MobileRequests`/`MobileEventDetail`; rebase surface is one line.

## Migration Plan

Frontend-only, additive; no data or API migration. Ship behind nothing — the agenda remains the default view for first-time users (`localStorage` empty). Rollback = revert the commit; `MobileAgenda`'s presentational slimming is the only non-additive edit.

## Open Questions

None — all decision points were resolved with the user during brainstorming (2026-07-28).
