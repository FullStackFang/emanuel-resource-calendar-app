## ADDED Requirements

### Requirement: The Email Schedules panel shows the schedule email message
The Email Schedules panel SHALL show the current stored `assignment-schedule`
template body in a Message section, collapsed by default. Every sender SHALL
be able to read it. The sheet GET response SHALL include the resolved body as
`assignmentEmailBody` beside the existing `assignmentEmailSubject`, so senders
without `canEditEmailTemplates` can read it without calling the template API.

#### Scenario: Sender without template permission reads the message
- **WHEN** an Events-department requester opens the Email Schedules panel and expands Message
- **THEN** the current template body is shown read-only and no Edit control is rendered

#### Scenario: Customized body is shown
- **WHEN** the `assignment-schedule` template has a stored override
- **THEN** `assignmentEmailBody` on the sheet GET is the override body, not the code default

### Requirement: Template editors can edit and save the shared template from the panel
Users with `canEditEmailTemplates` SHALL be able to edit the message in place
using the shared template editor. Saving SHALL write the single shared
`assignment-schedule` override (the same one Email Management edits), SHALL use
in-button confirmation, and SHALL show a success or error toast. After a save
the panel SHALL show the stored text.

#### Scenario: Approver saves from the panel
- **WHEN** an approver edits the body in the panel and confirms Save template
- **THEN** the `assignment-schedule` override is updated and Email Management shows the new body on its next load

#### Scenario: Concurrent change on save
- **WHEN** the save returns 409 `TEMPLATE_CHANGED`
- **THEN** the panel keeps the approver's unsaved text, shows who saved the newer version, and offers to reload it

### Requirement: Unsaved template edits block sending
While the panel's template editor has unsaved changes, the panel SHALL disable
sending to recipients and SHALL explain that the changes must be saved or
discarded first. Sends SHALL always use the stored template.

#### Scenario: Dirty editor blocks send
- **WHEN** an approver has edited the body without saving
- **THEN** the "Email N people" button is disabled with the message "Save or discard your template changes first."

#### Scenario: Discarding re-enables send
- **WHEN** the approver discards the edits
- **THEN** the send button is enabled again (subject to the existing send rules)

### Requirement: Real-recipient preview
The system SHALL provide `POST /api/scheduling-sheets/:id/email/preview`,
restricted to assignment managers, that takes `{ dayIds, subject, recipientEmail }`
and returns `{ subject, html, recipientName }` for that recipient, rendered
by the same code path as the real send. It SHALL make no writes. The panel
SHALL let the sender pick any selected, addressable recipient and show the
result in a sandboxed iframe.

#### Scenario: Preview matches the real send
- **WHEN** the preview is requested for a recipient and the same scope is then sent
- **THEN** the previewed subject and HTML equal what that recipient is sent

#### Scenario: Recipient not in scope
- **WHEN** `recipientEmail` is not an assigned, non-placeholder person in the selected days
- **THEN** the system responds 400 `RECIPIENT_NOT_IN_SCOPE`

#### Scenario: Case-insensitive recipient match
- **WHEN** `recipientEmail` differs from the stored address only by letter case
- **THEN** the preview is rendered for that person

#### Scenario: Non-manager refused
- **WHEN** a user without assignment-management access calls the preview endpoint
- **THEN** the system responds 403

#### Scenario: Preview has no side effects
- **WHEN** a preview is rendered
- **THEN** no day's `emailLog`, `_version` or `lastModifiedAt` changes

### Requirement: Send a preview to yourself
The system SHALL provide `POST /api/scheduling-sheets/:id/email/test-send`,
restricted to assignment managers, that renders the chosen recipient's email
as in the preview and sends it ONLY to the signed-in user's own address, taken
from the verified token. Any destination in the request body SHALL be ignored.
The subject SHALL be prefixed `[Preview] `. Attachments SHALL follow the real
send: the `.ics` of the previewed person's entries when `includeCalendar` is
true, and the uploaded PDF when supplied, under the same size limit and
warnings. It SHALL NOT append to `emailLog` or change sent or stale state.

#### Scenario: Preview goes only to the sender
- **WHEN** an approver sends a preview of another person's email with a `to` field naming a third address in the body
- **THEN** exactly one message is sent, addressed to the approver, and none to the third address or the previewed person

#### Scenario: Subject marked as preview
- **WHEN** a preview is sent with subject "Your assignments for Rosh Hashanah"
- **THEN** the delivered subject is "[Preview] Your assignments for Rosh Hashanah"

#### Scenario: Calendar file follows the checkbox
- **WHEN** a preview is sent with `includeCalendar: true`
- **THEN** the message carries an `.ics` containing only the previewed person's assignments

#### Scenario: No sent state recorded
- **WHEN** a preview is sent successfully
- **THEN** no `emailLog` entry is written and the previewed person still reads 'not yet emailed'

#### Scenario: Delivery disabled
- **WHEN** email delivery is turned off in System Settings
- **THEN** the endpoint responds `{ sent: false, skipped: true }` and the panel says email delivery is turned off rather than reporting success
