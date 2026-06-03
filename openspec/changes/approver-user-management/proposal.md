## Why

Today, all user administration (create, edit role, delete) is gated behind the `admin` role. Admins are a scarce resource, so routine onboarding — granting a new staff member `viewer` or `requester` access — bottlenecks on them. Approvers already manage events and see requester PII through the reservation workflow, so they are well-positioned to handle low-privilege user onboarding without being able to escalate anyone (including themselves) to a privileged role.

## What Changes

- **Empower `approver` to manage users**, constrained so an approver may only act on users whose effective role is `viewer` or `requester`, and may only assign roles up to `requester`. Admins retain full, unrestricted user management.
- All approvers receive this ability automatically — no new per-user flag on the user document.
- Approvers see every user in the list, but rows for `approver`/`admin` users render locked (read-only) client-side.
- **Harden the user-write endpoints with a field allowlist** applied to ALL callers (including admins). `POST /api/users` and `PUT /api/users/:id` currently persist the raw request body, which — once approvers can write — is a privilege-escalation vector (smuggling `isAdmin: true` or `permissions.canViewAllReservations` past a role-only cap). The allowlist closes this for everyone.
- **Add a user-management audit trail.** No audit record exists today for user create/update/delete, even for admins. Every such operation now writes a `templeEvents__UserAuditHistory` entry.
- Relax the five user CRUD endpoints from an `isAdmin()` gate to a `canManageUsers` entry gate plus a role cap; the target user is classified via `getEffectiveRole()` so legacy-field users cannot be misclassified.
- Frontend: surface User Management to approvers, cap the role selector, lock un-manageable rows.

## Capabilities

### New Capabilities
- `user-management`: Role-gated administration of user accounts — who may list, create, edit, and delete users; the role-assignment cap that constrains approvers to `viewer`/`requester`; the server-side write-field allowlist that prevents privilege escalation; and the audit trail for all user mutations.

### Modified Capabilities
<!-- None: there is no existing user-management / permissions capability spec. The permission hierarchy itself is unchanged. -->

## Impact

- **Backend**: `backend/utils/permissionUtils.js` (new `canManageUsers` flag, `ROLE_MAX_ASSIGNABLE`, `assertUserManagementAllowed`, `USER_WRITABLE_FIELDS`/`sanitizeUserWrite`); `backend/utils/authUtils.js` (new `canManageUsers` wrapper); `backend/api-server.js` (5 user CRUD endpoints: `GET /api/users`, `GET /api/users/:id`, `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`); `backend/services/auditService.js` (new `recordUserManagement` + `templeEvents__UserAuditHistory` collection/index).
- **Frontend**: `src/context/RoleSimulationContext.jsx` (mirror `canManageUsers` into `ROLE_TEMPLATES`); new `src/utils/userManagementPolicy.js`; `src/components/Navigation.jsx` (per-item Admin dropdown gating); `src/components/UserAdmin.jsx` (capped role selects, locked rows, caller-role from permissions context, reconcile `deriveRole`); `src/App.jsx` (light client guard on `/admin/users`).
- **Data**: new `templeEvents__UserAuditHistory` collection. No migration of existing user documents required.
- **Security**: privilege-escalation surface on user-write endpoints closed via field allowlist; cap evaluated against the caller's real role (never the simulated role).
- **Tests**: new backend `userManagementApprover.test.js` (incl. field-smuggle stripping + audit assertions), a permission-shape drift snapshot, frontend `userManagementPolicy.test.js`, and a `UserAdmin` render test.
