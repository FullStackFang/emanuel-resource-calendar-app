# Events-Department Access to Holidays & Closures (Calendar Markers)

- **Date:** 2026-06-11
- **Status:** Design approved; ready for implementation plan
- **Author:** brainstorming session

## Problem

Holidays & Closures (the `templeEvents__CalendarMarkers` feature) is **admin-only**
for all writes. Temple staff in the new **Events** department need to add and
manage holidays/closures themselves without being granted full `admin` role.

The requested model mirrors an existing precedent the app already ships:
approvers get **User Management** as a **top-level** nav item (not buried in the
Admin dropdown) because it is the one admin-area tool they may use. Events-dept
members should get **Holidays & Closures** the same way.

The twist: this is the **first** capability granted by *department* rather than
*role*. Department (`user.department`, a single string key) today only grants
*field-level* edit rights (e.g. `maintenance` → setup/teardown times). Here a
department grants a whole *feature*, deliberately independent of the user's role.

## Goals

- Anyone whose `user.department` is **Events** (`key: "events"`) can **add, edit,
  and delete** calendar markers — full parity with admins.
- The grant is **role-independent**: an Events-dept *viewer* gets it.
- Events-dept non-admins get a **top-level** "Holidays & Closures" nav link,
  exactly parallel to the approver "User Management" pattern.
- Admins are unchanged: they keep the existing link **inside** the Admin dropdown.
- The `/admin/calendar-markers` route gets a guard (today it has none), closing
  a small existing hole where any logged-in user can load the screen.
- One canonical rule, computed once on the backend, mirrored on the frontend the
  same way every other permission flag already is.

## Non-goals

- No change to marker **read** access — `GET /api/calendar-markers` is already
  open to all authenticated users, which already satisfies "viewable by anyone."
- No change to the marker data model, the ribbon rendering, `pushToOutlook`, or
  the reservation advisory.
- No generalized department→feature permission framework (YAGNI for one grant).
- No change to the admin role, the role hierarchy, or any other department's
  field-edit grants.
- No "add-only" tier — Events-dept gets full CRUD (locked decision e).

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| a | Department key to gate on | `"events"` (verified against the live `templeEvents__Departments` doc: `{name:"Events", key:"events", active:true}`); compared case-insensitively |
| b | Grant axis | **Department, role-independent** — `isAdmin OR department === 'events'` |
| c | Capability shape | A **named flag** `canManageCalendarMarkers`, threaded like `canManageUsers` (not inline string checks) |
| d | Nav placement | **Top-level for Events-dept non-admins** (`canManageCalendarMarkers && !isAdmin`); admins keep the **dropdown** link |
| e | CRUD scope | **Full CRUD** (POST + PUT + DELETE), admin parity |
| f | Read access | **Unchanged** — `GET` stays open to all authenticated users |
| g | Magic-string locus | The literal `'events'` lives in **one** backend constant; frontend reads booleans only |
| h | Simulation semantics | Role-simulation previews the **role** portion only (admin→true, others→false); the department portion is real and applies only when not simulating |

## Current state (verified 2026-06-11)

> Line numbers are from exploration and approximate; the implementation plan pins
> exact lines.

### Backend (`backend/api-server.js`)
- `GET /api/calendar-markers` (~`19624`): `verifyToken` only — open to all. **No change.**
- `POST /api/calendar-markers` (~`19645`), `PUT /api/calendar-markers/:id`
  (~`19696`), `DELETE /api/calendar-markers/:id` (~`19753`): each opens with
  `const user = await requireMarkerAdmin(req, res); if (!user) return;`.
- `requireMarkerAdmin(req, res)` (~`19500`): loads the user via
  `findUserByIdentity(usersCollection, req.user.userId, req.user.email)`, then
  `if (!isAdmin(user, req.user.email)) { res.status(403)…; return null; }`.

### Backend permission layer
- `getPermissions(user, userEmail)` (`backend/utils/permissionUtils.js:219-231`)
  returns `{ role, department, departmentEditableFields, canEditDepartmentFields,
  ...ROLE_PERMISSIONS[role] }`. Served by `GET /api/users/me/permissions`.
- `hasRole(user, email, role)` (`permissionUtils.js:179-184`) backs `isAdmin`
  (`authUtils.js:28-30`). `permissionUtils` does **not** import `authUtils`
  (one-way dependency: `authUtils → permissionUtils`), so the new predicate must
  use `hasRole` locally, not `isAdmin`, to avoid a circular import.
- `normalizeDepartment(d) = (d||'').toLowerCase().trim()` exists at
  `backend/utils/eventEditability.js:9-11`. The predicate will inline the
  identical one-liner rather than import it (keeps `permissionUtils` leaf-clean).

### Frontend
- `src/components/Navigation.jsx:158` — top-level User Management:
  `{canManageUsers && !isAdmin && (<li><NavLink to="/admin/users">User
  Management</NavLink></li>)}`. The Admin dropdown is gated `{isAdmin && (…)}`
  (~`168`) and contains the existing "Holidays & Closures" `NavLink`.
- `src/hooks/usePermissions.jsx` exposes `canManageUsers`, `isAdmin`,
  `department`, etc. from `effectivePermissions`.
- `src/context/RoleSimulationContext.jsx`: `ROLE_TEMPLATES` (viewer / requester /
  approver / admin) each carry an explicit `permissions` object;
  `DEFAULT_PERMISSIONS` is the most-restrictive fallback; `getEffectivePermissions()`
  returns the simulated template when simulating, else an **explicitly-listed**
  passthrough of `actualPermissions` (each flag named), else `DEFAULT_PERMISSIONS`.
  `actualDepartment` is stored but is not part of the simulated identity.
- `src/App.jsx:98-102` — `RequireUserManagement` guard:
  `if (!effectivePermissions.canManageUsers) return <Navigate to="/" replace/>`.
  Route `/admin/users` (`:343`) is wrapped; `/admin/calendar-markers` (`:345`)
  is **not** wrapped.
- `src/components/CalendarMarkersManagement.jsx`: no internal permission gate;
  relies on the backend 403. Add/edit/delete already use the in-button
  confirmation pattern.
- Test `src/__tests__/unit/components/Navigation.userManagement.test.jsx` locks
  the top-level-vs-dropdown IA — the template for the new nav test.

## The rule

```
canManageCalendarMarkers(user, email):
    return hasRole(user, email, 'admin')
        || normalize(user.department) === 'events'      // normalize = (d||'').toLowerCase().trim()
```

Single source of truth on the backend; the frontend mirrors it through the same
template + passthrough plumbing used for every existing flag (it does **not**
re-derive from the raw `'events'` string).

## Design

### 1. Backend predicate (one place, one string)
In `backend/utils/permissionUtils.js`:
- Add `const CALENDAR_MARKER_DEPARTMENT = 'events';`
- Add and export:
  ```js
  function canManageCalendarMarkers(user, userEmail) {
    if (hasRole(user, userEmail, 'admin')) return true;
    return (user?.department || '').toLowerCase().trim() === CALENDAR_MARKER_DEPARTMENT;
  }
  ```
- In `getPermissions()`, add `canManageCalendarMarkers: canManageCalendarMarkers(user, userEmail)`
  to the returned object (next to the role-derived flags). This flows through
  `GET /api/users/me/permissions` to the frontend automatically.

### 2. Backend enforcement (rename + reuse)
In `backend/api-server.js`:
- Replace `requireMarkerAdmin` with `requireMarkerManager(req, res)` — same
  shape, but the gate becomes
  `if (!canManageCalendarMarkers(user, req.user.email)) { res.status(403)
  .json({ error: 'Calendar marker management access required' }); return null; }`
  (import `canManageCalendarMarkers` from `permissionUtils`).
- Point the three write endpoints (POST/PUT/DELETE) at `requireMarkerManager`.
- `GET` is untouched. Each write endpoint keeps its existing body
  (validation, soft-delete, `active` index, cache invalidation) unchanged.

### 3. Frontend threading (mirror `canManageUsers` exactly)
In `src/context/RoleSimulationContext.jsx`:
- Add `canManageCalendarMarkers` to each `ROLE_TEMPLATES.*.permissions`:
  `admin: true`, `viewer/requester/approver: false` (the role portion only —
  decision h).
- Add `canManageCalendarMarkers: false` to `DEFAULT_PERMISSIONS`.
- In `getEffectivePermissions()`'s non-simulated branch, add the explicit
  passthrough `canManageCalendarMarkers: actualPermissions.canManageCalendarMarkers ?? false`.

In `src/hooks/usePermissions.jsx`:
- Expose `canManageCalendarMarkers: effectivePermissions.canManageCalendarMarkers`
  (and include it in the `useMemo` deps via `effectivePermissions`).

### 4. Navigation (top-level link)
In `src/components/Navigation.jsx`:
- Pull `canManageCalendarMarkers` from `usePermissions()`.
- Directly after the top-level User Management `<li>`, add:
  ```jsx
  {canManageCalendarMarkers && !isAdmin && (
    <li>
      <NavLink to="/admin/calendar-markers" className={({ isActive }) => isActive ? 'active' : ''}>
        Holidays &amp; Closures
      </NavLink>
    </li>
  )}
  ```
- The existing Admin-dropdown "Holidays & Closures" link is **unchanged** (admins
  still reach it there; `!isAdmin` keeps the top-level copy off their nav).

### 5. Route guard
In `src/App.jsx`:
- Add `RequireCalendarMarkers`, cloned from `RequireUserManagement`:
  ```jsx
  function RequireCalendarMarkers({ children }) {
    const { effectivePermissions } = useRoleSimulation();
    if (!effectivePermissions.canManageCalendarMarkers) return <Navigate to="/" replace />;
    return children;
  }
  ```
- Wrap route `:345`:
  `<Route path="/admin/calendar-markers" element={<RequireCalendarMarkers><CalendarMarkersManagement apiToken={apiToken} /></RequireCalendarMarkers>} />`

### 6. Screen
`CalendarMarkersManagement.jsx` needs **no** permission change — the route guard
plus backend enforcement cover it, matching how User Management trusts its guard.

## Behavior changes & edge cases (honest accounting)

- **Events-dept member, any role:** gains top-level nav link + full marker CRUD.
  A role-`viewer` in Events dept can now manage markers — intended (decision b).
- **Admin in Events dept:** `!isAdmin` suppresses the top-level copy; they use the
  dropdown as before. No duplicate link.
- **Events-dept approver:** sees **both** top-level "User Management"
  (`canManageUsers && !isAdmin`) and top-level "Holidays & Closures"
  (`canManageCalendarMarkers && !isAdmin`). Expected.
- **Route hole closed:** a viewer/requester who types `/admin/calendar-markers`
  now redirects to `/` instead of loading a 403-ing screen.
- **Simulation:** an admin simulating "viewer/requester/approver" sees the feature
  **hidden** (templates carry `false`); not simulating, the real backend answer
  (role OR dept) applies. Department is never simulated (decision h) — acceptable,
  since only admins can simulate and admins always have real access.
- **Case/whitespace in stored department:** handled — comparison lowercases+trims,
  so `"Events"`, `"events"`, `" events "` all match.
- **Department renamed/deactivated later:** gating is on the **stored
  `user.department` string** (`"events"`), not the `templeEvents__Departments`
  doc. Renaming the department's display name does not change existing user keys;
  changing the *key* or reassigning users is the admin's lever, as today.

## Verification plan (TDD-first per CLAUDE.md)

1. **Backend predicate** — `permissionUtils.test.js`: `getPermissions` returns
   `canManageCalendarMarkers === true` for (a) an `admin` and (b) a `viewer` with
   `department: 'events'`; `false` for a `viewer`/`requester`/`approver` with no
   dept or a different dept. Write first; implement predicate to green.
2. **Backend enforcement** — extend the calendar-markers backend test suite
   (add one if absent): with `TEST_AUTH_BYPASS`, assert POST/PUT/DELETE
   `/api/calendar-markers` **succeed** for an Events-dept non-admin and for an
   admin, and return **403** for a viewer and for an other-dept user; `GET`
   succeeds for all. Write first; rename middleware to green.
3. **Frontend nav** — new `Navigation.calendarMarkers.test.jsx` mirroring the
   User-Management test: Events-dept non-admin → top-level link, no dropdown;
   admin → link in dropdown, no top-level copy; plain viewer → neither.
4. **Frontend threading** — update any RoleSimulation/usePermissions tests or
   permission-shape snapshots to include the new flag.
5. Run only the touched suites (per CLAUDE.md "do not run the full suite").

## File-change inventory

- Edit `backend/utils/permissionUtils.js` — constant + `canManageCalendarMarkers`
  predicate (exported) + add flag to `getPermissions`.
- Edit `backend/api-server.js` — `requireMarkerAdmin` → `requireMarkerManager`
  (gate via predicate); repoint POST/PUT/DELETE; import predicate.
- Edit `src/context/RoleSimulationContext.jsx` — flag in `ROLE_TEMPLATES`,
  `DEFAULT_PERMISSIONS`, `getEffectivePermissions` passthrough.
- Edit `src/hooks/usePermissions.jsx` — expose the flag.
- Edit `src/components/Navigation.jsx` — top-level link.
- Edit `src/App.jsx` — `RequireCalendarMarkers` guard + wrap the route.
- Test: `backend/__tests__/.../permissionUtils.test.js` (extend), backend
  calendar-markers permission test (extend/add), `Navigation.calendarMarkers.test.jsx`
  (new), frontend permission-shape tests (touch as needed).

## Risks

- **Circular import:** computing the predicate inside `permissionUtils` must use
  local `hasRole`, not `authUtils.isAdmin` — designed around (uses `hasRole` +
  inline normalize).
- **Permission-shape snapshots:** adding a flag may break exact-shape assertions
  in context/permission tests — update them in step 4.
- **Two-language rule duplication:** the role portion is expressed in both
  `ROLE_PERMISSIONS`/predicate (BE) and `ROLE_TEMPLATES` (FE), exactly as every
  existing flag is — consistent with house style; the nav test locks agreement.
