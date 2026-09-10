## ADDED Requirements

### Requirement: Managers select explicit days and eligible recipients
The distribution UI SHALL support current day, all days, and arbitrary checked days, defaulting to current day. It SHALL derive recipients only from valid assignments in scope and offer recipient selection.

#### Scenario: Nonconsecutive dates
- **WHEN** a manager selects Friday and Sunday while leaving Saturday unchecked
- **THEN** the roster and assignment counts SHALL include only Friday and Sunday
- **AND** changing the day selection SHALL visibly recompute the roster and reset recipients to all eligible people

#### Scenario: Nothing is selected
- **WHEN** no days or no recipients are selected
- **THEN** send SHALL be disabled
- **AND** an API request with empty dayIds or explicit empty recipients SHALL fail without sending any messages

### Requirement: Scope is validated before delivery
The backend SHALL validate selected ids, ownership, grouping, recipients, and new-client day versions before delivery. It SHALL support unambiguous legacy dayId or wholeSheet requests through the same internal scope plan.

#### Scenario: Invalid selection cannot broaden a send
- **WHEN** input contains duplicate days, mixed legacy/new scope, an unsupported grouping, or ineligible recipients
- **THEN** the API SHALL return 400 and send nothing
- **AND** an unknown or foreign-workbook day SHALL return 404 and send nothing

#### Scenario: Legacy client still works
- **WHEN** a caller supplies one valid legacy dayId or wholeSheet true without new scope fields
- **THEN** the API SHALL retain combined delivery and optional legacy attachment support
- **AND** omitted recipients SHALL mean all eligible recipients while explicit empty recipients SHALL be rejected

#### Scenario: Sheet changed since preview
- **WHEN** any selected day differs from the new client's expectedDayVersions
- **THEN** the API SHALL return 409 before sending and the UI SHALL request refreshed selection review

### Requirement: Combined and per-day delivery share one plan
The system SHALL support combined and perDay grouping, ordering days chronologically and sending a recipient only groups containing their assignments.

#### Scenario: Combined selection
- **WHEN** a recipient has assignments on two selected days and grouping is combined
- **THEN** they SHALL receive one message containing their assignments across both days

#### Scenario: Separate day messages
- **WHEN** grouping is perDay and one recipient has both days while another has only one
- **THEN** the first SHALL receive two messages and the second one
- **AND** the confirmation SHALL show two unique people and three messages with selected dates

### Requirement: Attachments and downloads match selected scope
The UI SHALL offer independent PDF and personal ICS toggles. PDF content SHALL contain only the corresponding group's selected day grids, while email bodies and ICS SHALL contain only the recipient's assignments within that scope. Export SHALL reuse the same day selection and combined/per-day packaging.

#### Scenario: Selected-day attachments
- **WHEN** a manager emails a subset of the workbook with both attachments enabled
- **THEN** the PDF SHALL exclude unselected days
- **AND** the ICS and body SHALL exclude unselected days and other people's assignments
- **AND** the UI SHALL explain that the PDF contains the full shared grid for selected days

#### Scenario: Separate downloads
- **WHEN** a manager chooses per-day PDF export
- **THEN** the UI SHALL offer explicitly dated download links for each selected day's file
- **AND** no unselected day SHALL be generated

#### Scenario: Size or day limits
- **WHEN** a combined PDF selection exceeds the renderer's 31-day cap or aggregate upload exceeds the request limit
- **THEN** the operation SHALL stop before sending and explain that fewer days or per-day output is required as applicable
- **AND** the system SHALL NOT silently omit selected days

#### Scenario: Optional attachment fails
- **WHEN** an enabled attachment cannot be generated or exceeds its per-message budget
- **THEN** the system SHALL retain self-contained email delivery and expose an attachment warning
- **AND** each delivery result SHALL accurately report which attachments were included

### Requirement: Confirmation describes and freezes the intended send
Sending SHALL use persistent two-click in-button confirmation. Any scope, recipient, grouping, or attachment change SHALL reset confirmation, and controls SHALL prevent duplicate submission while sending or while local edits are pending.

#### Scenario: Selection changes after first click
- **WHEN** a manager arms confirmation and then changes a date, recipient, grouping, or attachment toggle
- **THEN** another first click SHALL be required before confirming the revised send

### Requirement: Delivery results and coverage are per group
The system SHALL bound mail concurrency, isolate failures, report results per recipient/group, and record coverage only for successful assigned days. Disabled delivery SHALL NOT be recorded as sent. Automatic retries after ambiguous mail outcomes SHALL NOT occur.

#### Scenario: Partial send failure
- **WHEN** Friday succeeds and Sunday fails for a recipient
- **THEN** the results SHALL identify both outcomes separately
- **AND** only Friday SHALL gain sent coverage

#### Scenario: Log persistence fails after delivery
- **WHEN** mail delivery succeeds but its coverage log cannot be written
- **THEN** the result SHALL remain sent with a coverage-recording warning

#### Scenario: Delivery is disabled
- **WHEN** the email service reports delivery is disabled
- **THEN** results SHALL report skipped and SHALL NOT write successful send logs

### Requirement: Send status reflects all selected assigned days
New send logs SHALL record the sent day version. Aggregate status SHALL be sent only when every selected assigned day is current, partially sent when coverage mixes sent and unsent days, changed since sent when any recorded version is stale, and not yet emailed when no coverage exists. Historical logs SHALL retain timestamp-based compatibility.

#### Scenario: Unsent day precedes sent day
- **WHEN** a recipient's first selected assigned day is unsent and a later one is sent
- **THEN** the aggregate SHALL be partially sent regardless of iteration order

#### Scenario: Day changes during delivery
- **WHEN** a day is edited after the server captures the send snapshot but before mail completes
- **THEN** its recorded sent version SHALL remain the snapshot version
- **AND** its status SHALL show changed since sent
