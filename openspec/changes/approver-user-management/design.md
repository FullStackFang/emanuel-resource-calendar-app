## Context

User administration (`GET/POST/PUT/DELETE /api/users`) is gated on `isAdmin()`. The permission model in `backend/utils/permissionUtils.js` is a strict hierarchy `viewer(0) < requester(1) < approver(2) < admin(3)`; each role maps to a flat `ROLE_PERMISSIONS` flag set, and `getEffectiveRole(user)` derives the role from the `role` field with legacy fallbacks (`isAdmin`, `permissions.canViewAllReservations`). The frontend mirrors `ROLE_PERMISSIONS` in `ROLE_TEMPLATES` (`RoleSimulationContext.jsx`) and gates the Admin nav dropdown on `isAdmin`. `UserAdmin.jsx` renders a role `<select>` over a local `ROLES` map and uses only MSAL (no permission context).

A code-architecture review of the initial design surfaced a P0: `POST /api/users` and `PUT /api/users/:id` persist the raw request body (`insertOne(userData)` / `$set: updates`) with no field allowlist. A role-only cap is therefore insufficient — an approver could submit `{ role: 'requester', isAdmin: true }`, pass the cap, and have `getEffectiveRole` honor the smuggled legacy flag on next load. The allowlist is the prerequisite that must ship with the gate relaxation.

## Goals / Non-Goals

**Goals:**
- Let every approver create/edit/delete users capped at `viewer`/`requester`, with admins unchanged.
- Make role escalation structurally impossible for approvers (cap on both target-current and requested role; effective-role classification of targets; write-field allowlist).
- Keep the cap rule in exactly one place per layer (one backend function, one frontend util) to prevent drift.
- Add a user-management audit trail (new capability, applies to admins too).

**Non-Goals:**
- No change to the role hierarchy or to event/reservation permissions.
- No new per-user capability flag — the ability is intrinsic to the `approver` role.
- No Azure AD group/LDAP sync.
- No bulk user operations or invitation/email flow.

## Decisions

**Decision 1 — Intrinsic role flag, not a per-user grant.** Add `canManageUsers: true` to `approver` and `admin` in `ROLE_PERMISSIONS`. It flows automatically into `getPermissions()` (which spreads `ROLE_PERMISSIONS[role]`) and the `/permissions` payload. *Alternative considered:* a per-user `canManageUsers` boolean field — rejected because the user chose "all approvers," and it would add a second permission concept plus an admin toggle UI.

**Decision 2 — Separate entry gate from role cap.** Two distinct concepts: entry (`canManageUsers` — may you touch user management at all) and cap (`ROLE_MAX_ASSIGNABLE = { approver: 'requester', admin: 'admin' }` — the highest role you may assign or act on). Conflating them is the classic escalation bug. A single shared `assertUserManagementAllowed({ callerRole, targetCurrentRole, requestedRole })` enforces the cap on BOTH ends of a mutation; `targetCurrentRole`/`requestedRole` are passed only for the operations where they apply (create → requestedRole; delete → targetCurrentRole; edit-role → both). *Alternative considered:* inline checks per endpoint — rejected as drift-prone across five handlers.

**Decision 3 — Cap uses the caller's REAL role.** The endpoints classify the caller via `getEffectiveRole` (real role), never `resolveEffectiveRole` (simulation-aware). Otherwise an admin simulating `approver` for UI testing would have their own real writes restricted. This differs from endpoints that intentionally honor simulation, so it is documented inline at the call sites.

**Decision 4 — Write-field allowlist for ALL callers.** `USER_WRITABLE_FIELDS = ['displayName','email','role','department','roleType','title','preferences','notificationPreferences']`; `sanitizeUserWrite(body)` returns only those keys, and reduces `preferences` to known preference keys so `preferences.isAdmin` cannot ride along. Applied uniformly (admins included) because admins never legitimately write `isAdmin`/`permissions.*` (they set `role`), and one code path is safer than two. The cap validates the `role` VALUE; the allowlist removes dangerous FIELDS — both are required.

**Decision 5 — Effective-role classification of targets.** The cap classifies the target with `getEffectiveRole(targetUser)`, so a legacy admin (no `role`, `isAdmin: true`) is correctly treated as admin and protected from approver action.

**Decision 6 — Audit via a new auditService path.** `auditService` today records to event/reservation collections only. Add `recordUserManagement({ targetUserId, targetEmail, callerEmail, callerRole, changeType, oldRole, newRole, metadata })` writing to a new `templeEvents__UserAuditHistory` collection (with an index), mirroring `recordEvent`/`recordReservation`. Audit errors are swallowed — they must never block the underlying write.

**Decision 7 — Frontend single-source cap.** New `src/utils/userManagementPolicy.js` mirrors `ROLE_MAX_ASSIGNABLE` with `getAssignableRoles(callerRole)` and `canManageTarget(callerRole, targetRole)`, unit-tested in isolation. `UserAdmin.jsx` consumes it to cap the role `<select>` (inline edit + create modal) and lock un-manageable rows; it reads the caller role from the permissions/role-simulation context. `Navigation.jsx` opens the Admin dropdown on `isAdmin || canManageUsers` and gates each item individually. `App.jsx` adds a light client guard redirecting `/admin/users` when `!canManageUsers` (UX only; backend stays authoritative).

**Decision 8 — List projection.** `GET /api/users` returns a projection (id, email, displayName, role, department, roleType, title, plus timestamps/last-login needed by the UI) rather than the raw document, excluding legacy permission internals and any token material.

## Risks / Trade-offs

- **Drift between backend `ROLE_PERMISSIONS`/`ROLE_MAX_ASSIGNABLE` and the frontend mirrors** → a backend snapshot test asserts `getPermissions('approver').canManageUsers === true`; the FE policy util is unit-tested; both reference the same documented rule. A missing mirror fails falsy-silently, so the snapshot is the safety net.
- **Allowlist drops a field the UI legitimately needs** → the allowlist is derived from the fields `UserAdmin.jsx` actually edits; any future field must be added in one place. Mitigated by the create/update round-trip tests.
- **Approver now sees all users' PII** → accepted (approvers already see requester PII via reservations); narrowed by the list projection. Approver/admin rows are read-only.
- **5-minute user-cache TTL means a role change may take up to ~5 min to take effect for the target** → targeted `invalidateUserCache(userId)` on update; behavior documented in a code comment. Delete clears the whole cache (deleted user's id unavailable post-delete), unchanged.
- **Client-side row locking is not a security boundary** → the backend cap + allowlist are authoritative; the lock is UX. Tests assert backend denial independently of the UI.

## Migration Plan

- No data migration. The new `templeEvents__UserAuditHistory` collection and its index are created on startup alongside existing audit-collection setup; it simply begins empty.
- Deploy backend and frontend together (the FE expects `canManageUsers` in the permissions payload). If only the backend ships, approvers gain API access but no nav entry; if only the FE ships, the nav entry appears but writes 403 — so co-deploy.
- Rollback: revert both. No persisted user-document shape change to undo; audit entries are additive and harmless.

## Open Questions

- None blocking. Future follow-up could add a UI surface for the user-management audit log (out of scope here).
