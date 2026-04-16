## Context

A series master event in `templeEvents__Events` stores three distinct date concepts that the UI currently conflates:

1. **First-occurrence date** — top-level `startDate` / `endDate` (+ `startDateTime` / `endDateTime`), mirrored in `calendarData.*`. Required by Microsoft Graph because the master's `start` in Graph literally IS the first occurrence.
2. **Pattern range** — `calendarData.recurrence.range.startDate` / `endDate`. Defines when the series as a whole runs.
3. **Time of day** — the time portion of the first-occurrence datetime, which propagates to every virtual occurrence.

The "Reservation Start Date" and "Reservation End Date" inputs in `RoomReservationFormBase.jsx` bind to `formData.startDate` / `formData.endDate` — concept #1 — while *labelling* it as if it were concept #2. They are already locked on recurring events via `isRecurringDateLocked`, so users cannot edit them directly; the recurrence modal is the authoritative editor for the range. But when reviewing a master, users see "Start Date: 4/15, End Date: 4/15" and have no at-a-glance way to see the series span.

Meanwhile, clicking an individual occurrence on the calendar and choosing "This Event" currently passes the series master's own first-occurrence date into the form instead of the clicked day's date. And the recurrence tab renders fully editable on that view, which means a user who thinks they're editing one day's staff assignment can silently reshape the entire series' pattern.

The Exception-as-Document architecture work has **landed in the codebase** (contrary to the "in-progress" framing in memory `project_exception_as_document.md`, which is now out of date). Concretely, `backend/utils/exceptionDocumentService.js` exports `resolveSeriesMaster`, `createExceptionDocument`, `updateExceptionDocument`, `findExceptionForDate`, and `_insertOccurrenceDocument` — the last of which already guarantees a clean `seriesMasterEventId` on every newly-written exception. All three occurrence-write endpoints (`PUT /api/admin/events/:id`, `PUT /api/room-reservations/draft/:id`, `POST /api/admin/events/:id/publish-edit`) already call `resolveSeriesMaster` and use these helpers. The DELETE handler at `api-server.js:24200–24391` has an exception/addition branch that cascades properly on `editScope: 'allEvents'` and maintains `recurrence.exclusions` on `editScope: 'thisEvent'`. **This change builds on that landed infrastructure — it does not introduce it.**

This change focuses on the *display* and *input-lock* layer on top of that foundation.

**Stakeholders**: requesters booking rooms, approvers reviewing series, admins editing schedules. All of them currently have to mentally reconcile three date concepts the UI presents as one.

**Constraints**:
- Microsoft Graph requires series master `start` = first occurrence. We cannot change what `startDate`/`startDateTime` store.
- `CLAUDE.md` forbids running the full 523-test backend suite per change; we will scope test runs to affected files.
- Existing `TimezoneContext` and `toLocalISOString()` pattern must be respected — no new `toISOString()` calls that would produce UTC-shifted dates.

## Goals / Non-Goals

**Goals:**
- Series master review shows the **series span** in its read-only date inputs.
- Single-occurrence review ("This Event") shows the **clicked day's date**, honoring any exception document overrides.
- Single-occurrence review shows the recurrence pattern as a **read-only text summary** — editing the pattern requires opening "All Events".
- Occurrence dates are **immutable** on the "This Event" edit flow: UI disabled, backend 400 on API bypass. Time-of-day edits continue to work.
- All new code paths operate in ET without UTC conversions.

**Non-Goals:**
- No schema migration. Top-level `startDate`/`endDate` on masters stay as first-occurrence dates.
- No changes to the recurrence modal's editing UX — only how the tab renders when `readOnly` is active.
- No auto-extending of series ranges when a user expresses "move this occurrence outside the range" — rejected (too implicit).
- No detaching of occurrences into standalone events — rejected (surprising side-effect of a date change).
- No timezone refactor. The codebase stays in its current ET-effective posture.
- No backfill or one-off script. This is purely a read-path display fix (PR 1) plus an input-lock + write-path guard (PR 2).

## Decisions

### Decision 1: Display-layer transform on the master (not schema change)

On a series master, the Reservation Start/End inputs render `recurrence.range.startDate` / `endDate` instead of `formData.startDate` / `endDate`. The form state, save path, and DB fields are unchanged.

**Alternatives considered:**
- **(a) Rewire `formData.startDate` to bind to `recurrence.range.startDate` at transform time.** Rejected — it would force every downstream reader (Graph sync, conflict detection, publish endpoint, exception creation) to also rewire, expanding the blast radius far beyond the UI layer.
- **(b) Rename the DB field to make it "just work".** Rejected — breaks Graph API contract where master `start` = first occurrence; would require a coordinated schema migration for zero real benefit.

**Why display-layer wins**: smallest blast radius, no migration, no coordination with Graph sync code, and the single-source-of-truth principle is preserved (the recurrence tab is still the only editor for `range.*`; the read-only input just *reflects* its value).

### Decision 2: Diagnose the downstream leak, then patch at the first offending layer

Phase-1 codebase exploration established that `Calendar.jsx handleEventClick` / `handleRecurringScopeSelected` (lines 4128–4196) is **already correct** — the "This Event" branch at line 4190 calls `reviewModal.openModal(event, { editScope: 'thisEvent' })` with the clicked virtual occurrence object, and the "All Events" branch fetches / passes the master. Yet the user's bug report (clicking 4/20 shows the master's creation date e.g. 4/16 instead) is real, so the leak must live **downstream** of the click handler.

There are two plausible culprits, and Phase-2 diagnosis must identify which before writing the GREEN fix:

1. **`useReviewModal.jsx` — inconsistent `occurrenceDate` extraction.** Three sites (lines 455, 966, 1214) extract the occurrence date with different fallback patterns:
   - Line 455 (save): `currentItem.start?.dateTime`
   - Line 966 (delete): `currentItem.start?.dateTime`
   - Line 1214 (edit request): `(currentItem?.startDate || currentItem?.start?.dateTime?.split('T')[0])`
   If the *modal form itself* populates `startDate` / `endDate` from a different field than these — and that field reads master-derived data — the form shows the wrong date even though the save path would send the right one.

2. **`src/utils/eventTransformers.js` — `transformEventToFlatStructure` precedence.** A virtual occurrence object may carry both `start.dateTime` (occurrence-specific) and a `calendarData` block that was merged in from the master. If `transformEventToFlatStructure` prefers `calendarData.startDate` (master's first-occurrence) over `start.dateTime` (clicked day), the form displays the master's date despite receiving a correctly-shaped occurrence.

**Diagnosis approach:** Phase 2 must add logging or a targeted test that captures the `event` object *as it arrives at the review modal* for a clicked occurrence, then traces which field drives the rendered `startDate` / `endDate`. The fix location follows from the diagnosis, not the reverse.

**Alternatives considered:**
- **Assume it's the click handler and "fix" Calendar.jsx.** Rejected — the exploration already proved the click handler passes the right object. Blindly adding another layer of date-setting there would mask the real bug and create a conflict path.
- **Rewrite `transformEventToFlatStructure` preemptively for occurrence-vs-master awareness.** Rejected — the transformer is deliberately dumb (takes whatever fields exist, prefers flat). If it's the offender, the fix is a precedence reorder; if it's not, touching it would be wasted diff.

### Decision 2b: Normalize `occurrenceDate` extraction regardless of diagnosis

Independent of where the display leak lives, the three inconsistent `occurrenceDate` extraction sites in `useReviewModal.jsx` (lines 455, 966, 1214) should be unified into a single helper — either co-located in the hook or exported from `eventTransformers.js`. This removes a foot-gun where the three save/delete/edit-request paths could diverge further over time. Small scope, low risk, immediately verifiable via a shared unit test.

### Decision 3: Recurrence tab read-only mode is a `readOnly` prop, not a new component

The recurrence tab component gains a boolean `readOnly` prop (or derives it from `eventType === 'occurrence'` / `editScope === 'thisEvent'`). When true, the editor is replaced with a single rendered paragraph from the new `formatRecurrenceSummary(recurrence)` helper.

**Alternatives considered:**
- **New `RecurrenceTabSummary` component.** Rejected as over-abstraction — the readOnly content is a single `<p>` element. Splitting it into a component adds file bloat and a cross-file render path for no reuse benefit.

### Decision 4: `formatRecurrenceSummary` is a pure utility in a new file

`src/utils/recurrenceFormatters.js` exports a single `formatRecurrenceSummary(recurrence)` function. Pure, synchronous, no React dependency. Fully unit-testable with Vitest.

**Format rules:**
- Pattern: `Daily`, `Weekly on Wednesdays`, `Every 2 weeks on Mondays and Wednesdays`, `Monthly on day 15`, `Yearly on April 15`.
- Range: appended as `, 4/15/2026 – 4/30/2026` (endDate type), `, 4/15/2026, 4 occurrences` (numbered type), `, starting 4/15/2026` (noEnd type).
- Additions/exclusions: if either array is non-empty, append ` (+N added, M excluded)`.
- Uses EN-DASH (`–`, U+2013) per memory `feedback_warnings_left_side` and existing formatting style.
- All date formatting uses `toLocaleDateString('en-US')` with no timezone option — defers to the browser's ET behavior.

### Decision 5: Occurrence date immutability — UI disabled + server-side guard at three endpoints

Both layers are required:
- **UI**: `disabled` (not just `readOnly`) on `startDate` / `endDate` inputs when viewing an occurrence. Helper text explains the alternative action.
- **Server**: date-immutability validation applied at **all three** endpoints that actually write occurrence/exception documents:
  - `PUT /api/admin/events/:id` — thisEvent block at `backend/api-server.js:22795`
  - `PUT /api/room-reservations/draft/:id` — thisEvent block at `backend/api-server.js:14399`
  - `POST /api/admin/events/:id/publish-edit` — thisEvent block at `backend/api-server.js:21309`

  Each block already calls `resolveSeriesMaster` and then `createExceptionDocument` / `updateExceptionDocument`. The validation slots in between those two steps: if the request body's `startDate` / `endDate` (or equivalent computed fields) differs from the block's `occurrenceDate` parameter, return `400 { code: 'DATE_IMMUTABLE', message: ... }` and abort the write.

**Shared helper.** To keep the three sites consistent and DRY, a new export colocated in `backend/utils/exceptionDocumentService.js` with `resolveSeriesMaster`: `validateOccurrenceDateNotChanged(incomingBody, occurrenceDate)`. On a mismatch it throws `{ statusCode: 400, code: 'DATE_IMMUTABLE', message: <explanation> }` — the same thrown-error shape `resolveSeriesMaster` uses — so call sites can catch once and return the 400 uniformly. Colocating with `resolveSeriesMaster` makes the call sequence trivially readable: *resolve master → validate date → write exception*.

**Anchor choice — compare incoming body against `occurrenceDate` (not the persisted exception).** The request body always carries `occurrenceDate` as the source of truth for which slot is being edited (required by each thisEvent-block condition and supplied by `Calendar.jsx:4190`). Comparing the body's `startDate` / `endDate` to `occurrenceDate` works uniformly for (a) creating a new exception — where no persisted doc exists to compare against — and (b) updating an existing exception — where the persisted date will equal `occurrenceDate` on any well-formed doc. Same-value re-sends (body's `startDate === occurrenceDate`) are a no-op and pass.

**Why NOT `PUT /api/room-reservations/:id/edit`.** That endpoint exists at `backend/api-server.js:16304` but is **master-only** — no `editScope` parameter parsing, no occurrence routing, no exception-document writes. It operates on masters and singleInstance events exclusively (status guard at line 16341 restricts to `pending` / `rejected`). Adding DATE_IMMUTABLE there would attach a guard that no occurrence edit path can reach; it is intentionally out of scope for this change. A separate defensive guard (reject when an exception's `_id` is passed) is tracked as a follow-up in Open Questions — it's a different defensive concern from DATE_IMMUTABLE and should not be bundled.

**Why NOT collapse the three paths into one shared endpoint.** Each write path has meaningfully different surrounding logic: admin PUT carries permission gates and Graph choreography; draft PUT runs a lighter state transition without Graph sync; publish-edit runs inside the approval workflow with its own audit and status transitions. Refactoring them into a single unified occurrence-edit endpoint would be substantially risky and separate scope. Applying the same shared helper at three sites is cheap, additive, and preserves each path's invariants.

**Why both UI and server layers**: the UI guard is for UX; the server guard is for correctness. An API-only client (Postman, a misbehaving frontend build, an integration script) must not be able to silently mutate occurrence dates.

**Alternatives considered:**
- **UI `min`/`max` constraining the date picker to the series range.** Rejected — user explicitly asked for the simpler "no date changes at all" model. min/max would invite users to try and complicate the code.
- **Server-side silent-ignore of date fields on occurrences.** Rejected — silent data loss is worse than a loud 400. A client attempting a date change should be told clearly that it's not supported.
- **Compare incoming body against the existing persisted exception (anchor = existing doc).** Rejected — fails for the create-new-exception case where no persisted doc exists. The `occurrenceDate` anchor covers create and update uniformly.
- **Compare against both `occurrenceDate` AND the persisted doc (defensive double-check).** Rejected — no additional correctness, since both values must agree on any well-formed exception. If they ever disagree, we have a data-integrity bug deserving its own investigation, not a silent acceptance.

### Decision 6: Time-of-day edits remain allowed on occurrences

A user may need to shift a single occurrence's start/end time (e.g., the 4/22 class runs 10am instead of 9am). `startTime` and `endTime` fields stay editable. The server-side immutability check targets only `startDate` and `endDate` — the *day* — not the full datetime.

### Decision 7: Ship as two PRs (ABC, then D)

- **PR 1 (ABC)**: display transforms + occurrence-date resolution fix + read-only recurrence summary. Pure frontend, no backend risk.
- **PR 2 (D)**: UI disable + backend `DATE_IMMUTABLE` validation. Frontend + backend, gated behind a clear spec.

**Why split**: PR 1 is reviewable in isolation as a display-bug fix. PR 2 introduces a write-path constraint that warrants independent review and backend test coverage. If we combined them, any reviewer concern about the immutability contract would block the otherwise-safe display fix.

## Risks / Trade-offs

- **[Risk] Recurrence range missing on an old master** (e.g., legacy data with no `recurrence.range`) → **Mitigation**: display-transform falls back to `formData.startDate` / `endDate` when `recurrence.range.startDate` or `endDate` is nullish. Regression guard test covers this fallback.
- **[Risk] Exception document for a clicked occurrence not yet loaded** (async fetch in progress when click fires) → **Mitigation**: the click handler either awaits the override lookup or passes the raw virtual occurrence's date as a provisional value; if an override is later resolved, the modal updates. Edge case to verify during Phase 2 exploration — spec test `B2` asserts the final resolved state.
- **[Risk] Server-side guard rejects legitimate client edits that happen to re-send the same-day date** → **Mitigation**: the guard compares *values*, not *presence*. Sending `startDate: "2026-04-20"` on an already-4/20 occurrence is a no-op diff and passes.
- **[Risk] Existing client code may send `startDate` / `endDate` in the thisEvent payload with values that differ from `occurrenceDate`, which would newly trip DATE_IMMUTABLE once the guard lands.** The three thisEvent-writing endpoints currently accept payloads that could include any combination of `startDate` / `endDate` / `startTime` / `endTime` / `startDateTime` / `endDateTime`. If any frontend (or test harness) currently sends a `startDate` that doesn't match `occurrenceDate`, that payload will 400 after the guard is added — a behavioral change disguised as a validation fix. **Mitigation**: Phase-2 verification must grep for all frontend call sites that PUT/POST to the three occurrence-write endpoints with `editScope: 'thisEvent'` and confirm their payload construction sets `startDate === occurrenceDate` (equivalently for `endDate`). If a site sends divergent values, fix the client first, or expand the helper to treat `occurrenceDate` as the authoritative anchor and overwrite the body's date fields server-side rather than 400. The grep is already scoped in `tasks.md` Section 8.
- **[Risk] A user interprets the read-only range on the master as editable and is confused when clicks do nothing** → **Mitigation**: keep the `disabled` styling and add a tooltip/helper-text pointing them to the recurrence tab for edits. Already the established pattern (`isRecurringDateLocked`).
- **[Trade-off] The master's displayed range can temporarily drift from its `formData.startDate` when the user edits the recurrence range via the modal but hasn't saved.** This is acceptable — the read-only input simply reflects the in-memory `recurrence.range` while the form is dirty. On save, the backend recomputes and persists consistently.
- **[Trade-off] The recurrence tab summary is English-only.** The codebase has no i18n layer today, so this matches existing conventions. If i18n is added later, the formatter is a single function to localize.

## Migration Plan

No data migration. Deployment sequence:

1. **Merge PR 1 (ABC)** — display-only change. Roll out on any cadence; no coordination required. Rollback is a plain git revert.
2. **Merge PR 2 (D)** — introduces server-side `DATE_IMMUTABLE` validation at the three occurrence-write endpoints (`PUT /api/admin/events/:id`, `PUT /api/room-reservations/draft/:id`, `POST /api/admin/events/:id/publish-edit`). Pre-flight: per the risk above, grep frontend call sites that target these three endpoints with `editScope: 'thisEvent'` and verify their payload's `startDate` / `endDate` match `occurrenceDate` (fix any that don't before this PR merges). Rollback is a plain git revert; no data written during D can be in an unrollbackable state — the guard rejects before any write.

## Open Questions

- **Recurrence tab location**: the recurrence editor is referenced in the proposal as "the recurrence tab component (location TBD during Phase 2 verification)". Phase 2 of implementation must `grep` for the tab container and confirm whether `readOnly` is threaded through an existing prop chain or needs a new one. If the tab lives inside a tabbed shell that already has a `readOnly` concept (e.g., for view-only approvers), we should reuse that flag rather than adding a parallel one.
- **Helper text wording for occurrence-date-lock**: proposed text is *"To move this event to a different day, click on the target date or edit the series schedule."* Final copy reviewed during PR 2 implementation; not blocking.
- **"All times Eastern" footer hint**: marked optional in proposal. Decide at PR-1 review time whether to include or defer.
