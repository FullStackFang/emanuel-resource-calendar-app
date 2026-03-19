## Context

Recurrence management is currently spread across three UI surfaces:

1. **Details tab** in `RoomReservationFormBase.jsx` — a recurrence summary card with "Manage Recurrence" link (lines ~1523-1574). If the Recurrence tab exists it switches tabs; otherwise opens `RecurrencePatternModal`.
2. **Recurrence tab** in `RecurrenceTabContent.jsx` — empty state shows a "Create Recurrence" CTA that opens the modal; management state shows pattern summary + occurrence list with "Edit Pattern" button that opens the modal.
3. **RecurrencePatternModal** (`RecurrencePatternModal.jsx`, 534 lines) — the actual editing UI with frequency selector, day-of-week buttons, end date, styled calendar preview, ad-hoc additions/exclusions.

State is lifted to `RoomReservationReview.jsx` which manages `recurrencePattern` and `showRecurrenceModal`, passing them down to both `RoomReservationFormBase` and `RecurrenceTabContent`.

Per-occurrence overrides are fully supported by the backend (`occurrenceOverrides[]` on the series master, with cascade logic in the admin save endpoint at lines 22021-22064 of `api-server.js`). The frontend can trigger occurrence edits via `editScope: 'thisEvent'` on both draft and admin save endpoints. However, there is no UI to edit individual occurrences from within the recurrence tab — users must close the modal, find the occurrence on the calendar, and open it separately.

## Goals / Non-Goals

**Goals:**
- Single location for all recurrence management: the Recurrence tab
- Pattern creation and editing inline (no modal) with the correctly styled calendar
- Per-occurrence editing accessible directly from the occurrence list
- Follows the Outlook model: occurrences show current effective values, editable naturally, no inheritance/reset UI

**Non-Goals:**
- Backend changes (all APIs and data structures already exist)
- Showing other calendar events on a given date (deferred)
- Deep-linking / URL routing to individual events
- Changes to the RecurringScopeDialog (used when clicking events on the calendar — separate flow)

## Decisions

### D1: Absorb RecurrencePatternModal content into RecurrenceTabContent left column

**Decision**: Extract the pattern editing UI (frequency, interval, day-of-week buttons, end date, styled calendar) from `RecurrencePatternModal.jsx` and render it directly in RecurrenceTabContent's left column.

**Why**: Eliminates the modal indirection. The tab has ample space (left column is 320px, modal was 850px split into ~350px + ~450px). The left column already has the pattern card and mini-calendar — these get replaced by the full editor.

**Alternative considered**: Keep the modal but auto-open it. Rejected because it still feels like two layers and doesn't solve the "too many clicks" problem.

**Implementation**: The modal's state logic (frequency, interval, daysOfWeek, startDate, endType, endDate, occurrenceCount, adHocAdditions, adHocExclusions) moves into RecurrenceTabContent. The calendar preview and day-of-week buttons render inline. The modal's `onSave` pattern (build object, call parent) becomes direct state updates via `onRecurrencePatternChange`.

### D2: Unified empty/edit state — no separate "empty state" view

**Decision**: When no pattern exists, the left column shows the same editor fields with defaults (frequency=weekly, interval=1, etc.) and a "Create" button. When a pattern exists, the same fields show current values. No separate empty-state CTA page.

**Why**: Mirrors Outlook behavior — you go to the recurrence settings and they're just there. Reduces code paths and eliminates the empty-state component entirely.

### D3: Right column toggles between list view and occurrence detail view

**Decision**: The right column defaults to the occurrence list. Clicking a row swaps it to an occurrence detail/edit view showing that date's effective field values. A "Back to list" link returns to the list.

**Why**: Keeps the user in the recurrence tab context. No second modal, no navigation away from the series master.

**Fields in detail view**: eventTitle, startTime, endTime, locations (room picker), setupTime, teardownTime, doorOpenTime, doorCloseTime, categories. These match the fields supported by `occurrenceOverrides[]` in the backend.

### D4: Occurrence edits accumulate on the in-memory recurrence state, saved with the form

**Decision**: Editing an occurrence in the detail view updates the local `occurrenceOverrides[]` state. Changes are persisted when the parent form saves (same flow as pattern changes). No immediate API calls from the detail view.

**Why**: Consistent with how pattern changes work — they accumulate and save together. Avoids partial-save states where pattern is saved but overrides aren't.

**Alternative considered**: Immediate save per occurrence (like Outlook does when you close an occurrence editor). Rejected because the ReviewModal already has a unified save flow, and splitting it would create complexity around error handling and version conflicts.

### D5: Customized occurrence indicator — minimal, Outlook-style

**Decision**: Occurrence rows that have entries in `occurrenceOverrides[]` show a small visual indicator (e.g., a dot or subtle icon). No field-level inheritance indicators, no reset buttons.

**Why**: Matches Outlook — you can see at a glance which occurrences are customized, but the editing experience treats every field the same regardless of whether it's inherited or overridden.

### D6: Remove recurrence card from Details tab entirely

**Decision**: `RoomReservationFormBase.jsx` no longer renders the recurrence summary card or "Manage Recurrence" / "Set Up Recurrence" buttons. The recurrence-related props (`externalShowRecurrenceModal`, `onShowRecurrenceModalChange`, `onSwitchToRecurrenceTab`) are removed.

**Why**: The Recurrence tab is the single home. Having a card on Details creates the fragmentation this change eliminates.

### D7: Port calendar CSS from RecurrencePatternModal.css

**Decision**: Copy the calendar-specific styles (`.react-datepicker__day.recurrence-pattern`, `.adhoc-addition`, `.adhoc-exclusion`, legend, day sizing) from `RecurrencePatternModal.css` into `RecurrenceTabContent.css`, scoped under `.recurrence-tab-calendar`.

**Why**: The modal's calendar looks correct; the tab's doesn't. Same markup structure, just different CSS scoping.

## Risks / Trade-offs

**[Left column width]** The modal had ~350px for the calendar + ~450px for the editor side-by-side. The tab's left column is 320px. The frequency/day-of-week controls need to fit in a narrower space. → Mitigation: Stack controls vertically instead of side-by-side. The calendar fits fine at 320px (it already renders there). Day-of-week buttons wrap naturally.

**[State complexity]** RecurrenceTabContent currently receives `recurrencePattern` as a prop and calls `onRecurrencePatternChange`. Adding occurrence detail editing means it also needs access to `occurrenceOverrides[]` and a way to update them. → Mitigation: The overrides are already part of the event data accessible via `reservation.occurrenceOverrides`. Add an `onOccurrenceOverridesChange` callback prop or include overrides in the existing `onRecurrencePatternChange` flow.

**[RecurrencePatternModal deletion risk]** Other components might import it. → Mitigation: Grep for all imports before removing. Currently only `RecurrenceTabContent.jsx` and `RoomReservationFormBase.jsx` import it.

**[Form save integration]** Occurrence override edits need to be included when the parent form saves. → Mitigation: The `getProcessedFormData()` call in `RoomReservationReview` already collects `recurrence`. Extend it to also collect `occurrenceOverrides` from the tab's state.
