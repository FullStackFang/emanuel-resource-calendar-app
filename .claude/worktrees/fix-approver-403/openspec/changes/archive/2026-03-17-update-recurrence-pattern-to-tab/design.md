## Context

The ReviewModal currently renders tabs (Details, Attachments, History, Admin, Conflicts) via manual tab buttons in ReviewModal.jsx, with content rendered conditionally by RoomReservationReview.jsx based on `activeTab`. The recurrence UI lives inside RoomReservationFormBase as a collapsed card that launches a 850px RecurrencePatternModal. The Conflicts tab renders RecurringConflictSummary as a standalone view for series masters.

Key existing patterns:
- Tabs are string-keyed (`'details'`, `'attachments'`, `'history'`, `'admin'`, `'conflicts'`)
- Tab visibility is conditional (e.g., `'admin'` only for admins, `'conflicts'` only for series masters)
- Tab content renders inside the ReviewModal scroll area at 0.70 zoom
- RecurrencePatternModal manages its own state (frequency, interval, days, additions, exclusions)
- RecurringConflictSummary fetches from `/api/rooms/recurring-conflicts` with debouncing

## Goals / Non-Goals

**Goals:**
- Give recurrence management a dedicated tab in ReviewModal with full-width space
- Show a scrollable occurrence list where users can inspect individual dates, see conflicts inline, and manage additions/exclusions
- Provide a clean empty state with "Create Recurrence" CTA when no pattern exists
- Reuse the existing RecurrencePatternModal for pattern definition (create + edit)
- Merge the Conflicts tab functionality into the recurrence occurrence list
- Keep the Details tab recurrence section as a compact summary with tab-switch link

**Non-Goals:**
- Per-occurrence overrides (different time/room for a single date) — future work
- Batch operations on occurrences (e.g., exclude all Mondays in April)
- Changes to RecurrencePatternModal internals — reused as-is
- Backend API changes — all needed data already available
- Mobile-specific responsive redesign — follow existing ReviewModal responsive behavior

## Decisions

### 1. New RecurrenceTabContent component (not inline in RoomReservationReview)

Create a dedicated `RecurrenceTabContent.jsx` component rather than adding more conditional rendering inside RoomReservationReview.

**Rationale**: RoomReservationReview is already large. A dedicated component encapsulates the two-column layout, occurrence list logic, and empty state. It receives recurrence state as props from the same source that currently feeds the form card.

**Alternative considered**: Rendering inline in RoomReservationReview like other tabs. Rejected because the recurrence tab has significant internal state (scroll position, filter selection, expanded conflict rows) that would clutter the parent.

### 2. Two-column layout: sticky left, scrollable right

Left column (~350px, position: sticky): pattern summary card, "Edit Pattern" button, interactive mini-calendar, legend.
Right column (flex: 1, overflow-y: auto): occurrence list with filter bar.

**Rationale**: The mini-calendar is a compact, always-useful reference. The occurrence list can be long (52+ rows for weekly events over a year) and needs independent scrolling. Sticky left keeps context visible while browsing.

**Alternative considered**: Single column with calendar above list. Rejected because it pushes the occurrence list below the fold and loses the side-by-side context that makes the interactive calendar useful.

### 3. Reuse existing RecurrencePatternModal for pattern creation and editing

"Create Recurrence" (empty state) and "Edit Pattern" (management view) both open the same modal. The modal handles pattern definition; the tab handles instance browsing and management.

**Rationale**: The modal is battle-tested (534 lines, handles frequency/interval/days/end-date/additions/exclusions). Rebuilding this inline would be high effort with no UX gain — pattern definition is inherently compact and modal-friendly.

### 4. Occurrence list built from existing recurrenceUtils

Use `calculateAllSeriesDates()` from recurrenceUtils.js to expand the full series, then merge additions/exclusions/conflict data into a flat list of occurrence objects rendered as rows.

**Rationale**: The expansion logic already exists and handles DST edge cases. The occurrence list is a presentation layer on top of data the app already computes.

### 5. Absorb RecurringConflictSummary into occurrence rows

Instead of a separate Conflicts tab, each occurrence row shows its conflict status inline (checkmark or warning icon). Clicking a conflicted row expands to show conflict details.

**Rationale**: Conflicts are per-occurrence data — they belong next to the occurrence, not in a separate view. This eliminates a tab and puts the information where users look for it.

**Migration**: The `'conflicts'` tab key is removed from ReviewModal tab rendering for recurring events. Non-recurring events never showed it, so no impact there.

### 6. Details tab recurrence card becomes summary-only

The existing recurrence card in RoomReservationFormBase simplifies to: pattern summary text, occurrence count, and a "Manage Recurrence" link that calls a callback to switch `activeTab` to `'recurrence'`.

**Rationale**: The form section no longer needs the full "Edit Recurrence" button or inline RecurringConflictSummary since both capabilities move to the tab.

### 7. Tab badge for active recurrence

The Recurrence tab pill shows a small colored dot when `recurrencePattern` is non-null, using the existing CSS variable `--color-primary-500`.

**Rationale**: Consistent with common tab badge patterns. Users can tell at a glance from any tab whether recurrence is configured.

## Risks / Trade-offs

**[State coordination between Details tab form and Recurrence tab]** — The recurrence pattern state is currently owned by RoomReservationFormBase. The new tab needs read/write access to the same state.
→ Mitigation: Lift recurrence state to RoomReservationReview (or the parent that renders both tabs). Pass down as props + callbacks. This is the same pattern used for other cross-tab state like `formData`.

**[Occurrence list performance for long series]** — A daily recurring event over 2 years = 730 rows. With conflict checking per row, this could be slow.
→ Mitigation: Virtualize the list if it exceeds ~100 items (react-window or simple windowing). Conflict data is already fetched in batch from the existing endpoint — just map it onto rows. Defer to implementation; start without virtualization and add if needed.

**[Mini-calendar additions/exclusions sync]** — The interactive calendar in the left column allows clicking to add/exclude dates, same as in the modal. Changes must immediately reflect in the occurrence list.
→ Mitigation: Both columns read from the same state (additions/exclusions arrays). Calendar click handlers update state; occurrence list re-renders reactively. Standard React data flow.

**[Removing Conflicts tab is a minor breaking change for admin muscle memory]** — Admins who use the Conflicts tab will need to find it in the new location.
→ Mitigation: Low risk — the Conflicts tab only appeared for series masters and contained the same information now shown inline. No data is lost.
