## ADDED Requirements

### Requirement: User-management entry gate

The system SHALL permit a caller to access user-administration operations (list, view, create, update, delete users) only when the caller's effective role grants `canManageUsers`. The `approver` and `admin` roles SHALL have `canManageUsers`; `viewer` and `requester` SHALL NOT. Callers without `canManageUsers` SHALL receive HTTP 403.

#### Scenario: Approver reaches user management
- **WHEN** an approver calls `GET /api/users`
- **THEN** the request succeeds (HTTP 200) and returns the user list

#### Scenario: Requester is denied
- **WHEN** a requester or viewer calls any user-administration endpoint
- **THEN** the system responds HTTP 403 and performs no read of other users' data

#### Scenario: Admin retains access
- **WHEN** an admin calls any user-administration endpoint
- **THEN** the request is permitted with no additional role cap applied

### Requirement: Role-assignment cap for approvers

The system SHALL constrain an approver so that every user they act on, and every role they assign, is at or below the `requester` level. The cap SHALL be defined by a role-to-maximum-assignable map where `approver` maps to `requester` and `admin` maps to `admin`. The target user's current role SHALL be classified using the effective-role derivation (honoring legacy fields), NOT the raw stored `role` field. A cap violation SHALL return HTTP 403 with code `USER_MANAGEMENT_FORBIDDEN`.

#### Scenario: Approver creates a low-privilege user
- **WHEN** an approver creates a user with role `viewer` or `requester`
- **THEN** the user is created (HTTP 201)

#### Scenario: Approver cannot create a privileged user
- **WHEN** an approver creates a user with role `approver` or `admin`
- **THEN** the system responds HTTP 403 with code `USER_MANAGEMENT_FORBIDDEN` and creates nothing

#### Scenario: Approver re-assigns within the cap
- **WHEN** an approver changes a `viewer` user to `requester`, or a `requester` user to `viewer`
- **THEN** the change succeeds (HTTP 200)

#### Scenario: Approver cannot promote across the cap
- **WHEN** an approver changes a `viewer` or `requester` user to `approver` or `admin`
- **THEN** the system responds HTTP 403 with code `USER_MANAGEMENT_FORBIDDEN` and the stored role is unchanged

#### Scenario: Approver cannot act on a privileged target
- **WHEN** an approver attempts to edit or delete a user whose effective role is `approver` or `admin`
- **THEN** the system responds HTTP 403 with code `USER_MANAGEMENT_FORBIDDEN`

#### Scenario: Legacy-field target is classified by effective role
- **WHEN** an approver attempts to act on a user that has no `role` field but `isAdmin: true`
- **THEN** the target is classified as `admin` and the action is denied (HTTP 403)

### Requirement: Cap evaluated against the caller's real role

The system SHALL evaluate the role cap using the caller's real effective role and SHALL NOT use the simulated role from the `X-Simulated-Role` header for cap evaluation.

#### Scenario: Admin simulating approver is not restricted in real writes
- **WHEN** an admin sends `X-Simulated-Role: approver` and performs a user-management write
- **THEN** the cap uses the admin's real role and the write is not restricted to the approver cap

### Requirement: Server-side write-field allowlist

The system SHALL persist only an explicit allowlist of user fields on create and update, for ALL callers including admins. The allowlist SHALL be `displayName`, `email`, `role`, `department`, `roleType`, `title`, `preferences`, and `notificationPreferences`. Any other field in the request body SHALL be dropped before persistence. The `preferences` object SHALL itself be restricted to known preference keys so privilege-bearing keys cannot be nested inside it.

#### Scenario: Smuggled legacy escalation field is stripped
- **WHEN** any caller submits a user write containing `isAdmin: true` or `permissions.canViewAllReservations: true`
- **THEN** the persisted document contains neither field and the user's effective role is unaffected by the submitted payload

#### Scenario: Nested escalation in preferences is stripped
- **WHEN** a caller submits `preferences: { isAdmin: true }`
- **THEN** the persisted `preferences` object does not contain `isAdmin`

#### Scenario: Allowed fields are persisted
- **WHEN** a caller submits a write with allowlisted fields
- **THEN** those fields are persisted as provided (subject to the role cap)

### Requirement: Self-protection guard

The system SHALL prevent any caller from deleting their own user account or lowering their own role through the user-management endpoints, independent of the role cap.

#### Scenario: Caller cannot delete self
- **WHEN** a caller invokes delete on their own user record
- **THEN** the system responds HTTP 403 and the record is not deleted

#### Scenario: Caller cannot demote self
- **WHEN** a caller submits an update that lowers their own role
- **THEN** the system responds HTTP 403 and the role is unchanged

### Requirement: User list excludes sensitive fields

The system SHALL return the user list through a projection that excludes sensitive and legacy internal fields rather than the raw stored document.

#### Scenario: List omits legacy permission internals
- **WHEN** a caller with `canManageUsers` lists users
- **THEN** the response items omit raw legacy permission internals and any stored token material while including the fields needed to render and manage the user (id, email, displayName, role, department, roleType, title)

### Requirement: User-management audit trail

The system SHALL record an audit entry for every successful user create, update, and delete, capturing the acting caller (email and role), the target user (id and email), the operation, and the role transition where applicable. Audit-write failures SHALL be logged and swallowed and SHALL NOT block or fail the underlying operation.

#### Scenario: Role change is audited
- **WHEN** a caller changes a user's role
- **THEN** an audit entry is written recording caller, target, old role, and new role

#### Scenario: Audit failure does not block the operation
- **WHEN** the audit write fails
- **THEN** the user create/update/delete still completes successfully

### Requirement: Frontend reflects the role cap

The frontend SHALL present user-management affordances consistent with the caller's cap: the role selector SHALL offer only assignable roles for the caller, and rows for users the caller cannot manage SHALL render read-only without edit, role-change, or delete controls. The User Management navigation entry SHALL be visible whenever the caller has `canManageUsers`.

#### Scenario: Approver sees a capped role selector
- **WHEN** an approver opens the role selector for a manageable user
- **THEN** only `viewer` and `requester` are offered

#### Scenario: Approver sees privileged rows locked
- **WHEN** an approver views the user list
- **THEN** rows whose effective role is `approver` or `admin` show no edit, role-change, or delete controls

#### Scenario: Approver sees the User Management nav entry
- **WHEN** an approver opens the navigation
- **THEN** the Admin area exposes the User Management entry while admin-only entries (categories, locations, calendar config) remain hidden
