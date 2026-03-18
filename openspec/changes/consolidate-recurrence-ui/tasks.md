## 1. Remove recurrence UI from Details tab

- [x] 1.1 Remove recurrence summary card and "Manage Recurrence" / "Set Up Recurrence" buttons from RoomReservationFormBase.jsx (lines ~1500-1580)
- [x] 1.2 Remove recurrence-related props from RoomReservationFormBase: externalShowRecurrenceModal, onShowRecurrenceModalChange, onSwitchToRecurrenceTab
- [x] 1.3 Remove RecurrencePatternModal import and render from RoomReservationFormBase.jsx
- [x] 1.4 Clean up corresponding CSS for removed recurrence card elements

## 2. Remove modal plumbing from parent components

- [x] 2.1 Remove showRecurrenceModal state and setShowRecurrenceModal from RoomReservationReview.jsx
- [x] 2.2 Remove showRecurrenceModal/onShowRecurrenceModal props from RecurrenceTabContent usage in RoomReservationReview.jsx
- [x] 2.3 Remove externalShowRecurrenceModal/onShowRecurrenceModalChange prop passing from RoomReservationReview to RoomReservationFormBase

## 3. Inline pattern editor into RecurrenceTabContent left column

- [x] 3.1 Extract pattern editing logic from RecurrencePatternModal (frequency, interval, daysOfWeek, startDate, endType, endDate, occurrenceCount state and handlers) into RecurrenceTabContent
- [x] 3.2 Replace the empty-state CTA with the inline editor in creation mode (fields with defaults, "Create" button to apply pattern)
- [x] 3.3 Replace the management-view pattern card + "Edit Pattern" button with the inline editor populated with current pattern values
- [x] 3.4 Render frequency selector, interval input, day-of-week toggle buttons, and end date picker directly in the left column
- [x] 3.5 Wire inline editor state changes to call onRecurrencePatternChange so the occurrence list updates reactively
- [x] 3.6 Remove RecurrencePatternModal import and render from RecurrenceTabContent.jsx

## 4. Fix calendar styling

- [x] 4.1 Port calendar-specific CSS from RecurrencePatternModal.css into RecurrenceTabContent.css (day highlighting for pattern/added/excluded, legend colors, day sizing)
- [x] 4.2 Scope ported styles under .recurrence-tab-calendar to avoid conflicts
- [x] 4.3 Verify calendar renders with correct colors for pattern dates (blue), additions (green), and exclusions (red)

## 5. Tighten occurrence list layout

- [x] 5.1 Reduce the Occurrences header from h3 to a smaller label, inline with the filter buttons
- [x] 5.2 Reduce row padding and min-height for denser occurrence rows
- [x] 5.3 Add customized indicator (small icon/dot) on occurrence rows that have entries in occurrenceOverrides[]

## 6. Occurrence detail editing view

- [x] 6.1 Add selectedOccurrence state to RecurrenceTabContent for tracking which occurrence is being edited
- [x] 6.2 Create OccurrenceDetailEditor sub-component (or inline section) that renders editable fields: eventTitle, startTime, endTime, locations, setupTime, teardownTime, doorOpenTime, doorCloseTime, categories
- [x] 6.3 Populate fields with effective values: override values if present, otherwise series master values
- [x] 6.4 Wire field changes to update a local occurrenceOverrides[] state (add new entry or update existing entry for that date)
- [x] 6.5 Add "Back to list" navigation to return from detail view to occurrence list
- [x] 6.6 Handle excluded occurrences: show date as excluded with "Restore" action, no editable fields
- [x] 6.7 Wire occurrenceOverrides state into the form save flow via getProcessedFormData() in RoomReservationReview

## 7. Cleanup and testing

- [x] 7.1 Verify RecurrencePatternModal is no longer imported anywhere (grep for imports)
- [x] 7.2 Run existing frontend tests to confirm no regressions
- [x] 7.3 Add frontend test: Recurrence tab renders inline editor when no pattern exists
- [x] 7.4 Add frontend test: Recurrence tab renders inline editor with populated values when pattern exists
- [x] 7.5 Add frontend test: Clicking occurrence row shows detail editor with effective values
- [x] 7.6 Add frontend test: Editing occurrence field updates occurrenceOverrides state
- [x] 7.7 Add frontend test: Customized indicator appears on rows with overrides
