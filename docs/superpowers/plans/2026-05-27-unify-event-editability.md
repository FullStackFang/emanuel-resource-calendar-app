# Unify Event Editability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "who can edit / request-edit / request-cancellation on an event" decided by ONE canonical rule (`owner | same-department | ownerless | rsched`) that the frontend and backend compute identically from the same stored data.

**Architecture:** A single pure logic module exists twice — `src/utils/eventEditability.js` (ESM) and `backend/utils/eventEditability.js` (CommonJS) — with byte-identical function bodies. Both read the event's stored `roomReservationData.requestedBy.department`; neither does a live lookup. A data-only JSON fixture of `(event, user) → expected` is run by both Vitest and Jest so the two copies cannot drift. A one-time backfill populates the stored department on historical events.

**Tech Stack:** React 19 (Vitest), Node/Express (Jest + MongoDB Memory Server), MongoDB/Cosmos.

**Spec:** `docs/superpowers/specs/2026-05-27-unify-event-editability-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/__tests__/__fixtures__/eventEditabilityCases.json` | Shared parity cases (data only) |
| `backend/utils/eventEditability.js` | BE pure rule module (CommonJS) |
| `src/utils/eventEditability.js` | FE pure rule module (ESM) — identical bodies |
| `backend/__tests__/unit/utils/eventEditability.test.js` | BE contract test (runs the fixture) |
| `src/__tests__/unit/utils/eventEditability.test.js` | FE contract test (runs the same fixture) |
| `src/hooks/useCurrentUserGates.js` | Consumes FE module (was: inline `creatorDepartment` read) |
| `backend/api-server.js` | 3 endpoints consume BE module + fallback deleted; enrichment removed |
| `src/components/DayEventPanel.jsx`, `DayEventsPopup.jsx` | "Request Edit" button gated by `canRequestEditEvent` |
| `src/components/Calendar.jsx` | Dead `canEditThisEvent`/`canRequestEditThisEvent` useMemos deleted |
| `backend/migrate-backfill-requester-department.js` | One-time stored-department backfill |

**The shared module API** (identical on both sides; ESM uses `export function`, CJS uses `function` + `module.exports`):

```
normalizeDepartment(d) -> string
resolveEventDepartment(event) -> string            // requestedBy.department, normalized
resolveOwnerEmail(event) -> string                 // requestedBy.email | calendarData.requesterEmail | requesterEmail
isEventOwner(event, email) -> bool
isEventOwnerless(event) -> bool                     // !requestedBy.email
isRschedImported(event) -> bool                     // source === 'rsSched'
isSameDepartment(event, userDepartment) -> bool
isCommunityEditable(event, user) -> bool            // owner | dept | ownerless | rsched
isAdminEditor(user) -> bool                         // canEditEvents | canApproveReservations
isSeriesChild(event) -> bool                        // occurrence | exception | addition
hasPendingEditRequest(event) -> bool
canRequestEditEvent(event, user) -> bool            // PUBLISHED community-editable, requester, no pending req
canDirectEditEvent(event, user) -> bool             // PENDING/REJECTED owner|dept, requester
```
`user = { email, department, canSubmitReservation, canEditEvents, canApproveReservations }`.

---

### Task 1: BE shared module + parity fixture (TDD)

**Files:**
- Create: `backend/__tests__/__fixtures__/eventEditabilityCases.json`
- Create: `backend/__tests__/unit/utils/eventEditability.test.js`
- Create: `backend/utils/eventEditability.js`

- [ ] **Step 1: Create the shared fixture**

`backend/__tests__/__fixtures__/eventEditabilityCases.json`:

```json
[
  { "name": "owner / published / requester -> requestEdit",
    "event": { "status": "published", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "owner@x.org", "department": "Music", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": true, "canDirectEditEvent": false } },

  { "name": "same-dept / published / requester -> requestEdit",
    "event": { "status": "published", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "colleague@x.org", "department": "music", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": true, "canDirectEditEvent": false } },

  { "name": "diff-dept / published / requester -> blocked",
    "event": { "status": "published", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "stranger@x.org", "department": "Finance", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": false } },

  { "name": "ownerless / published / requester -> requestEdit",
    "event": { "status": "published", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "", "department": "" } } },
    "user": { "email": "anyone@x.org", "department": "Finance", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": true, "canDirectEditEvent": false } },

  { "name": "rsched / published / diff-dept requester -> requestEdit",
    "event": { "status": "published", "eventType": "singleInstance", "source": "rsSched", "roomReservationData": { "requestedBy": { "email": "legacy@x.org", "department": "" } } },
    "user": { "email": "anyone@x.org", "department": "Finance", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": true, "canDirectEditEvent": false } },

  { "name": "owner / pending / requester -> directEdit",
    "event": { "status": "pending", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "owner@x.org", "department": "Music", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": true } },

  { "name": "same-dept / pending / requester -> directEdit",
    "event": { "status": "pending", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "colleague@x.org", "department": "Music", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": true } },

  { "name": "diff-dept / pending / requester -> blocked",
    "event": { "status": "pending", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "stranger@x.org", "department": "Finance", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": false } },

  { "name": "ownerless / pending -> no directEdit (owner|dept only)",
    "event": { "status": "pending", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "" } } },
    "user": { "email": "anyone@x.org", "department": "Finance", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": false } },

  { "name": "owner / rejected / requester -> directEdit",
    "event": { "status": "rejected", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "owner@x.org", "department": "Music", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": true } },

  { "name": "owner / draft -> neither composite (draft is owner-only via deriveGates isOwnerEditable)",
    "event": { "status": "draft", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "owner@x.org", "department": "Music", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": false } },

  { "name": "admin / published -> blocked (admins use admin-save path)",
    "event": { "status": "published", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "admin@x.org", "department": "IT", "canSubmitReservation": true, "canEditEvents": true, "canApproveReservations": true },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": false } },

  { "name": "same-dept / published / has pending edit request -> blocked",
    "event": { "status": "published", "eventType": "singleInstance", "pendingEditRequest": { "status": "pending" }, "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "colleague@x.org", "department": "Music", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": false } },

  { "name": "series child (occurrence) / published / owner -> blocked",
    "event": { "status": "published", "eventType": "occurrence", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "owner@x.org", "department": "Music", "canSubmitReservation": true, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": false } },

  { "name": "owner / published / viewer (no submit) -> blocked",
    "event": { "status": "published", "eventType": "singleInstance", "roomReservationData": { "requestedBy": { "email": "owner@x.org", "department": "Music" } } },
    "user": { "email": "owner@x.org", "department": "Music", "canSubmitReservation": false, "canEditEvents": false, "canApproveReservations": false },
    "expect": { "canRequestEditEvent": false, "canDirectEditEvent": false } }
]
```

- [ ] **Step 2: Write the failing BE contract test**

`backend/__tests__/unit/utils/eventEditability.test.js`:

```javascript
const cases = require('@fixtures/eventEditabilityCases.json');
const {
  canRequestEditEvent,
  canDirectEditEvent,
} = require('../../../utils/eventEditability');

describe('eventEditability shared contract (backend)', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(canRequestEditEvent(c.event, c.user)).toBe(c.expect.canRequestEditEvent);
      expect(canDirectEditEvent(c.event, c.user)).toBe(c.expect.canDirectEditEvent);
    });
  }
});
```

- [ ] **Step 3: Run it; verify it fails**

Run: `cd backend && npm test -- eventEditability.test.js`
Expected: FAIL — `Cannot find module '../../../utils/eventEditability'`.

- [ ] **Step 4: Implement the BE module**

`backend/utils/eventEditability.js`:

```javascript
// Pure, dependency-free rule module. The body MUST stay byte-identical to
// src/utils/eventEditability.js (the ESM twin). Parity is locked by the shared
// fixture backend/__tests__/__fixtures__/eventEditabilityCases.json, run by both
// Jest (here) and Vitest (frontend).

const SERIES_CHILD_TYPES = ['occurrence', 'exception', 'addition'];

function normalizeDepartment(d) {
  return (d || '').toLowerCase().trim();
}

function resolveEventDepartment(event) {
  // Canonical: department stored on the event at creation. The flat
  // roomReservationData.department and the migration-unset calendarData.department
  // are intentionally NOT read (see spec decision e).
  return normalizeDepartment(event && event.roomReservationData
    && event.roomReservationData.requestedBy
    && event.roomReservationData.requestedBy.department);
}

function resolveOwnerEmail(event) {
  const rb = event && event.roomReservationData && event.roomReservationData.requestedBy;
  const cd = event && event.calendarData;
  return (
    (rb && rb.email) ||
    (cd && cd.requesterEmail) ||
    (event && event.requesterEmail) ||
    ''
  ).toLowerCase();
}

function isEventOwner(event, email) {
  const e = (email || '').toLowerCase();
  return !!e && resolveOwnerEmail(event) === e;
}

function isEventOwnerless(event) {
  return !(event && event.roomReservationData
    && event.roomReservationData.requestedBy
    && event.roomReservationData.requestedBy.email);
}

function isRschedImported(event) {
  return !!event && event.source === 'rsSched';
}

function isSameDepartment(event, userDepartment) {
  const ed = resolveEventDepartment(event);
  const ud = normalizeDepartment(userDepartment);
  return !!(ud && ed && ud === ed);
}

function isCommunityEditable(event, user) {
  const u = user || {};
  return (
    isEventOwner(event, u.email) ||
    isSameDepartment(event, u.department) ||
    isEventOwnerless(event) ||
    isRschedImported(event)
  );
}

function isAdminEditor(user) {
  const u = user || {};
  return !!(u.canEditEvents || u.canApproveReservations);
}

function isSeriesChild(event) {
  const t = (event && (event.eventType || (event.graphData && event.graphData.type))) || null;
  return SERIES_CHILD_TYPES.includes(t);
}

function hasPendingEditRequest(event) {
  return !!(event && event.pendingEditRequest && event.pendingEditRequest.status === 'pending');
}

function canRequestEditEvent(event, user) {
  const u = user || {};
  return (
    !!u.canSubmitReservation &&
    !isAdminEditor(u) &&
    !!event && event.status === 'published' &&
    !isSeriesChild(event) &&
    isCommunityEditable(event, u) &&
    !hasPendingEditRequest(event)
  );
}

function canDirectEditEvent(event, user) {
  const u = user || {};
  const status = event && event.status;
  return (
    !isAdminEditor(u) &&
    !!u.canSubmitReservation &&
    (isEventOwner(event, u.email) || isSameDepartment(event, u.department)) &&
    (status === 'pending' || status === 'rejected')
  );
}

module.exports = {
  normalizeDepartment,
  resolveEventDepartment,
  resolveOwnerEmail,
  isEventOwner,
  isEventOwnerless,
  isRschedImported,
  isSameDepartment,
  isCommunityEditable,
  isAdminEditor,
  isSeriesChild,
  hasPendingEditRequest,
  canRequestEditEvent,
  canDirectEditEvent,
};
```

- [ ] **Step 5: Run it; verify it passes**

Run: `cd backend && npm test -- eventEditability.test.js`
Expected: PASS — all fixture cases green.

- [ ] **Step 6: Commit**

```bash
git add backend/__tests__/__fixtures__/eventEditabilityCases.json backend/__tests__/unit/utils/eventEditability.test.js backend/utils/eventEditability.js
git commit -m 'feat(editability): add shared BE rule module + parity fixture'
```

---

### Task 2: FE shared module (TDD, reuses the fixture)

**Files:**
- Create: `src/__tests__/unit/utils/eventEditability.test.js`
- Create: `src/utils/eventEditability.js`

- [ ] **Step 1: Write the failing FE contract test**

`src/__tests__/unit/utils/eventEditability.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import cases from '../../../../backend/__tests__/__fixtures__/eventEditabilityCases.json';
import { canRequestEditEvent, canDirectEditEvent } from '../../../utils/eventEditability';

describe('eventEditability shared contract (frontend)', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(canRequestEditEvent(c.event, c.user)).toBe(c.expect.canRequestEditEvent);
      expect(canDirectEditEvent(c.event, c.user)).toBe(c.expect.canDirectEditEvent);
    });
  }
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `npm run test:run -- eventEditability`
Expected: FAIL — cannot resolve `../../../utils/eventEditability`.

- [ ] **Step 3: Implement the FE module (ESM twin, identical bodies)**

`src/utils/eventEditability.js`:

```javascript
// Pure, dependency-free rule module. The body MUST stay byte-identical to
// backend/utils/eventEditability.js (the CommonJS twin). Parity is locked by the
// shared fixture backend/__tests__/__fixtures__/eventEditabilityCases.json, run by
// both Vitest (frontend) and Jest (backend).

const SERIES_CHILD_TYPES = ['occurrence', 'exception', 'addition'];

export function normalizeDepartment(d) {
  return (d || '').toLowerCase().trim();
}

export function resolveEventDepartment(event) {
  return normalizeDepartment(event && event.roomReservationData
    && event.roomReservationData.requestedBy
    && event.roomReservationData.requestedBy.department);
}

export function resolveOwnerEmail(event) {
  const rb = event && event.roomReservationData && event.roomReservationData.requestedBy;
  const cd = event && event.calendarData;
  return (
    (rb && rb.email) ||
    (cd && cd.requesterEmail) ||
    (event && event.requesterEmail) ||
    ''
  ).toLowerCase();
}

export function isEventOwner(event, email) {
  const e = (email || '').toLowerCase();
  return !!e && resolveOwnerEmail(event) === e;
}

export function isEventOwnerless(event) {
  return !(event && event.roomReservationData
    && event.roomReservationData.requestedBy
    && event.roomReservationData.requestedBy.email);
}

export function isRschedImported(event) {
  return !!event && event.source === 'rsSched';
}

export function isSameDepartment(event, userDepartment) {
  const ed = resolveEventDepartment(event);
  const ud = normalizeDepartment(userDepartment);
  return !!(ud && ed && ud === ed);
}

export function isCommunityEditable(event, user) {
  const u = user || {};
  return (
    isEventOwner(event, u.email) ||
    isSameDepartment(event, u.department) ||
    isEventOwnerless(event) ||
    isRschedImported(event)
  );
}

export function isAdminEditor(user) {
  const u = user || {};
  return !!(u.canEditEvents || u.canApproveReservations);
}

export function isSeriesChild(event) {
  const t = (event && (event.eventType || (event.graphData && event.graphData.type))) || null;
  return SERIES_CHILD_TYPES.includes(t);
}

export function hasPendingEditRequest(event) {
  return !!(event && event.pendingEditRequest && event.pendingEditRequest.status === 'pending');
}

export function canRequestEditEvent(event, user) {
  const u = user || {};
  return (
    !!u.canSubmitReservation &&
    !isAdminEditor(u) &&
    !!event && event.status === 'published' &&
    !isSeriesChild(event) &&
    isCommunityEditable(event, u) &&
    !hasPendingEditRequest(event)
  );
}

export function canDirectEditEvent(event, user) {
  const u = user || {};
  const status = event && event.status;
  return (
    !isAdminEditor(u) &&
    !!u.canSubmitReservation &&
    (isEventOwner(event, u.email) || isSameDepartment(event, u.department)) &&
    (status === 'pending' || status === 'rejected')
  );
}
```

- [ ] **Step 4: Run it; verify it passes**

Run: `npm run test:run -- eventEditability`
Expected: PASS — same fixture, FE module green (proves FE ≡ BE).

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/unit/utils/eventEditability.test.js src/utils/eventEditability.js
git commit -m 'feat(editability): add shared FE rule module (parity-locked to BE)'
```

---

### Task 3: Refactor `deriveGates` to consume the FE module

**Files:**
- Modify: `src/hooks/useCurrentUserGates.js`
- Test: `src/__tests__/unit/hooks/useCurrentUserGates.test.js` (existing — must stay green; add one dept-match case)

- [ ] **Step 1: Add a department-match regression test**

Append to `src/__tests__/unit/hooks/useCurrentUserGates.test.js` (inside the top-level `describe`):

```javascript
describe('department-match editing (stored requestedBy.department)', () => {
  const deptEvent = (status) => ({
    status,
    eventType: 'singleInstance',
    roomReservationData: { requestedBy: { email: OTHER, department: 'Music' } },
  });
  const colleague = { ...PERMISSION_FIXTURES.requester, department: 'music' };

  it('same-dept colleague can request-edit a published event', () => {
    const g = deriveGates(deptEvent('published'), colleague, [{ username: 'me@x.org' }]);
    expect(g.canRequestEdit).toBe(true);
  });

  it('same-dept colleague can save a pending event (direct edit)', () => {
    const g = deriveGates(deptEvent('pending'), colleague, [{ username: 'me@x.org' }]);
    expect(g.canSavePendingEdit).toBe(true);
  });

  it('different-dept user cannot request-edit', () => {
    const stranger = { ...PERMISSION_FIXTURES.requester, department: 'Finance' };
    const g = deriveGates(deptEvent('published'), stranger, [{ username: 'me@x.org' }]);
    expect(g.canRequestEdit).toBe(false);
  });
});
```

- [ ] **Step 2: Run it; verify the new cases FAIL**

Run: `npm run test:run -- useCurrentUserGates`
Expected: FAIL on the new dept cases — current `deriveGates` reads `event.creatorDepartment` (undefined here), so `canRequestEdit`/`canSavePendingEdit` are false.

- [ ] **Step 3: Refactor `deriveGates` to use the module**

In `src/hooks/useCurrentUserGates.js`:

Add import after line 3 (only the functions used in this file — `isOwner` from `isEventOwner`, plus the two composites):

```javascript
import { isEventOwner, canRequestEditEvent, canDirectEditEvent } from '../utils/eventEditability';
```

Delete the local `normalizeDepartment` const (line 6) and the `import { ... } from './usePermissions'`-adjacent helpers as needed. Replace the ownership/ownerless/rsched block (current lines 44-60) so the body reads ONLY:

```javascript
  const currentUserEmail = (accounts?.[0]?.username || '').toLowerCase();
  const isOwner = isEventOwner(event, currentUserEmail);
```

Delete the old `requesterEmail`, `isOwnerless`, and `isRschedImported` locals entirely — they fed only the old inline `canRequestEdit` and are now encapsulated inside the module's `canRequestEditEvent`. (`isOwner` is retained because `isOwnerEditable`, `canProposeViaEditRequest`, `canEditOccurrence`, `canDelete`, and the return object still use it.) Note the import above deliberately omits `isEventOwnerless`/`isRschedImported` — they would be unused in this file.

Build the shared `user` object once (after the `permissions` destructure, ~line 93):

```javascript
  const editabilityUser = {
    email: currentUserEmail,
    department,
    canSubmitReservation,
    canEditEvents,
    canApproveReservations,
  };
```

Delete the `userDept` / `ownerDept` / `departmentMatches` lines (current 112-116) entirely. Department matching now lives inside the module (the composites call `isSameDepartment` internally), so `deriveGates` no longer needs a local `departmentMatches` — it fed only `canRequestEdit` and `canNonAdminOwnerEdit`, both replaced below.

Replace `canRequestEdit` (lines 142-150) with:

```javascript
  const canRequestEdit =
    canRequestEditEvent(event, editabilityUser) &&
    !isEditRequestMode &&
    !isViewingEditRequest;
```

Replace `canNonAdminOwnerEdit` (lines 159-163) with:

```javascript
  const canNonAdminOwnerEdit = canDirectEditEvent(event, editabilityUser);
```

Update the two references that used `isRschedImported` (the old local const) to `isRschedImportedEvent`. Leave `canProposeViaEditRequest`, `isOwnerEditable`, `canDelete`, `canEditOccurrence`, etc. unchanged — they already use `isOwner`.

- [ ] **Step 4: Run the hook tests; verify all pass**

Run: `npm run test:run -- useCurrentUserGates`
Expected: PASS — new dept cases green, all existing invariants still green.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useCurrentUserGates.js src/__tests__/unit/hooks/useCurrentUserGates.test.js
git commit -m 'refactor(editability): deriveGates reads stored department via shared module'
```

---

### Task 4: Wire the 3 backend endpoints to the module; delete the live-lookup fallback

**Files:**
- Modify: `backend/api-server.js` (`POST /api/edit-requests`, `POST /api/events/:id/request-cancellation`, `PUT /api/room-reservations/:id/edit`)
- Test: `backend/__tests__/integration/events/editRequestsCreate.test.js`, `cancellationRequest.test.js`, `pendingEdit.test.js`, `rejectedEdit.test.js` (existing)

> **Baseline note:** before changing anything, run `cd backend && npm test -- cancellationRequest.test.js` and record which tests fail. CR-4, CR-13, CR-14 are KNOWN to fail on clean HEAD (mutual-exclusion + audit entries). Do not attribute those to this change; only a NEW failure matters.

- [ ] **Step 1: Add the import**

At the existing require block near `backend/api-server.js:20`, add:

```javascript
const { isCommunityEditable, isEventOwner, isSameDepartment } = require('./utils/eventEditability');
```

- [ ] **Step 2: Replace the edit-requests gate (`:22209-22250`)**

Replace the entire `isOwner` / `isSameDepartment` / `isOwnerlessEvent` / `isRschedImported` block and its 403 (current lines 22209-22250) with:

```javascript
    // Permission gate: owner | same-department | ownerless | rsched.
    // Department is read from the event's stored requestedBy.department only —
    // no live creator-profile lookup (parity with the frontend). See
    // backend/utils/eventEditability.js.
    const requestingUser = await findUserByIdentity(usersCollection, userId, userEmail);
    const editabilityUser = { email: userEmail, department: requestingUser?.department || '' };
    if (!isCommunityEditable(originalEvent, editabilityUser)) {
      return res.status(403).json({
        error: 'Only the event owner or users in the same department can request edits',
      });
    }
```

- [ ] **Step 3: Replace the cancellation gate (`:23447-23488`)**

Replace the `isOwner` / `isOwnerlessEvent` / `isRschedImported` / `isSameDepartment` block and its 403 (current lines 23447-23488) with:

```javascript
    // Permission gate: owner | same-department | ownerless | rsched (stored dept only).
    const requestingUser = await findUserByIdentity(usersCollection, userId, userEmail);
    const editabilityUser = { email: userEmail, department: requestingUser?.department || '' };
    if (!isCommunityEditable(event, editabilityUser)) {
      return res.status(403).json({
        error: 'Only the event owner, users in the same department, or any user for ownerless events can request cancellation',
      });
    }
```

- [ ] **Step 4: Replace the owner-edit gate (`:17469-17487`)**

This endpoint is pending/rejected direct-edit → owner OR same-department only (NOT ownerless/rsched). Replace the block (current lines 17469-17487) with:

```javascript
    // Ownership + department check (stored dept only; no live creator lookup).
    const currentUserRecord = await findUserByIdentity(usersCollection, userId, userEmail);
    const editabilityUser = { email: userEmail, department: currentUserRecord?.department || '' };
    if (!isEventOwner(event, userEmail) && !isSameDepartment(event, editabilityUser.department)) {
      return res.status(403).json({ error: 'You can only edit reservations from your own department' });
    }
```

- [ ] **Step 5: Run the affected integration suites**

Run: `cd backend && npm test -- editRequestsCreate.test.js pendingEdit.test.js rejectedEdit.test.js`
Expected: PASS (these do not have the known cancellation baseline issue).

Run: `cd backend && npm test -- cancellationRequest.test.js`
Expected: same pass/fail set as the baseline from the note above — no NEW failures.

- [ ] **Step 6: Commit**

```bash
git add backend/api-server.js
git commit -m 'refactor(editability): 3 endpoints use shared rule; delete live-lookup fallback'
```

---

### Task 5: Gate the day-popup "Request Edit" buttons

**Files:**
- Modify: `src/components/DayEventPanel.jsx`
- Modify: `src/components/DayEventsPopup.jsx`

Both components already pull permissions from `usePermissions()`; we add the user's email (`useMsal`) + the dept/approve flags and replace the inline condition with the shared predicate.

- [ ] **Step 1: DayEventPanel — imports + user object**

In `src/components/DayEventPanel.jsx`, add imports:

```javascript
import { useMsal } from '@azure/msal-react';
import { canRequestEditEvent } from '../utils/eventEditability';
```

Change the permissions destructure (current line 28) to include dept + approve:

```javascript
  const { canEditEvents, canDeleteEvents, canSubmitReservation, canApproveReservations, department } = usePermissions();
  const { accounts } = useMsal();
  const currentUserEmail = (accounts?.[0]?.username || '').toLowerCase();
  const editabilityUser = { email: currentUserEmail, department, canSubmitReservation, canEditEvents, canApproveReservations };
```

- [ ] **Step 2: DayEventPanel — replace the button condition (`:258`)**

Replace:

```javascript
                  {event.status === 'published' && canSubmitReservation && !canEditEvents && onRequestEdit && event.pendingEditRequest?.status !== 'pending' && (
```

with:

```javascript
                  {onRequestEdit && canRequestEditEvent(event, editabilityUser) && (
```

(`canRequestEditEvent` already encodes published-status, requester-only, no-pending-request, and now the ownership/department/ownerless/rsched check.)

- [ ] **Step 3: DayEventsPopup — same change (`:275`)**

In `src/components/DayEventsPopup.jsx` add the same two imports, the same `usePermissions` destructure additions + `useMsal`/`editabilityUser` block, then replace:

```javascript
                  {event.status === 'published' && canSubmitReservation && !canEditEvents && onRequestEdit && event.pendingEditRequest?.status !== 'pending' && (
```

with:

```javascript
                  {onRequestEdit && canRequestEditEvent(event, editabilityUser) && (
```

- [ ] **Step 4: Verify the frontend build + existing tests**

Run: `npm run test:run`
Expected: PASS (no test currently asserts the ungated button; the new gating is stricter but correct). If any day-popup snapshot/test exists, confirm it still reflects valid states.

Run: `npm run lint`
Expected: no new errors in the two files.

- [ ] **Step 5: Commit**

```bash
git add src/components/DayEventPanel.jsx src/components/DayEventsPopup.jsx
git commit -m 'fix(editability): gate day-popup Request Edit by shared rule (owner|dept|ownerless|rsched)'
```

---

### Task 6: Remove dead code (Calendar useMemos + getUnifiedEvents enrichment)

**Files:**
- Modify: `src/components/Calendar.jsx`
- Modify: `backend/api-server.js` (`getUnifiedEvents`)

- [ ] **Step 1: Verify `creatorDepartment` has no readers besides the gate code being removed**

Run: `grep -rn "creatorDepartment" src backend --include="*.js" --include="*.jsx" | grep -v "__tests__"`
Expected: only `src/components/Calendar.jsx` (the dead useMemos, lines ~669/699), `src/hooks/useCurrentUserGates.js` (already removed in Task 3 — confirm gone), and `backend/api-server.js:6213-6215` (the enrichment writer). If any OTHER reader appears, stop and re-plan.

- [ ] **Step 2: Delete the dead Calendar useMemos**

In `src/components/Calendar.jsx`, delete the `canEditThisEvent` useMemo (current lines ~650-675) and the `canRequestEditThisEvent` useMemo (current lines ~677-703). Confirm they are not referenced:

Run: `grep -n "canEditThisEvent\|canRequestEditThisEvent" src/components/Calendar.jsx`
Expected: no matches after deletion.

- [ ] **Step 3: Remove the `creatorDepartment` enrichment in `getUnifiedEvents`**

In `backend/api-server.js`, delete the batch creator-department lookup (current lines 6188-6207, the `creatorEmails`/`creatorDeptMap` block) and the enrichment assignment (current lines 6212-6216, the `event.creatorDepartment = ...` lines). Leave the start/end normalization that follows intact.

- [ ] **Step 4: Verify nothing broke**

Run: `npm run test:run -- Calendar`
Expected: PASS.
Run: `cd backend && npm test -- events/`
Expected: PASS (load/list paths unaffected by dropping the unused enrichment).

- [ ] **Step 5: Commit**

```bash
git add src/components/Calendar.jsx backend/api-server.js
git commit -m 'refactor(editability): remove dead creatorDepartment enrichment + Calendar useMemos'
```

---

### Task 7: Backfill script for stored `requestedBy.department`

**Files:**
- Create: `backend/migrate-backfill-requester-department.js`
- Test: `backend/__tests__/unit/scripts/backfillRequesterDepartment.test.js`

- [ ] **Step 1: Write a unit test for the query predicate + child-doc exclusion**

`backend/__tests__/unit/scripts/backfillRequesterDepartment.test.js`:

```javascript
const { buildBackfillQuery } = require('../../../migrate-backfill-requester-department');

describe('backfill requester department — target query', () => {
  it('targets app events with an owner email but no department, excludes rsched + children', () => {
    const q = buildBackfillQuery();
    expect(q.source).toEqual({ $ne: 'rsSched' });
    expect(q.eventType).toEqual({ $in: ['singleInstance', 'seriesMaster'] });
    expect(q['roomReservationData.requestedBy.email']).toEqual({ $exists: true, $nin: [null, ''] });
    expect(q.$or).toEqual([
      { 'roomReservationData.requestedBy.department': { $exists: false } },
      { 'roomReservationData.requestedBy.department': '' },
      { 'roomReservationData.requestedBy.department': null },
    ]);
  });
});
```

- [ ] **Step 2: Run it; verify it fails**

Run: `cd backend && npm test -- backfillRequesterDepartment.test.js`
Expected: FAIL — module/`buildBackfillQuery` not defined.

- [ ] **Step 3: Implement the backfill script**

`backend/migrate-backfill-requester-department.js`:

```javascript
/**
 * Migration: Backfill roomReservationData.requestedBy.department on app events.
 *
 * The unified editability rule (backend/utils/eventEditability.js) reads the
 * stored requestedBy.department only — no live creator lookup. This backfills
 * historical app events that have a requester email but no stored department,
 * from the creator's CURRENT profile department. rsched imports and recurring
 * child docs (occurrence/exception/addition) are skipped.
 *
 * Usage:
 *   node migrate-backfill-requester-department.js --dry-run
 *   node migrate-backfill-requester-department.js
 *   node migrate-backfill-requester-department.js --verify
 */

const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
const COLLECTION = 'templeEvents__Events';
const USERS_COLLECTION = 'templeEvents__Users';
const BATCH_SIZE = 100;

const isDryRun = process.argv.includes('--dry-run');
const isVerify = process.argv.includes('--verify');

function buildBackfillQuery() {
  return {
    source: { $ne: 'rsSched' },
    eventType: { $in: ['singleInstance', 'seriesMaster'] },
    'roomReservationData.requestedBy.email': { $exists: true, $nin: [null, ''] },
    $or: [
      { 'roomReservationData.requestedBy.department': { $exists: false } },
      { 'roomReservationData.requestedBy.department': '' },
      { 'roomReservationData.requestedBy.department': null },
    ],
  };
}

async function verify(events) {
  const remaining = await events.countDocuments(buildBackfillQuery());
  console.log(`   Remaining events missing stored department: ${remaining}`);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const events = db.collection(COLLECTION);
    const users = db.collection(USERS_COLLECTION);

    console.log(`\n📋 Migration: Backfill requester department`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   Mode: ${isDryRun ? 'DRY RUN' : isVerify ? 'VERIFY' : 'APPLY'}\n`);

    if (isVerify) {
      await verify(events);
      return;
    }

    const docs = await events.find(buildBackfillQuery())
      .project({ _id: 1, 'roomReservationData.requestedBy.userId': 1, 'roomReservationData.requestedBy.email': 1 })
      .toArray();
    console.log(`   Candidates: ${docs.length}`);

    // Resolve each candidate's creator department from the user profile.
    const emails = [...new Set(docs.map(d => (d.roomReservationData?.requestedBy?.email || '').toLowerCase()).filter(Boolean))];
    const profiles = emails.length
      ? await users.find({ email: { $in: emails } }, { projection: { email: 1, department: 1 } }).toArray()
      : [];
    const deptByEmail = {};
    for (const p of profiles) deptByEmail[(p.email || '').toLowerCase()] = p.department || '';

    const updates = docs
      .map(d => ({ _id: d._id, dept: deptByEmail[(d.roomReservationData?.requestedBy?.email || '').toLowerCase()] || '' }))
      .filter(u => u.dept); // only write when we actually resolved a department

    console.log(`   Resolvable (creator has a department): ${updates.length}`);

    if (isDryRun) {
      console.log('   DRY RUN — no writes. Sample:');
      updates.slice(0, 10).forEach(u => console.log(`     ${u._id} -> "${u.dept}"`));
      return;
    }

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      // Per-doc value differs, so issue one update per doc within the batch.
      await Promise.all(batch.map(u => events.updateOne(
        { _id: u._id },
        { $set: { 'roomReservationData.requestedBy.department': u.dept } }
      )));

      const processed = Math.min(i + BATCH_SIZE, updates.length);
      const percent = Math.round((processed / Math.max(updates.length, 1)) * 100);
      process.stdout.write(`\r   [Progress] ${percent}% (${processed}/${updates.length})`);

      if (i + BATCH_SIZE < updates.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    console.log(`\n   Done. Updated ${updates.length} events.`);
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exit(1); });
}

module.exports = { buildBackfillQuery };
```

- [ ] **Step 4: Run the unit test; verify it passes**

Run: `cd backend && npm test -- backfillRequesterDepartment.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/migrate-backfill-requester-department.js backend/__tests__/unit/scripts/backfillRequesterDepartment.test.js
git commit -m 'feat(editability): backfill script for stored requester department'
```

---

### Task 8: Lock the creation-path data foundation (regression guard)

**Files:**
- Verify: `backend/api-server.js` (request + draft create paths)
- Test: `backend/__tests__/integration/events/requesterDepartmentStored.test.js`

This proves the two requester-facing creation paths persist `requestedBy.department`, so the rule has stored data going forward (the backfill only covers history).

- [ ] **Step 1: Confirm the create paths resolve department**

Run: `grep -n "effectiveDepartment" backend/api-server.js`
Expected: lines ~15588-15597 (draft) and ~20814-20823 (request) resolve `effectiveDepartment` from the profile and pass it to `buildRequestedByObject`. If a requester-facing create path is found that does NOT, add the same `effectiveDepartment` resolution there before the `buildRequestedByObject` call.

- [ ] **Step 2: Write an integration test (request path stores department)**

`backend/__tests__/integration/events/requesterDepartmentStored.test.js` — follow the existing integration harness in `backend/__tests__/integration/events/*.test.js` (import `testApp`, `userFactory`, seed a user with `department: 'Music'`, POST `/api/events/request`, then read the event back):

```javascript
const request = require('supertest');
const { setupTestDb, teardownTestDb, clearTestDb } = require('../../__helpers__/testSetup');
const { createTestApp } = require('../../__helpers__/testApp');
const { createUser } = require('../../__helpers__/userFactory');
const { authHeaderFor } = require('../../__helpers__/authHelpers');

let app, db;
beforeAll(async () => { ({ db } = await setupTestDb()); app = createTestApp(db); });
afterAll(async () => { await teardownTestDb(); });
beforeEach(async () => { await clearTestDb(db); });

it('POST /api/events/request stores requestedBy.department from the profile', async () => {
  const user = await createUser(db, { email: 'req@x.org', department: 'Music', role: 'requester' });
  const res = await request(app)
    .post('/api/events/request')
    .set(authHeaderFor(user))
    .send({ eventTitle: 'T', startDate: '2026-06-01', startTime: '10:00', endDate: '2026-06-01', endTime: '11:00' });
  expect([200, 201]).toContain(res.status);
  const saved = await db.collection('templeEvents__Events').findOne({ eventId: res.body.eventId });
  expect(saved.roomReservationData.requestedBy.department).toBe('Music');
});
```

> If the local helper signatures differ (e.g. `authHeaderFor` is named `getAuthHeader`), match the existing usage in a sibling test such as `editRequestsCreate.test.js` exactly — do not invent helper names.

- [ ] **Step 3: Run it; verify it passes (or fix the create path until it does)**

Run: `cd backend && npm test -- requesterDepartmentStored.test.js`
Expected: PASS. If FAIL because department is empty, add `effectiveDepartment` resolution at the offending create path (Step 1) and re-run.

- [ ] **Step 4: Commit**

```bash
git add backend/__tests__/integration/events/requesterDepartmentStored.test.js backend/api-server.js
git commit -m 'test(editability): lock requester department persisted on create'
```

---

### Task 9: Final verification + spec close-out

- [ ] **Step 1: Run the full frontend suite**

Run: `npm run test:run`
Expected: PASS.

- [ ] **Step 2: Run the backend suites touched by this work**

Run: `cd backend && npm test -- eventEditability.test.js editRequestsCreate.test.js pendingEdit.test.js rejectedEdit.test.js backfillRequesterDepartment.test.js requesterDepartmentStored.test.js`
Expected: PASS.
Run: `cd backend && npm test -- cancellationRequest.test.js`
Expected: only the pre-existing CR-4/CR-13/CR-14 failures (baseline), no new ones.

- [ ] **Step 3: Dry-run the backfill against the dev database**

Run: `cd backend && node migrate-backfill-requester-department.js --dry-run`
Expected: prints candidate + resolvable counts and a sample, writes nothing.

- [ ] **Step 4: Update the spec status**

Edit `docs/superpowers/specs/2026-05-27-unify-event-editability-design.md` header `Status:` → `Implemented (pending backfill run in prod)`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-27-unify-event-editability-design.md
git commit -m 'docs(editability): mark unify-editability spec implemented'
```

---

## Notes for the implementer
- **Byte-identical twins:** if you change one `eventEditability.js`, change the other identically (only `export`/`module.exports` syntax differs). The shared fixture will catch drift on both runners.
- **Do not re-add a live creator-profile lookup** in the backend gates — it silently re-breaks FE/BE parity (the FE cannot do it). Stored department is the single source.
- **Cosmos:** the backfill issues per-doc `updateOne` (values differ per doc) in batches of 100 with a 1000ms inter-batch delay, matching the established migration pattern. Run `--dry-run` then `--verify` in prod.
- **Known baseline:** CR-4/CR-13/CR-14 in `cancellationRequest.test.js` fail on clean HEAD — verify before blaming this change.
