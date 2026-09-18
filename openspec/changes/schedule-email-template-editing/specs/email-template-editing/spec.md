## ADDED Requirements

### Requirement: Approvers and admins may edit email templates
The system SHALL grant a `canEditEmailTemplates` permission to users whose
effective role is approver or admin, and SHALL deny it to viewers and
requesters regardless of department. The server SHALL re-fetch the user record
to evaluate it and SHALL NOT trust token claims.

#### Scenario: Approver lists templates
- **WHEN** an approver calls `GET /api/admin/email/templates`
- **THEN** the system responds 200 with every template

#### Scenario: Approver saves a template
- **WHEN** an approver calls `PUT /api/admin/email/templates/:id` with a subject and body
- **THEN** the override is stored with `updatedBy` set to the approver's email and the response is 200

#### Scenario: Approver previews and resets a template
- **WHEN** an approver calls the template preview or reset endpoint
- **THEN** the system responds 200 and behaves exactly as it does for an admin

#### Scenario: Requester is refused
- **WHEN** a requester calls any of the five template endpoints
- **THEN** the system responds 403

#### Scenario: Events-department non-approver is refused
- **WHEN** a user with role requester and department 'events' calls `PUT /api/admin/email/templates/:id`
- **THEN** the system responds 403

### Requirement: Email delivery settings remain admin-only
The system SHALL keep `GET /api/admin/email/config`,
`PUT /api/admin/email/settings` and `POST /api/admin/email/test` restricted to
admins.

#### Scenario: Approver cannot read or change delivery settings
- **WHEN** an approver calls `GET /api/admin/email/config`, `PUT /api/admin/email/settings` or `POST /api/admin/email/test`
- **THEN** the system responds 403 and no setting changes

### Requirement: Email Management shows approvers the Templates tab only
The Email Management page SHALL be reachable by users with
`canEditEmailTemplates`. For non-admins it SHALL render only the Templates
tab, SHALL open on it, and SHALL NOT request the admin-only config endpoint.
Users without the permission SHALL be redirected away from the route.

#### Scenario: Approver opens Email Management
- **WHEN** a non-admin approver navigates to `/admin/email-test`
- **THEN** the Templates tab is shown, no Settings tab is rendered, and no request is made to `/api/admin/email/config`

#### Scenario: Admin sees both tabs
- **WHEN** an admin navigates to `/admin/email-test`
- **THEN** both the Settings and Templates tabs are available

#### Scenario: Requester is redirected
- **WHEN** a requester navigates to `/admin/email-test`
- **THEN** the page is not rendered and the user is redirected

#### Scenario: Approver sees the nav link
- **WHEN** a non-admin approver views the navigation
- **THEN** an Email Management link is visible

### Requirement: Template saves detect a concurrent change
`PUT /api/admin/email/templates/:id` SHALL accept an optional
`expectedUpdatedAt`. When supplied and it does not equal the stored override's
`updatedAt` (with `null` meaning "no override stored"), the system SHALL
respond 409 with code `TEMPLATE_CHANGED` and the current subject, body,
`updatedBy` and `updatedAt`, and SHALL NOT write. When omitted the save SHALL
behave as before (last write wins).

#### Scenario: Stale save is refused
- **WHEN** approver A loads a template at `updatedAt` T1, approver B saves it (now T2), and A saves with `expectedUpdatedAt` T1
- **THEN** A receives 409 `TEMPLATE_CHANGED` carrying B's content and B's save is intact

#### Scenario: Save of an uncustomized template while someone else customizes it
- **WHEN** a client saves with `expectedUpdatedAt: null` but an override now exists
- **THEN** the system responds 409 `TEMPLATE_CHANGED`

#### Scenario: Legacy client without the field
- **WHEN** a save omits `expectedUpdatedAt`
- **THEN** the override is written as before

### Requirement: One shared template editor component
The system SHALL render template editing through one shared component used by
both Email Management and the Email Schedules panel. It covers the subject,
rich-text body, variables list, Save, two-step Reset to default (in-button
confirmation) and last-updated metadata.

#### Scenario: Same editor behavior in both places
- **WHEN** a template is edited and saved from either Email Management or the Email Schedules panel
- **THEN** the same component, validation and save endpoint are used, and the other screen shows the saved text on its next load
