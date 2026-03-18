## Why

The recurring event management UI is currently embedded as a modal launched from a collapsed card within the event form. As the feature has matured (additions, exclusions, per-occurrence conflict detection), users struggle to inspect individual occurrences and manage exceptions in the constrained 850px modal. The recurrence tools deserve dedicated space consistent with the app's existing tab-based layout inside ReviewModal.

## What Changes

- **New "Recurrence" tab in ReviewModal** — always-visible pill tab alongside Details, Attachments, History. Shows empty-state CTA ("Create Recurrence") when no pattern exists, and a full two-column management view when a pattern is active.
- **Two-column management view** — left column shows pattern summary, "Edit Pattern" button, and interactive mini-calendar; right column shows scrollable occurrence list with per-row conflict status, addition/exclusion indicators, and inline actions (remove addition, restore exclusion).
- **Absorb Conflicts tab into Recurrence tab** — the existing RecurringConflictSummary data merges into the occurrence list as inline conflict indicators, eliminating the separate Conflicts tab for recurring events.
- **Simplify the recurrence card on the Details tab** — the current in-form recurrence section becomes a compact summary card with a "Manage Recurrence" link that switches to the Recurrence tab.
- **Tab badge indicator** — the Recurrence pill tab shows a dot/badge when recurrence is active, similar to how other tabs indicate content exists.
- **"Create Recurrence" triggers existing modal** — the empty-state button opens the current RecurrencePatternModal for initial pattern definition. "Edit Pattern" in the management view also reuses this modal for rule changes only.

## Capabilities

### New Capabilities
- `recurrence-tab`: Dedicated ReviewModal tab for recurring event management, including empty-state CTA, two-column management layout with occurrence list, pattern summary, and inline conflict display.

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- **Frontend components**: ReviewModal.jsx (new tab registration), RoomReservationReview.jsx (tab content rendering), RoomReservationFormBase.jsx (simplified recurrence card), RecurrencePatternModal.jsx (no structural changes, reused as-is)
- **New component**: RecurrenceTabContent.jsx (or similar) — the two-column management view
- **Removed/merged**: RecurringConflictSummary standalone tab usage absorbed into recurrence tab occurrence list
- **No backend changes** — all data (pattern, additions, exclusions, conflicts) already available via existing APIs
- **No API changes** — occurrence expansion and conflict checking already handled by existing endpoints and frontend utilities
- **CSS**: New styles for occurrence list, two-column layout, tab badge indicator; existing ReviewModal tab styles extended
