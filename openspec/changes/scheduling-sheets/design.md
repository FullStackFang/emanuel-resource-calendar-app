# Design: Scheduling Sheets

## Context

Holiday staffing lives on a printed Excel grid: events as columns, a metadata band (Location / Call Time / Doors Open / Begins / Ends), role rows below, names in cells. The user's governing framing, arrived at through mockup iteration (final mockup: scratchpad `assignment-days-mockup.html`, session 2026-09-02): **this is a scheduling artifact builder, not a calendar feature** — "super interactive and non prohibitive; give the admins and power users the ability to create whatever." A pre-implementation architecture review (2026-09-02) verified the reusable precedents (Calendar Markers gate/isolation, email registry, picker UX) and flagged corrections that are baked in below.

The UI model, user-approved after four mockup revisions:
- One landing surface: the **workbook**. A prominent Scheduling Sheet picker ("2026 High Holy Days ▾") top-left; **day tabs** (dates, not occasion names) styled on the app's pill-tab idiom; "+" tab adds a day.
- Inside a day: sheet title carries the ceremony name; columns are events/posts; five starter rows seed the metadata band; role rows below; everything renameable/deletable/addable; free text anywhere; `@` person chips, `#` location chips, cell notes.

## Goals / Non-Goals

**Goals:**
- Replace the Excel artifact: build, print, and email holiday staffing grids in-app.
- Freeform editing with structured chips layered on top (never required).
- Derived per-person surfaces: My Assignments view + one schedule email per person.
- Full isolation from the event/reservation workflow.

**Non-Goals (explicitly out of v1):**
- Any write to Outlook/Graph, `templeEvents__Events`, or any approval workflow.
- Guest tokens / one-time passcodes (the email is self-contained for external people).
- Accept/decline, reminders, notification cadence.
- Formulas, drag-fill, arbitrary cell types — this is a fixed-mechanics grid, not a spreadsheet engine.
- Per-workbook ownership/collaborators (all managers see all sheets), starter-row templates, coordinator-private notes, read-only workbook access for non-managers, mobile surface. All are noted future adds.

## Decisions

### D1. Sheet-document data model; assignments are derived, not stored

`templeEvents__SchedulingSheets` (workbook): `{ _id, name, notes, createdAt/By, lastModifiedAt/By }`. Day membership is derived from day docs (no `dates[]` array to keep in sync).

`templeEvents__SchedulingSheetDays` (one doc per day tab):
```javascript
{
  _id, sheetId,                    // parent workbook
  date: 'YYYY-MM-DD',              // date-only string, CalendarMarkers convention
  title,                           // ceremony name; null → surfaces show the date
  columns: [{ id, name,            // client-generated ids (crypto.randomUUID)
    linkedEvent: null | { eventId, linkedAt,
      snapshot: { title, startDateTime, endDateTime, locationNames } } }],
  rows: [{ id, label, kind: 'starter' | 'custom' }],  // kind is cosmetic (band tint) only
  cells: { '<rowId>:<colId>': {    // sparse map; absent key = empty cell
    segments: [                    // ordered content
      { type: 'text', text },
      { type: 'person', userId|null, name, email|null,   // email lowercased at write
        placeholder: false, callTimeOverride: null|'HH:MM' },
      { type: 'location', locationId|null, name }
    ],
    note: null | { text, authorName, at }
  } },
  taggedEmails: ['a@x.org'],       // denormalized, recomputed server-side on every write
  emailLog: [{ email, sentAt, sentBy }],   // append-only, one entry per successful send
  _version,
  createdAt/By, lastModifiedAt/By
}
```

*Why not normalized assignment rows (the original design)?* The freeform reframe inverts the model: the sheet is the source of truth and "an assignment" is just a person chip in a cell. Normalized rows cannot represent free-text rows, off-script columns, or multi-segment cells without a parallel document store anyway. Derivation (D4) keeps the person-centric surfaces working.

*Rejected: per-cell documents.* Finer OCC granularity, but every sheet load becomes a multi-doc assembly, structural ops (delete column) become fan-out writes needing transactions Cosmos makes painful, and the row/column order still needs a parent doc. D2 gets the same practical concurrency benefit cheaper.

### D2. Concurrency: OCC on structure, last-write-wins per cell

The architecture review flagged that roster prep is multi-editor under deadline — whole-doc OCC would make two people editing *different cells* collide constantly, which is worse than no OCC. Split by operation type:

- **Structural ops** (add/remove/rename/reorder rows & columns, day title, link/unlink event): `conditionalUpdate()` on the day doc's `_version` with `expectedVersion`, standard 409 `VERSION_CONFLICT` envelope. Structure conflicts are rare and genuinely need "reload and look".
- **Cell writes** (`PUT .../cells/:cellKey` with the full cell object): targeted `$set` on the one `cells.<key>` path + `$inc: { _version: 1 }` **without** a version gate. Two editors on different cells never conflict; two editors on the *same* cell get last-write-wins on that cell only — the blast radius of a lost write is one cell, and the UI refetches on window focus. This is a written decision in the Calendar Markers Decision-9 style, not an inherited analogy.
- Server recomputes `taggedEmails` and validates segment shape on every cell write (client segments are untrusted input: cap segments per cell, note length, and reject unknown `type`).

### D3. Permission: named flag, gate middleware with DB re-fetch, self-gated lookup

- `canManageAssignments(user)` = `user.isAdmin || user.department === 'events'` in `permissionUtils.js`, added to `getPermissions()`, consumed by frontend via `useRoleSimulation().effectivePermissions` → `usePermissions()` → route guard + nav — the exact `canManageCalendarMarkers` pipeline; never inlined at call sites.
- `requireAssignmentManager` middleware **re-fetches the user via `findUserByIdentity(usersCollection, req.user.userId, req.user.email)`** before checking — never trusts JWT claims (review P1).
- **New endpoint `GET /api/scheduling-sheets/user-lookup?q=`** gated by `requireAssignmentManager` itself, returning `{ userId, name, email }` matches (capped). The `@` picker must NOT call `GET /api/users`: that endpoint is `canManageUsers`-gated (approver/admin only) and would 403 an events-department requester whom our gate deliberately admits (review P1).

### D4. Derived person surfaces via `taggedEmails`

`GET /api/my-assignments` (any authenticated user): query `{ taggedEmails: token.email.toLowerCase(), date: { $gte: today } }` on day docs — index `{ taggedEmails: 1, date: 1 }` (multikey; plain equality match, never `$regex`, per the Cosmos convention). Server then extracts only the requesting user's cells (row label, column name + times, call-time override, notes) into a flat read shape; the raw sheet is not exposed to non-managers. Grouped by day (user default #5). External people match by email the same way if they ever get accounts (default #4 from the earlier round).

### D5. Email: one message per person, fan-out with per-recipient isolation

- `POST /api/scheduling-sheets/:sheetId/email` with `{ scope: { dayId } | { wholeSheet: true }, recipients?: [emails], expectedNothing }` — day-scoped and workbook-scoped sends (default #11).
- Recipients = distinct person-chip emails in scope. **Placeholder chips are skipped and reported in `skippedPlaceholders`, never a block** (revised 2026-09-03; the original 422 `UNRESOLVED_PLACEHOLDERS` hard-block and its admin-only `allowPlaceholders` override were removed).
- Fan-out via `Promise.allSettled` over `emailService.sendEmail` per recipient; response `{ results: [{ email, success, error }] }`; one bad address never blocks the rest. Any future per-recipient retry MUST use `retryWithBackoff` (review note; no hand-rolled loops).
- New `ASSIGNMENT_SCHEDULE` template in `emailTemplates.js` + `CTA_CONFIG` entry (EU-14 forces the classification). Subject is day-scoped: "Your assignments for Friday, September 11" (workbook scope: one email listing all the person's days). Sheet title in the body. CTA → My Assignments — a deliberate deviation from the `eventUrl` deep-link convention (documented here per review P3); external recipients can ignore it. Body includes cell notes (default: notes are visible to assignees) and the person's effective call time (column default overridden by `callTimeOverride`).
- Success appends `{ email, sentAt, sentBy }` to the day doc's `emailLog`. **Staleness** is computed, not stored: a person's send is stale when `day.lastModifiedAt > their latest sentAt` (question 2 resolution — "emailed, but changed since" indicator).

### D6. Event linking is sugar with a drift flag, never a live coupling

Linking a column stores an immutable `snapshot` of the event's title/times/locations at link time and prefills the column name + starter-row cells (one-time copy the user can edit). On sheet load the client fetches the linked events (existing published-events read path) and compares against snapshots; a mismatch renders a "changed since linked" flag on the column with a "refresh from event" action (explicit, never automatic — call/doors times are operational overrides; silent live-update is wrong). A deleted event degrades the chip to "event no longer exists"; the column keeps working (defaults #2/#12 family). Event picker offers the day's published events ±1 day (setup-day rows).

### D7. Client freshness: React Query + refetch, no SSE in v1

Standard query keys per workbook/day, `deriveListLoadingState` for every list/grid first paint (repo convention), refetch on window focus and after mutations. A scoped SSE topic is a later add if concurrent editing proves chatty; D2 already bounds the cost of staleness to one cell.

### D8. Assorted user-approved behaviors (recorded so they don't get re-litigated)

- Tab window: today + upcoming days as tabs, just-passed days linger ~7 days, everything else in the workbook picker's per-year groups (#1, #13).
- One day-sheet per (workbook, date); the same calendar date MAY exist in two workbooks — surfaces name the workbook (#2, #10).
- Untitled day → all surfaces show the date (#3).
- Copy a day / copy a workbook: structure + people carry, dates cleared/re-seeded in order, count mismatch handled by blanks/drops, soft warning when source and target weekdays differ (#6, #12).
- Crowded cells: rows grow; no "+N" truncation on screen or print (question 1).
- Double-booking (same person, overlapping columns): soft client-side warning badge, never a block (question 3).
- Empty workbook / first run: empty state auto-opens the "+" creation panel (#7).
- Deep link: `/admin/scheduling-sheets?sheet=<id>&date=YYYY-MM-DD`; email CTA lands on My Assignments for everyone (#8, #9).
- Nav: managers get the workbook (Admin dropdown for admins, top-level link for events-dept non-admins, mirroring Calendar Markers); everyone else gets My Assignments only (#8).

## Risks / Trade-offs

- [Last-write-wins on a contested cell loses one edit] → blast radius is one cell (D2); focus-refetch shortens the stale window; revisit with SSE/presence if it bites in practice.
- [`taggedEmails` drifts from cell content] → recomputed server-side on every cell write from the stored doc, never client-supplied; covered by a dedicated test.
- [Freeform cells make emails/My Assignments only as good as tagging discipline] → the UI makes `@` the visibly easy path; placeholder ghosts are loud; the send hard-block catches unresolved slots. Accepted residual: a name typed as plain text is invisible to derived surfaces — this matches the user's "non-prohibitive" priority.
- [Sheet docs grow with big grids] → bounded in practice (columns × rows for one day's staffing); cap validation on segments/notes; Cosmos doc limit is nowhere near reachable for realistic sheets.
- [Role simulation can't preview the events-dept gate] → known caveat, documented in proposal; QA uses a real events-dept account (same as Calendar Markers).
- [Two collection-wiring sites] → both `api-server.js` startup and `injectedDb` branch wired; integration tests run against `createAppForTest` (real server), which fails loudly if one is missed.

## Migration Plan

Greenfield — no existing data, no migration. Deploy backend + frontend together (frontend surfaces 404 without the routes). Rollback = remove nav/routes; collections are inert.

## Open Questions

(none blocking — all v1 decisions above are user-approved; deferred items are listed under Non-Goals)
