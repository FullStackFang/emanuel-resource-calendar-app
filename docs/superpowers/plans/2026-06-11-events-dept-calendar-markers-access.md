# Events-Department Access to Holidays & Closures — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone whose `user.department` is `"events"` add/edit/delete Holidays & Closures (calendar markers) — full parity with admins — with a top-level nav link, while admins keep their existing dropdown entry.

**Architecture:** One backend predicate `canManageCalendarMarkers(user, email) = isAdmin || department === 'events'` becomes the single rule. It is added to `ROLE_PERMISSIONS` (role-projection) + computed (department-aware) in `getPermissions()`, threaded to the frontend exactly like `canManageUsers` (templates → effective-permissions passthrough → `usePermissions()`), and enforced on the three marker write endpoints via a renamed `requireMarkerManager`. The nav gets a top-level link (with the whole-nav early-return updated so an Events-dept viewer isn't hidden), and the route gets a `RequireCalendarMarkers` guard.

**Tech Stack:** Node.js/Express + MongoDB (backend, Jest + supertest + mongodb-memory-server), React 19 + Vite (frontend, Vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-06-11-events-dept-calendar-markers-access-design.md`

**Branch:** `feat/events-dept-calendar-markers` (already checked out; the spec is committed there).

---

## Conventions for every commit

- Commit messages: `<type>(<scope>): <summary>`, single quotes only (NEVER double quotes), summary < 72 chars.
- End each commit body with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Run only the specific test file(s) named in each task — do NOT run the full suite (CLAUDE.md rule).

---

## Task 1: Backend predicate + getPermissions flag (`permissionUtils.js`)

**Files:**
- Test: `backend/__tests__/unit/utils/permissionUtils.test.js` (add a describe block)
- Modify: `backend/utils/permissionUtils.js` (ROLE_PERMISSIONS, new const+function, getPermissions, exports)

- [ ] **Step 1: Write the failing tests**

In `backend/__tests__/unit/utils/permissionUtils.test.js`, add this describe block immediately after the existing `describe('canManageUsers flag (drift guard vs frontend ROLE_TEMPLATES)', ...)` block (it closes at the line `  });` before `describe('sanitizeUserWrite', ...)`). `getPermissions` and `ROLE_PERMISSIONS` are already imported at the top of this file.

```js
  describe('canManageCalendarMarkers flag (Events-department feature grant)', () => {
    it('role-projection on ROLE_PERMISSIONS: admin only', () => {
      expect(ROLE_PERMISSIONS.viewer.canManageCalendarMarkers).toBe(false);
      expect(ROLE_PERMISSIONS.requester.canManageCalendarMarkers).toBe(false);
      expect(ROLE_PERMISSIONS.approver.canManageCalendarMarkers).toBe(false);
      expect(ROLE_PERMISSIONS.admin.canManageCalendarMarkers).toBe(true);
    });

    it('getPermissions grants to any admin', () => {
      expect(getPermissions({ role: 'admin' }, 'a@x.org').canManageCalendarMarkers).toBe(true);
    });

    it('getPermissions grants to a non-admin in the events department (role-independent)', () => {
      expect(getPermissions({ role: 'viewer', department: 'events' }, 'v@x.org').canManageCalendarMarkers).toBe(true);
      expect(getPermissions({ role: 'requester', department: 'events' }, 'r@x.org').canManageCalendarMarkers).toBe(true);
    });

    it('getPermissions denies a non-admin outside the events department', () => {
      expect(getPermissions({ role: 'viewer' }, 'v@x.org').canManageCalendarMarkers).toBe(false);
      expect(getPermissions({ role: 'requester', department: 'security' }, 's@x.org').canManageCalendarMarkers).toBe(false);
      expect(getPermissions({ role: 'approver' }, 'a@x.org').canManageCalendarMarkers).toBe(false);
    });

    it('matches the department case-insensitively and trims whitespace', () => {
      expect(getPermissions({ role: 'viewer', department: 'Events' }, 'v@x.org').canManageCalendarMarkers).toBe(true);
      expect(getPermissions({ role: 'viewer', department: '  events  ' }, 'v@x.org').canManageCalendarMarkers).toBe(true);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- permissionUtils.test.js`
Expected: FAIL — `canManageCalendarMarkers` is `undefined`, so every `toBe(true/false)` on it fails.

- [ ] **Step 3: Add the flag to `ROLE_PERMISSIONS`**

In `backend/utils/permissionUtils.js`, in the `ROLE_PERMISSIONS` object (lines 43-93), add a `canManageCalendarMarkers` line immediately after the `canManageUsers` line in each role — value `false` for viewer/requester/approver, `true` for admin. The `admin` block becomes exactly:

```js
  admin: {
    canViewCalendar: true,
    canSubmitReservation: true,
    canCreateEvents: true,
    canEditEvents: true,
    canDeleteEvents: true,
    canApproveReservations: true,
    canViewAllReservations: true,
    canGenerateReservationTokens: true,
    canManageUsers: true,
    canManageCalendarMarkers: true,
    isAdmin: true
  }
```

For `viewer`, `requester`, and `approver`, insert `    canManageCalendarMarkers: false,` directly after their `canManageUsers: ...,` line (above `isAdmin`).

- [ ] **Step 4: Add the constant + predicate above `getPermissions`**

In `backend/utils/permissionUtils.js`, immediately BEFORE the `/**\n * Get all permissions for a user...` JSDoc that precedes `function getPermissions` (around line 212), insert:

```js
// The Events department is granted full management of calendar markers
// (Holidays & Closures) — the app's FIRST department-grants-a-feature gate.
// See docs/superpowers/specs/2026-06-11-events-dept-calendar-markers-access-design.md.
const CALENDAR_MARKER_DEPARTMENT = 'events';

/**
 * Whether a user may create/update/delete calendar markers (Holidays &
 * Closures). Granted to admins OR anyone whose department is Events —
 * deliberately role-independent. Uses local hasRole (NOT authUtils.isAdmin)
 * to avoid a circular import.
 *
 * @param {Object} user - User object from database (can be null)
 * @param {string} userEmail - User's email address
 * @returns {boolean}
 */
function canManageCalendarMarkers(user, userEmail) {
  if (hasRole(user, userEmail, 'admin')) return true;
  return (user?.department || '').toLowerCase().trim() === CALENDAR_MARKER_DEPARTMENT;
}
```

- [ ] **Step 5: Compute the department-aware value in `getPermissions`**

In `backend/utils/permissionUtils.js`, change the `getPermissions` return (currently lines 224-230) to add a trailing comma after the spread and an override line:

```js
  return {
    role,
    department,
    departmentEditableFields,
    canEditDepartmentFields: departmentEditableFields.length > 0,
    ...ROLE_PERMISSIONS[role],
    canManageCalendarMarkers: canManageCalendarMarkers(user, userEmail)
  };
```

- [ ] **Step 6: Export the predicate**

In `backend/utils/permissionUtils.js`, in `module.exports` (lines 362-380), add `canManageCalendarMarkers,` immediately after the `getPermissions,` line.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && npm test -- permissionUtils.test.js`
Expected: PASS (all existing tests in the file still green, plus the 5 new ones).

Then check whether any OTHER backend suite asserts the exact `getPermissions`/permissions-endpoint shape (a strict-equality assertion would now be missing `canManageCalendarMarkers`):

Run: `grep -rln "canManageUsers" backend/__tests__`
For each file returned other than `permissionUtils.test.js`, open it; if it uses `toEqual`/`toStrictEqual`/`toMatchObject` on a permissions object, add `canManageCalendarMarkers` (admin/events → `true`, else `false`) to the expected shape and re-run that file. If they only use selective `.toBe`/`.toContain` assertions, no change is needed.

- [ ] **Step 8: Commit**

```bash
git add backend/utils/permissionUtils.js backend/__tests__/unit/utils/permissionUtils.test.js
git commit -m "feat(permissions): add canManageCalendarMarkers predicate" -m "- isAdmin OR department 'events'; role-projection on ROLE_PERMISSIONS,
  department-aware override in getPermissions
- Tests: 5 new, permissionUtils suite passing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Backend enforcement — `requireMarkerManager` (authUtils re-export + api-server)

**Files:**
- Test: `backend/__tests__/calendarMarkers.test.js` (add a describe block + one import)
- Modify: `backend/utils/authUtils.js` (re-export the predicate)
- Modify: `backend/api-server.js` (import + rename gate + 3 call sites)

- [ ] **Step 1: Write the failing tests**

In `backend/__tests__/calendarMarkers.test.js`, first add `createViewer` to the userFactory import (line 19):

```js
const { createAdmin, createApprover, createRequester, createViewer, insertUsers } = require('./__helpers__/userFactory');
```

Then add this describe block inside the outer `describe('Calendar Markers', ...)`, immediately after the `describe('Soft delete (DELETE /api/calendar-markers/:id)', ...)` block closes (after its final `  });`, before `describe('Read API ...')`):

```js
  describe('Events-department access (non-admin, role-independent)', () => {
    let eventsViewerToken;
    let eventsRequesterToken;
    let plainViewerToken;
    let securityToken;

    beforeEach(async () => {
      const eventsViewer = createViewer({ email: 'events-viewer@test.com', userId: 'events-viewer', department: 'events' });
      const eventsRequester = createRequester({ email: 'events-requester@test.com', userId: 'events-requester', department: 'events' });
      const plainViewer = createViewer({ email: 'plain-viewer@test.com', userId: 'plain-viewer' });
      const securityUser = createRequester({ email: 'security@test.com', userId: 'security-user', department: 'security' });
      await insertUsers(db, [eventsViewer, eventsRequester, plainViewer, securityUser]);
      eventsViewerToken = await createMockToken(eventsViewer);
      eventsRequesterToken = await createMockToken(eventsRequester);
      plainViewerToken = await createMockToken(plainViewer);
      securityToken = await createMockToken(securityUser);
    });

    it('events-dept viewer can CREATE a marker (201)', async () => {
      const res = await post(eventsViewerToken, validMarker());
      expect(res.status).toBe(201);
      expect(await db.collection(MARKERS_COLLECTION).countDocuments({})).toBe(1);
    });

    it('events-dept requester can UPDATE a marker (200)', async () => {
      const created = await post(adminToken, validMarker());
      const res = await put(eventsRequesterToken, created.body._id, { ...validMarker(), name: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Updated');
    });

    it('events-dept viewer can DELETE a marker (200, soft-delete)', async () => {
      const created = await post(adminToken, validMarker());
      const res = await del(eventsViewerToken, created.body._id);
      expect(res.status).toBe(200);
      const stored = await db.collection(MARKERS_COLLECTION).findOne({});
      expect(stored.active).toBe(false);
    });

    it('a viewer NOT in the events department is still blocked (403)', async () => {
      const res = await post(plainViewerToken, validMarker());
      expect(res.status).toBe(403);
      expect(await db.collection(MARKERS_COLLECTION).countDocuments({})).toBe(0);
    });

    it('a non-events department (security) is blocked (403)', async () => {
      const res = await post(securityToken, validMarker());
      expect(res.status).toBe(403);
      expect(await db.collection(MARKERS_COLLECTION).countDocuments({})).toBe(0);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- calendarMarkers.test.js`
Expected: FAIL — the three "events-dept ... can CREATE/UPDATE/DELETE" tests get `403` (current `requireMarkerAdmin` only allows admins). The two "blocked" tests already pass.

- [ ] **Step 3: Re-export the predicate from `authUtils`**

In `backend/utils/authUtils.js`, add `canManageCalendarMarkers` to BOTH the require-destructure (line 17) and `module.exports` (lines 129-149).

Line 17 becomes:
```js
const { hasRole, getPermissions, canManageCalendarMarkers, getEffectiveRole, resolveEffectiveRole, getDepartmentEditableFields, canEditField, sanitizeUserWrite, assertUserManagementAllowed, DEPARTMENT_EDITABLE_FIELDS, ROLE_HIERARCHY, VALID_ROLES, DEFAULT_ADMIN_DOMAIN } = require('./permissionUtils');
```

In `module.exports`, add `  canManageCalendarMarkers,` immediately after the `getPermissions,` line.

- [ ] **Step 4: Import the predicate into `api-server.js`**

In `backend/api-server.js`, line 22, add `canManageCalendarMarkers` to the destructure from `./utils/authUtils` (insert after `canManageUsers,`):

```js
const { isAdmin, canViewAllReservations, canGenerateReservationTokens, canApproveReservations, canSubmitReservation, canManageUsers, canManageCalendarMarkers, canAccessEventAttachments, getPermissions, getDepartmentEditableFields, getEffectiveRole, resolveEffectiveRole, sanitizeUserWrite, assertUserManagementAllowed, ROLE_HIERARCHY } = require('./utils/authUtils');
```

- [ ] **Step 5: Rename the gate to `requireMarkerManager` and widen it**

In `backend/api-server.js`, replace the whole `requireMarkerAdmin` function (lines 19499-19510) with:

```js
/**
 * Management gate shared by the marker write endpoints. Resolves the request
 * user and returns it when they may manage calendar markers (admin OR Events
 * department); otherwise sends 403 and returns null.
 */
async function requireMarkerManager(req, res) {
  const user = await findUserByIdentity(usersCollection, req.user.userId, req.user.email);
  if (!canManageCalendarMarkers(user, req.user.email)) {
    res.status(403).json({ error: 'Calendar marker management access required' });
    return null;
  }
  return user;
}
```

- [ ] **Step 6: Repoint the three write endpoints**

In `backend/api-server.js`, the marker POST (~19647), PUT (~19698), and DELETE (~19755) each contain the identical line:

```js
    const user = await requireMarkerAdmin(req, res);
```

Replace all three occurrences with:

```js
    const user = await requireMarkerManager(req, res);
```

- [ ] **Step 7: Verify no stale references remain**

Run: `grep -rn "requireMarkerAdmin" backend/`
Expected: no matches (the name is fully gone).

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd backend && npm test -- calendarMarkers.test.js`
Expected: PASS — all original admin/approver/requester cases AND the 5 new Events-department cases green.

- [ ] **Step 9: Commit**

```bash
git add backend/utils/authUtils.js backend/api-server.js backend/__tests__/calendarMarkers.test.js
git commit -m "feat(calendar-markers): allow Events dept to manage markers" -m "- Rename requireMarkerAdmin -> requireMarkerManager (admin OR events dept)
- Re-export predicate through authUtils; GET stays open to all
- Tests: 5 new (events-dept CRUD + non-events 403), calendarMarkers suite passing

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend permission threading (context + hook + fallback)

**Files:**
- Test: `src/__tests__/unit/hooks/usePermissions.contract.test.jsx` (PERMS helper + 1 test)
- Test: `src/__tests__/unit/context/RoleSimulationContext.effectivePermissions.test.jsx` (Probe + payloads + 2 tests)
- Modify: `src/context/RoleSimulationContext.jsx` (ROLE_TEMPLATES + getEffectivePermissions)
- Modify: `src/hooks/usePermissions.jsx` (forward the flag)
- Modify: `src/services/permissionService.js` (fallback shape)

- [ ] **Step 1: Write the failing contract test**

In `src/__tests__/unit/hooks/usePermissions.contract.test.jsx`, add `canManageCalendarMarkers: true,` to the `PERMS` helper (after the `canManageUsers: true,` line, ~line 38) so the helper default carries the flag.

Then add this test inside `describe('usePermissions() contract', ...)`, after the `forwards \`canManageUsers\`` test (~line 90):

```js
  it('forwards `canManageCalendarMarkers` from effective permissions', () => {
    mockSim = simState({ effectivePermissions: PERMS({ canManageCalendarMarkers: true }) });
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canManageCalendarMarkers).toBe(true);

    mockSim = simState({ effectivePermissions: PERMS({ canManageCalendarMarkers: false }) });
    const { result: r2 } = renderHook(() => usePermissions());
    expect(r2.current.canManageCalendarMarkers).toBe(false);
  });
```

- [ ] **Step 2: Write the failing passthrough test**

In `src/__tests__/unit/context/RoleSimulationContext.effectivePermissions.test.jsx`:

(a) Replace the `Probe` component (lines 82-85) with:

```js
function Probe() {
  const { canManageUsers, canManageCalendarMarkers } = usePermissions();
  return (
    <>
      <span data-testid="canManageUsers">{String(canManageUsers)}</span>
      <span data-testid="canManageCalendarMarkers">{String(canManageCalendarMarkers)}</span>
    </>
  );
}
```

(b) Add `canManageCalendarMarkers` to the payload constants. Change `ADMIN` (add the flag), and override it in `APPROVER`/`REQUESTER`, then add `EVENTS_VIEWER`. The constants block (lines 58-80) becomes:

```js
const ADMIN = {
  role: 'admin',
  canViewCalendar: true,
  canSubmitReservation: true,
  canCreateEvents: true,
  canEditEvents: true,
  canDeleteEvents: true,
  canApproveReservations: true,
  canViewAllReservations: true,
  canGenerateReservationTokens: true,
  canManageUsers: true,
  canManageCalendarMarkers: true,
  isAdmin: true,
  department: null,
  departmentEditableFields: [],
};
const APPROVER = { ...ADMIN, role: 'approver', isAdmin: false, canManageCalendarMarkers: false };
const REQUESTER = {
  ...ADMIN,
  role: 'requester',
  canApproveReservations: false,
  canManageUsers: false,
  canManageCalendarMarkers: false,
  isAdmin: false,
};
const EVENTS_VIEWER = {
  ...REQUESTER,
  role: 'viewer',
  canSubmitReservation: false,
  department: 'events',
  canManageCalendarMarkers: true,
};
```

(c) Add these two tests inside `describe('RoleSimulationContext effective permissions passthrough', ...)`, after the `EP-3` test (~line 130):

```js
  it('EP-4: forwards canManageCalendarMarkers=true for a real Events-dept viewer', async () => {
    h.fetchPermissions.mockResolvedValue(EVENTS_VIEWER);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('canManageCalendarMarkers').textContent).toBe('true')
    );
  });

  it('EP-5: forwards canManageCalendarMarkers=false for a real requester', async () => {
    h.fetchPermissions.mockResolvedValue(REQUESTER);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId('canManageCalendarMarkers').textContent).toBe('false')
    );
  });
```

- [ ] **Step 3: Run both tests to verify they fail**

Run:
```bash
npm run test:run -- src/__tests__/unit/hooks/usePermissions.contract.test.jsx src/__tests__/unit/context/RoleSimulationContext.effectivePermissions.test.jsx
```
Expected: FAIL — `canManageCalendarMarkers` resolves to `undefined` (string `"undefined"`), so the contract test and EP-4/EP-5 fail.

- [ ] **Step 4: Add the flag to `ROLE_TEMPLATES`**

In `src/context/RoleSimulationContext.jsx`, in each of the four `ROLE_TEMPLATES.*.permissions` objects (lines 19-85), add `canManageCalendarMarkers: <bool>,` immediately after the `canManageUsers: ...,` line — `false` for viewer/requester/approver, `true` for admin. The admin `permissions` block becomes:

```js
    permissions: {
      canViewCalendar: true,
      canSubmitReservation: true,
      canCreateEvents: true,
      canEditEvents: true,
      canDeleteEvents: true,
      canApproveReservations: true,
      canViewAllReservations: true,
      canGenerateReservationTokens: true,
      canManageUsers: true,
      canManageCalendarMarkers: true,
      isAdmin: true
    }
```

(`DEFAULT_PERMISSIONS` at line 88 is `ROLE_TEMPLATES.viewer.permissions` — it inherits the viewer flag automatically; no separate edit.)

- [ ] **Step 5: Add the flag to the non-simulated passthrough**

In `src/context/RoleSimulationContext.jsx`, in `getEffectivePermissions()` (the `if (actualPermissions)` return, lines 235-249), add this line immediately after the `canManageUsers: actualPermissions.canManageUsers ?? false,` line (before `isAdmin`):

```js
        canManageCalendarMarkers: actualPermissions.canManageCalendarMarkers ?? false,
```

- [ ] **Step 6: Forward the flag from `usePermissions`**

In `src/hooks/usePermissions.jsx`, in the `useMemo` return (lines 45-66), add this line immediately after `canManageUsers: effectivePermissions.canManageUsers,` (line 52):

```js
    canManageCalendarMarkers: effectivePermissions.canManageCalendarMarkers,
```

- [ ] **Step 7: Keep the fetch-failure fallback shape in sync**

In `src/services/permissionService.js`, in the fallback object returned on fetch error (lines 69-82), add this line immediately after `canGenerateReservationTokens: false,` (line 80, before `isAdmin: false`):

```js
      canManageCalendarMarkers: false,
```

- [ ] **Step 8: Run both tests to verify they pass**

Run:
```bash
npm run test:run -- src/__tests__/unit/hooks/usePermissions.contract.test.jsx src/__tests__/unit/context/RoleSimulationContext.effectivePermissions.test.jsx
```
Expected: PASS (existing EP-1..EP-3 and contract tests still green, plus the new ones).

- [ ] **Step 9: Commit**

```bash
git add src/context/RoleSimulationContext.jsx src/hooks/usePermissions.jsx src/services/permissionService.js src/__tests__/unit/hooks/usePermissions.contract.test.jsx src/__tests__/unit/context/RoleSimulationContext.effectivePermissions.test.jsx
git commit -m "feat(permissions): thread canManageCalendarMarkers to frontend" -m "- ROLE_TEMPLATES + effectivePermissions passthrough + usePermissions forward
- permissionService fallback shape parity
- Tests: contract + effectivePermissions passthrough (EP-4/EP-5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Navigation — early-return fix + top-level link

**Files:**
- Test: `src/__tests__/unit/components/Navigation.calendarMarkers.test.jsx` (new)
- Modify: `src/components/Navigation.jsx` (destructure + early return + link)

- [ ] **Step 1: Write the failing test (new file)**

Create `src/__tests__/unit/components/Navigation.calendarMarkers.test.jsx`:

```jsx
// src/__tests__/unit/components/Navigation.calendarMarkers.test.jsx
//
// Locks the Holidays & Closures navigation IA for Events-department members vs
// admins — parallels Navigation.userManagement.test.jsx.
//
// Anyone whose department is "events" has canManageCalendarMarkers: true
// (role-independent — even a viewer). The nav must surface a TOP-LEVEL
// "Holidays & Closures" link for them; admins reach it inside the Admin
// dropdown. The whole-nav early return (which hides the nav for plain viewers)
// must NOT fire for an Events-dept viewer, or the link would never render.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let mockPermissions = {};
vi.mock('../../../hooks/usePermissions', () => ({
  usePermissions: () => mockPermissions,
}));

vi.mock('../../../hooks/usePolling', () => ({ usePolling: vi.fn() }));
vi.mock('../../../hooks/useDataRefreshBus', () => ({ useDataRefreshBus: vi.fn() }));
vi.mock('../../../hooks/useAuthenticatedFetch', () => ({
  useAuthenticatedFetch: () => vi.fn(() => Promise.resolve({ ok: false })),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: null }),
}));
vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));

import Navigation from '../../../components/Navigation';

const baseViewer = {
  canViewCalendar: true,
  canSubmitReservation: false,
  canApproveReservations: false,
  canManageUsers: false,
  canManageCalendarMarkers: false,
  isAdmin: false,
};

function renderNav() {
  return render(
    <MemoryRouter>
      <Navigation />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockPermissions = { ...baseViewer };
});

describe('Navigation — Holidays & Closures IA', () => {
  it('events-dept viewer: shows a top-level Holidays & Closures link and no Admin dropdown', () => {
    mockPermissions = { ...baseViewer, canManageCalendarMarkers: true };
    renderNav();

    const link = screen.getByRole('link', { name: 'Holidays & Closures' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/admin/calendar-markers');

    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('admin: shows the link inside the Admin dropdown, no duplicate top-level link', () => {
    mockPermissions = {
      ...baseViewer,
      canSubmitReservation: true,
      canApproveReservations: true,
      canManageUsers: true,
      canManageCalendarMarkers: true,
      isAdmin: true,
    };
    renderNav();

    const adminToggle = screen.getByText('Admin');
    expect(adminToggle).toBeInTheDocument();

    expect(screen.queryByRole('link', { name: 'Holidays & Closures' })).not.toBeInTheDocument();

    fireEvent.click(adminToggle);
    const link = screen.getByRole('link', { name: 'Holidays & Closures' });
    expect(link.getAttribute('href')).toBe('/admin/calendar-markers');
  });

  it('plain viewer (no events dept): nav hidden entirely, no link', () => {
    mockPermissions = { ...baseViewer };
    const { container } = renderNav();
    expect(container.querySelector('nav')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Holidays & Closures' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/__tests__/unit/components/Navigation.calendarMarkers.test.jsx`
Expected: FAIL — the events-dept-viewer case throws because the whole-nav early return (`!canSubmitReservation && !canApproveReservations && !isAdmin`) currently returns `null` for that persona, so no link exists.

- [ ] **Step 3: Destructure the new flag**

In `src/components/Navigation.jsx`, change the `usePermissions()` destructure (lines 13-18) to add `canManageCalendarMarkers`:

```jsx
  const {
    canSubmitReservation,
    canApproveReservations,
    canManageUsers,
    canManageCalendarMarkers,
    isAdmin
  } = usePermissions();
```

- [ ] **Step 4: Update the whole-nav early return**

In `src/components/Navigation.jsx`, change the early return (lines 119-121) to:

```jsx
  // Viewers only see Calendar — hide nav bar entirely since it adds no value.
  // Events-dept members (canManageCalendarMarkers) keep the nav so their
  // top-level Holidays & Closures link can render.
  if (!canSubmitReservation && !canApproveReservations && !isAdmin && !canManageCalendarMarkers) {
    return null;
  }
```

- [ ] **Step 5: Add the top-level link**

In `src/components/Navigation.jsx`, immediately after the User Management top-level block (which closes with `        )}` at line 164) and before the `{/* Admin dropdown ... */}` comment, insert:

```jsx
        {/* Holidays & Closures - top-level for Events-department members (who can
            manage calendar markers but are not admins). Mirrors the User
            Management pattern above; admins reach it in the Admin dropdown. */}
        {canManageCalendarMarkers && !isAdmin && (
          <li>
            <NavLink to="/admin/calendar-markers" className={({ isActive }) => isActive ? 'active' : ''}>
              Holidays &amp; Closures
            </NavLink>
          </li>
        )}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:run -- src/__tests__/unit/components/Navigation.calendarMarkers.test.jsx`
Expected: PASS (all three cases).

- [ ] **Step 7: Run the sibling nav test to confirm no regression**

Run: `npm run test:run -- src/__tests__/unit/components/Navigation.userManagement.test.jsx`
Expected: PASS (the early-return change is additive; approver/admin/requester behavior unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/components/Navigation.jsx src/__tests__/unit/components/Navigation.calendarMarkers.test.jsx
git commit -m "feat(nav): top-level Holidays & Closures for Events dept" -m "- Add canManageCalendarMarkers && !isAdmin top-level link
- Widen whole-nav early return so an Events-dept viewer is not hidden
- Tests: new Navigation.calendarMarkers (incl. viewer regression lock)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Route guard + screen comment

**Files:**
- Modify: `src/App.jsx` (new `RequireCalendarMarkers` + wrap the route)
- Modify: `src/components/CalendarMarkersManagement.jsx` (header comment only)

No new automated test: this mirrors the existing `RequireUserManagement` guard, which has no dedicated unit test; coverage comes from the backend 403 tests + the nav test + the manual smoke in Task 6. (A jsdom Router-guard test would largely re-assert React Router behavior, not our logic — YAGNI.)

- [ ] **Step 1: Add the `RequireCalendarMarkers` guard**

In `src/App.jsx`, immediately after the `RequireUserManagement` function (which closes at line 102), insert:

```jsx
// Guards /admin/calendar-markers — reachable by admins and Events-department
// members (canManageCalendarMarkers). UX redirect; the backend is authoritative.
function RequireCalendarMarkers({ children }) {
  const { effectivePermissions } = useRoleSimulation();
  if (!effectivePermissions.canManageCalendarMarkers) return <Navigate to="/" replace />;
  return children;
}
```

- [ ] **Step 2: Wrap the route**

In `src/App.jsx`, replace the `/admin/calendar-markers` route (line 345):

```jsx
                  <Route path="/admin/calendar-markers" element={<CalendarMarkersManagement apiToken={apiToken} />} />
```

with:

```jsx
                  <Route path="/admin/calendar-markers" element={<RequireCalendarMarkers><CalendarMarkersManagement apiToken={apiToken} /></RequireCalendarMarkers>} />
```

- [ ] **Step 3: Update the stale screen comment**

In `src/components/CalendarMarkersManagement.jsx`, replace line 3:

```js
// Admin-only "Holidays & Closures" screen. Create/edit/delete calendar markers
```

with:

```js
// "Holidays & Closures" screen (admins + Events-department members).
// Create/edit/delete calendar markers
```

- [ ] **Step 4: Verify the frontend still builds/lints**

Run: `npm run lint`
Expected: no new errors in `App.jsx` or `CalendarMarkersManagement.jsx`. (`RequireCalendarMarkers` uses the already-imported `useRoleSimulation` and `Navigate`.)

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx src/components/CalendarMarkersManagement.jsx
git commit -m "feat(routing): guard /admin/calendar-markers by marker-manage" -m "- RequireCalendarMarkers redirects non-managers to / (closes unguarded route)
- Refresh stale 'Admin-only' screen comment

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Full verification & manual smoke

- [ ] **Step 1: Run every touched test file**

```bash
cd backend && npm test -- permissionUtils.test.js calendarMarkers.test.js
```
Expected: PASS.

```bash
npm run test:run -- src/__tests__/unit/hooks/usePermissions.contract.test.jsx src/__tests__/unit/context/RoleSimulationContext.effectivePermissions.test.jsx src/__tests__/unit/components/Navigation.calendarMarkers.test.jsx src/__tests__/unit/components/Navigation.userManagement.test.jsx
```
Expected: PASS.

- [ ] **Step 2: Confirm the old gate name is gone**

Run: `grep -rn "requireMarkerAdmin" backend/`
Expected: no matches.

- [ ] **Step 3: Manual smoke (dev servers)**

Start backend (`cd backend && npm run dev`) and frontend (`npm run dev`). Then:
1. As an admin, open `/admin/departments` and confirm an `Events` department (key `events`) exists; via `/admin/users` set a test user's department to `Events`.
2. Log in as that user (a non-admin). Confirm a top-level **Holidays & Closures** link appears in the nav, and that opening it lets you create, edit, and delete a marker (toasts succeed).
3. Log in as a non-Events viewer/requester. Confirm there is no Holidays & Closures link, and typing `/admin/calendar-markers` in the URL redirects to `/`.
4. As an admin, confirm Holidays & Closures still appears inside the Admin dropdown (not duplicated at top level).

- [ ] **Step 4: Update CLAUDE.md "Calendar markers" note (optional, recommended)**

In the project `CLAUDE.md` (at the repo root — the `emanuel-resource-calendar-app` directory), the "Calendar markers (Holidays & Office Closures)" bullet says "Admin-only CRUD". Update it to: "Admin- or Events-department CRUD (`canManageCalendarMarkers` = admin OR `department === 'events'`); top-level nav link for non-admin Events-dept members, `RequireCalendarMarkers` route guard." Commit:

```bash
git add CLAUDE.md
git commit -m "docs(calendar-markers): note Events-dept management access" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done-when checklist (maps to spec)

- [ ] Admins AND `department === 'events'` users can POST/PUT/DELETE markers (Task 2) — spec decisions b, e.
- [ ] `GET` unchanged / open to all (untouched) — spec decision f.
- [ ] Role-independent: an Events-dept **viewer** has full CRUD (Task 1 + Task 2 tests) — spec decision b.
- [ ] Top-level nav link for non-admin Events-dept members; admins keep dropdown (Task 4) — spec decision d.
- [ ] Events-dept **viewer** is not hidden by the whole-nav early return (Task 4 regression test) — spec Gap 1.
- [ ] `/admin/calendar-markers` route guarded (Task 5) — spec design §5.
- [ ] Permission-shape parity: fallback, templates, ROLE_PERMISSIONS, contract test, drift guard (Tasks 1, 3) — spec Gaps 2, 3, 6.
- [ ] Stale "Admin-only" comment refreshed (Task 5) — spec Gap 4.
- [ ] One backend constant holds the `'events'` literal (Task 1) — spec decision g.
