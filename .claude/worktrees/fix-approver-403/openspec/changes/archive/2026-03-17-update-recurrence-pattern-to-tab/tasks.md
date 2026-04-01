## 1. Lift Recurrence State

- [x] 1.1 Move recurrence state (recurrencePattern, showRecurrenceModal, recurrencePatternRef) from RoomReservationFormBase up to RoomReservationReview so both Details and Recurrence tabs can access it
- [x] 1.2 Pass recurrence state and callbacks as props to RoomReservationFormBase (preserve existing behavior on Details tab)
- [x] 1.3 Verify existing recurrence functionality still works after state lift (create, edit, remove pattern via Details tab)

## 2. Register Recurrence Tab in ReviewModal

- [x] 2.1 Add 'recurrence' tab key to ReviewModal tab rendering, positioned between Details and Attachments
- [x] 2.2 Add tab badge indicator (dot) on the Recurrence pill when recurrencePattern is non-null
- [x] 2.3 Make tab visibility conditional: always show if recurrence exists; show only with edit permissions if no recurrence
- [x] 2.4 Remove the standalone 'conflicts' tab for recurring events (absorbed into recurrence tab)

## 3. Create RecurrenceTabContent Component

- [x] 3.1 Create RecurrenceTabContent.jsx with empty-state view (centered icon, text, 'Create Recurrence' button)
- [x] 3.2 Wire 'Create Recurrence' button to open RecurrencePatternModal with event start date
- [x] 3.3 Build two-column management layout shell (sticky left ~350px, scrollable right flex)
- [x] 3.4 Add responsive stacking for narrow viewports

## 4. Left Column - Pattern Summary and Calendar

- [x] 4.1 Render pattern summary card (frequency, interval, days, date range) from recurrencePattern state
- [x] 4.2 Add 'Edit Pattern' button that opens RecurrencePatternModal pre-populated with current pattern
- [x] 4.3 Integrate interactive mini-calendar (reuse DatePicker inline from RecurrencePatternModal) with click-to-add/exclude logic
- [x] 4.4 Add color-coded legend (pattern, added, excluded)

## 5. Right Column - Occurrence List

- [x] 5.1 Build occurrence list using calculateAllSeriesDates() merged with additions and exclusions into a sorted flat array
- [x] 5.2 Render pattern-date rows with date, time range, room(s), and conflict status icon
- [x] 5.3 Render ad-hoc addition rows with green accent and 'Remove' action
- [x] 5.4 Render excluded-date rows with strikethrough styling and 'Restore' action
- [x] 5.5 Add inline conflict display: warning icon on conflicted rows, expandable detail showing conflicting event info
- [x] 5.6 Integrate conflict data from existing /api/rooms/recurring-conflicts endpoint (reuse RecurringConflictSummary fetch logic)
- [x] 5.7 Add filter bar (All, Added only, Excluded only, Conflicts only) above occurrence list

## 6. Remove Recurrence Action

- [x] 6.1 Add 'Remove Recurrence' button in management view with two-click confirmation pattern (red confirm state, 3s auto-reset)
- [x] 6.2 On confirm, clear recurrencePattern state and return to empty state

## 7. Simplify Details Tab Recurrence Section

- [x] 7.1 Replace the current in-form recurrence card with a compact summary card showing pattern text, occurrence count, and additions/exclusions/conflict counts
- [x] 7.2 Add 'Manage Recurrence' link that switches activeTab to 'recurrence'
- [x] 7.3 When no recurrence exists, show compact invitation text with link to Recurrence tab
- [x] 7.4 Remove the inline RecurringConflictSummary from the Details tab recurrence section (now in Recurrence tab)

## 8. CSS and Styling

- [x] 8.1 Create RecurrenceTabContent.css with two-column layout, sticky left column, scrollable right column
- [x] 8.2 Style occurrence list rows (pattern, added, excluded variants) with appropriate colors from design system
- [x] 8.3 Style empty state (centered, icon + text + button)
- [x] 8.4 Style tab badge indicator dot
- [x] 8.5 Style filter bar and expanded conflict detail rows

## 9. Testing

- [x] 9.1 Add frontend tests for RecurrenceTabContent empty state rendering and 'Create Recurrence' button
- [x] 9.2 Add frontend tests for management view: occurrence list rendering with pattern dates, additions, exclusions
- [x] 9.3 Add frontend tests for filter bar functionality
- [x] 9.4 Add frontend tests for tab switching from Details 'Manage Recurrence' link
- [x] 9.5 Verify existing recurrence backend tests still pass (no backend changes expected)
