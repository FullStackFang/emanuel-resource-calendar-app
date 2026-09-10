## Why

Approvers need to manage Scheduling Sheets completely, but the current permission admits only admins and Events-department users, and adding rows requires an undiscoverable Enter action. Sending supports only one day or the whole workbook, while even day-only emails attach the entire workbook PDF.

## What Changes

- Grant approvers full Scheduling Sheet management, retaining admin and Events-department access and existing restrictions for other users.
- Add explicit, accessible row creation with save feedback; allow all rows to be reordered while preserving their identities and contents.
- Separate timing/location row meaning from editable labels, and remove deleted structure's orphaned assignments from downstream outputs.
- Let senders select any days, select recipients within those days, and send combined schedules or separate emails per day.
- Use the selected scope consistently for email bodies, personal calendar files, and schedule PDFs; support combined or per-day PDF downloads.
- Show message counts and per-recipient/per-group delivery results, with accurate sent/stale coverage and no accidental send-all on an empty recipient selection.
- Preserve legacy API scope inputs; reject ambiguous inputs and stale new-client send snapshots before sending.

## Capabilities

### New Capabilities

- `scheduling-sheet-full-management`: Approver access, reliable structure editing, stable metadata roles, and deletion integrity.
- `scheduling-sheet-scoped-distribution`: Selected-day email/PDF scope, grouping, confirmation, and delivery accounting.

### Modified Capabilities

None in `openspec/specs/`. Scheduling specifications currently reside in unarchived changes. This change explicitly supersedes the admin/Events-only gate in `scheduling-sheets` and the fixed starter-row ordering in `scheduling-sheet-drag-reorder`; see design.md for reconciliation before archival.

## Impact

- Backend: `permissionUtils.js`, Scheduling Sheet routes/helpers in `api-server.js`, cell/assignment extraction, and focused integration tests.
- Frontend: role simulation and permission consumers, Scheduling Sheets grid/shell/email panel, query mutations, event prefill helpers, and existing PDF generator.
- Storage: optional stable row metadata role and additive delivery-log snapshot fields; existing workbook/day collections remain authoritative.
- Reuse existing app-only email service, PDF renderer, ICS builder, and structural optimistic concurrency control. No new provider or deployment work.
- Non-goals: saved date groups, staff-role/event-based splitting, scheduled background delivery, arbitrary non-assignee recipient lists, calendar cancellation/subscription behavior, or broad route refactoring.
