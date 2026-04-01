## Why

The recurrence editing experience is fragmented across three entry points (Details tab recurrence card, Recurrence tab empty-state CTA, Recurrence tab "Edit Pattern" button) that all funnel into the same RecurrencePatternModal. This forces unnecessary clicks and context-switches. The mini-calendar in the Recurrence tab also has incorrect styling compared to the modal's calendar. Per-occurrence editing is fully supported by the backend (occurrenceOverrides[]) but has no dedicated UI surface within the recurrence management view — users must close the series master and navigate to individual occurrences to edit them.

## What Changes

- **Inline the pattern editor into the Recurrence tab left column** — Move RecurrencePatternModal's content (frequency selector, interval input, day-of-week buttons, end date picker, styled calendar preview) directly into the left column. No pattern? Fields are blank and ready. Has a pattern? Fields show current values, editable in place. No modal.
- **Remove the recurrence card from the Details tab** — RoomReservationFormBase no longer renders recurrence information. The Recurrence tab is the single home for all recurrence management.
- **Stop using RecurrencePatternModal** — Remove all renders and imports from RecurrenceTabContent and parent components. The inline editor replaces it entirely.
- **Fix calendar styling** — The inline calendar uses the same styled CSS from RecurrencePatternModal (correct colors for pattern/added/excluded dates).
- **Tighten the occurrence list** — Reduce the oversized header. Denser rows.
- **Add per-occurrence detail editing** — Clicking an occurrence row swaps the right column to show that occurrence's current effective field values (title, time, room, setup/teardown, categories) in editable form. Saving writes to the master's occurrenceOverrides[]. A small indicator on list rows marks occurrences with overrides. Follows the Outlook model: no inheritance indicators, no reset buttons — just show current values and let the user edit naturally.

## Capabilities

### New Capabilities
- `inline-pattern-editor`: Pattern creation and editing rendered directly in the Recurrence tab left column, replacing RecurrencePatternModal for all recurrence management.
- `occurrence-detail-editing`: Click an occurrence in the list to view/edit its fields inline within the Recurrence tab. Edits save to occurrenceOverrides[] on the series master. Customized occurrences show an indicator in the list.

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- **Frontend components modified**: RecurrenceTabContent.jsx (major rewrite — absorb modal editor content, add occurrence detail view), RecurrenceTabContent.css (major — port modal calendar styles, tighten list layout), RoomReservationFormBase.jsx (remove recurrence card from Details tab), RoomReservationReview.jsx (remove showRecurrenceModal/onShowRecurrenceModal prop plumbing)
- **Frontend components removed from usage**: RecurrencePatternModal.jsx (no longer rendered)
- **No backend changes** — occurrenceOverrides[] CRUD already exists in PUT /api/room-reservations/draft/:id and PUT /api/admin/events/:id with editScope='thisEvent'
- **No API changes** — all data and endpoints already exist
- **CSS**: Port RecurrencePatternModal.css calendar styles into RecurrenceTabContent.css
