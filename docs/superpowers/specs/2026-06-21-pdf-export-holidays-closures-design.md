# PDF Export — Holidays & Closures

**Date:** 2026-06-21
**Status:** Approved (design), ready for implementation plan
**Visual reference:** `docs/mockups/pdf-markers-mockup.html`

## Problem

The "Search & Export" PDF (`generateCalendarPdf`, reached from the Calendar
"Search & Export" button → `EventSearch` → `EventSearchExport`) is a
date-grouped list/table report of events. The recently added **Holidays &
Closures** (calendar markers) render as ribbons on the on-screen Month/Week/Day
views but are **absent from the PDF**. Users want each marker to appear at the
top of every day it covers in the exported report, including multi-day spans.

## Goal

In the date-sorted PDF, show a marker banner at the top of each day a marker
covers — a holiday on 6/21 prints under the 6/21 date header; a closure spanning
6/24–6/26 prints under 6/24, 6/25, and 6/26 — **even on days with no matching
events**.

## Scope

**In scope**
- `generateCalendarPdf` renders day-level markers (banners + a summary block).
- `EventSearchExport` fetches active markers and passes them to the generator.
- Unit tests for the new generator behavior.

**Out of scope**
- CSV / JSON exports (markers are a PDF-presentation concept; those formats
  stay events-only).
- `AIChat` PDF path (generator stays backward compatible; AIChat can opt in
  later by passing `markers`, but we do not wire it now).
- `CalendarExport.jsx` — dead code (its render JSX is commented out); untouched.
- Any change to the marker data model, endpoints, or admin screen.

## Data model (existing, unchanged)

Active marker documents returned by `GET /calendar-markers`:

```js
{
  _id,
  type: 'holiday' | 'officeClosed',
  name: string,                 // e.g. "Shavuot", "Summer Maintenance Shutdown"
  startDate: 'YYYY-MM-DD',      // date-only, inclusive
  endDate:   'YYYY-MM-DD',      // date-only, inclusive
  color?: string,              // optional per-marker override (CSS color)
  active: boolean
}
```

## Approach

**Keep all PDF concerns inside `generateCalendarPdf`.** Markers are passed in as
a separate, typed input — never merged into the `events` array.

Rejected alternative: synthesizing fake "marker events" and letting the existing
event loop render them. Rejected because the row renderer (sort keys, columns,
zebra striping, row-height math, and the "Total: N events" tally) all assume real
events; fake rows would require special-casing throughout and would corrupt the
event count.

### Generator signature (additive, backward compatible)

```js
export function generateCalendarPdf({
  events,
  sortBy = 'date',
  showMaintenanceTimes = false,
  showSecurityTimes = false,
  timezone = 'America/New_York',
  searchCriteria = {},   // now also reads searchCriteria.dateRange for bounding
  markers = [],          // NEW — active marker docs; [] = today's behavior exactly
})
```

`markers = []` guarantees existing tests and the AIChat caller are unaffected.

### Reuse

- `buildMarkersByDate(markers)` and `getMarkersForDate(map, key)` from
  `src/utils/calendarMarkers.js` — the **same** helpers that drive the on-screen
  ribbons. Multi-day expansion is therefore identical in PDF and UI (one source
  of truth for "which days does this marker cover").
- `getMarkerRibbonColors(marker)` is CSS-oriented (returns `var(--...)`), so it
  is **not** reused for PDF. The generator maps marker type → an RGB triple in
  its own `colors` object (see below).

## Behavior

### Date sort (`sortBy === 'date'`) — the primary case

Replace the current "iterate events, detect date change" loop with a **day-walk**:

1. Build `markersByDate = buildMarkersByDate(markers)`.
2. Bound marker days to the search range:
   `markerDayKeys = [...markersByDate.keys()].filter(k => k >= rangeStart && k <= rangeEnd)`
   where `rangeStart`/`rangeEnd` come from `searchCriteria.dateRange.start/.end`
   (already `YYYY-MM-DD` from the date inputs; string compare == chronological).
   If no range is supplied, fall back to the min/max event day so markers never
   blow up unbounded.
3. Group events by day key: `eventsByDay: Map<'YYYY-MM-DD', event[]>`, key =
   `dayKeyInTz(event.start.dateTime)` (see Timezone below). Events within a day
   keep the existing time sort.
4. `allDayKeys = uniqueSorted([...eventsByDay.keys(), ...markerDayKeys])`.
5. For each `dayKey`:
   - page-break check (add page → redraw header + table header as today);
   - draw the date separator pill (label derived from `dayKey`, see Timezone);
   - draw a banner per `getMarkersForDate(markersByDate, dayKey)` (0+);
   - if the day has events, draw each event row (existing renderer);
   - else draw a quiet `No events scheduled.` line (muted, italic).

Outcome: multi-day markers repeat per day; a day with both a holiday and a
closure shows both banners; marker-only days still print.

#### Regression-sensitive details (must stay identical when no markers)

The day-walk must reproduce today's date-sort output exactly when `markers` is
empty:

- **Zebra striping** currently keys off the global event loop index (`i % 2`).
  Keep a single running event counter across the day-walk so striping is
  unchanged — do **not** reset it per day.
- **Date-pill label** format stays `"{weekday}, {Mon} {D}, {YYYY}"` (e.g.
  `Sat, Jun 21, 2026`). Deriving it from the day key must yield the same string
  the event-derived path produces today.
- **Page-break "(cont'd)"**: when a day's events overflow to a new page, redraw
  the day's separator with the existing `(cont'd)` suffix, as today.
- **DATE column** stays blank in date-sort mode (the date lives in the pill); the
  per-row date is only printed for category/location sort, unchanged.

### Category / Location sort (`sortBy !== 'date'`)

No per-day section exists, so do **not** fabricate day groups. Instead, after the
search-criteria box and before the table header, render one compact summary box:

- Title: `HOLIDAYS & CLOSURES IN THIS RANGE`
- One row per marker (bounded to range): colored dot + name + date or
  `start – end` range.
- Rendered only when `markers` (within range) is non-empty.

Event rows below are unchanged.

### Banner — Style A (tinted bar + left rule)

Per-marker, full content width, drawn under the date pill:

- Light tint fill (rounded rect) in the type's tint color.
- A thin solid left rule in the type's accent color.
- Bold marker `name` in `primary`.
- For multi-day markers, a muted `MMM D – MMM D` span after the name.
- A small uppercase tag at the right edge: `HOLIDAY` or `OFFICE CLOSED`, in the
  type's accent color.
- Page-break aware: if the banner would overflow the page bottom, add a page and
  redraw header + table header before drawing it (no orphaned banners).

### Colors (added to the generator `colors` object)

- Holiday accent: existing `accent` `[180,142,73]` (gold). Tint `[248,243,233]`.
- Office-closed accent: **new** `closed` `[150,52,52]` (palette-tuned muted red).
  Tint `[247,237,237]`.
- A per-marker `color` override is **deferred** (not implemented). The on-screen
  ribbons honor `marker.color`, but PDF parity needs CSS→RGB parsing (hex / named
  / `var(--token)`), so it is a follow-up. PDF banners currently always use the
  type's canonical color (gold / red).

## Key decisions (confirmed)

1. **Markers match by date only.** They carry no category/location/text, so they
   ignore the search term / category / location filters and always print for the
   days they cover within the range (building-wide status, not filtered events).
2. **Day key uses the export timezone**, not the browser's:
   ```js
   const dayKeyInTz = (dateString) =>
     new Intl.DateTimeFormat('en-CA', {
       timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
     }).format(new Date(dateString)); // → 'YYYY-MM-DD'
   ```
   The date-pill label is derived from the day key (UTC parts) so event days and
   marker-only days use identical labeling logic and never drift across the UTC
   boundary.
3. **Banner style A**, **summary block** for non-date sort (both confirmed).
4. **"Total: N events"** continues to count real events only; markers never
   affect the tally.

## Data flow (`EventSearchExport`)  *(as implemented)*

- `EventSearchExport` reads active markers from the shared
  `useCalendarMarkersQuery(apiToken)` hook (cached 5 min, deduped across the app,
  and warm because the Calendar that opens the Search panel already mounts it).
  A fetch failure resolves to `[]`, so the PDF still generates without banners.
  Chosen over a click-time fetch because it reuses the existing shared query
  (same pattern as Calendar / ReservationMarkerAdvisory) with no new fetch code.
- `handleExport()` passes `markers` plus `dateRange` (inside `searchCriteria`) to
  `generateCalendarPdf`.
- JSON/CSV handlers unchanged.

## Edge cases

- No markers, or none in range → output byte-for-byte identical to today.
- Marker fetch fails → PDF generates without banners (logged, non-blocking).
- Multi-day marker partially outside the range → only its in-range days print.
- A marker-only day at a page boundary → page-break logic keeps pill + banner
  together.
- `endDate < startDate` → already skipped by `buildMarkersByDate`.

## Testing (verification-first)

Add to `src/__tests__/unit/utils/calendarPdfGenerator.test.js` (drives the pure
generator via its mocked `doc.text` capture):

- **PDFMK-1**: a single-day holiday draws its name on its day.
- **PDFMK-2**: a multi-day closure repeats on each day in range.
- **PDFMK-3**: a marker-only day (no events) still prints the date + banner +
  "No events scheduled."
- **PDFMK-4**: "Total: N events" excludes markers.
- **PDFMK-5**: `sortBy: 'category'` renders the summary block, not per-day banners.
- **PDFMK-6**: `markers: []` (or omitted) → no marker text drawn (regression guard).
- **PDFMK-7**: multi-day marker is clipped to the search `dateRange`.

Run with: `npm run test:run -- calendarPdfGenerator` (frontend Vitest).

## Files touched

- `src/utils/calendarPdfGenerator.js` — `markers` param, `dayKeyInTz`, day-walk
  for date sort, `drawMarkerBanner`, summary block, `closed` color.
- `src/components/EventSearchExport.jsx` — read markers via
  `useCalendarMarkersQuery`; pass `markers` + `dateRange` into the generator.
- `src/__tests__/unit/utils/calendarPdfGenerator.test.js` — PDFMK-1..7.
- `src/__tests__/unit/components/EventSearchExport.markers.test.jsx` — ESX-MK-1
  (forwards markers + dateRange to the generator).
- `docs/mockups/pdf-markers-mockup.html` — visual reference (already added).
