## ADDED Requirements

### Requirement: Series master review displays the series range in read-only date inputs

When a user opens a series master in the review modal, the read-only "Reservation Start Date" and "Reservation End Date" inputs SHALL display the values from `recurrence.range.startDate` and `recurrence.range.endDate` — i.e., the series span — instead of the master's `startDate` / `endDate` (which represent the first-occurrence date and remain the persistence source of truth for Microsoft Graph compatibility).

The transform SHALL be applied at the display layer only. The underlying form state (`formData.startDate` / `formData.endDate`) and the database fields MUST remain unchanged, so save paths, Graph synchronization, and conflict detection continue to operate on first-occurrence dates.

If `recurrence.range.startDate` or `recurrence.range.endDate` is missing or nullish on a series master (e.g., legacy data), the display SHALL fall back to the existing `formData.startDate` / `formData.endDate` values.

#### Scenario: Master displays range start date (AC-A1)
- **WHEN** a series master with `recurrence.range.startDate = '2026-04-15'` and a first-occurrence `startDate = '2026-04-15'` is opened in the review modal
- **AND** the recurrence range differs from the first occurrence — e.g., `recurrence.range.endDate = '2026-04-30'`
- **THEN** the read-only "Reservation Start Date" input displays `'2026-04-15'`
- **AND** the read-only "Reservation End Date" input displays `'2026-04-30'`

#### Scenario: Master displays range end date when range extends beyond first occurrence (AC-A2)
- **WHEN** a series master for a weekly recurring event has `recurrence.range.startDate = '2026-04-15'` and `recurrence.range.endDate = '2026-05-06'`
- **AND** the master's own `startDate` is `'2026-04-15'` (first-occurrence date)
- **THEN** the "Reservation End Date" input displays `'2026-05-06'` (the series span), NOT `'2026-04-15'`

#### Scenario: Single-instance (non-recurring) events are unchanged (AC-A3)
- **WHEN** a non-recurring event (`eventType !== 'seriesMaster'`, no `recurrence.range`) is opened in the review modal
- **THEN** the "Reservation Start Date" and "Reservation End Date" inputs display the event's top-level `startDate` and `endDate`
- **AND** no display transform is applied

#### Scenario: Master with missing recurrence range falls back gracefully
- **WHEN** a series master has `eventType === 'seriesMaster'` but `recurrence.range.startDate` is `null` or `undefined`
- **THEN** the "Reservation Start Date" input falls back to `formData.startDate`
- **AND** no error is raised

---

### Requirement: Single-occurrence review displays the clicked occurrence's date

When a user clicks a single occurrence on the calendar and chooses "This Event" from the recurring-scope dialog, the review modal SHALL be populated with that occurrence's own resolved date — not the series master's `startDate`, and not the series-creation date.

If an exception document has overridden the clicked slot (e.g., the 4/22 occurrence was moved to 4/23), the display SHALL reflect the overridden date. Resolution of the override value happens before the modal is opened; the modal does not re-read the master's fields after override resolution.

When the user instead chooses "All Events" from the scope dialog, the series master's fields are shown per the series-range display requirement above, NOT the clicked occurrence's date.

#### Scenario: "This Event" on an unmodified occurrence shows the clicked day (AC-B1)
- **WHEN** a weekly recurring series master has first occurrence on `2026-04-15`, pattern `weekly on wednesday`, range through `2026-04-29`
- **AND** the user clicks the `2026-04-22` virtual occurrence on the calendar
- **AND** selects "This Event" from the recurring-scope dialog
- **THEN** the review modal opens with `startDate` and `endDate` both equal to `'2026-04-22'`
- **AND** the original series-creation date (e.g., `'2026-04-15'`) does NOT appear in the date inputs

#### Scenario: "This Event" honors exception-document override (AC-B2)
- **WHEN** an exception document exists for the `2026-04-22` slot with `originalStart = '2026-04-22'` and overridden `startDate = '2026-04-23'`
- **AND** the user clicks the occupied `2026-04-23` position on the calendar and selects "This Event"
- **THEN** the review modal displays `startDate = endDate = '2026-04-23'`
- **AND** the unmodified master's `startDate` is not used

#### Scenario: "All Events" from an occurrence click opens the master with the series range (AC-B3)
- **WHEN** a weekly series runs `2026-04-15` through `2026-04-29` and the user clicks the `2026-04-22` occurrence
- **AND** selects "All Events" from the scope dialog
- **THEN** the review modal opens with the master's data
- **AND** the read-only "Reservation Start Date" / "End Date" inputs display `'2026-04-15'` / `'2026-04-29'` per the series-range display requirement
- **AND** the clicked occurrence's date (`'2026-04-22'`) does NOT appear in the date inputs

---

### Requirement: Single-occurrence review renders the recurrence tab as a read-only summary

When the review modal is viewing a single occurrence (identified by `eventType === 'occurrence'` OR an equivalent scope indicator such as `editScope === 'thisEvent'`), the recurrence tab SHALL replace its editable controls with a plain-text summary describing the parent series' pattern and range. No form inputs, checkboxes, or date pickers for recurrence configuration shall be rendered on this view.

Users who need to edit the series pattern or range SHALL use the "All Events" scope; this is communicated implicitly by the presence of the read-only summary on the "This Event" view.

#### Scenario: Occurrence view shows recurrence summary text (AC-C1)
- **WHEN** a user opens a single occurrence of a `weekly on wednesday, 2026-04-15 – 2026-04-29` series via "This Event"
- **THEN** the recurrence tab renders a paragraph containing `"Weekly on Wednesdays"` and the range `"4/15/2026 – 4/29/2026"`
- **AND** no editable recurrence inputs (frequency dropdown, day-of-week checkboxes, range end picker, additions/exclusions calendar) are present on the tab

#### Scenario: Master and single-instance views keep the recurrence tab fully editable (AC-C3 regression guard)
- **WHEN** a series master is opened via "All Events" (or a non-recurring event is opened)
- **THEN** the recurrence tab renders its normal editable controls
- **AND** no read-only summary paragraph is shown in place of the editor

---

### Requirement: Recurrence summary formatter produces human-readable pattern + range text

A utility function `formatRecurrenceSummary(recurrence)` SHALL convert a `recurrence` object (containing `pattern`, `range`, `additions`, `exclusions`) into a human-readable English string suitable for display in the read-only recurrence tab.

The formatter SHALL support all pattern types (`daily`, `weekly`, `monthly`, `yearly`) and all range types (`endDate`, `numbered`, `noEnd`). It SHALL append an additions/exclusions tail when either array is non-empty. Date formatting SHALL use `en-US` locale conventions and SHALL NOT apply any explicit timezone conversion (operating in the browser's effective timezone, which for this application is ET).

The function MUST be a pure, synchronous utility with no React or async dependencies — so it can be unit-tested in isolation and composed by other display code in the future.

#### Scenario: Daily pattern with endDate range (AC-C2 - daily)
- **WHEN** `formatRecurrenceSummary` is called with `{ pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-15', endDate: '2026-04-20' } }`
- **THEN** the returned string contains `"Daily"` and `"4/15/2026 – 4/20/2026"`

#### Scenario: Weekly pattern on multiple days with numbered range (AC-C2 - weekly)
- **WHEN** `formatRecurrenceSummary` is called with `{ pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'numbered', startDate: '2026-04-15', numberOfOccurrences: 8 } }`
- **THEN** the returned string contains `"Weekly"`, references both `"Mondays"` and `"Wednesdays"`, and indicates `"8 occurrences"`

#### Scenario: Monthly pattern with noEnd range (AC-C2 - monthly)
- **WHEN** `formatRecurrenceSummary` is called with `{ pattern: { type: 'monthly', interval: 1, dayOfMonth: 15 }, range: { type: 'noEnd', startDate: '2026-04-15' } }`
- **THEN** the returned string describes `"Monthly"` and `"day 15"` and references `"starting 4/15/2026"`
- **AND** the string does NOT contain an end-date delimiter (no `"–"` between two dates)

#### Scenario: Yearly pattern (AC-C2 - yearly)
- **WHEN** `formatRecurrenceSummary` is called with `{ pattern: { type: 'yearly', interval: 1, month: 4, dayOfMonth: 15 }, range: { type: 'endDate', startDate: '2026-04-15', endDate: '2030-04-15' } }`
- **THEN** the returned string contains `"Yearly"` and references April 15 in a human-readable form

#### Scenario: Interval > 1 produces "Every N units" phrasing
- **WHEN** `formatRecurrenceSummary` receives `{ pattern: { type: 'weekly', interval: 2, daysOfWeek: ['wednesday'] }, range: { type: 'endDate', startDate: '2026-04-15', endDate: '2026-06-10' } }`
- **THEN** the returned string begins with `"Every 2 weeks"` (NOT `"Weekly"`)

#### Scenario: Additions and exclusions appear as a tail annotation
- **WHEN** the recurrence has non-empty `additions` or `exclusions` arrays — e.g., `additions: ['2026-05-04']` and `exclusions: ['2026-04-22', '2026-04-29']`
- **THEN** the summary string contains a trailing annotation such as `"(+1 added, 2 excluded)"`
- **AND** when both arrays are empty, no such trailing annotation is appended

---

### Requirement: Occurrence date inputs are disabled on the edit UI

On the "This Event" (single-occurrence) edit view, the "Reservation Start Date" and "Reservation End Date" inputs SHALL be rendered with the HTML `disabled` attribute set, preventing any user-initiated date modification. Helper text visible alongside the inputs SHALL explain the alternative: click a different day on the calendar or edit the series via the recurrence pattern.

Time-of-day inputs (`startTime`, `endTime`, `setupTime`, `doorOpenTime`, `doorCloseTime`, `teardownTime`, etc.) SHALL remain editable on the occurrence view, so users can adjust a single occurrence's timing within its fixed day.

#### Scenario: Occurrence view disables date inputs (AC-D1)
- **WHEN** a user opens a single occurrence via "This Event"
- **THEN** both the "Reservation Start Date" and "Reservation End Date" inputs have `disabled = true`
- **AND** neither a date picker nor a text-input cursor is available in those fields

#### Scenario: Helper text directs user to alternative action (AC-D2)
- **WHEN** the occurrence view is rendered
- **THEN** visible text near the date inputs explains that the date is locked and instructs the user to either click a different day on the calendar or edit the series via the recurrence tab (by opening "All Events")

#### Scenario: Time inputs remain editable on an occurrence (AC-D3)
- **WHEN** the occurrence view is rendered
- **THEN** the `startTime` and `endTime` inputs are NOT disabled
- **AND** the user can type a new time and save the occurrence successfully (subject to backend validation of the time itself)

---

### Requirement: Server rejects occurrence date mutations

The `PUT /api/room-reservations/:id/edit` endpoint SHALL reject requests that attempt to change the `startDate` or `endDate` of an occurrence or exception document (any document whose `eventType === 'occurrence'` OR that is otherwise identified as an exception). Rejection SHALL return HTTP `400` with a response body containing `{ code: 'DATE_IMMUTABLE', message: <user-readable explanation> }`. The update MUST NOT be partially applied.

Requests that modify only time-of-day fields (and leave `startDate` / `endDate` matching the persisted values) SHALL be accepted and processed normally. Same-value re-sends of `startDate` / `endDate` SHALL be treated as a no-op diff and accepted (the guard compares values, not presence).

The check SHALL apply unconditionally to all callers — including any frontend build and any direct API client — so the immutability guarantee cannot be bypassed by a misbehaving or outdated UI.

#### Scenario: Date-change attempt on an occurrence is rejected (AC-D4)
- **WHEN** a `PUT /api/room-reservations/:id/edit` request targets an occurrence document with persisted `startDate = '2026-04-22'`
- **AND** the request body contains `startDate = '2026-04-23'`
- **THEN** the server responds with HTTP `400`
- **AND** the response body has `code: 'DATE_IMMUTABLE'`
- **AND** the document in MongoDB is unchanged (no partial write)

#### Scenario: Time-only edits to an occurrence succeed (AC-D5)
- **WHEN** a `PUT /api/room-reservations/:id/edit` request targets an occurrence document
- **AND** the request body changes `startTime` from `'09:00'` to `'10:00'` and leaves `startDate` unchanged
- **THEN** the server responds with HTTP `200`
- **AND** the occurrence document is updated with the new time
- **AND** no `DATE_IMMUTABLE` error is raised

#### Scenario: Same-value date re-send is a no-op (AC-D6 part 1)
- **WHEN** a client sends `startDate = '2026-04-22'` in a request body, matching the persisted value
- **THEN** the server does not raise `DATE_IMMUTABLE`
- **AND** processes any other (non-date) changes normally

#### Scenario: Direct API bypass still enforces the rule (AC-D6 part 2)
- **WHEN** a client (e.g., a non-standard frontend, an integration script, a test harness) sends a date-change request directly to `PUT /api/room-reservations/:id/edit` for an occurrence
- **THEN** the server returns HTTP `400` with `code: 'DATE_IMMUTABLE'`
- **AND** the rejection behavior is identical regardless of the request origin
