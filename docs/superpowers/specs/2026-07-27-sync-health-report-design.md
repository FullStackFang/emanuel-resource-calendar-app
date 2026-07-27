# Sync Health Report — Design

**Date:** 2026-07-27
**Status:** Approved

## Problem

The app treats MongoDB (`templeEvents__Events`) as the source of truth and mirrors
published events into Outlook via Graph. Sync defects are silent: the recent
`recurrence.additions` bug left 43 added dates rendering in the app while Outlook
had never heard of them, and nothing surfaced the gap. Admins and Approvers need a
fast, self-serve sanity check that compares what the app believes is published
against what Outlook actually shows, and names the specific discrepancies.

## Solution Overview

An on-demand **Sync Health** report:

- New admin endpoint `GET /api/admin/reports/sync-health?startDate&endDate`
  performs a per-event existence diff between the app's expected published
  instances and Outlook's `calendarView` for the window.
- New admin page at `/admin/sync-health` (visible to Admins and Approvers) with a
  Run Check button and per-calendar result cards.
- Default window: today−30 days to today+180 days. No stored reports, no cron,
  no field-level comparison in v1.

Ground truth on the Outlook side is Graph's `calendarView`, which expands
recurring series into concrete dated instances server-side — so both sides of
the diff are flat lists of dated instances, and pattern-level drift shows up as
date-level differences. Matching is by Graph ID (plus date for series
occurrences), never by title/time, so renames and time edits cannot cause false
positives.

## Backend

### Endpoint

`GET /api/admin/reports/sync-health?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

- **Auth:** JWT-protected; allowed when `isAdmin(user, email)` OR
  `canApproveReservations(user, email)`. Otherwise 403.
- **Defaults:** `startDate` = today−30d, `endDate` = today+180d.
- **Validation:** 400 if the window exceeds 400 days or `endDate < startDate`.

### Data gathering

1. Query `templeEvents__Events` for events overlapping the window
   (`startDateTime < windowEnd && endDateTime > windowStart`, plus series
   masters whose `recurrence.range` overlaps the window) with
   `status: 'published'`. Include deleted tracked events only for the
   failed-deletion check (see finding types). Group by distinct
   `(calendarOwner, calendarId)` — that set defines the calendars the app
   manages.
2. Per calendar, one `graphApiService.getCalendarEvents(owner, calendarId,
   windowStart, windowEnd, { select: 'id,subject,start,end,type,seriesMasterId,isCancelled' })`
   call. The util already paginates via `@odata.nextLink`.
3. Build the app-side expected instance list:
   - `singleInstance` docs → one instance each; linkage = `graphData.id`.
   - `seriesMaster` docs → expand with the existing
     `expandAllOccurrences()` from `backend/utils/recurrenceExpansion.js`
     (honors `additions` and `exclusions`), filtered to the window.
   - `exception`/`addition` child docs overlaid by `occurrenceDate`; their
     linkage is `graphEventId`.

### Diff module

`backend/utils/syncHealthDiff.js` — pure functions only, no I/O. Takes the
app-side documents and the Outlook instance list for one calendar; returns the
findings object. All matching logic lives here so it is unit-testable without
Mongo or Graph.

**Outlook index:** instances keyed two ways — by event `id`, and by
`(seriesMasterId, localDate)` for occurrences/exceptions of a series.

**Matching rules:**

| App-side item | Match condition in Outlook |
|---|---|
| Single instance | its `graphData.id` exists in the window's instance set |
| Series pattern date | an instance with `seriesMasterId === master.graphData.id` on the same local date |
| Added date (child doc) | the child's `graphEventId` exists (standalone event) |
| Exception child | match by `(master graph id, date)` first; fall back to `graphEventId` if standalone |

Dates are compared as local dates in the calendar's timezone
(`America/New_York`), never UTC. The diff module normalizes each Outlook
instance's start time to Eastern before extracting its date key (kept inside
the pure diff layer so it is unit-testable; no reliance on the
`Prefer: outlook.timezone` request header).

**Finding types (per calendar):**

1. `missingFromOutlook` (critical) — app expects a published instance; Outlook
   has no match. Catches the `additions` bug class, failed publishes, failed
   pattern patches.
2. `untethered` (critical) — published app event with no stored Graph ID
   (`graphData.id` / `graphEventId` absent).
3. `shouldNotBeInOutlook` (critical) — an Outlook instance of a *tracked*
   series on an excluded date, or a tracked event that is deleted in-app
   (`isDeleted: true` with a stored Graph ID) but still present in Outlook.
   Failed-deletion detector.
4. `untracked` (informational) — Outlook events consumed by no match and
   unknown to the app (e.g. created directly in Outlook). Rendered collapsed.

`isCancelled: true` Outlook instances are treated as absent.

**Counts per calendar:** `appExpected`, `outlookFound`, `matched`.

### Response shape

```json
{
  "window": { "start": "2026-06-27", "end": "2027-01-23" },
  "calendars": [
    {
      "calendarOwner": "templeevents@emanuelnyc.org",
      "calendarId": null,
      "error": null,
      "counts": { "appExpected": 142, "outlookFound": 139, "matched": 138 },
      "missingFromOutlook": [
        { "mongoId": "...", "eventTitle": "...", "date": "2026-08-14", "eventType": "addition", "reason": "no Outlook event for added date" }
      ],
      "untethered": [ { "mongoId": "...", "eventTitle": "...", "eventType": "seriesMaster" } ],
      "shouldNotBeInOutlook": [ { "graphId": "...", "subject": "...", "date": "2026-09-02", "reason": "excluded date still present" } ],
      "untracked": [ { "graphId": "...", "subject": "...", "date": "2026-08-01" } ]
    }
  ]
}
```

### Error handling & performance

- Graph calls wrapped in `retryWithBackoff` with the same retryable-error policy
  as `backfill-addition-graph-events.js` (429, 503, ETIMEDOUT, ECONNRESET).
- Per-calendar try/catch: one calendar's Graph failure sets that entry's
  `error` field; other calendars still return results (partial success is a
  200).
- Expected cost: 1–3 calendarView pages per calendar for the 7-month default
  window; interactive wall time of a few seconds. No caching or persistence.

## Frontend

- **Route:** `/admin/sync-health`, route-guarded (Admin or Approver), nav link
  in the Admin dropdown.
- **Page:** date range inputs prefilled with the default window + **Run Check**
  button. On-demand query following the `EventSearch` pattern: idle state is a
  "run the check" prompt (NOT a spinner); results pane gates on
  `isSearching || isFetching` per the `deriveListLoadingState` convention with
  `enabled` driven by the button click.
- **Results:** one card per calendar —
  - counts header; an all-green banner when every section is empty
    ("App and Outlook agree: N instances matched").
  - red sections for `missingFromOutlook`, `untethered`,
    `shouldNotBeInOutlook` listing event title, date, and reason as readable
    rows.
  - collapsed "In Outlook only" section for `untracked`.
  - an errored calendar renders as an error card with the message.
- **Feedback:** `showError` toast on request failure. Run Check is a plain
  action (no in-button confirmation — it is non-destructive and read-only).

## Testing

- **Unit (Jest):** `backend/__tests__/unit/syncHealthDiff.test.js` — the core.
  Cases: clean match; missing added date (regression for the shipped
  `recurrence.additions` bug); untethered master; excluded date still present
  in Outlook; deleted single still present in Outlook; untracked Outlook event;
  cancelled Outlook instance treated as absent; timezone edge (instance near
  midnight Eastern must not shift date keys).
- **Integration (Jest):** endpoint test with `graphApiMock` + `eventFactory` —
  permission gate (requester 403, approver 200, admin 200); happy path with a
  seeded discrepancy; one-calendar-Graph-failure returns partial results.
- **Frontend (Vitest):** idle prompt renders before first run; results render
  from a mocked response; error card renders for an errored calendar.

## Out of Scope (v1)

- Scheduled/weekly email delivery (can be layered on later by calling the same
  diff service from a cron and emailing via `emailService`).
- Field-level comparison (title/time/location drift on matched pairs).
- Stored report history.
- Any remediation actions from the report page (fix-up remains via scripts).
