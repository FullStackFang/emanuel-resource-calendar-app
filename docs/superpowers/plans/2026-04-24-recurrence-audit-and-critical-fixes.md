# Recurrence Audit + Critical Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit the current codebase against the recurrence business-logic spec (`docs/superpowers/specs/2026-04-24-recurrence-business-logic-design.md`), produce a findings document, and fix the three highest-priority bug classes flagged there — the "delete-without-exclusion" bug (DL-1), the "orphan exception on pattern change" bug (E-1/E-2/E-3), and the "re-delete returns 409" bug (DL-8).

**Architecture:** TDD — each fix starts with a failing integration or unit test that asserts the spec rule, then minimal code change to pass. All fixes flow through existing helpers (`exceptionDocumentService.js`, `RecurrenceTabContent.jsx`, DELETE endpoint in `api-server.js`) — no new modules. An audit findings document at `docs/superpowers/audits/2026-04-24-recurrence-audit.md` tracks each spec rule's status (compliant / non-compliant / deferred to Plan 2/3) and is updated as tasks complete.

**Tech Stack:** Node.js + Express + MongoDB (Cosmos DB) backend, Jest integration tests; React + Vitest unit tests; existing spec-layer: `recurrenceUtils.js` (frontend), `recurrenceExpansion.js` (backend), `exceptionDocumentService.js` (backend CRUD).

**Explicitly out of scope (deferred to follow-on plans):**
- **Plan 2 (Scope Dialog Unification):** E-0, DL-0, A-2.1 — the scope-dialog-in-MyReservations/ReservationRequests/EventManagement work. Coupled with A-2.1's "hide exceptions panel in edit-request mode".
- **Plan 3 (Graph Sync Hardening):** A-P2 (publish rollback on Graph failure), E-4 (Graph reconcile on pattern change), G-3 (Graph exception cleanup).

---

## Task 1: Create audit findings document skeleton

**Files:**
- Create: `docs/superpowers/audits/2026-04-24-recurrence-audit.md`

- [ ] **Step 1: Write the findings document skeleton**

Create `docs/superpowers/audits/2026-04-24-recurrence-audit.md`:

```markdown
# Recurrence Audit — 2026-04-24

**Spec:** `docs/superpowers/specs/2026-04-24-recurrence-business-logic-design.md`
**Plan:** `docs/superpowers/plans/2026-04-24-recurrence-audit-and-critical-fixes.md`

## Legend

- ✅ Compliant (code matches spec, regression test exists)
- ⚠️ Partially compliant (code mostly matches but has known gaps)
- ❌ Non-compliant (code does not match spec — fix required)
- 🔭 Deferred (verification/fix scheduled for later plan)

## Invariants

| ID | Invariant | Status | Evidence |
|---|---|---|---|
| I-1 | Every exception's occurrenceDate is in the pattern | ⚠️ | See Task 15 findings |
| I-2 | Every addition's occurrenceDate is NOT in the pattern | ⚠️ | See Task 15 findings |
| I-3 | At most one representation per date | ⚠️ | See Task 15 findings |
| I-4 | Occurrence date cannot be moved (DATE_IMMUTABLE) | ✅ | `exceptionDocumentService.js` guard, existing tests |
| I-5 | Soft-delete cascades | ✅ | `cascadeDeleteExceptions`, existing tests |
| I-6 | Status cascades | ✅ | `cascadeStatusUpdate`, existing tests (incl. `644f7e6` reject fix) |

## View rules (V-*)

| ID | Rule | Status | Evidence |
|---|---|---|---|
| V-1 | Virtual occurrence doesn't leak onto materialized date | TBD | See Task 16 findings |
| V-2 | Occurrence click shows occurrence's date | ✅ | Existing `recurring-event-dates` spec + tests |
| V-3 | "All Events" from occurrence click shows series range | ✅ | Existing `recurring-event-dates` spec + tests |

## Create rules (C-*)

| ID | Rule | Status | Evidence |
|---|---|---|---|
| C-1 | Master dates = first occurrence date on create | TBD | See Task 17 findings |
| C-2 | Pattern-date entries in additions[] silently dropped | TBD | See Task 17 findings |
| C-3 | Non-pattern entries in exclusions[] silently dropped | TBD | See Task 17 findings |
| C-4 | Empty pattern is HTTP 400 | TBD | See Task 17 findings |

## Edit rules (E-*)

| ID | Rule | Status | Evidence |
|---|---|---|---|
| E-0 | Scope dialog on all 4 entry points | 🔭 Plan 2 | Only Calendar.jsx implements |
| E-1 | Orphan exception soft-deleted on pattern change | ❌ | Task 8–10 fix |
| E-2 | Redundant addition soft-deleted on pattern change | ❌ | Task 11–12 fix |
| E-3 | UI warns before orphan cascade | ❌ | Task 13–14 fix |
| E-4 | Graph reconcile on pattern change | 🔭 Plan 3 | Thin coverage |
| E-5 | Past-date edits allowed | TBD | See Task 18 findings |

## Delete rules (DL-*)

| ID | Rule | Status | Evidence |
|---|---|---|---|
| DL-0 | Scope dialog on delete (all entry points) | 🔭 Plan 2 | Only Calendar.jsx implements |
| DL-1 | thisEvent delete always adds exclusion | ❌ | Tasks 2–7 fix |
| DL-3 | allEvents delete cascades | ✅ | `cascadeDeleteExceptions`, existing tests |
| DL-4 | Restore does not modify exclusions | TBD | See Task 19 findings |
| DL-5 | Restore master undoes cascade | ✅ | Existing restore logic |
| DL-6 | Restore does not remove exclusions | TBD | See Task 19 findings |
| DL-8 | Idempotent re-delete returns 200 | ❌ | Tasks 20–22 fix |

## Approve/Reject/Resubmit rules (A-*)

| ID | Rule | Status | Evidence |
|---|---|---|---|
| A-1 | Series atomic for approval | ✅ | No per-occurrence endpoints |
| A-P1 | Publish cascades to children | ✅ | `cascadeStatusUpdate` in publish endpoint |
| A-P2 | Graph failure rolls back status | 🔭 Plan 3 | Partial commit windows |
| A-P3 | Conflict check expanded on publish | ✅ | `checkRoomConflicts` + `recurrenceExpansion` |
| A-R1 | Reject cascades to children | ✅ | Fixed `644f7e6` |
| A-R2 | Rejection reason on master | ✅ | `roomReservationData.reviewNotes` |
| A-S1 | Only requester can resubmit | ✅ | Ownership guard in endpoint |
| A-S2 | Resubmit cascades children to pending | ✅ | Existing tests |
| A-2.1 | Edit-request UI hides exceptions panel | 🔭 Plan 2 | Verify + fix coupled with scope dialog |
| A-2.3 | Orphan warning on edit-request approval | 🔭 Plan 3 | Depends on E-3 landing first |

## Findings (narrative)

Each task populates this section as it runs. Narrative entries include
file:line citations and any surprises encountered.

```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/audits/2026-04-24-recurrence-audit.md
git commit -m "docs(recurrence): add audit findings skeleton"
```

---

## Task 2: Backend — write failing test for DL-1 (thisEvent delete adds exclusion)

**Files:**
- Create: `backend/__tests__/integration/events/recurrenceDeleteExclusion.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/__tests__/integration/events/recurrenceDeleteExclusion.test.js`:

```javascript
const { setupTestDatabase, teardownTestDatabase, getTestApp, getCollection } = require('../../__helpers__/testSetup');
const { createAdminUser } = require('../../__helpers__/userFactory');
const { createRecurringSeriesMaster } = require('../../__helpers__/eventFactory');
const { createAuthenticatedRequest } = require('../../__helpers__/authHelpers');

describe('DL-1: thisEvent delete always adds exclusion', () => {
  let app, collection, admin, request;

  beforeAll(async () => {
    await setupTestDatabase();
    app = getTestApp();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    collection = getCollection('templeEvents__Events');
    admin = await createAdminUser();
    request = createAuthenticatedRequest(app, admin);
  });

  test('DL1-1: deleting a virtual occurrence adds date to master.recurrence.exclusions', async () => {
    // Weekly on Wednesdays, 2026-05-06 through 2026-05-27 (4 Wednesdays)
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06',
      endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: [],
        exclusions: [],
      },
    });

    const res = await request
      .delete(`/api/admin/events/${master.eventId}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-05-13',
        reason: 'Testing DL-1',
        expectedVersion: master._version,
      });

    expect(res.status).toBe(200);

    const updated = await collection.findOne({ eventId: master.eventId });
    expect(updated.recurrence.exclusions).toContain('2026-05-13');
    expect(updated.isDeleted).toBeFalsy(); // master not deleted
  });

  test('DL1-2: deleting an exception doc adds date to exclusions AND soft-deletes the exception', async () => {
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06',
      endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: [],
        exclusions: [],
      },
    });

    // Seed an exception document for 2026-05-13
    const exceptionDoc = {
      eventId: `${master.eventId}-exc-2026-05-13`,
      eventType: 'exception',
      seriesMasterEventId: master.eventId,
      occurrenceDate: '2026-05-13',
      startDate: '2026-05-13',
      endDate: '2026-05-13',
      status: 'published',
      isDeleted: false,
      calendarOwner: master.calendarOwner,
      roomReservationData: master.roomReservationData,
      _version: 1,
      statusHistory: [{ status: 'published', changedAt: new Date(), changedBy: 'test' }],
    };
    await collection.insertOne(exceptionDoc);

    const res = await request
      .delete(`/api/admin/events/${master.eventId}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-05-13',
        reason: 'Testing DL-1 with existing exception',
        expectedVersion: master._version,
      });

    expect(res.status).toBe(200);

    const updatedMaster = await collection.findOne({ eventId: master.eventId });
    expect(updatedMaster.recurrence.exclusions).toContain('2026-05-13');

    const updatedException = await collection.findOne({ eventId: exceptionDoc.eventId });
    expect(updatedException.isDeleted).toBe(true);
    expect(updatedException.status).toBe('deleted');
  });

  test('DL1-3: idempotent — deleting same occurrence twice does not duplicate exclusion', async () => {
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06',
      endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: [],
        exclusions: ['2026-05-13'],
      },
    });

    const res = await request
      .delete(`/api/admin/events/${master.eventId}`)
      .send({
        editScope: 'thisEvent',
        occurrenceDate: '2026-05-13',
        reason: 'Idempotent check',
        expectedVersion: master._version,
      });

    expect(res.status).toBe(200);

    const updated = await collection.findOne({ eventId: master.eventId });
    const count = updated.recurrence.exclusions.filter(d => d === '2026-05-13').length;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- recurrenceDeleteExclusion.test.js`

Expected: 3 failures — DL1-1 fails because exclusions is still empty, DL1-2 fails the same way, DL1-3 may pass or fail depending on behavior.

- [ ] **Step 3: Commit the failing test**

```bash
git add backend/__tests__/integration/events/recurrenceDeleteExclusion.test.js
git commit -m "test(recurrence): add failing DL-1 exclusion-on-delete tests"
```

---

## Task 3: Backend — add `addExclusionToMaster` helper

**Files:**
- Modify: `backend/utils/exceptionDocumentService.js`

- [ ] **Step 1: Add the helper function above the module.exports block**

Open `backend/utils/exceptionDocumentService.js` and insert this function before line 512 (just before the `module.exports` block — verify line by `grep -n 'module.exports' backend/utils/exceptionDocumentService.js` first):

```javascript
/**
 * Atomically add a date to a series master's recurrence.exclusions array.
 * Idempotent — safe to call with a date already present. Returns true if the
 * date was newly added, false if it was already present.
 *
 * Used by thisEvent-scope delete operations to enforce spec rule DL-1.
 *
 * @param {Collection} collection
 * @param {string} seriesMasterEventId
 * @param {string} occurrenceDate - YYYY-MM-DD
 * @param {Object} [options]
 * @param {string} [options.changedBy] - Audit attribution
 * @returns {Promise<boolean>} true if added, false if already present
 */
async function addExclusionToMaster(collection, seriesMasterEventId, occurrenceDate, options = {}) {
  if (!occurrenceDate || typeof occurrenceDate !== 'string') {
    throw new Error('addExclusionToMaster: occurrenceDate must be a YYYY-MM-DD string');
  }
  const now = new Date();
  const result = await collection.updateOne(
    {
      eventId: seriesMasterEventId,
      eventType: EVENT_TYPE.SERIES_MASTER,
      'recurrence.exclusions': { $ne: occurrenceDate },
    },
    {
      $addToSet: { 'recurrence.exclusions': occurrenceDate },
      $set: {
        lastModifiedDateTime: now,
        ...(options.changedBy && { lastModifiedBy: options.changedBy }),
      },
      $inc: { _version: 1 },
    }
  );
  return result.modifiedCount > 0;
}
```

- [ ] **Step 2: Add to the exports block**

Find the `module.exports = {` block near line 512 and add the new function:

```javascript
module.exports = {
  // ... existing exports ...
  addExclusionToMaster,
  cascadeDeleteExceptions,
  cascadeStatusUpdate,
  // ...
};
```

- [ ] **Step 3: Commit**

```bash
git add backend/utils/exceptionDocumentService.js
git commit -m "feat(recurrence): add addExclusionToMaster helper for DL-1"
```

---

## Task 4: Backend — wire `addExclusionToMaster` into DELETE endpoint

**Files:**
- Modify: `backend/api-server.js` (DELETE `/api/admin/events/:id` handler)
- Modify: `backend/__tests__/__helpers__/testApp.js` (mirror for test harness)

- [ ] **Step 1: Locate the thisEvent branch of DELETE**

Run: `grep -n "editScope.*thisEvent\|cascadeDeleteExceptions" backend/api-server.js | head -20`

Expected: identifies the branch (around line 23361–23402 per prior audit) where thisEvent soft-deletes the exception.

- [ ] **Step 2: Import the new helper**

In `backend/api-server.js`, find the existing require for `exceptionDocumentService` and ensure `addExclusionToMaster` is destructured:

```javascript
// Before (example):
const { resolveSeriesMaster, createExceptionDocument, updateExceptionDocument, cascadeDeleteExceptions, cascadeStatusUpdate } = require('./utils/exceptionDocumentService');

// After (add addExclusionToMaster):
const { resolveSeriesMaster, createExceptionDocument, updateExceptionDocument, cascadeDeleteExceptions, cascadeStatusUpdate, addExclusionToMaster } = require('./utils/exceptionDocumentService');
```

- [ ] **Step 3: Call the helper in the thisEvent branch**

In the thisEvent branch of the DELETE handler, AFTER the existing soft-delete-exception logic succeeds (or after determining the target was a virtual occurrence with no exception doc), insert:

```javascript
// DL-1: thisEvent delete always adds exclusion to master (idempotent).
const seriesMasterEventId = eventDoc.eventType === 'seriesMaster'
  ? eventDoc.eventId
  : eventDoc.seriesMasterEventId;
if (seriesMasterEventId) {
  await addExclusionToMaster(
    collection,
    seriesMasterEventId,
    occurrenceDate, // already validated earlier as YYYY-MM-DD
    { changedBy: userEmail }
  );
}
```

Place this:
- AFTER: the exception-doc soft-delete (if one was performed)
- BEFORE: the response is sent

- [ ] **Step 4: Mirror the change in testApp.js**

Run: `grep -n "editScope.*thisEvent\|DELETE.*admin/events" backend/__tests__/__helpers__/testApp.js | head`

Apply the same `addExclusionToMaster` call in the test harness's DELETE handler. If testApp.js uses a simplified delete flow, add the exclusion update alongside whatever thisEvent branch exists.

- [ ] **Step 5: Run the DL-1 tests**

Run: `cd backend && npm test -- recurrenceDeleteExclusion.test.js`

Expected: all 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/api-server.js backend/__tests__/__helpers__/testApp.js
git commit -m "feat(recurrence): always add exclusion on thisEvent delete (DL-1)"
```

---

## Task 5: Update audit findings — DL-1 compliant

**Files:**
- Modify: `docs/superpowers/audits/2026-04-24-recurrence-audit.md`

- [ ] **Step 1: Flip DL-1 to compliant**

In the audit markdown, change the DL-1 row from ❌ to ✅:

```markdown
| DL-1 | thisEvent delete always adds exclusion | ✅ | `addExclusionToMaster` in `exceptionDocumentService.js`; 3 tests in `recurrenceDeleteExclusion.test.js` |
```

Add narrative under **Findings**:

```markdown
### DL-1 — thisEvent delete always adds exclusion (Fixed 2026-04-24)

**Before:** DELETE `/api/admin/events/:id` with `editScope: 'thisEvent'` soft-deleted the matching exception document (if present) but did NOT update `master.recurrence.exclusions`. This caused the virtual occurrence to re-materialize on next read.

**After:** Added `addExclusionToMaster(collection, seriesMasterEventId, occurrenceDate, options)` to `exceptionDocumentService.js`. The DELETE handler now invokes it unconditionally on every thisEvent-scope delete. Idempotent via `$addToSet`.

**Files changed:** `backend/utils/exceptionDocumentService.js`, `backend/api-server.js`, `backend/__tests__/__helpers__/testApp.js`.

**Tests:** `recurrenceDeleteExclusion.test.js` — DL1-1 (virtual), DL1-2 (with exception), DL1-3 (idempotent).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/audits/2026-04-24-recurrence-audit.md
git commit -m "docs(audit): mark DL-1 compliant after fix"
```

---

## Task 6: Frontend — write failing test for handleRemoveOverride emits exclusion

**Files:**
- Create: `src/__tests__/unit/components/RecurrenceTabContent.removeOverride.test.jsx`

- [ ] **Step 1: Write the failing test**

Create the test file:

```jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RecurrenceTabContent from '../../../components/RecurrenceTabContent';

describe('DL-1 frontend: handleRemoveOverride adds exclusion', () => {
  const baseProps = {
    canEdit: true,
    readOnly: false,
    editScope: 'allEvents',
    formData: { startDate: '2026-05-06', startTime: '10:00', endTime: '11:00' },
    reservation: {},
    recurrencePattern: {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
      range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
      additions: [],
      exclusions: [],
    },
    occurrenceOverrides: [
      { occurrenceDate: '2026-05-13', eventTitle: 'Custom 5/13' },
    ],
    onRecurrencePatternChange: vi.fn(),
    onOccurrenceOverridesChange: vi.fn(),
  };

  test('DL1-FE-1: clicking remove on an override removes the override AND adds the date to exclusions', () => {
    render(<RecurrenceTabContent {...baseProps} />);

    const removeButton = screen.getByRole('button', { name: /remove.*5\/13/i });
    fireEvent.click(removeButton);

    // Override removed
    expect(baseProps.onOccurrenceOverridesChange).toHaveBeenCalledWith([]);
    // Date added to exclusions
    expect(baseProps.onRecurrencePatternChange).toHaveBeenCalledWith(
      expect.objectContaining({
        exclusions: expect.arrayContaining(['2026-05-13']),
      })
    );
  });

  test('DL1-FE-2: remove on a pattern occurrence (no override) adds exclusion only', () => {
    const propsNoOverride = { ...baseProps, occurrenceOverrides: [] };
    render(<RecurrenceTabContent {...propsNoOverride} />);

    const removeButton = screen.getByRole('button', { name: /remove.*5\/13/i });
    fireEvent.click(removeButton);

    expect(propsNoOverride.onRecurrencePatternChange).toHaveBeenCalledWith(
      expect.objectContaining({
        exclusions: expect.arrayContaining(['2026-05-13']),
      })
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- RecurrenceTabContent.removeOverride.test.jsx`

Expected: DL1-FE-1 fails because `onRecurrencePatternChange` is not called with exclusion. DL1-FE-2 similar.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/__tests__/unit/components/RecurrenceTabContent.removeOverride.test.jsx
git commit -m "test(RecurrenceTabContent): add failing DL-1 remove-emits-exclusion tests"
```

---

## Task 7: Frontend — fix `handleRemoveOverride` to emit exclusion

**Files:**
- Modify: `src/components/RecurrenceTabContent.jsx` (function at line 462)

- [ ] **Step 1: Update handleRemoveOverride**

Replace the function at `src/components/RecurrenceTabContent.jsx:462-465`:

```javascript
const handleRemoveOverride = useCallback((dateStr) => {
  if (!canEdit) return;
  // Remove the override for this date (if any)
  if (onOccurrenceOverridesChange) {
    onOccurrenceOverridesChange(overrides.filter(o => o.occurrenceDate !== dateStr));
  }
  // Spec DL-1: always add the date to exclusions (idempotent).
  if (onRecurrencePatternChange && recurrencePattern) {
    const existing = recurrencePattern.exclusions || [];
    if (!existing.includes(dateStr)) {
      onRecurrencePatternChange({
        ...recurrencePattern,
        exclusions: [...existing, dateStr],
      });
    }
  }
}, [canEdit, overrides, onOccurrenceOverridesChange, onRecurrencePatternChange, recurrencePattern]);
```

- [ ] **Step 2: Run the tests**

Run: `npm test -- RecurrenceTabContent.removeOverride.test.jsx`

Expected: both tests pass.

- [ ] **Step 3: Run neighboring tests to catch regressions**

Run: `npm test -- RecurrenceTabContent`

Expected: no regressions in existing tests.

- [ ] **Step 4: Commit**

```bash
git add src/components/RecurrenceTabContent.jsx
git commit -m "fix(RecurrenceTabContent): emit exclusion on remove-override (DL-1)"
```

---

## Task 8: Backend — write failing test for E-1 (orphan exception deleted on pattern change)

**Files:**
- Create: `backend/__tests__/integration/events/recurrencePatternChangeOrphanCascade.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
const { setupTestDatabase, teardownTestDatabase, getTestApp, getCollection } = require('../../__helpers__/testSetup');
const { createAdminUser } = require('../../__helpers__/userFactory');
const { createRecurringSeriesMaster } = require('../../__helpers__/eventFactory');
const { createAuthenticatedRequest } = require('../../__helpers__/authHelpers');

describe('E-1/E-2: orphan cascade on pattern change', () => {
  let app, collection, admin, request;

  beforeAll(async () => {
    await setupTestDatabase();
    app = getTestApp();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    collection = getCollection('templeEvents__Events');
    admin = await createAdminUser();
    request = createAuthenticatedRequest(app, admin);
  });

  test('E1-1: changing pattern to exclude existing exception-date soft-deletes the exception', async () => {
    // Weekly on Wednesdays
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06',
      endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: [],
        exclusions: [],
      },
    });

    // Exception for 2026-05-13 (Wed) — will be orphaned when we switch to Thursdays
    const exceptionDoc = {
      eventId: `${master.eventId}-exc-2026-05-13`,
      eventType: 'exception',
      seriesMasterEventId: master.eventId,
      occurrenceDate: '2026-05-13',
      startDate: '2026-05-13',
      endDate: '2026-05-13',
      status: master.status,
      isDeleted: false,
      calendarOwner: master.calendarOwner,
      roomReservationData: master.roomReservationData,
      _version: 1,
      statusHistory: [{ status: master.status, changedAt: new Date(), changedBy: 'test' }],
    };
    await collection.insertOne(exceptionDoc);

    // Change pattern to Thursdays (5/13 is NOT a Thursday → orphan)
    const res = await request
      .put(`/api/admin/events/${master.eventId}`)
      .send({
        editScope: 'allEvents',
        confirmOrphanCascade: true, // E-3: user has been warned
        expectedVersion: master._version,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['thursday'] },
          range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
          additions: [],
          exclusions: [],
        },
      });

    expect(res.status).toBe(200);

    const updatedException = await collection.findOne({ eventId: exceptionDoc.eventId });
    expect(updatedException.isDeleted).toBe(true);
    expect(updatedException.status).toBe('deleted');
  });

  test('E1-2: exception on a date STILL in new pattern is not touched', async () => {
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06',
      endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: [],
        exclusions: [],
      },
    });

    // Exception for 2026-05-13 (Wed) — STAYS valid under wed+fri pattern
    const exceptionDoc = {
      eventId: `${master.eventId}-exc-2026-05-13`,
      eventType: 'exception',
      seriesMasterEventId: master.eventId,
      occurrenceDate: '2026-05-13',
      startDate: '2026-05-13',
      endDate: '2026-05-13',
      status: master.status,
      isDeleted: false,
      calendarOwner: master.calendarOwner,
      roomReservationData: master.roomReservationData,
      _version: 1,
      statusHistory: [{ status: master.status, changedAt: new Date(), changedBy: 'test' }],
    };
    await collection.insertOne(exceptionDoc);

    // Broaden to include Fridays — 5/13 still in pattern
    const res = await request
      .put(`/api/admin/events/${master.eventId}`)
      .send({
        editScope: 'allEvents',
        confirmOrphanCascade: true,
        expectedVersion: master._version,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday', 'friday'] },
          range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
          additions: [],
          exclusions: [],
        },
      });

    expect(res.status).toBe(200);

    const updatedException = await collection.findOne({ eventId: exceptionDoc.eventId });
    expect(updatedException.isDeleted).toBe(false);
  });

  test('E2-1: addition on a date newly in pattern is soft-deleted (redundant)', async () => {
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06',
      endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: ['2026-05-22'], // Friday — outside pattern
        exclusions: [],
      },
    });

    const additionDoc = {
      eventId: `${master.eventId}-add-2026-05-22`,
      eventType: 'addition',
      seriesMasterEventId: master.eventId,
      occurrenceDate: '2026-05-22',
      startDate: '2026-05-22',
      endDate: '2026-05-22',
      status: master.status,
      isDeleted: false,
      calendarOwner: master.calendarOwner,
      roomReservationData: master.roomReservationData,
      _version: 1,
      statusHistory: [{ status: master.status, changedAt: new Date(), changedBy: 'test' }],
    };
    await collection.insertOne(additionDoc);

    // Add Fridays to pattern — 5/22 is a Friday → now in pattern → addition is redundant
    const res = await request
      .put(`/api/admin/events/${master.eventId}`)
      .send({
        editScope: 'allEvents',
        confirmOrphanCascade: true,
        expectedVersion: master._version,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday', 'friday'] },
          range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
          additions: ['2026-05-22'], // still in master's additions array, but addition doc now redundant
          exclusions: [],
        },
      });

    expect(res.status).toBe(200);

    const updatedAddition = await collection.findOne({ eventId: additionDoc.eventId });
    expect(updatedAddition.isDeleted).toBe(true);
  });

  test('E3-preflight: request without confirmOrphanCascade returns 409 with affected dates', async () => {
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06',
      endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: [],
        exclusions: [],
      },
    });

    const exceptionDoc = {
      eventId: `${master.eventId}-exc-2026-05-13`,
      eventType: 'exception',
      seriesMasterEventId: master.eventId,
      occurrenceDate: '2026-05-13',
      startDate: '2026-05-13',
      endDate: '2026-05-13',
      status: master.status,
      isDeleted: false,
      calendarOwner: master.calendarOwner,
      roomReservationData: master.roomReservationData,
      _version: 1,
      statusHistory: [{ status: master.status, changedAt: new Date(), changedBy: 'test' }],
    };
    await collection.insertOne(exceptionDoc);

    // Send the pattern change WITHOUT confirmOrphanCascade
    const res = await request
      .put(`/api/admin/events/${master.eventId}`)
      .send({
        editScope: 'allEvents',
        expectedVersion: master._version,
        recurrence: {
          pattern: { type: 'weekly', interval: 1, daysOfWeek: ['thursday'] },
          range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
          additions: [],
          exclusions: [],
        },
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ORPHAN_CASCADE_REQUIRES_CONFIRMATION');
    expect(res.body.orphanDates).toContain('2026-05-13');
    expect(res.body.redundantAdditionDates).toEqual([]);

    // Verify the exception is NOT yet deleted (pre-flight did not mutate)
    const untouched = await collection.findOne({ eventId: exceptionDoc.eventId });
    expect(untouched.isDeleted).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- recurrencePatternChangeOrphanCascade.test.js`

Expected: All four tests fail (E1-1 orphan not deleted, E1-2 may pass by accident, E2-1 addition not deleted, E3-preflight no 409 returned).

- [ ] **Step 3: Commit the failing tests**

```bash
git add backend/__tests__/integration/events/recurrencePatternChangeOrphanCascade.test.js
git commit -m "test(recurrence): add failing E-1/E-2/E-3 orphan cascade tests"
```

---

## Task 9: Backend — add `findOrphanedChildren` helper

**Files:**
- Modify: `backend/utils/exceptionDocumentService.js`

- [ ] **Step 1: Add the helper**

Insert this function in `exceptionDocumentService.js`, near the other cascade helpers (after `cascadeStatusUpdate`):

```javascript
/**
 * Identify which exception and addition docs would become invalid under a
 * proposed new recurrence pattern. Used by the pre-flight check (E-3) and
 * the cascade writer (E-1, E-2).
 *
 * Returns two arrays of YYYY-MM-DD date strings:
 *  - orphanDates: exception dates no longer matched by the proposed pattern
 *  - redundantAdditionDates: addition dates that the proposed pattern now generates
 *
 * @param {Collection} collection
 * @param {string} seriesMasterEventId
 * @param {Object} proposedRecurrence - { pattern, range, additions?, exclusions? }
 * @param {Function} isDateInPattern - from backend/utils/recurrenceExpansion.js
 * @returns {Promise<{orphanDates: string[], redundantAdditionDates: string[]}>}
 */
async function findOrphanedChildren(collection, seriesMasterEventId, proposedRecurrence, isDateInPattern) {
  const children = await collection.find({
    seriesMasterEventId,
    eventType: { $in: EXCEPTION_TYPES },
    isDeleted: { $ne: true },
  }).toArray();

  const { pattern, range } = proposedRecurrence;
  const patternStart = new Date(range.startDate + 'T00:00:00');
  const rangeEnd = (range.type === 'endDate' && range.endDate)
    ? new Date(range.endDate + 'T23:59:59')
    : null;

  const orphanDates = [];
  const redundantAdditionDates = [];

  for (const child of children) {
    const dateStr = child.occurrenceDate;
    if (!dateStr) continue;
    const dateObj = new Date(dateStr + 'T00:00:00');
    const inRange = dateObj >= patternStart && (!rangeEnd || dateObj <= rangeEnd);
    const inPattern = inRange && isDateInPattern(dateObj, pattern, patternStart);

    if (child.eventType === EVENT_TYPE.EXCEPTION && !inPattern) {
      orphanDates.push(dateStr);
    }
    if (child.eventType === EVENT_TYPE.ADDITION && inPattern) {
      redundantAdditionDates.push(dateStr);
    }
  }

  return { orphanDates, redundantAdditionDates };
}

/**
 * Soft-delete a set of child docs (exception or addition) by occurrenceDate list.
 * Returns count of docs deleted. Used by the cascade writer (E-1, E-2).
 *
 * @param {Collection} collection
 * @param {string} seriesMasterEventId
 * @param {string[]} occurrenceDates - YYYY-MM-DD dates to soft-delete
 * @param {Object} [options]
 * @param {string} [options.reason]
 * @param {string} [options.deletedBy]
 * @returns {Promise<number>}
 */
async function cascadeDeleteChildrenByDate(collection, seriesMasterEventId, occurrenceDates, options = {}) {
  if (!occurrenceDates || occurrenceDates.length === 0) return 0;
  const now = new Date();
  const result = await collection.updateMany(
    {
      seriesMasterEventId,
      eventType: { $in: EXCEPTION_TYPES },
      occurrenceDate: { $in: occurrenceDates },
      isDeleted: { $ne: true },
    },
    {
      $set: {
        isDeleted: true,
        status: 'deleted',
        deletedAt: now,
        deletedBy: options.deletedBy || 'system',
        lastModifiedDateTime: now,
      },
      $push: {
        statusHistory: {
          status: 'deleted',
          changedAt: now,
          changedBy: options.deletedBy || 'system',
          reason: options.reason || 'Orphaned by pattern change',
        },
      },
      $inc: { _version: 1 },
    }
  );
  return result.modifiedCount;
}
```

- [ ] **Step 2: Export both new helpers**

Update the `module.exports` block:

```javascript
module.exports = {
  // ... existing exports ...
  addExclusionToMaster,
  findOrphanedChildren,
  cascadeDeleteChildrenByDate,
  cascadeDeleteExceptions,
  cascadeStatusUpdate,
  // ...
};
```

- [ ] **Step 3: Commit**

```bash
git add backend/utils/exceptionDocumentService.js
git commit -m "feat(recurrence): add findOrphanedChildren + cascadeDeleteChildrenByDate helpers"
```

---

## Task 10: Backend — wire orphan cascade into `PUT /api/admin/events/:id` (allEvents scope)

**Files:**
- Modify: `backend/api-server.js` (allEvents branch of `PUT /api/admin/events/:id`)
- Modify: `backend/__tests__/__helpers__/testApp.js`

- [ ] **Step 1: Locate the allEvents branch**

Run: `grep -n "editScope.*allEvents\|allEvents.*editScope" backend/api-server.js | head -20`

Expected: identifies the handler (around line 21977–22084 per prior audit). The allEvents branch handles master-level edits including recurrence changes.

- [ ] **Step 2: Import the new helpers**

Destructure `findOrphanedChildren, cascadeDeleteChildrenByDate` from the `exceptionDocumentService` require. Also import `isDateInPattern` from `recurrenceExpansion`:

```javascript
const { isDateInPattern } = require('./utils/recurrenceExpansion');
const {
  // ...existing...
  findOrphanedChildren,
  cascadeDeleteChildrenByDate,
} = require('./utils/exceptionDocumentService');
```

- [ ] **Step 3: Insert the orphan check**

In the allEvents branch, BEFORE the master update is committed, insert:

```javascript
// E-1 / E-2 / E-3: orphan cascade detection & enforcement.
// Only applies when recurrence pattern/range is changing on a seriesMaster.
const isRecurrenceChanging = (
  eventDoc.eventType === 'seriesMaster' &&
  req.body.recurrence &&
  JSON.stringify(req.body.recurrence.pattern) !== JSON.stringify(eventDoc.recurrence?.pattern)
);

if (isRecurrenceChanging) {
  const { orphanDates, redundantAdditionDates } = await findOrphanedChildren(
    collection,
    eventDoc.eventId,
    req.body.recurrence,
    isDateInPattern
  );

  const hasAffected = orphanDates.length > 0 || redundantAdditionDates.length > 0;

  if (hasAffected && !req.body.confirmOrphanCascade) {
    // E-3: pre-flight returns 409 so the UI can warn the user
    return res.status(409).json({
      code: 'ORPHAN_CASCADE_REQUIRES_CONFIRMATION',
      message: `This pattern change will affect ${orphanDates.length + redundantAdditionDates.length} occurrence(s). Confirm to proceed.`,
      orphanDates,
      redundantAdditionDates,
    });
  }

  // E-1 / E-2: user confirmed — soft-delete affected children atomically with master update.
  // We do the children first so a failure here aborts the whole operation (OCC on master
  // will catch any concurrent write; ordering is safe because cascade targets only
  // the affected dates, not the master itself).
  if (hasAffected) {
    const affectedDates = [...orphanDates, ...redundantAdditionDates];
    await cascadeDeleteChildrenByDate(
      collection,
      eventDoc.eventId,
      affectedDates,
      { reason: 'Orphaned by pattern change', deletedBy: userEmail }
    );
  }
}

// ... then the existing master conditionalUpdate runs ...
```

- [ ] **Step 4: Mirror the change in testApp.js**

Run: `grep -n "editScope.*allEvents" backend/__tests__/__helpers__/testApp.js | head`

Apply the equivalent orphan-cascade block in the test harness's allEvents branch.

- [ ] **Step 5: Run the E-1/E-2/E-3 tests**

Run: `cd backend && npm test -- recurrencePatternChangeOrphanCascade.test.js`

Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/api-server.js backend/__tests__/__helpers__/testApp.js
git commit -m "feat(recurrence): cascade orphans on pattern change (E-1/E-2/E-3)"
```

---

## Task 11: Update audit findings — E-1/E-2/E-3 compliant

**Files:**
- Modify: `docs/superpowers/audits/2026-04-24-recurrence-audit.md`

- [ ] **Step 1: Flip E-1, E-2, E-3 to compliant**

Update the audit table:

```markdown
| E-1 | Orphan exception soft-deleted on pattern change | ✅ | `findOrphanedChildren` + `cascadeDeleteChildrenByDate` in `exceptionDocumentService.js` |
| E-2 | Redundant addition soft-deleted on pattern change | ✅ | Same helper |
| E-3 | UI warns before orphan cascade (backend 409 pre-flight) | ✅ backend / 🔭 frontend wiring in Task 13 |
```

Add narrative:

```markdown
### E-1 / E-2 / E-3 — Orphan cascade on pattern change (Fixed 2026-04-24)

**Before:** Changing a series master's pattern on `editScope: 'allEvents'` left orphaned exception documents (dates no longer in pattern) and redundant addition documents (dates now in pattern) in the DB. Virtual occurrences and stored docs diverged.

**After:**
- `findOrphanedChildren(collection, seriesMasterId, proposedRecurrence, isDateInPattern)` returns affected date arrays.
- Pre-flight: if any affected AND client did not send `confirmOrphanCascade: true`, backend returns HTTP 409 with `ORPHAN_CASCADE_REQUIRES_CONFIRMATION` and the date arrays. UI uses these to render the warning (Task 13).
- Post-confirmation: `cascadeDeleteChildrenByDate` soft-deletes affected children atomically before the master update.

**Files changed:** `backend/utils/exceptionDocumentService.js`, `backend/api-server.js`, `backend/__tests__/__helpers__/testApp.js`.

**Tests:** `recurrencePatternChangeOrphanCascade.test.js` — E1-1, E1-2, E2-1, E3-preflight.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/audits/2026-04-24-recurrence-audit.md
git commit -m "docs(audit): mark E-1/E-2/E-3 compliant after backend cascade landed"
```

---

## Task 12: Frontend — write failing test for E-3 orphan warning dialog

**Files:**
- Create: `src/components/OrphanCascadeWarningDialog.jsx` (stub only — for import in test)
- Create: `src/__tests__/unit/components/OrphanCascadeWarningDialog.test.jsx`

- [ ] **Step 1: Create a minimal stub component**

Create `src/components/OrphanCascadeWarningDialog.jsx` with just enough to make the test compile:

```jsx
import React from 'react';

export default function OrphanCascadeWarningDialog({ isOpen, orphanDates, redundantAdditionDates, onConfirm, onCancel }) {
  if (!isOpen) return null;
  return <div role="dialog" data-testid="orphan-cascade-warning">stub</div>;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/__tests__/unit/components/OrphanCascadeWarningDialog.test.jsx`:

```jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import OrphanCascadeWarningDialog from '../../../components/OrphanCascadeWarningDialog';

describe('OrphanCascadeWarningDialog (E-3)', () => {
  test('E3-FE-1: renders affected dates when open', () => {
    render(
      <OrphanCascadeWarningDialog
        isOpen={true}
        orphanDates={['2026-05-13', '2026-05-20']}
        redundantAdditionDates={['2026-05-22']}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/2026-05-13/)).toBeInTheDocument();
    expect(screen.getByText(/2026-05-20/)).toBeInTheDocument();
    expect(screen.getByText(/2026-05-22/)).toBeInTheDocument();
    expect(screen.getByText(/3 occurrence/i)).toBeInTheDocument();
  });

  test('E3-FE-2: renders nothing when closed', () => {
    render(
      <OrphanCascadeWarningDialog
        isOpen={false}
        orphanDates={['2026-05-13']}
        redundantAdditionDates={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('E3-FE-3: Cancel button calls onCancel', () => {
    const onCancel = vi.fn();
    render(
      <OrphanCascadeWarningDialog
        isOpen={true}
        orphanDates={['2026-05-13']}
        redundantAdditionDates={[]}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('E3-FE-4: Confirm button calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <OrphanCascadeWarningDialog
        isOpen={true}
        orphanDates={['2026-05-13']}
        redundantAdditionDates={[]}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /continue|confirm/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- OrphanCascadeWarningDialog.test.jsx`

Expected: E3-FE-1, E3-FE-3, E3-FE-4 fail (dates not rendered, buttons missing).

- [ ] **Step 4: Commit**

```bash
git add src/components/OrphanCascadeWarningDialog.jsx src/__tests__/unit/components/OrphanCascadeWarningDialog.test.jsx
git commit -m "test(recurrence): add failing E-3 orphan warning dialog tests"
```

---

## Task 13: Frontend — implement `OrphanCascadeWarningDialog`

**Files:**
- Modify: `src/components/OrphanCascadeWarningDialog.jsx`

- [ ] **Step 1: Implement the component**

Replace the stub:

```jsx
import React from 'react';

/**
 * Warning shown before a pattern/range change that would orphan exception docs
 * or make addition docs redundant. Spec rules E-1, E-2, E-3.
 *
 * The backend returns HTTP 409 with code `ORPHAN_CASCADE_REQUIRES_CONFIRMATION`
 * and the affected date arrays. The caller opens this dialog with those arrays,
 * and on confirm, retries the PUT with `confirmOrphanCascade: true`.
 */
export default function OrphanCascadeWarningDialog({
  isOpen,
  orphanDates = [],
  redundantAdditionDates = [],
  onConfirm,
  onCancel,
}) {
  if (!isOpen) return null;
  const total = orphanDates.length + redundantAdditionDates.length;
  const word = total === 1 ? 'occurrence' : 'occurrences';

  const formatDate = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div role="dialog" aria-labelledby="orphan-warning-title" className="orphan-warning-dialog">
      <div className="orphan-warning-backdrop" onClick={onCancel} />
      <div className="orphan-warning-content">
        <h2 id="orphan-warning-title">Pattern change will affect {total} {word}</h2>

        {orphanDates.length > 0 && (
          <section>
            <h3>Customized occurrences to be removed</h3>
            <p>
              These dates have custom edits and are no longer in the new pattern.
              Saving will delete them:
            </p>
            <ul>
              {orphanDates.map((d) => (
                <li key={d}>
                  <time dateTime={d}>{formatDate(d)}</time> <span className="raw-date">({d})</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {redundantAdditionDates.length > 0 && (
          <section>
            <h3>Added dates now generated by pattern</h3>
            <p>
              These ad-hoc additions are already generated by the new pattern.
              Saving will remove the duplicate entries:
            </p>
            <ul>
              {redundantAdditionDates.map((d) => (
                <li key={d}>
                  <time dateTime={d}>{formatDate(d)}</time> <span className="raw-date">({d})</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="orphan-warning-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onConfirm} className="danger">Continue</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run the tests**

Run: `npm test -- OrphanCascadeWarningDialog.test.jsx`

Expected: all 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/OrphanCascadeWarningDialog.jsx
git commit -m "feat(OrphanCascadeWarningDialog): implement E-3 warning dialog"
```

---

## Task 14: Frontend — wire the dialog into the master save flow

**Files:**
- Modify: `src/hooks/useReviewModal.jsx` (or wherever master allEvents-scope save is dispatched)

- [ ] **Step 1: Find the master save handler**

Run: `grep -n "allEvents\|editScope" src/hooks/useReviewModal.jsx | head -20`

Expected: identifies the `handleSave` path for master-level saves.

- [ ] **Step 2: Catch the 409 ORPHAN_CASCADE_REQUIRES_CONFIRMATION and open the dialog**

In the master save handler, wrap the PUT call:

```javascript
const doMasterSave = async (payload, { confirmOrphanCascade = false } = {}) => {
  const body = { ...payload, editScope: 'allEvents' };
  if (confirmOrphanCascade) body.confirmOrphanCascade = true;

  try {
    const res = await authenticatedFetch(`/api/admin/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });

    if (res.status === 409) {
      const data = await res.json();
      if (data.code === 'ORPHAN_CASCADE_REQUIRES_CONFIRMATION') {
        setOrphanWarning({
          isOpen: true,
          orphanDates: data.orphanDates || [],
          redundantAdditionDates: data.redundantAdditionDates || [],
          payload, // stash payload for retry on confirm
        });
        return { needsConfirmation: true };
      }
      // fall through to existing 409 handling (version conflict etc.)
    }

    // ... existing success handling ...
  } catch (e) {
    // ... existing error handling ...
  }
};

// In the JSX where the modal renders:
<OrphanCascadeWarningDialog
  isOpen={orphanWarning.isOpen}
  orphanDates={orphanWarning.orphanDates}
  redundantAdditionDates={orphanWarning.redundantAdditionDates}
  onCancel={() => setOrphanWarning({ isOpen: false, orphanDates: [], redundantAdditionDates: [], payload: null })}
  onConfirm={async () => {
    const stashed = orphanWarning.payload;
    setOrphanWarning({ isOpen: false, orphanDates: [], redundantAdditionDates: [], payload: null });
    await doMasterSave(stashed, { confirmOrphanCascade: true });
  }}
/>
```

Add the `orphanWarning` state:

```javascript
const [orphanWarning, setOrphanWarning] = useState({
  isOpen: false,
  orphanDates: [],
  redundantAdditionDates: [],
  payload: null,
});
```

Add the import:

```javascript
import OrphanCascadeWarningDialog from '../components/OrphanCascadeWarningDialog';
```

- [ ] **Step 3: Manual verification in dev**

Run the dev server (`npm run dev` in one terminal, `cd backend && npm run dev` in another). In the browser:
1. Create a weekly-Wednesdays series spanning 2 weeks.
2. Edit a Wednesday occurrence (thisEvent scope) and save.
3. Open the master (allEvents scope), change the pattern to Thursdays only.
4. Click Save.

Expected: Orphan warning dialog appears listing the Wednesday exception's date. Click Cancel → nothing saved. Click Continue → save succeeds, exception is soft-deleted.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useReviewModal.jsx
git commit -m "feat(useReviewModal): show orphan cascade warning on 409 pre-flight (E-3)"
```

---

## Task 15: Backend — write failing test for DL-8 (idempotent re-delete)

**Files:**
- Create: `backend/__tests__/integration/events/recurrenceIdempotentDelete.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
const { setupTestDatabase, teardownTestDatabase, getTestApp, getCollection } = require('../../__helpers__/testSetup');
const { createAdminUser } = require('../../__helpers__/userFactory');
const { createRecurringSeriesMaster } = require('../../__helpers__/eventFactory');
const { createAuthenticatedRequest } = require('../../__helpers__/authHelpers');

describe('DL-8: idempotent re-delete returns 200', () => {
  let app, collection, admin, request;

  beforeAll(async () => {
    await setupTestDatabase();
    app = getTestApp();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    collection = getCollection('templeEvents__Events');
    admin = await createAdminUser();
    request = createAuthenticatedRequest(app, admin);
  });

  test('DL8-1: deleting an already-deleted master returns 200 with no-op indicator', async () => {
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06',
      endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: [],
        exclusions: [],
      },
    });

    // First delete
    const first = await request
      .delete(`/api/admin/events/${master.eventId}`)
      .send({ editScope: 'allEvents', reason: 'First delete', expectedVersion: master._version });
    expect(first.status).toBe(200);

    const afterFirst = await collection.findOne({ eventId: master.eventId });
    expect(afterFirst.isDeleted).toBe(true);

    // Second delete — should be a no-op, not a 409
    const second = await request
      .delete(`/api/admin/events/${master.eventId}`)
      .send({ editScope: 'allEvents', reason: 'Second delete', expectedVersion: afterFirst._version });
    expect(second.status).toBe(200);
    expect(second.body.alreadyDeleted).toBe(true);
  });

  test('DL8-2: deleting an already-deleted occurrence (thisEvent) returns 200 no-op', async () => {
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06',
      endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: [],
        exclusions: ['2026-05-13'], // already excluded
      },
    });

    // Attempt to delete 5/13 again — already in exclusions
    const res = await request
      .delete(`/api/admin/events/${master.eventId}`)
      .send({ editScope: 'thisEvent', occurrenceDate: '2026-05-13', reason: 'Re-delete', expectedVersion: master._version });

    expect(res.status).toBe(200);
    expect(res.body.alreadyExcluded).toBe(true);

    // Exclusions array should not have been duplicated
    const updated = await collection.findOne({ eventId: master.eventId });
    const count = updated.recurrence.exclusions.filter(d => d === '2026-05-13').length;
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- recurrenceIdempotentDelete.test.js`

Expected: DL8-1 fails with a 409 (OCC conflict or already-deleted error). DL8-2 may pass partially because `addExclusionToMaster` uses `$addToSet`, but the response shape likely lacks `alreadyExcluded: true`.

- [ ] **Step 3: Commit**

```bash
git add backend/__tests__/integration/events/recurrenceIdempotentDelete.test.js
git commit -m "test(recurrence): add failing DL-8 idempotent delete tests"
```

---

## Task 16: Backend — make DELETE idempotent on already-deleted docs

**Files:**
- Modify: `backend/api-server.js` (DELETE `/api/admin/events/:id` handler)
- Modify: `backend/__tests__/__helpers__/testApp.js`

- [ ] **Step 1: Locate the pre-delete check**

Run: `grep -n "DELETE.*admin/events\|isDeleted.*ne\|already.*deleted" backend/api-server.js | head -20`

- [ ] **Step 2: Add early-return for already-deleted cases**

In the DELETE handler, AFTER the `expectedVersion` check but BEFORE the soft-delete write, insert:

```javascript
// DL-8: idempotent re-delete. If already in the target state, return 200 no-op.
if (editScope === 'allEvents' || !editScope) {
  if (eventDoc.isDeleted === true) {
    return res.status(200).json({
      success: true,
      alreadyDeleted: true,
      eventId: eventDoc.eventId,
      message: 'Event was already deleted; no change applied.',
    });
  }
}

if (editScope === 'thisEvent' && occurrenceDate) {
  const seriesMasterEventId = eventDoc.eventType === 'seriesMaster'
    ? eventDoc.eventId
    : eventDoc.seriesMasterEventId;
  if (seriesMasterEventId) {
    const master = eventDoc.eventType === 'seriesMaster'
      ? eventDoc
      : await collection.findOne({ eventId: seriesMasterEventId });
    if (master?.recurrence?.exclusions?.includes(occurrenceDate)) {
      // Check the exception doc (if any) is also soft-deleted
      const exception = await collection.findOne({
        seriesMasterEventId,
        eventType: 'exception',
        occurrenceDate,
      });
      if (!exception || exception.isDeleted) {
        return res.status(200).json({
          success: true,
          alreadyExcluded: true,
          eventId: eventDoc.eventId,
          occurrenceDate,
          message: 'Occurrence was already excluded; no change applied.',
        });
      }
      // else: exclusion present but exception not deleted — fall through to clean up
    }
  }
}
```

- [ ] **Step 3: Mirror in testApp.js**

Apply the same early-return block in the test harness.

- [ ] **Step 4: Run the tests**

Run: `cd backend && npm test -- recurrenceIdempotentDelete.test.js`

Expected: both tests pass.

- [ ] **Step 5: Run the DL-1 suite again for regression check**

Run: `cd backend && npm test -- recurrenceDeleteExclusion.test.js`

Expected: still passes.

- [ ] **Step 6: Commit**

```bash
git add backend/api-server.js backend/__tests__/__helpers__/testApp.js
git commit -m "fix(recurrence): idempotent re-delete returns 200 no-op (DL-8)"
```

---

## Task 17: Backend — invariant regression test suite (I-1, I-2, I-3)

**Files:**
- Create: `backend/__tests__/integration/events/recurrenceInvariants.test.js`

- [ ] **Step 1: Write the invariant tests**

```javascript
const { setupTestDatabase, teardownTestDatabase, getTestApp, getCollection } = require('../../__helpers__/testSetup');
const { createAdminUser } = require('../../__helpers__/userFactory');
const { createRecurringSeriesMaster } = require('../../__helpers__/eventFactory');
const { createAuthenticatedRequest } = require('../../__helpers__/authHelpers');
const { isDateInPattern } = require('../../../utils/recurrenceExpansion');

describe('Recurrence invariants (I-1, I-2, I-3)', () => {
  let app, collection, admin, request;

  beforeAll(async () => {
    await setupTestDatabase();
    app = getTestApp();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    collection = getCollection('templeEvents__Events');
    admin = await createAdminUser();
    request = createAuthenticatedRequest(app, admin);
  });

  async function assertInvariants(masterId) {
    const master = await collection.findOne({ eventId: masterId });
    const children = await collection.find({
      seriesMasterEventId: masterId,
      eventType: { $in: ['exception', 'addition'] },
      isDeleted: { $ne: true },
    }).toArray();

    const patternStart = new Date(master.recurrence.range.startDate + 'T00:00:00');
    const exclusionSet = new Set(master.recurrence.exclusions || []);

    for (const child of children) {
      const dateObj = new Date(child.occurrenceDate + 'T00:00:00');
      const inPattern = isDateInPattern(dateObj, master.recurrence.pattern, patternStart);

      if (child.eventType === 'exception') {
        // I-1: exception's date must be in pattern
        expect(inPattern).toBe(true);
      }
      if (child.eventType === 'addition') {
        // I-2: addition's date must NOT be in pattern
        expect(inPattern).toBe(false);
      }
      // I-3: date must not be excluded
      expect(exclusionSet.has(child.occurrenceDate)).toBe(false);
    }
  }

  test('INV-1: invariants hold after thisEvent delete', async () => {
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06', endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: [],
        exclusions: [],
      },
    });
    await request.delete(`/api/admin/events/${master.eventId}`)
      .send({ editScope: 'thisEvent', occurrenceDate: '2026-05-13', reason: 'INV test', expectedVersion: master._version });
    await assertInvariants(master.eventId);
  });

  test('INV-2: invariants hold after orphan cascade on pattern change', async () => {
    const master = await createRecurringSeriesMaster(collection, {
      startDate: '2026-05-06', endDate: '2026-05-06',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: [],
        exclusions: [],
      },
    });
    // Seed exception on Wed 5/13 and addition on Fri 5/22
    await collection.insertMany([
      {
        eventId: `${master.eventId}-exc-2026-05-13`,
        eventType: 'exception',
        seriesMasterEventId: master.eventId,
        occurrenceDate: '2026-05-13',
        startDate: '2026-05-13', endDate: '2026-05-13',
        status: master.status, isDeleted: false,
        calendarOwner: master.calendarOwner, roomReservationData: master.roomReservationData,
        _version: 1,
        statusHistory: [{ status: master.status, changedAt: new Date(), changedBy: 'test' }],
      },
      {
        eventId: `${master.eventId}-add-2026-05-22`,
        eventType: 'addition',
        seriesMasterEventId: master.eventId,
        occurrenceDate: '2026-05-22',
        startDate: '2026-05-22', endDate: '2026-05-22',
        status: master.status, isDeleted: false,
        calendarOwner: master.calendarOwner, roomReservationData: master.roomReservationData,
        _version: 1,
        statusHistory: [{ status: master.status, changedAt: new Date(), changedBy: 'test' }],
      },
    ]);
    // Switch pattern to Tue+Fri — Wed exception orphaned, Fri addition redundant
    await request.put(`/api/admin/events/${master.eventId}`).send({
      editScope: 'allEvents',
      confirmOrphanCascade: true,
      expectedVersion: master._version,
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday', 'friday'] },
        range: { type: 'endDate', startDate: '2026-05-06', endDate: '2026-05-27' },
        additions: ['2026-05-22'],
        exclusions: [],
      },
    });
    await assertInvariants(master.eventId);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd backend && npm test -- recurrenceInvariants.test.js`

Expected: both tests pass (they verify the fixes from prior tasks held).

- [ ] **Step 3: Commit**

```bash
git add backend/__tests__/integration/events/recurrenceInvariants.test.js
git commit -m "test(recurrence): add I-1/I-2/I-3 invariant regression suite"
```

---

## Task 18: Audit findings — final pass

**Files:**
- Modify: `docs/superpowers/audits/2026-04-24-recurrence-audit.md`

- [ ] **Step 1: Mark DL-8 compliant**

```markdown
| DL-8 | Idempotent re-delete returns 200 | ✅ | `recurrenceIdempotentDelete.test.js` |
```

- [ ] **Step 2: Mark I-1, I-2, I-3 compliant**

```markdown
| I-1 | Every exception's occurrenceDate is in the pattern | ✅ | `recurrenceInvariants.test.js` |
| I-2 | Every addition's occurrenceDate is NOT in the pattern | ✅ | `recurrenceInvariants.test.js` |
| I-3 | At most one representation per date | ✅ | `recurrenceInvariants.test.js` |
```

- [ ] **Step 3: Populate TBD rows with findings from code inspection**

For each row still marked TBD (C-1 through C-4, V-1, E-5, DL-4, DL-6), open the relevant file, grep for the behavior, and write a finding. If a rule turns out compliant by reading code alone (no test needed), mark ✅ with a file:line citation. If a gap is found, mark ❌ and schedule it for a follow-on task in a later plan.

Example finding block for V-1:

```markdown
### V-1 — Virtual occurrence dedup against exceptions/additions/exclusions

**Code path:** `src/utils/recurrenceUtils.js:200 expandRecurringSeries()`
**Behavior:** Loop at lines 272–346 generates pattern dates; line 285 skips exclusions; line 295 skips `materializedDates` (exception/addition docs). Additions loop at line 349 skips `generatedDates` and `exclusions`.
**Status:** ✅ Compliant. Dedup is enforced at 3 levels as spec requires.
```

Do this for each remaining TBD row. Commit when all rows are resolved.

- [ ] **Step 4: Add summary at top of findings doc**

Insert just under the Legend:

```markdown
## Summary (2026-04-24)

- **Fixed in this plan (Plan 1):** DL-1, DL-8, E-1, E-2, E-3 backend + frontend dialog, I-1/I-2/I-3 regression coverage.
- **Deferred to Plan 2 (Scope Dialog Unification):** E-0, DL-0, A-2.1.
- **Deferred to Plan 3 (Graph Sync Hardening):** A-P2, E-4, G-3, A-2.3.
- **Already compliant (pre-existing):** I-4, I-5, I-6, V-2, V-3, DL-3, DL-5, A-1, A-P1, A-P3, A-R1, A-R2, A-S1, A-S2.
- **Compliant by inspection (verified in Step 3):** fill in list after Step 3.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/audits/2026-04-24-recurrence-audit.md
git commit -m "docs(audit): final findings pass — DL-8, invariants, TBD rows resolved"
```

---

## Self-review checklist for implementers

Before closing out the plan, verify:

- [ ] All backend tests listed in tasks pass: `cd backend && npm test -- recurrenceDeleteExclusion recurrencePatternChangeOrphanCascade recurrenceIdempotentDelete recurrenceInvariants` (run as four separate commands if that's too long).
- [ ] All frontend tests listed in tasks pass: `npm test -- RecurrenceTabContent.removeOverride OrphanCascadeWarningDialog`.
- [ ] Audit doc has NO rows remaining at `TBD`.
- [ ] Manual smoke test: create a recurring series, delete one occurrence, verify it stays gone after a reload. Change the pattern, verify the warning dialog appears and confirms correctly.

---

## Follow-on plans (for future scheduling)

**Plan 2 — Scope Dialog Unification (E-0 / DL-0 / A-2.1):**
- Port `RecurringScopeDialog` pattern from `Calendar.jsx` into `EventReviewExperience` so MyReservations, ReservationRequests, and EventManagement all prompt for thisEvent vs allEvents.
- Audit all four entry points; verify dialog appears on both edit and delete actions.
- Hide exceptions panel in edit-request mode (A-2.1) — verify `pendingEditRequest` mode in `RecurrenceTabContent`.

**Plan 3 — Graph Sync Hardening (A-P2 / E-4 / G-3 / A-2.3):**
- Wrap publish in a transaction so Graph failure rolls back status (A-P2).
- On allEvents pattern change of a published series, reconcile Graph exceptions (delete orphaned, upsert new) (E-4).
- Integration tests for partial Graph failure and reconcile (G-3).
- Surface orphan warning on edit-request approval UI (A-2.3).
