## Context

Scheduling Sheets use workbook and day documents, a TanStack Query data layer, and a single backend `requireAssignmentManager` gate. Structural writes use `expectedVersion`; cell writes are intentionally per-cell last-write-wins. The grid receives editing access as a whole, rather than a separate row-add permission.

The gate currently admits admins and Events-department users. The frontend role simulator also denies approvers by default. Row creation is an Enter-only input; its label clears before persistence completes. Starter rows can be renamed/deleted but cannot move. Assignment extraction and event-prefill helpers identify timing/location metadata by labels. Structure deletion does not remove the corresponding cells, and extraction walks those cells even without matching rows/columns.

The email panel accepts `dayId` or `wholeSheet`, then the server extracts and groups assignments by email. The browser generates one full-workbook PDF; the server generates each recipient's ICS. Send logs are stored on day documents. The PDF renderer limits output to 31 days. These foundations are retained.

## Goals / Non-Goals

**Goals:** full approver management; accessible and reliable editing; safe metadata renaming/reordering/deletion; selected-day scope shared by email/PDF/ICS; combined or per-day distribution; honest confirmation and delivery coverage.

**Non-Goals:** saved groups, event/role splitting, background scheduling, arbitrary recipients, cancellation emails for removed calendar entries, replacing last-write-wins cell editing, or refactoring the whole API server. Agents prepare and verify locally; deployment belongs to the user.

## Decisions

### 1. Expand the existing capability

`canManageAssignments` grants admin OR approver OR Events department using existing effective-role helpers. Retain the database-backed backend gate for every workbook/day/cell/lookup/send endpoint. Update the simulator's approver capability and verify navigation and direct-route access through the existing permission pipeline. No new grant is added to event/calendar-marker or user management permissions.

Alternative: a separate edit-only approver grant. Rejected because the accepted scope is full Scheduling Sheet management, including destructive actions and distribution.

### 2. Make row editing explicit and preserve structure identity

Provide a visible Add Row button alongside the existing input and Enter shortcut. Await the existing structural mutation, disable duplicate submission while pending, clear the label only after success, and retain it on validation/network/version errors. Use notifications and existing two-click destructive confirmation.

All rows support drag and keyboard move controls, including starter rows, with stable ids/cell keys. Continue structural OCC and refetch on conflicts; never silently retry a stale whole-array update. Coordinate pending cell writes before structural submission to avoid immediately stale versions.

### 3. Decouple metadata meaning from labels

Add optional `metadataRole` on a row: `location`, `callTime`, `doorsOpen`, `begins`, `ends`, or explicit `null` for an ordinary row. Seed these roles on new starter rows and preserve them during copies, renames, and reorders. Permit at most one row per non-null role per day. Provide a row action to assign/change/remove its metadata role, including recovery after deleting a metadata row. Reject duplicate/unknown roles in the API.

For legacy rows with the property absent, a shared documented resolution rule recognizes case-insensitive, trimmed exact legacy labels. If a role has an explicit owner, it wins; otherwise the last matching legacy row in stored order retains the current extraction behavior. Materialize resolved roles on the next successful structural write, marking other rows null. Both frontend prefill/display consumers and backend extraction must use this rule rather than independently interpreting labels. Previously renamed legacy rows have no recoverable identity: show them as ordinary and allow explicit role assignment; do not guess.

Deleting a metadata row removes that fallback; existing personal time overrides and linked-event fallbacks continue to work. Reordering never affects role resolution after normalization.

Alternative: lock standard labels/rows. Rejected because it conflicts with complete editing. A mandatory migration is unnecessary; compatibility reads plus normalization on write avoid a production data operation.

### 4. Remove orphaned data at the structural boundary

For structural deletes, use the version-matched update to remove affected cell paths and recompute `taggedEmails` from surviving valid cells atomically with the structure. A concurrent cell write bumps the version and causes conflict rather than losing data. Cell writes must check that row and column still exist in their atomic write predicate, preventing a late write from resurrecting removed cells.

All assignment extraction and frontend recipient collection ignore cells without both a current row and column, covering historical orphaned data before a structural save cleans it. This applies to My Assignments, email bodies, calendars, counts, and recipient selection.

### 5. Normalize selection and grouping explicitly

The new panel defaults to the active day and combined mode. It offers Current day, All days, and a dated checkbox list supporting nonconsecutive selections. Recipient selection derives only from valid assignments within selected days. Changing day scope recomputes the roster and resets it to all eligible recipients with visible counts; any selection/grouping/attachment change cancels pending confirmation. Empty scope or recipients disables send.

New email request fields:

```json
{
  "dayIds": ["day-id-1", "day-id-2"],
  "grouping": "combined",
  "recipients": ["person@example.org"],
  "includePdf": true,
  "includeCalendar": true,
  "expectedDayVersions": { "day-id-1": 3, "day-id-2": 7 },
  "attachmentsByGroup": []
}
```

`grouping` is `combined` or `perDay`. New clients always send explicit recipients and version entries for every selected day. Validate a nonempty unique day list, workbook ownership, supported grouping, normalized eligible recipients, and complete numeric versions before any send. Return 400 for invalid/mixed scope; 404 for unknown or foreign days without exposing their workbook; 409 for stale versions. Explicit `recipients: []` is invalid; omission retains legacy all-eligible behavior. Unknown/noneligible supplied recipients are rejected rather than broadened.

Continue accepting exactly one legacy `dayId` or `wholeSheet: true`, with default combined mode and legacy optional `attachment`. Reject mixed old/new scope or attachment formats. Normalize legacy requests into the same internal day/group plan; new-client snapshot validation does not break older clients.

Build groups chronologically on the server: combined contains all selected days; perDay contains one day per group. A recipient gets a message only for groups containing their assignments. A small pure planning helper supports validation/grouping tests without email delivery; reuse existing extractors, templates, ICS generation, and service calls. No new service framework.

### 6. Keep output scope consistent

Reuse `generateSchedulingSheetPdf` by passing a copy of the sheet containing only the group's selected days. A combined PDF includes all selected days' full grids; a per-day PDF includes just that day's full grid. The PDF remains a shared schedule, while the body and ICS are personal assignments within the same scope. Clearly label this distinction in the panel.

`attachmentsByGroup` contains one entry per group when PDFs are enabled: `{ groupId, dayIds, fileName, contentBase64 }`. Group ids are deterministic (`combined` or the day id). The server validates group membership against its plan, file shape, per-message attachment budget, and the existing request-body limit. The browser cannot prove PDF bytes represent current server data; version preflight prevents ordinary stale-preview mismatches, while the authorized client remains the PDF producer. Generate from a captured sheet snapshot and disable sending while local edits are pending.

Offer independent PDF and ICS toggles, both on by default for the new panel. Reuse existing attachment-failure behavior: warn when an enabled attachment fails and report its actual presence per delivery; email content remains self-contained. Scope-limit truncation is different: never send/export a PDF omitting selected days. Block generation above the existing 31-day combined limit and instruct the user to choose fewer days or per-day mode. Check aggregate upload size before sending; explain a smaller selection is needed when it exceeds the server request limit.

Export uses the same day selector and combined/per-day PDF generation. Per-day export exposes explicit dated file download links so browser multiple-download blocking cannot silently lose files; revoke object URLs on dismissal. No ZIP dependency is required.

Alternative: server-side PDF rewrite or persistent named groups. Neither is necessary to select and package existing days reliably.

### 7. Report coverage and partial success precisely

Use a bounded worker pool for recipient/group messages (initial cap: four concurrent sends), preserving failure isolation. No automatic retry after an ambiguous mail outcome. Show group/date, recipient, outcome, and actual attachment status for every result. Totals count messages and separately report unique people. Preserve the legacy top-level summary fields for legacy clients.

Record successful coverage only on days represented by that recipient's actual assignments in that delivery. Add the sent day version and group id to existing log entries. Compare current day version to the recorded version for new logs, so an edit during a send is stale even when it occurred before `sentAt`; use the current timestamp fallback for historical logs. A log-write failure must appear as a warning without converting a delivered email into a failure. Disabled delivery never writes sent coverage.

Aggregate selected-day status from each recipient's assigned days: all current = sent; any version mismatch = changed since sent; mixed sent/unsent = partially sent; all missing = not yet emailed. This removes the existing order-dependent aggregate status behavior. Keep day-level rather than per-cell staleness, accepting conservative stale indicators after another person's edit.

### 8. Reconcile related OpenSpec changes

The baseline scheduling specs are not yet in `openspec/specs`, so this proposal uses two new capability files with ADDED requirements. These requirements supersede the older changes' admin/Events-only access, starter-row fixed-prefix ordering, day-or-whole-sheet-only send scope, and unconditional full-workbook PDF attachment. Preserve the remaining inline-cell and ICS contracts, including stable calendar UIDs.

Before archival, reconcile those exact overlapping requirements into canonical specs or update the pending source deltas, depending on which changes have been archived by then. Do not archive conflicting requirements independently. Existing unfinished browser/mail-client checks remain unfinished and are not implied complete by this proposal.

## Risks / Trade-offs

- More messages in per-day mode -> display message count before confirmation, bound concurrency, and report each outcome.
- Lost network response after delivery -> outcome is unknown; tell the sender to check results before manually resending. Exactly-once delivery and persistent delivery jobs are outside this change.
- Legacy renamed rows cannot be inferred reliably -> explicit role assignment with backward-compatible reads.
- A PDF is generated in the browser while email content is generated on the server -> capture versions, preflight before sends, and reuse captured server documents for all body/ICS work after validation.
- Expanded structural permissions expose existing orphan bugs -> fix atomic cleanup and read filtering before considering full editing complete.
- Old clients can drop new row fields on writes -> normalize against persisted roles server-side and preserve roles for matching ids when legacy request rows omit `metadataRole`.
- Rolling back to code that ignores metadata roles can lose renamed-row semantics -> document rollback limitation; preserve stored fields and avoid destructive migration.

## Migration Plan

1. Write focused failing permission, structure, and distribution tests and capture browser reproduction of the original row-add report.
2. Implement permission and editing integrity changes with additive row-role compatibility, then verify independently.
3. Implement scoped distribution and UI, retaining legacy request support and historical log reads.
4. Run focused suites and local browser/PDF checks; use mocked mail for automation. Real outbound mail testing requires explicit user authorization and user deployment remains separate.
5. Reconcile overlapping specs before archive. No production migration or deployment is performed by this change creation.

## Open Questions

None blocking the agreed scope. Working interpretation: split means combined or per-day emails/PDFs for any selected dates; saved named groups and staff-role/event splitting remain deferred. Outlook's handling of existing multi-event ICS files is a pre-existing verification item, not resolved by these artifacts.
