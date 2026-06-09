## Context

The app stores all events in `templeEvents__Events`, queried by date-range overlap and pushed to Microsoft 365 via app-only Graph auth (`graphApiService.js` + `graphEventBuilder.js`). The Month view already tints whole day cells for "today" via an `isToday()` → `.current-day` class, and the design system (`src/styles/design-tokens.css`) carries an accent-gold palette ("Temple Heritage") and an error-red palette that are both visually distinct from the primary blue used by "today". Holidays and office closures are day-level facts that affect the calendar as a whole; they are not bookable events and have no requester, approver, or conflict workflow. This change adds them as a separate concept. Requirements are in `specs/`; motivation is in `proposal.md`.

## Goals / Non-Goals

**Goals:**
- Let admins mark days (single or multi-day) as Holiday or Office Closed.
- Surface markers in Month/Week/Day views as a light transparent-wash ribbon, and optionally as a soft booking advisory.
- Mirror markers to the shared Outlook calendar as all-day events so Outlook viewers see them too.
- Keep markers fully isolated from the event domain (no leakage into queues, counts, search, conflicts, export).

**Non-Goals:**
- No hard reservation blocking (advisory only).
- No recurrence rules and no bulk/Hebcal import in this change.
- No per-marker choice of Outlook calendar (always the main TempleEvents calendar).
- No all-day band in Week/Day views (label rides the day-column header).

## Decisions

**1. Dedicated `templeEvents__CalendarMarkers` collection (vs. a new `eventType`, vs. SystemSettings).**
A separate collection means markers are automatically absent from every event query — no `$nin` filter has to be added to the approval queue, counts, search, conflict detection, or export. A new `eventType` would require hunting down ~a dozen filters (the codebase already does this for `exception`/`addition` children) and would risk leaks. SystemSettings is for singleton config, not a date-indexed, growing set. Managed with the same cached CRUD pattern as `templeEvents__Categories`.

**2. Soft, non-blocking advisory (vs. hard 409 block).**
Chosen by the product owner. `warnOnReservation` surfaces a dismissible banner in booking forms; `checkRoomConflicts()` is untouched and no new 409 path exists. This makes the "blocking" feature read-side only: the marker read API feeds both the calendar and the booking forms. The field is named `warnOnReservation` (not `blocksReservation`) so the non-blocking semantics are explicit in the schema.

**3. Visual: top transparent-wash ribbon (Option C, "V4" weight).**
Selected from rendered HTML mockups. The ribbon is the first flex child of `.day-cell` (already `flex-direction: column`), so it pushes the date/events down with no absolute positioning. Holiday = `accent-500` at ~16% opacity, Office Closed = `error-500` at ~13%, both with `-700` text (white text fails contrast on a pale wash; `-700`-on-wash clears WCAG AA). The same element is reused in the Week/Day day-column header.

**4. Synchronous marker → Graph sync (vs. batch job); `pushToOutlook` drives the Graph lifecycle, `active` is soft-delete only.**
Marker create/update/delete drives an immediate Graph create/patch/delete and stores `graphData.id` back, mirroring the publish flow (`PUT /api/admin/events/:id/publish`). To dodge the Cosmos trap where `$set: { 'graphData.id': x }` silently no-ops through a null parent, every marker is inserted with `graphData: null`, and the first push writes the whole `graphData` object with a single full-object `$set` (exactly as the publish endpoint does for events).

`pushToOutlook` — not `active` — is the staging control. A marker created with `pushToOutlook: false` is visible in the app but absent from Outlook; flipping it to `true` later performs the Graph create. `active` means only "not soft-deleted": the DELETE endpoint sets it `false`, and a soft-deleted marker is terminal (this change has no marker-restore path, so there is no draft-vs-reopened ambiguity). `active` is never overloaded for staging. The Graph action for every write is enumerated in the matrix below so the create/update/delete handlers cannot each invent their own rule.

**Marker → Graph state matrix** (the Graph action taken on each write; `graphData.id present?` = was the marker previously pushed):

| Operation | `pushToOutlook` | `graphData.id` present? | Graph action |
|---|---|---|---|
| Create | `true` | — | create event, store `graphData` via full-object `$set` |
| Create | `false` | — | none (staged) |
| Update | `true` | no | create event, store `graphData` (stage → activate) |
| Update | `true` | yes | patch event |
| Update | `false` | yes | delete event, clear `graphData` |
| Update | `false` | no | none |
| Delete (soft, `active:false`) | any | yes | delete event, clear `graphData` |
| Delete (soft, `active:false`) | any | no | none |

Every Graph action is failure-isolated (Decision in Risks): the marker write persists regardless, and a failed delete leaves `graphData.id` in place as a "needs cleanup" signal reconciled on the next edit.

**5. All-day Graph semantics: exclusive midnight end via UTC date math.**
Graph all-day events require `isAllDay: true`, `start` at midnight of the start date, and `end` at midnight of the day *after* the last day (exclusive). The +1 day is computed with UTC/string date arithmetic, never local `Date` math, so DST transitions cannot shift the boundary and re-trip Graph's "end must be midnight" validation.

**6. Manual dated entries (vs. recurrence rules).**
This is a synagogue; most holidays follow the Hebrew calendar and shift on the Gregorian calendar every year, so annual Gregorian recurrence would be wrong. Markers are explicit dated entries. Bulk/Hebcal import is deferred.

**7. Date-only `YYYY-MM-DD` string storage.**
Markers are date-only, so storing zero-padded ISO date strings makes lexical comparison equal date comparison: the overlap query is `startDate <= windowEnd && endDate >= windowStart && active`, with an index on `{ startDate, endDate, active }`. This avoids timezone drift inherent in the event collection's local-time datetime strings.

**8. New `buildGraphMarkerEventData(marker)` builder (vs. extending `buildGraphEventDataFromRecord`).**
The existing `buildGraphEventDataFromRecord()` in `utils/graphEventBuilder.js` reads `event.calendarData` (titles, datetimes, locations) and always emits a *timed* `start`/`end` with a `timeZone`. Markers are flat (`startDate`, `endDate`, `name`, `note`, `type`) and all-day — they share none of that input shape. Rather than branch that function on document type (which would corrupt its single-purpose republish/recovery contract and risk emitting an empty payload from a missing `calendarData`), marker sync uses a new, separately exported `buildGraphMarkerEventData(marker)` in the same file. It emits `isAllDay: true` with bare `YYYY-MM-DD` `start.dateTime`/`end.dateTime` and **no `timeZone`** (Graph rejects all-day events that carry one), `showAs` derived from `type`, and subject/body from `name`/`note`. The event builder is left untouched.

**9. No optimistic concurrency control on markers (vs. `conditionalUpdate`).**
Every *event* write uses `conditionalUpdate()` with `_version` because requesters, approvers, and admins race on the same documents. Markers have none of that surface area: they are admin-only config with no requester/approver workflow and negligible concurrent-writer risk — the same profile as `templeEvents__Categories`, which also writes without OCC. Markers therefore omit `_version`/`expectedVersion`/409 handling **deliberately**. This is the documented exception to the "every write endpoint uses OCC" rule in CLAUDE.md; recording it here so it is not re-flagged as a pattern violation during code review.

## Risks / Trade-offs

- **Graph exclusive-end / DST off-by-one** → compute the +1 day in UTC; cover single-day and multi-day cases with Jest tests asserting the exact `end` date.
- **Cosmos DB rate limits / cold reads on the marker query** → markers are few; cache them like Categories with manual invalidation on write, and share one fetch across all three calendar views.
- **Long multi-day ribbons look repetitive** → acceptable for v1 (each cell stays self-explanatory); a "continuation" style can be added later without schema change.
- **Extra client query for markers** → small, cached payload; keyed into a `markersByDate` map once and reused by Month/Week/Day and the booking forms.
- **Graph sync failure mid-write** → isolate: persist the marker, log/surface the Graph error, and reconcile on the next edit (matches the app's existing graceful-degradation on delete).

## Migration Plan

Additive only. The new collection and its index are created during DB connection setup; no existing data is migrated, and the events collection schema is unchanged. Rollback is removing the new routes/UI and (optionally) the collection — existing events and Graph sync are unaffected throughout. Outlook events created for markers can be cleaned up by deleting their markers (which propagates the Graph delete).

## Open Questions

- Should approvers (not just admins) be allowed to manage markers? Currently admin-only; trivially widened later by relaxing the role gate.
- Exact wash opacity is locked at 16% (holiday) / 13% (closed) from the mockup; final values can be nudged during frontend polish without spec impact.
