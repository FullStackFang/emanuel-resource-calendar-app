## 1. Backend permission model (`backend/utils/permissionUtils.js`)

- [x] 1.1 Add `canManageUsers` to `ROLE_PERMISSIONS` (`true` for `approver` + `admin`, `false` for `viewer` + `requester`)
- [x] 1.2 Add `ROLE_MAX_ASSIGNABLE = { approver: 'requester', admin: 'admin' }`
- [x] 1.3 Add `USER_WRITABLE_FIELDS` allowlist and `sanitizeUserWrite(body)` (returns only allowlisted keys; reduces `preferences` to known preference keys)
- [x] 1.4 Add `assertUserManagementAllowed({ callerRole, targetCurrentRole, requestedRole })` returning `{ allowed, code, reason }`; cap enforced on both target-current and requested role; admin passes all
- [x] 1.5 Export the new symbols from the module
- [x] 1.6 Add `canManageUsers(user, email)` convenience wrapper in `backend/utils/authUtils.js`

## 2. Backend permission unit tests

- [x] 2.1 Unit-test `sanitizeUserWrite`: strips `isAdmin`, `permissions.*`, nested `preferences.isAdmin`; keeps allowlisted fields
- [x] 2.2 Unit-test `assertUserManagementAllowed` for every caller/target/requested combination (approver caps, admin passes, viewer/requester denied)
- [x] 2.3 Snapshot/shape test: `getPermissions('approver').canManageUsers === true` and `getPermissions('requester').canManageUsers === false` (drift guard vs frontend mirror)

## 3. Audit service (`backend/services/auditService.js`)

- [x] 3.1 Add `recordUserManagement({ targetUserId, targetEmail, callerEmail, callerRole, changeType, oldRole, newRole, metadata })` writing to `templeEvents__UserAuditHistory`; swallow errors (never block main op)
- [x] 3.2 Add `getUserAuditCollection()` and export `recordUserManagement`
- [x] 3.3 Create the `templeEvents__UserAuditHistory` index in the startup index-creation path (mirror existing audit-collection setup)

## 4. Backend endpoints (`backend/api-server.js`)

- [x] 4.1 `GET /api/users`: gate on `canManageUsers`; return a projection excluding legacy permission internals / token material (keep id, email, displayName, role, department, roleType, title, timestamps, lastLogin)
- [x] 4.2 `GET /api/users/:id`: gate on `canManageUsers`; unify caller lookup on `findUserByIdentity`
- [x] 4.3 `POST /api/users`: gate on `canManageUsers`; `sanitizeUserWrite` body; cap `requestedRole`; 403 `USER_MANAGEMENT_FORBIDDEN` on violation; audit create
- [x] 4.4 `PUT /api/users/:id`: gate on `canManageUsers`; load target, classify via `getEffectiveRole`; `sanitizeUserWrite`; cap target-current AND requested role; self-demote guard; 403 `USER_MANAGEMENT_FORBIDDEN`; audit update with old→new role; keep targeted `invalidateUserCache(userId)` + add stale-window comment
- [x] 4.5 `DELETE /api/users/:id`: gate on `canManageUsers`; classify target via `getEffectiveRole`; cap; self-delete guard; audit delete
- [x] 4.6 Ensure all cap-evaluation uses the caller's REAL role (`getEffectiveRole`), with an inline comment explaining why not `resolveEffectiveRole`

## 5. Backend integration tests (`backend/__tests__/userManagementApprover.test.js`)

- [x] 5.1 Approver creates `viewer`/`requester` (201); cannot create `approver`/`admin` (403 `USER_MANAGEMENT_FORBIDDEN`)
- [x] 5.2 Approver re-assigns `viewer`↔`requester` (200); cannot promote to `approver`/`admin` (403)
- [x] 5.3 Approver cannot edit or delete an `approver`/`admin` target, incl. legacy `isAdmin:true` target (403)
- [x] 5.4 Field-smuggle: approver write with `isAdmin:true` / `permissions.canViewAllReservations` / `preferences.isAdmin` is stripped (assert stored doc has none and effective role unchanged)
- [x] 5.5 Self-protection: caller cannot delete or demote self (403)
- [x] 5.6 Admin retains full unrestricted create/edit/delete (regression); viewer/requester still 403 on all (regression)
- [x] 5.7 Audit entry written to `templeEvents__UserAuditHistory` on create/update/delete; audit failure does not fail the operation (swallowed by recordUserManagement)

## 6. Frontend permission mirror + policy util

- [x] 6.1 Add `canManageUsers` to `ROLE_TEMPLATES` in `src/context/RoleSimulationContext.jsx` (approver + admin true) — keep mirror comment accurate
- [x] 6.2 Create `src/utils/userManagementPolicy.js`: `ROLE_MAX_ASSIGNABLE`, `getAssignableRoles(callerRole)`, `canManageTarget(callerRole, targetRole)`
- [x] 6.3 Unit-test `src/__tests__/unit/utils/userManagementPolicy.test.js` for every caller role

## 7. Frontend UI

- [x] 7.1 `src/components/Navigation.jsx`: open Admin dropdown on `isAdmin || canManageUsers`; gate User Management item on `canManageUsers`, other items on `isAdmin`
- [x] 7.2 `src/components/UserAdmin.jsx`: read caller role from permissions/role-simulation context; cap both role `<select>` sites via `getAssignableRoles`
- [x] 7.3 `src/components/UserAdmin.jsx`: lock rows where `!canManageTarget(callerRole, targetRole)` (no edit/role/delete controls + lock affordance); surface `USER_MANAGEMENT_FORBIDDEN` 403 reason via setError banner
- [x] 7.4 `src/components/UserAdmin.jsx`: reconcile `deriveRole()` — drop dead `preferences.*` legacy checks to match backend `getEffectiveRole`
- [x] 7.5 `src/App.jsx`: light client guard redirecting `/admin/users` when `!canManageUsers`
- [x] 7.6 `UserAdmin` render test: approver → capped role select + locked admin row; admin → all four roles, no locks

## 8. Verification

- [x] 8.1 Run targeted backend tests: `userManagementApprover.test.js` + permissionUtils unit + existing auditService unit — 71/71 pass
- [x] 8.2 Run targeted frontend tests: `userManagementPolicy` + `UserAdmin.roleCap` + useCurrentUserGates + RoleSimulationContext — all pass
- [x] 8.3 Lint touched files — no NEW errors (3 pre-existing errors on untouched lines; new files lint clean)
- [x] 8.4 Update `openspec` change status and prepare the commit message
