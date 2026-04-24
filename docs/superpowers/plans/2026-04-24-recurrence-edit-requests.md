# Recurrence Edit Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow requesters to propose recurrence-pattern changes through the existing publish-edit (request-edit) workflow. Today the form lets requesters edit the pattern in edit-request mode, but the change is silently dropped: detection misses it, the payload doesn't carry it, and the backend ignores it. After this plan, recurrence travels end-to-end through request-edit → publish-edit, with conflict detection, Graph sync, and orphan reconciliation.

**Architecture:** Add a small shared comparison util (mirrored FE/BE) so both sides agree on what "different recurrence" means. Wire it through the existing `computeDetectedChanges` / `computeApproverChanges` / `buildEditRequestPayload` boundaries on the frontend, and through `proposedChanges` assembly + `finalChanges` application on the backend. Add policy guards (orphan check, exclusion-removal block). Reuse existing `buildGraphRecurrence` and `syncRecurrenceExclusionsToGraph` helpers for Graph sync. Reuse existing `checkRoomConflicts` (which already expands recurring series) for conflict checks on the new pattern.

**Tech Stack:** React 19 + Vite + Vitest (frontend), Node.js/Express + Jest + MongoDB Memory Server (backend), Microsoft Graph API for calendar sync.

**Locked policy decisions** (from product review on 2026-04-24):
- **Q1=B** — Allow recurrence-edit submission even when override docs exist; auto-delete orphaned overrides at approval time with audit trail.
- **Q2=B** — Allow promotion (singleInstance → seriesMaster) via edit request. Approval flips `eventType` and adds recurrence to the existing Graph event.
- **Q3=A** — `recurrence.range.startDate` is the source of truth; master `startDateTime` derives from it on approval.
- **Q4=A** — Approvers can tweak the proposed recurrence before publishing (parallel to existing `approverChanges` for other fields).
- **Q5=A** — Block recurrence-edit submissions that *remove* an exclusion (Graph cannot un-cancel a previously-deleted occurrence).

**Explicitly out of scope (deferred):**
- Demotion (seriesMaster → singleInstance via edit request). User can submit cancellation request instead.
- Recurrence edits with `editScope === 'thisEvent'` (per-occurrence). Pattern is series-level, not occurrence-level. Existing 400 guard stays.
- Email-template visual polish for recurrence diff rendering (Task 25 covers minimal correctness; deeper UX is a follow-on).

---

## File Structure

| File | Purpose |
|---|---|
| `src/utils/recurrenceCompare.js` (NEW) | Frontend `recurrenceEquals(a, b)` + `summarizeRecurrenceShort(r)` for diff display |
| `backend/utils/recurrenceCompare.js` (NEW) | Backend mirror — same logic, server-side |
| `src/utils/editRequestUtils.js` (MODIFY) | Extend `computeDetectedChanges`, `computeApproverChanges`, `buildEditRequestViewData` to handle recurrence |
| `src/utils/eventPayloadBuilder.js` (MODIFY) | `buildEditRequestPayload` carries `recurrence` |
| `src/hooks/useCurrentUserGates.js` (MODIFY) | Tighten `canEditRecurrence` for singleInstance in edit-request mode (Q2=B keeps it permissive — see Task 8) |
| `backend/api-server.js` (MODIFY) | `POST /api/events/:id/request-edit` accepts recurrence; `PUT /api/admin/events/:id/publish-edit` applies it |
| `backend/utils/recurrenceOrphanCleanup.js` (NEW) | Pure helper: given new recurrence + master eventId, find override docs that no longer fit; soft-delete them |
| `src/__tests__/unit/utils/recurrenceCompare.test.js` (NEW) | FE comparison util tests |
| `src/__tests__/unit/utils/editRequestUtilsRecurrence.test.js` (NEW) | FE detection + approver-change tests for recurrence |
| `src/__tests__/unit/hooks/useCurrentUserGates.test.js` (MODIFY) | Add positive test: edit-request mode allows recurrence edits on published series master |
| `backend/__tests__/unit/utils/recurrenceCompare.test.js` (NEW) | BE comparison util tests |
| `backend/__tests__/unit/utils/recurrenceOrphanCleanup.test.js` (NEW) | Orphan-reconciliation pure tests |
| `backend/__tests__/integration/events/editRequestRecurrence.test.js` (NEW) | End-to-end request-edit + publish-edit with recurrence |
| `backend/__tests__/__helpers__/eventFactory.js` (MODIFY, if needed) | Add `createPublishedSeriesMaster(...)` helper if not present |

---

## Task 1: Frontend `recurrenceEquals` helper — RED

**Files:**
- Create: `src/__tests__/unit/utils/recurrenceCompare.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// src/__tests__/unit/utils/recurrenceCompare.test.js
import { describe, it, expect } from 'vitest';
import { recurrenceEquals, summarizeRecurrenceShort } from '../../../utils/recurrenceCompare';

describe('recurrenceEquals', () => {
  it('returns true when both null', () => {
    expect(recurrenceEquals(null, null)).toBe(true);
  });

  it('returns false when one side is null', () => {
    const r = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(null, r)).toBe(false);
    expect(recurrenceEquals(r, null)).toBe(false);
  });

  it('returns true for identical patterns', () => {
    const r = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(r, { ...r })).toBe(true);
  });

  it('order of daysOfWeek does not matter', () => {
    const a = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday', 'friday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['friday', 'monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(a, b)).toBe(true);
  });

  it('returns false when interval differs', () => {
    const a = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(a, b)).toBe(false);
  });

  it('returns false when range.endDate differs', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-04-30' } };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-05-30' } };
    expect(recurrenceEquals(a, b)).toBe(false);
  });

  it('exclusions order does not matter', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: ['2026-04-22', '2026-04-25'] };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: ['2026-04-25', '2026-04-22'] };
    expect(recurrenceEquals(a, b)).toBe(true);
  });

  it('returns false when exclusion list differs', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: ['2026-04-22'] };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: [] };
    expect(recurrenceEquals(a, b)).toBe(false);
  });

  it('treats missing exclusions and empty array as equal', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: [] };
    expect(recurrenceEquals(a, b)).toBe(true);
  });
});

describe('summarizeRecurrenceShort', () => {
  it('returns empty string for null', () => {
    expect(summarizeRecurrenceShort(null)).toBe('');
  });

  it('returns a non-empty string for a populated pattern', () => {
    const r = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const s = summarizeRecurrenceShort(r);
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- recurrenceCompare`
Expected: All tests FAIL with module-not-found error.

- [ ] **Step 3: Commit (test-only)**

```bash
git add src/__tests__/unit/utils/recurrenceCompare.test.js
git commit -m "test(recurrence-edit): add failing tests for recurrenceEquals and summarizeRecurrenceShort"
```

---

## Task 2: Frontend `recurrenceEquals` helper — GREEN

**Files:**
- Create: `src/utils/recurrenceCompare.js`

- [ ] **Step 1: Implement the helper**

Create `src/utils/recurrenceCompare.js`:

```javascript
/**
 * Compare two recurrence objects for semantic equality.
 *
 * Used by the edit-request workflow to decide whether the requester actually
 * changed the recurrence (so detection flags it) and whether the approver
 * tweaked it during review (so it lands in approverChanges).
 *
 * Recurrence shape:
 *   { pattern: {type, interval, daysOfWeek?, dayOfMonth?, month?, index?},
 *     range:   {type, startDate, endDate?, numberOfOccurrences?, recurrenceTimeZone?},
 *     exclusions?: string[],   // YYYY-MM-DD
 *     additions?:  string[] }  // YYYY-MM-DD
 *
 * - daysOfWeek and exclusions/additions are compared as sets (order-insensitive).
 * - Missing arrays are treated as empty.
 * - null on both sides is equal; null vs populated is not.
 */
import { formatRecurrenceSummaryCompact } from './recurrenceUtils';

const setEqual = (a = [], b = []) => {
  if (a.length !== b.length) return false;
  const sa = [...a].map(String).sort();
  const sb = [...b].map(String).sort();
  return sa.every((v, i) => v === sb[i]);
};

function patternEquals(a = {}, b = {}) {
  if ((a.type || null) !== (b.type || null)) return false;
  if ((a.interval || 1) !== (b.interval || 1)) return false;
  if (!setEqual(a.daysOfWeek || [], b.daysOfWeek || [])) return false;
  if ((a.dayOfMonth ?? null) !== (b.dayOfMonth ?? null)) return false;
  if ((a.month ?? null) !== (b.month ?? null)) return false;
  if ((a.index ?? null) !== (b.index ?? null)) return false;
  if ((a.firstDayOfWeek ?? null) !== (b.firstDayOfWeek ?? null)) return false;
  return true;
}

function rangeEquals(a = {}, b = {}) {
  if ((a.type || null) !== (b.type || null)) return false;
  if ((a.startDate || null) !== (b.startDate || null)) return false;
  if ((a.endDate || null) !== (b.endDate || null)) return false;
  if ((a.numberOfOccurrences ?? null) !== (b.numberOfOccurrences ?? null)) return false;
  // recurrenceTimeZone is auto-populated server-side on create; do not gate equality on it.
  return true;
}

export function recurrenceEquals(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (!patternEquals(a.pattern || {}, b.pattern || {})) return false;
  if (!rangeEquals(a.range || {}, b.range || {})) return false;
  if (!setEqual(a.exclusions || [], b.exclusions || [])) return false;
  if (!setEqual(a.additions || [], b.additions || [])) return false;
  return true;
}

/**
 * Short, user-readable summary of a recurrence object — used for diff rows in
 * the detected-changes UI and for audit/email change descriptions. Returns ''
 * for null input.
 */
export function summarizeRecurrenceShort(r) {
  if (!r || !r.pattern) return '';
  return formatRecurrenceSummaryCompact(r.pattern, r.range || {}, r.additions || [], r.exclusions || []);
}
```

- [ ] **Step 2: Run tests to verify pass**

Run: `npm test -- recurrenceCompare`
Expected: All Task 1 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/utils/recurrenceCompare.js
git commit -m "feat(recurrence-edit): add recurrenceEquals and summarizeRecurrenceShort helpers"
```

---

## Task 3: Backend `recurrenceEquals` mirror — RED + GREEN

**Files:**
- Create: `backend/utils/recurrenceCompare.js`
- Create: `backend/__tests__/unit/utils/recurrenceCompare.test.js`

- [ ] **Step 1: Write backend tests (mirror of FE test set)**

Create `backend/__tests__/unit/utils/recurrenceCompare.test.js`:

```javascript
const { recurrenceEquals, exclusionsRemoved } = require('../../../utils/recurrenceCompare');

describe('recurrenceEquals (backend)', () => {
  test('null vs null is equal', () => {
    expect(recurrenceEquals(null, null)).toBe(true);
  });

  test('null vs populated is not equal', () => {
    const r = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(null, r)).toBe(false);
  });

  test('daysOfWeek order does not matter', () => {
    const a = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday', 'monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(a, b)).toBe(true);
  });

  test('range.endDate change is not equal', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-04-30' } };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-05-30' } };
    expect(recurrenceEquals(a, b)).toBe(false);
  });

  test('exclusion list set-equal', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: ['2026-04-22', '2026-04-25'] };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: ['2026-04-25', '2026-04-22'] };
    expect(recurrenceEquals(a, b)).toBe(true);
  });
});

describe('exclusionsRemoved', () => {
  test('returns dates that were in old but not in new', () => {
    const oldR = { exclusions: ['2026-04-22', '2026-04-25'] };
    const newR = { exclusions: ['2026-04-22'] };
    expect(exclusionsRemoved(oldR, newR)).toEqual(['2026-04-25']);
  });

  test('returns empty when new is a superset', () => {
    const oldR = { exclusions: ['2026-04-22'] };
    const newR = { exclusions: ['2026-04-22', '2026-04-29'] };
    expect(exclusionsRemoved(oldR, newR)).toEqual([]);
  });

  test('handles missing arrays as empty', () => {
    expect(exclusionsRemoved({}, {})).toEqual([]);
    expect(exclusionsRemoved({ exclusions: ['2026-04-22'] }, {})).toEqual(['2026-04-22']);
    expect(exclusionsRemoved({}, { exclusions: ['2026-04-22'] })).toEqual([]);
  });

  test('handles null inputs', () => {
    expect(exclusionsRemoved(null, null)).toEqual([]);
    expect(exclusionsRemoved(null, { exclusions: ['x'] })).toEqual([]);
    expect(exclusionsRemoved({ exclusions: ['x'] }, null)).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- recurrenceCompare`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the backend helper**

Create `backend/utils/recurrenceCompare.js`:

```javascript
'use strict';

/**
 * Backend mirror of src/utils/recurrenceCompare.js.
 * See FE file for shape documentation.
 */

const setEqual = (a = [], b = []) => {
  if (a.length !== b.length) return false;
  const sa = [...a].map(String).sort();
  const sb = [...b].map(String).sort();
  return sa.every((v, i) => v === sb[i]);
};

function patternEquals(a = {}, b = {}) {
  if ((a.type || null) !== (b.type || null)) return false;
  if ((a.interval || 1) !== (b.interval || 1)) return false;
  if (!setEqual(a.daysOfWeek || [], b.daysOfWeek || [])) return false;
  if ((a.dayOfMonth ?? null) !== (b.dayOfMonth ?? null)) return false;
  if ((a.month ?? null) !== (b.month ?? null)) return false;
  if ((a.index ?? null) !== (b.index ?? null)) return false;
  if ((a.firstDayOfWeek ?? null) !== (b.firstDayOfWeek ?? null)) return false;
  return true;
}

function rangeEquals(a = {}, b = {}) {
  if ((a.type || null) !== (b.type || null)) return false;
  if ((a.startDate || null) !== (b.startDate || null)) return false;
  if ((a.endDate || null) !== (b.endDate || null)) return false;
  if ((a.numberOfOccurrences ?? null) !== (b.numberOfOccurrences ?? null)) return false;
  return true;
}

function recurrenceEquals(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (!patternEquals(a.pattern || {}, b.pattern || {})) return false;
  if (!rangeEquals(a.range || {}, b.range || {})) return false;
  if (!setEqual(a.exclusions || [], b.exclusions || [])) return false;
  if (!setEqual(a.additions || [], b.additions || [])) return false;
  return true;
}

/**
 * Returns dates present in old.exclusions but not in new.exclusions.
 * Used by the request-edit guard for Q5=A (exclusion-removal block).
 */
function exclusionsRemoved(oldR, newR) {
  const oldEx = (oldR && Array.isArray(oldR.exclusions)) ? oldR.exclusions : [];
  const newEx = (newR && Array.isArray(newR.exclusions)) ? newR.exclusions : [];
  const newSet = new Set(newEx.map(String));
  return oldEx.map(String).filter(d => !newSet.has(d));
}

module.exports = { recurrenceEquals, exclusionsRemoved };
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && npm test -- recurrenceCompare`
Expected: All Task 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/utils/recurrenceCompare.js backend/__tests__/unit/utils/recurrenceCompare.test.js
git commit -m "feat(recurrence-edit): add backend recurrenceEquals + exclusionsRemoved helpers"
```

---

## Task 4: Frontend `computeDetectedChanges` extension — RED

**Files:**
- Create: `src/__tests__/unit/utils/editRequestUtilsRecurrence.test.js`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/unit/utils/editRequestUtilsRecurrence.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { computeDetectedChanges, computeApproverChanges } from '../../../utils/editRequestUtils';

const baseFields = {
  eventTitle: 'Weekly Standup',
  eventDescription: '',
  startDate: '2026-04-20',
  startTime: '09:00',
  endDate: '2026-04-20',
  endTime: '10:00',
};

const weeklyMonday = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
const weeklyMonWed = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };

describe('computeDetectedChanges — recurrence', () => {
  it('detects no change when recurrence is identical', () => {
    const original = { ...baseFields, recurrence: weeklyMonday };
    const current = { ...baseFields, recurrence: { ...weeklyMonday } };
    const changes = computeDetectedChanges(original, current);
    expect(changes.find(c => c.field === 'recurrence')).toBeUndefined();
  });

  it('detects change when daysOfWeek differs', () => {
    const original = { ...baseFields, recurrence: weeklyMonday };
    const current = { ...baseFields, recurrence: weeklyMonWed };
    const changes = computeDetectedChanges(original, current);
    const recRow = changes.find(c => c.field === 'recurrence');
    expect(recRow).toBeDefined();
    expect(recRow.label).toBe('Recurrence');
    expect(recRow.oldValue).toContain('Monday');
    expect(recRow.newValue).toContain('Monday');
    expect(recRow.newValue).toContain('Wednesday');
  });

  it('detects change when adding recurrence to a non-recurring event (promotion, Q2=B)', () => {
    const original = { ...baseFields, recurrence: null };
    const current = { ...baseFields, recurrence: weeklyMonday };
    const changes = computeDetectedChanges(original, current);
    const recRow = changes.find(c => c.field === 'recurrence');
    expect(recRow).toBeDefined();
    expect(recRow.oldValue).toBe('(none)');
  });

  it('detects change when exclusions added', () => {
    const original = { ...baseFields, recurrence: { ...weeklyMonday, exclusions: [] } };
    const current = { ...baseFields, recurrence: { ...weeklyMonday, exclusions: ['2026-04-27'] } };
    const changes = computeDetectedChanges(original, current);
    expect(changes.find(c => c.field === 'recurrence')).toBeDefined();
  });

  it('treats permuted daysOfWeek arrays as no change', () => {
    const a = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday', 'monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const original = { ...baseFields, recurrence: a };
    const current = { ...baseFields, recurrence: b };
    expect(computeDetectedChanges(original, current).find(c => c.field === 'recurrence')).toBeUndefined();
  });
});

describe('computeApproverChanges — recurrence', () => {
  it('omits recurrence when unchanged from original', () => {
    const original = { ...baseFields, recurrence: weeklyMonday };
    const current = { ...baseFields, recurrence: { ...weeklyMonday } };
    expect(computeApproverChanges(current, original)?.recurrence).toBeUndefined();
  });

  it('includes recurrence when approver tweaked it', () => {
    const original = { ...baseFields, recurrence: weeklyMonday };
    const current = { ...baseFields, recurrence: weeklyMonWed };
    const delta = computeApproverChanges(current, original);
    expect(delta).not.toBeNull();
    expect(delta.recurrence).toEqual(weeklyMonWed);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- editRequestUtilsRecurrence`
Expected: All tests FAIL because recurrence is not yet handled in the utils.

- [ ] **Step 3: Commit (test-only)**

```bash
git add src/__tests__/unit/utils/editRequestUtilsRecurrence.test.js
git commit -m "test(recurrence-edit): add failing tests for recurrence in detected/approver changes"
```

---

## Task 5: Frontend `computeDetectedChanges` extension — GREEN

**Files:**
- Modify: `src/utils/editRequestUtils.js`

- [ ] **Step 1: Add import and recurrence handling**

At top of `src/utils/editRequestUtils.js`, add:

```javascript
import { recurrenceEquals, summarizeRecurrenceShort } from './recurrenceCompare';
```

In `computeDetectedChanges` (currently ends at line 308), before the `return changes;` statement, add:

```javascript
  // Recurrence diff (single pseudo-field row with summary text on each side).
  const oldR = originalData.recurrence || null;
  const newR = currentData.recurrence || null;
  if (!recurrenceEquals(oldR, newR)) {
    changes.push({
      field: 'recurrence',
      label: 'Recurrence',
      oldValue: summarizeRecurrenceShort(oldR) || '(none)',
      newValue: summarizeRecurrenceShort(newR) || '(none)',
    });
  }
```

In `computeApproverChanges` (currently ends at line 251), inside the function body before the final `return Object.keys(changes).length > 0 ? changes : null;`, add:

```javascript
  // Recurrence: top-level field, deep object compare via recurrenceEquals.
  if (!recurrenceEquals(currentFormData.recurrence || null, originalEventData.recurrence || null)) {
    changes.recurrence = currentFormData.recurrence || null;
  }
```

- [ ] **Step 2: Run tests to verify pass**

Run: `npm test -- editRequestUtilsRecurrence`
Expected: All Task 4 tests PASS.

- [ ] **Step 3: Run full editRequestUtils suite to confirm no regressions**

Run: `npm test -- editRequestUtils`
Expected: All existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/utils/editRequestUtils.js
git commit -m "feat(recurrence-edit): wire recurrence into computeDetectedChanges and computeApproverChanges"
```

---

## Task 6: Frontend `buildEditRequestPayload` carries recurrence

**Files:**
- Modify: `src/utils/eventPayloadBuilder.js`

- [ ] **Step 1: Add recurrence to payload**

In `src/utils/eventPayloadBuilder.js`, inside `buildEditRequestPayload` (line 298), after the `offsiteLon: data.offsiteLon || null,` line and before the closing `};`, add:

```javascript
    // Recurrence pattern (undefined = not sent, so backend skips compare for non-recurring contexts)
    recurrence: data.recurrence !== undefined ? data.recurrence : undefined,
```

- [ ] **Step 2: Verify form already supplies recurrence**

Read `src/components/RoomReservationReview.jsx:408` — confirm `recurrence: recurrencePatternRef.current` is present in `getProcessedFormData`. (It is, per pre-plan investigation. No change needed here.)

- [ ] **Step 3: Smoke-test the wiring with an inline assertion**

Add a one-off assertion in `src/__tests__/unit/utils/editRequestUtilsRecurrence.test.js` (extending the existing file):

```javascript
import { buildEditRequestPayload } from '../../../utils/eventPayloadBuilder';

describe('buildEditRequestPayload — recurrence', () => {
  it('includes recurrence when provided', () => {
    const data = {
      eventTitle: 'X',
      startDate: '2026-04-20', startTime: '09:00',
      endDate: '2026-04-20', endTime: '10:00',
      attendeeCount: 5,
      recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } },
    };
    const payload = buildEditRequestPayload(data, { eventVersion: 1 });
    expect(payload.recurrence).toEqual(data.recurrence);
  });

  it('omits recurrence key when not provided (gets stripped by JSON.stringify)', () => {
    const data = { eventTitle: 'X', startDate: '2026-04-20', startTime: '09:00', endDate: '2026-04-20', endTime: '10:00' };
    const payload = buildEditRequestPayload(data, { eventVersion: 1 });
    // undefined survives in the JS object but is dropped during JSON serialization
    expect(JSON.parse(JSON.stringify(payload)).recurrence).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npm test -- editRequestUtilsRecurrence`
Expected: New tests pass, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/utils/eventPayloadBuilder.js src/__tests__/unit/utils/editRequestUtilsRecurrence.test.js
git commit -m "feat(recurrence-edit): include recurrence in edit-request payload"
```

---

## Task 7: Frontend `buildEditRequestViewData` overlays recurrence

**Files:**
- Modify: `src/utils/editRequestUtils.js`

- [ ] **Step 1: Add tests for view data overlay**

Append to `src/__tests__/unit/utils/editRequestUtilsRecurrence.test.js`:

```javascript
import { buildEditRequestViewData } from '../../../utils/editRequestUtils';

describe('buildEditRequestViewData — recurrence overlay', () => {
  it('overlays proposed recurrence at top level', () => {
    const event = {
      _version: 3,
      calendarData: { eventTitle: 'X' },
      recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } },
      pendingEditRequest: {
        proposedChanges: {
          recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } },
        },
      },
    };
    const result = buildEditRequestViewData(event, { calendarData: event.calendarData, recurrence: event.recurrence });
    expect(result.recurrence.pattern.daysOfWeek).toEqual(['monday', 'wednesday']);
    expect(result.calendarData.recurrence.pattern.daysOfWeek).toEqual(['monday', 'wednesday']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- editRequestUtilsRecurrence`
Expected: New test fails — recurrence is not currently overlaid by `buildEditRequestViewData`.

- [ ] **Step 3: Modify `buildEditRequestViewData`**

In `src/utils/editRequestUtils.js`, modify `buildEditRequestViewData` so it spreads `decomposed` (which already contains `recurrence` if proposed) at top level AND inside calendarData. Confirm that the existing spread already does this — `decomposed` is a copy of `proposedChanges` with date/time decomposition added. Since the backend stores `proposedChanges.recurrence` as a top-level key, it already lands in `decomposed`. So both `...decomposed` (line 173) and `calendarData: { ..., ...decomposed }` (line 180-183) already cover recurrence.

If the test still fails, add an explicit normalization. Inspect by adding `console.log(result)` then run. The likely fix:

```javascript
export function buildEditRequestViewData(event, currentData) {
  if (!event?.pendingEditRequest) return currentData;

  const proposed = event.pendingEditRequest.proposedChanges || {};
  const decomposed = decomposeProposedChanges(proposed);

  return {
    ...currentData,
    ...decomposed,
    pendingEditRequest: event.pendingEditRequest,
    // Explicit recurrence handling: ensure it lands at top-level even if decomposeProposedChanges
    // ever drops object-typed values in the future.
    ...(proposed.recurrence !== undefined ? { recurrence: proposed.recurrence } : {}),
    calendarData: {
      ...(currentData?.calendarData || {}),
      ...decomposed,
      ...(proposed.recurrence !== undefined ? { recurrence: proposed.recurrence } : {}),
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- editRequestUtilsRecurrence`
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/editRequestUtils.js src/__tests__/unit/utils/editRequestUtilsRecurrence.test.js
git commit -m "feat(recurrence-edit): overlay proposed recurrence in view-data builder"
```

---

## Task 8: Gate update — verify singleInstance promotion is allowed (Q2=B)

**Files:**
- Modify: `src/__tests__/unit/hooks/useCurrentUserGates.test.js`

Per Q2=B, requesters can promote a singleInstance to recurring. The existing gate `canEditRecurrence = (isSeriesMaster || isSingleInstance) && canSave` already allows this in edit-request mode. We just need a positive test to lock it in.

- [ ] **Step 1: Add positive tests**

In `src/__tests__/unit/hooks/useCurrentUserGates.test.js`, find the `describe('canEditRecurrence', ...)` block (containing the test at line 120) and add these new tests inside it:

```javascript
    it('requester CAN edit recurrence on own published seriesMaster IN edit-request mode', () => {
      const event = makeEvent({ status: 'published', eventType: 'seriesMaster', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts, { isEditRequestMode: true });
      expect(gates.canEditRecurrence).toBe(true);
      expect(gates.canSave).toBe(true);
    });

    it('requester CAN promote own published singleInstance to recurring IN edit-request mode (Q2=B)', () => {
      const event = makeEvent({ status: 'published', eventType: 'singleInstance', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts, { isEditRequestMode: true });
      expect(gates.canEditRecurrence).toBe(true);
    });

    it('requester CANNOT edit recurrence on own published seriesMaster WITHOUT edit-request mode', () => {
      // Regression check: at-rest editing of published events stays blocked.
      const event = makeEvent({ status: 'published', eventType: 'seriesMaster', isOwner: true });
      const gates = deriveGates(event, PERMISSION_FIXTURES.requester, accounts);
      expect(gates.canEditRecurrence).toBe(false);
    });
```

- [ ] **Step 2: Run tests**

Run: `npm test -- useCurrentUserGates`
Expected: All new tests pass without any code change (gate logic already supports them). All pre-existing tests in the file continue to pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/unit/hooks/useCurrentUserGates.test.js
git commit -m "test(recurrence-edit): lock in canEditRecurrence behavior in edit-request mode"
```

---

## Task 9: Backend — accept `recurrence` in `request-edit` body (RED)

**Files:**
- Create: `backend/__tests__/integration/events/editRequestRecurrence.test.js`

- [ ] **Step 1: Write failing integration test for accepting recurrence**

Create `backend/__tests__/integration/events/editRequestRecurrence.test.js`:

```javascript
const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createApprover, createRequester, insertUsers } = require('../../__helpers__/userFactory');
const { createPublishedEvent, insertEvents } = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS } = require('../../__helpers__/testConstants');

describe('Edit Request Tests — Recurrence (ER-R1 to ER-R8)', () => {
  let mongoClient;
  let db;
  let app;
  let approverUser;
  let approverToken;
  let requesterUser;
  let requesterToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('editRequestRecurrence'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.AUDIT_HISTORY).deleteMany({});

    approverUser = createApprover();
    requesterUser = createRequester();
    await insertUsers(db, [approverUser, requesterUser]);

    approverToken = await createMockToken(approverUser);
    requesterToken = await createMockToken(requesterUser);
  });

  // Helper: build a published seriesMaster owned by requesterUser.
  async function publishedSeriesMaster({ exclusions = [] } = {}) {
    const event = createPublishedEvent({
      ownerEmail: requesterUser.email,
      ownerName: requesterUser.displayName,
      ownerId: requesterUser.userId,
      ownerDepartment: requesterUser.department,
      eventType: 'seriesMaster',
      // Keep dates aligned with the recurrence range.
      startDate: '2026-04-20', startTime: '09:00',
      endDate: '2026-04-20', endTime: '10:00',
    });
    event.recurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
      range: { type: 'noEnd', startDate: '2026-04-20' },
      exclusions,
    };
    event.eventType = 'seriesMaster';
    await insertEvents(db, [event]);
    return event;
  }

  describe('ER-R1: submit recurrence change on seriesMaster with no children', () => {
    it('stores proposedChanges.recurrence and sets pendingEditRequest.status=pending', async () => {
      const event = await publishedSeriesMaster();
      const newRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
      };

      const res = await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: event.calendarData.eventTitle,
          recurrence: newRecurrence,
          _version: event._version,
        });

      expect(res.status).toBe(200);

      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(updated.pendingEditRequest).toBeDefined();
      expect(updated.pendingEditRequest.status).toBe('pending');
      expect(updated.pendingEditRequest.proposedChanges.recurrence).toEqual(newRecurrence);
    });

    it('does NOT include recurrence in proposedChanges when value is unchanged', async () => {
      const event = await publishedSeriesMaster();
      const sameRecurrence = JSON.parse(JSON.stringify(event.recurrence));

      const res = await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          eventTitle: 'New Title',
          recurrence: sameRecurrence,
          _version: event._version,
        });

      expect(res.status).toBe(200);
      const updated = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(updated.pendingEditRequest.proposedChanges.recurrence).toBeUndefined();
      expect(updated.pendingEditRequest.proposedChanges.eventTitle).toBe('New Title');
    });
  });

  describe('ER-R5: exclusion-removal blocked (Q5=A)', () => {
    it('returns 400 EXCLUSION_REMOVAL_NOT_SUPPORTED when new recurrence drops an exclusion', async () => {
      const event = await publishedSeriesMaster({ exclusions: ['2026-04-27'] });
      const recurrenceMinusExclusion = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
        exclusions: [],
      };

      const res = await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          recurrence: recurrenceMinusExclusion,
          _version: event._version,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('EXCLUSION_REMOVAL_NOT_SUPPORTED');
      expect(res.body.removedExclusions).toEqual(['2026-04-27']);
    });

    it('allows ADDING an exclusion (still allowed)', async () => {
      const event = await publishedSeriesMaster({ exclusions: [] });
      const recurrencePlusExclusion = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
        exclusions: ['2026-05-04'],
      };

      const res = await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          recurrence: recurrencePlusExclusion,
          _version: event._version,
        });

      expect(res.status).toBe(200);
    });
  });

  describe('ER-R0: replaces old date-change block — date moves are now allowed when bundled with recurrence (Q3=A)', () => {
    it('does NOT 400 when startDateTime change is implied by recurrence.range.startDate change', async () => {
      const event = await publishedSeriesMaster();
      const newRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-27' },
      };

      const res = await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          recurrence: newRecurrence,
          _version: event._version,
        });

      expect(res.status).toBe(200);
    });

    it('still 400s for naked startDateTime change without recurrence (per-master date moves still blocked)', async () => {
      const event = await publishedSeriesMaster();

      const res = await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({
          startDateTime: '2026-04-27T09:00:00',
          _version: event._version,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Date changes are not allowed/);
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- editRequestRecurrence`
Expected: All ER-R tests FAIL — backend doesn't accept `recurrence`, doesn't enforce exclusion-removal block, and still rejects bundled date moves.

- [ ] **Step 3: Commit (test-only)**

```bash
git add backend/__tests__/integration/events/editRequestRecurrence.test.js
git commit -m "test(recurrence-edit): add failing integration tests for recurrence in request-edit"
```

---

## Task 10: Backend — accept `recurrence` in `request-edit` (GREEN)

**Files:**
- Modify: `backend/api-server.js` (`POST /api/events/:id/request-edit`, around line 19788)

- [ ] **Step 1: Add destructure of `recurrence`**

In `backend/api-server.js`, in the `request-edit` handler's body destructuring (line 19794-19832), add `recurrence` to the list:

Replace lines 19794-19832 (the destructure block) with the existing fields plus:

```javascript
      // ... existing fields ...
      organizerName,
      organizerPhone,
      organizerEmail,
      _version,
      recurrence,                  // NEW: full recurrence object { pattern, range, exclusions, additions }
      // Recurring event scope fields (for per-occurrence edit requests)
      editScope,
      occurrenceDate,
      seriesMasterId
    } = req.body;
```

- [ ] **Step 2: Add the `require` for the comparison helper at the top of the file (or near other utils requires)**

Search for an existing util require like `require('./utils/concurrencyUtils')`. Add nearby:

```javascript
const { recurrenceEquals, exclusionsRemoved } = require('./utils/recurrenceCompare');
```

- [ ] **Step 3: Replace the date-change block (lines 19918-19933) with a narrower guard**

Replace:

```javascript
    // Prevent date changes on recurring series masters (dates are tied to recurrence pattern).
    if (originalEvent.eventType === 'seriesMaster' && editScope !== 'thisEvent' && (startDateTime || endDateTime)) {
      const cd = originalEvent.calendarData || {};
      const originalStartDate = extractDatePart(cd.startDateTime);
      const originalEndDate = extractDatePart(cd.endDateTime);
      const proposedStartDate = extractDatePart(startDateTime);
      const proposedEndDate = extractDatePart(endDateTime);

      if ((proposedStartDate && proposedStartDate !== originalStartDate) ||
          (proposedEndDate && proposedEndDate !== originalEndDate)) {
        return res.status(400).json({
          error: 'Date changes are not allowed in edit requests for recurring series. Only time changes are permitted. Contact an administrator to modify the recurrence pattern.'
        });
      }
    }
```

With (Q3=A — naked date moves still blocked, but a recurrence-driven date move is allowed; range.startDate becomes the source):

```javascript
    // Per-master date moves on recurring series remain blocked: dates are tied to the recurrence
    // pattern, so a date change MUST come bundled with a recurrence change. The recurrence path
    // handles its own date derivation in publish-edit (Q3=A — range.startDate becomes master start).
    if (originalEvent.eventType === 'seriesMaster' && editScope !== 'thisEvent' && (startDateTime || endDateTime) && !recurrence) {
      const cd = originalEvent.calendarData || {};
      const originalStartDate = extractDatePart(cd.startDateTime);
      const originalEndDate = extractDatePart(cd.endDateTime);
      const proposedStartDate = extractDatePart(startDateTime);
      const proposedEndDate = extractDatePart(endDateTime);

      if ((proposedStartDate && proposedStartDate !== originalStartDate) ||
          (proposedEndDate && proposedEndDate !== originalEndDate)) {
        return res.status(400).json({
          error: 'Date changes are not allowed in edit requests for recurring series unless bundled with a recurrence change. Submit the new recurrence pattern (whose range.startDate sets the new series start), or contact an administrator.'
        });
      }
    }
```

- [ ] **Step 4: Add Q5 exclusion-removal guard**

Inside the same handler, after the date-change block above and before "Mutual exclusion: no pending cancellation request" (line 19935), add:

```javascript
    // Q5=A: Block exclusion-removal. Graph cannot un-cancel a previously-deleted occurrence,
    // so allowing this would create a split-brain (MongoDB shows occurrence; Outlook does not).
    if (recurrence !== undefined && originalEvent.recurrence) {
      const removed = exclusionsRemoved(originalEvent.recurrence, recurrence);
      if (removed.length > 0) {
        return res.status(400).json({
          error: 'EXCLUSION_REMOVAL_NOT_SUPPORTED',
          message: 'Removing previously-cancelled occurrences from a recurring series is not supported via edit request. Affected dates: ' + removed.join(', '),
          removedExclusions: removed
        });
      }
    }
```

- [ ] **Step 5: Add recurrence to `proposedChanges` assembly**

Inside the same handler, after the `services` comparison block (around line 20087), and before "Handle contact person changes" (line 20089), add:

```javascript
    // Recurrence comparison (deep object compare via recurrenceEquals).
    // Compares against top-level event.recurrence (authoritative source) with calendarData fallback.
    if (recurrence !== undefined) {
      const baselineRecurrence = originalEvent.recurrence || (originalEvent.calendarData && originalEvent.calendarData.recurrence) || null;
      if (!recurrenceEquals(recurrence, baselineRecurrence)) {
        proposedChanges.recurrence = recurrence;
        changesArray.push({
          field: 'recurrence',
          oldValue: baselineRecurrence ? JSON.stringify(baselineRecurrence) : '(none)',
          newValue: recurrence ? JSON.stringify(recurrence) : '(none)'
        });
      }
    }
```

- [ ] **Step 6: Run integration tests**

Run: `cd backend && npm test -- editRequestRecurrence`
Expected: ER-R1 and ER-R5 tests PASS. ER-R0 first test (bundled date move) PASSES; second (naked date move) STILL PASSES.

- [ ] **Step 7: Run the broader edit-request suite to confirm no regression**

Run: `cd backend && npm test -- editRequest`
Expected: All existing edit-request tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/api-server.js
git commit -m "feat(recurrence-edit): accept recurrence in request-edit, block exclusion-removal (Q5)"
```

---

## Task 11: Backend orphan-cleanup helper — RED + GREEN

**Files:**
- Create: `backend/utils/recurrenceOrphanCleanup.js`
- Create: `backend/__tests__/unit/utils/recurrenceOrphanCleanup.test.js`

This implements Q1=B: when a new recurrence pattern is approved, override docs whose `occurrenceDate` is no longer in the new expansion get soft-deleted with an audit row.

- [ ] **Step 1: Write failing tests**

Create `backend/__tests__/unit/utils/recurrenceOrphanCleanup.test.js`:

```javascript
const { findOrphanedOverrides } = require('../../../utils/recurrenceOrphanCleanup');

// We test the pure helper, not the DB-touching cleanup function.
// findOrphanedOverrides(newRecurrence, overrideDocs) returns the subset of overrideDocs whose
// occurrenceDate is NOT in the new expansion.

describe('findOrphanedOverrides', () => {
  test('returns empty when override dates all fall within new pattern', () => {
    const newRecurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
      range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-05-31' }
    };
    const overrides = [
      { _id: '1', occurrenceDate: '2026-04-27', eventType: 'exception' },
      { _id: '2', occurrenceDate: '2026-05-04', eventType: 'exception' },
    ];
    expect(findOrphanedOverrides(newRecurrence, overrides)).toEqual([]);
  });

  test('returns overrides whose date is not in new expansion', () => {
    const newRecurrence = {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
      range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-05-31' }
    };
    const overrides = [
      { _id: '1', occurrenceDate: '2026-04-22', eventType: 'exception' },  // Wednesday — orphaned
      { _id: '2', occurrenceDate: '2026-04-27', eventType: 'exception' },  // Monday — kept
    ];
    const orphans = findOrphanedOverrides(newRecurrence, overrides);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]._id).toBe('1');
  });

  test('addition docs follow inverse rule — orphaned when date IS now in pattern (becomes redundant)', () => {
    // An "addition" is a date NOT in the pattern. If the new pattern now includes it,
    // the addition is redundant and should be cleaned up.
    const newRecurrence = {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-05-31' }
    };
    const overrides = [
      { _id: '1', occurrenceDate: '2026-04-22', eventType: 'addition' },
    ];
    const orphans = findOrphanedOverrides(newRecurrence, overrides);
    expect(orphans).toHaveLength(1);
  });

  test('handles empty override list', () => {
    const newRecurrence = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(findOrphanedOverrides(newRecurrence, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- recurrenceOrphanCleanup`
Expected: All tests FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `backend/utils/recurrenceOrphanCleanup.js`:

```javascript
'use strict';

const { expandAllOccurrences } = require('./recurrenceExpansion');

/**
 * Determine which override documents (exception/addition) no longer fit the new recurrence.
 *
 * Q1=B reconciliation rules:
 *   - exception: orphaned when its occurrenceDate is NOT in the new expansion
 *     (the "weekday it overrode" no longer occurs in the series).
 *   - addition:  orphaned when its occurrenceDate IS in the new expansion
 *     (the addition is now redundant — the date is already a regular occurrence).
 *
 * Pure function. No DB access. The caller is responsible for soft-deleting and auditing.
 *
 * @param {Object} newRecurrence - The new pattern { pattern, range, ... }
 * @param {Array<Object>} overrideDocs - exception/addition docs with at least { _id, occurrenceDate, eventType }
 * @returns {Array<Object>} The subset of overrideDocs that are orphaned.
 */
function findOrphanedOverrides(newRecurrence, overrideDocs) {
  if (!newRecurrence || !newRecurrence.pattern || !overrideDocs || overrideDocs.length === 0) {
    return [];
  }

  // Build the set of dates that fall in the new pattern. Use expandAllOccurrences over the
  // recurrence's own range so we don't accidentally truncate.
  // expandAllOccurrences expects (recurrence, startDateTime, endDateTime) as ISO strings.
  const rangeStart = newRecurrence.range && newRecurrence.range.startDate
    ? `${newRecurrence.range.startDate}T00:00:00`
    : null;
  // For noEnd ranges, expandAllOccurrences handles its own bounding via a hard cap;
  // pass the range.endDate when available, otherwise let expansion default.
  const rangeEnd = newRecurrence.range && newRecurrence.range.endDate
    ? `${newRecurrence.range.endDate}T23:59:59`
    : null;

  const occurrences = expandAllOccurrences(newRecurrence, rangeStart, rangeEnd);
  const occurrenceDateSet = new Set(
    (occurrences || []).map(o => {
      if (o.occurrenceDate) return o.occurrenceDate;
      if (o.startDateTime) return o.startDateTime.split('T')[0];
      return null;
    }).filter(Boolean)
  );

  return overrideDocs.filter(doc => {
    const date = doc.occurrenceDate;
    if (!date) return false;
    if (doc.eventType === 'exception') {
      // Orphaned when the date is no longer in the pattern.
      return !occurrenceDateSet.has(date);
    }
    if (doc.eventType === 'addition') {
      // Redundant when the date is now a regular occurrence.
      return occurrenceDateSet.has(date);
    }
    return false;
  });
}

module.exports = { findOrphanedOverrides };
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd backend && npm test -- recurrenceOrphanCleanup`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/utils/recurrenceOrphanCleanup.js backend/__tests__/unit/utils/recurrenceOrphanCleanup.test.js
git commit -m "feat(recurrence-edit): add orphan override detection helper for Q1=B reconciliation"
```

---

## Task 12: Publish-edit applies recurrence — RED

**Files:**
- Modify: `backend/__tests__/integration/events/editRequestRecurrence.test.js` (extend with publish-edit tests)

- [ ] **Step 1: Add publish-edit tests**

Append to `backend/__tests__/integration/events/editRequestRecurrence.test.js`:

```javascript
  describe('ER-R4: publish-edit applies recurrence to master', () => {
    it('updates event.recurrence and increments _version', async () => {
      const event = await publishedSeriesMaster();
      const newRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday', 'thursday'] },
        range: { type: 'noEnd', startDate: '2026-04-21' },
      };

      // Submit edit request
      await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ recurrence: newRecurrence, _version: event._version });

      const submitted = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(submitted.pendingEditRequest.proposedChanges.recurrence).toEqual(newRecurrence);

      // Approver publishes
      const res = await request(app)
        .put(`/api/admin/events/${event.eventId}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: submitted._version });

      expect(res.status).toBe(200);
      const published = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(published.recurrence).toEqual(newRecurrence);
      expect(published.pendingEditRequest.status).toBe('approved');
    });
  });

  describe('ER-R6: range.startDate change derives master.startDateTime (Q3=A)', () => {
    it('publish-edit updates calendarData.startDateTime to match new range.startDate', async () => {
      const event = await publishedSeriesMaster();
      const newRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-05-04' },
      };

      await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ recurrence: newRecurrence, _version: event._version });

      const submitted = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });

      const res = await request(app)
        .put(`/api/admin/events/${event.eventId}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: submitted._version });

      expect(res.status).toBe(200);
      const published = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(published.calendarData.startDateTime.startsWith('2026-05-04')).toBe(true);
      expect(published.calendarData.startDate).toBe('2026-05-04');
    });
  });

  describe('ER-R7: orphaned override docs are soft-deleted on pattern change (Q1=B)', () => {
    it('soft-deletes exception docs whose occurrenceDate is not in the new pattern', async () => {
      const event = await publishedSeriesMaster();
      // Insert an exception doc on a Monday (in pattern).
      const exceptionDoc = {
        eventId: `${event.eventId}-exception-1`,
        seriesMasterId: event.eventId,
        seriesMasterEventId: event.eventId,
        occurrenceDate: '2026-04-22',  // Wednesday — NOT in current 'monday' pattern (legacy/dirty data)
        eventType: 'exception',
        status: 'published',
        isDeleted: false,
        _version: 1,
        calendarOwner: event.calendarOwner,
        calendarId: event.calendarId,
        overrides: { eventTitle: 'Exception Title' },
      };
      await db.collection(COLLECTIONS.EVENTS).insertOne(exceptionDoc);

      // Submit a recurrence change. The new pattern is also 'monday'-only, so the exception
      // doc on Wednesday is still orphaned and should be cleaned up.
      const newRecurrence = {
        pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday'] },  // Every 2 weeks now
        range: { type: 'noEnd', startDate: '2026-04-20' },
      };

      await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ recurrence: newRecurrence, _version: event._version });

      const submitted = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });

      const res = await request(app)
        .put(`/api/admin/events/${event.eventId}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: submitted._version });

      expect(res.status).toBe(200);

      const cleanedException = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: exceptionDoc.eventId });
      expect(cleanedException.isDeleted).toBe(true);
      expect(cleanedException.status).toBe('deleted');
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- editRequestRecurrence`
Expected: ER-R4, ER-R6, ER-R7 FAIL — backend doesn't yet apply recurrence in publish-edit.

- [ ] **Step 3: Commit (test-only)**

```bash
git add backend/__tests__/integration/events/editRequestRecurrence.test.js
git commit -m "test(recurrence-edit): add failing tests for publish-edit applying recurrence"
```

---

## Task 13: Publish-edit applies recurrence (GREEN)

**Files:**
- Modify: `backend/api-server.js` (`PUT /api/admin/events/:id/publish-edit`, around line 20541)

- [ ] **Step 1: Add `recurrence` to the conflict-trigger condition**

In `backend/api-server.js`, find `hasTimeOrRoomChange` (line 20598) and replace:

```javascript
    const hasTimeOrRoomChange = finalChanges.startDateTime || finalChanges.endDateTime ||
      finalChanges.locations || finalChanges.requestedRooms ||
      finalChanges.setupTimeMinutes !== undefined || finalChanges.teardownTimeMinutes !== undefined ||
      finalChanges.reservationStartMinutes !== undefined || finalChanges.reservationEndMinutes !== undefined;
```

With:

```javascript
    const hasTimeOrRoomChange = finalChanges.startDateTime || finalChanges.endDateTime ||
      finalChanges.locations || finalChanges.requestedRooms ||
      finalChanges.setupTimeMinutes !== undefined || finalChanges.teardownTimeMinutes !== undefined ||
      finalChanges.reservationStartMinutes !== undefined || finalChanges.reservationEndMinutes !== undefined ||
      finalChanges.recurrence !== undefined;  // Pattern change moves the entire occurrence set.
```

- [ ] **Step 2: Add the require for orphan-cleanup helper near top**

Near other util requires (e.g. next to `recurrenceCompare` from Task 10):

```javascript
const { findOrphanedOverrides } = require('./utils/recurrenceOrphanCleanup');
```

- [ ] **Step 3: Add Q3=A date derivation block in publish-edit**

In the publish-edit handler, find the `// Build update object - apply final changes to calendarData` section (around line 20899) and the `const updateFields = {};` line. Just BEFORE that line, insert:

```javascript
    // Q3=A: When recurrence changes, derive master start/end dates from range.startDate.
    // The master's date is downstream of the recurrence range. We synthesize the date fields
    // into finalChanges so remapToCalendarData picks them up and Graph sync sees them.
    if (finalChanges.recurrence && finalChanges.recurrence.range && finalChanges.recurrence.range.startDate) {
      const newStartDate = finalChanges.recurrence.range.startDate;
      // Derive the time portion from existing master startDateTime/endDateTime if not also being changed.
      const existingStartTime = (cd.startDateTime || '').split('T')[1] || (cd.startTime ? `${cd.startTime}:00` : '00:00:00');
      const existingEndTime = (cd.endDateTime || '').split('T')[1] || (cd.endTime ? `${cd.endTime}:00` : '23:59:00');

      // Compute new endDate by preserving the existing duration (single-day series).
      // For multi-day single-occurrence series this is more complex; v1 assumes same-day events.
      const newEndDate = newStartDate;

      // Only synthesize if the user did not also pass explicit overrides.
      if (!finalChanges.startDateTime) finalChanges.startDateTime = `${newStartDate}T${existingStartTime}`;
      if (!finalChanges.endDateTime) finalChanges.endDateTime = `${newEndDate}T${existingEndTime}`;
      if (!finalChanges.startDate) finalChanges.startDate = newStartDate;
      if (!finalChanges.endDate) finalChanges.endDate = newEndDate;
    }
```

- [ ] **Step 4: Persist recurrence at top level + flip eventType for promotion (Q2=B)**

In the publish-edit handler, AFTER `Object.assign(updateFields, remappedFields);` (line 20905) and BEFORE the `// Update pendingEditRequest status` block, insert:

```javascript
    // Recurrence is stored at top level (not in calendarData). remapToCalendarData skips it.
    if (finalChanges.recurrence !== undefined) {
      updateFields.recurrence = finalChanges.recurrence;
      // Q2=B: promotion — singleInstance becomes seriesMaster when recurrence is added.
      if (finalChanges.recurrence && finalChanges.recurrence.pattern && event.eventType !== 'seriesMaster') {
        updateFields.eventType = 'seriesMaster';
      }
    }
```

- [ ] **Step 5: Soft-delete orphaned override docs after the master update succeeds**

After the `conditionalUpdate(...)` call that updates `updateFields` (around line 20920-20935), and BEFORE the Graph sync block (line 20937), insert:

```javascript
    // Q1=B: Orphan reconciliation. Find override docs that no longer fit the new pattern
    // and soft-delete them with audit entries.
    let orphanedDocsCleaned = [];
    if (finalChanges.recurrence) {
      try {
        const overrideDocs = await unifiedEventsCollection.find({
          seriesMasterEventId: event.eventId,
          eventType: { $in: ['exception', 'addition'] },
          isDeleted: { $ne: true }
        }).toArray();

        const orphans = findOrphanedOverrides(finalChanges.recurrence, overrideDocs);
        if (orphans.length > 0) {
          const orphanIds = orphans.map(o => o._id);
          const now = new Date();
          await unifiedEventsCollection.updateMany(
            { _id: { $in: orphanIds } },
            {
              $set: {
                isDeleted: true,
                status: 'deleted',
                deletedAt: now,
                deletedBy: userEmail,
                deletionReason: `Auto-deleted: orphaned by recurrence pattern change (edit request ${pendingEditRequest.id})`
              },
              $inc: { _version: 1 }
            }
          );

          for (const orphan of orphans) {
            await eventAuditHistoryCollection.insertOne({
              eventId: orphan.eventId,
              reservationId: orphan._id,
              action: 'orphan-cleanup',
              performedBy: userId,
              performedByEmail: userEmail,
              timestamp: now,
              changes: [{ field: 'status', oldValue: orphan.status, newValue: 'deleted' }],
              metadata: {
                seriesMasterEventId: event.eventId,
                editRequestId: pendingEditRequest.id,
                reason: 'orphaned-by-pattern-change',
                occurrenceDate: orphan.occurrenceDate,
              }
            });
          }
          orphanedDocsCleaned = orphans.map(o => ({ eventId: o.eventId, occurrenceDate: o.occurrenceDate }));
          logger.info('Orphan override cleanup complete', { count: orphans.length, masterEventId: event.eventId });
        }
      } catch (cleanupErr) {
        logger.error('Orphan override cleanup failed (non-fatal):', cleanupErr.message);
      }
    }
```

- [ ] **Step 6: Pass recurrence to Graph update**

In the Graph sync block (around line 20967), inside the `graphUpdate = { ... }` object construction, add a recurrence field. Find:

```javascript
        const graphUpdate = {
          subject: finalChanges.eventTitle || cd.eventTitle || event.graphData?.subject,
          start: { ... },
          end: { ... }
        };
```

After `end: { ... }` and the closing `};`, add a separate block (use existing `buildGraphRecurrence` already defined in api-server.js):

```javascript
        // Recurrence sync to Graph: PATCH the event with the new pattern.
        // For promotion (Q2=B), this converts a singleInstance Graph event into a series.
        if (finalChanges.recurrence) {
          const graphRecurrence = buildGraphRecurrence(finalChanges.recurrence, 'America/New_York');
          if (graphRecurrence) {
            graphUpdate.recurrence = graphRecurrence;
          }
        }
```

- [ ] **Step 7: Sync exclusions to Graph after the update returns**

After the existing `graphSyncResult = await graphApiService.updateCalendarEvent(...)` call (around line 21028) and BEFORE its `logger.info(...)` line, add:

```javascript
        // For recurrence changes that include exclusions, replay them to Graph (cancels matching occurrences).
        // Note: This only adds new exclusions; removing them is blocked at submit time (Q5=A).
        if (finalChanges.recurrence && finalChanges.recurrence.exclusions && finalChanges.recurrence.exclusions.length > 0) {
          try {
            await syncRecurrenceExclusionsToGraph(
              event.calendarOwner,
              event.calendarId,
              graphEventId,
              finalChanges.recurrence
            );
          } catch (exclSyncErr) {
            logger.warn('Failed to sync recurrence exclusions on publish-edit (non-fatal):', exclSyncErr.message);
          }
        }
```

- [ ] **Step 8: Include `orphanedDocsCleaned` in the response payload**

Find the `res.json({ success: true, ... })` for the series-level (non-occurrence) publish-edit branch (after the email-notification code, around line 21100). Add `orphanedDocsCleaned` to the response object so the frontend can show "X overrides were cleaned up." If a `res.json` already exists, just splice the field in:

```javascript
    res.json({
      success: true,
      message: 'Edit request published',
      eventId: event.eventId,
      _version: publishedEditEvent._version,
      changesApplied: finalChanges,
      orphanedDocsCleaned,  // NEW: surface to frontend
      graphSynced: !!graphSyncResult
    });
```

- [ ] **Step 9: Run integration tests**

Run: `cd backend && npm test -- editRequestRecurrence`
Expected: ER-R4, ER-R6, ER-R7 PASS.

- [ ] **Step 10: Run broader publish-edit tests to check for regressions**

Run: `cd backend && npm test -- editRequest`
Expected: All existing edit-request tests still pass. (If `approverChanges.test.js` exists and exercises publish-edit, run that too.)

- [ ] **Step 11: Commit**

```bash
git add backend/api-server.js
git commit -m "feat(recurrence-edit): publish-edit applies recurrence, derives dates, cleans orphans, syncs Graph"
```

---

## Task 14: Backend integration test — promotion (Q2=B)

**Files:**
- Modify: `backend/__tests__/integration/events/editRequestRecurrence.test.js`

- [ ] **Step 1: Add promotion test**

Append to the test file:

```javascript
  describe('ER-R8: singleInstance → seriesMaster promotion (Q2=B)', () => {
    it('publish-edit flips eventType to seriesMaster and stores recurrence', async () => {
      const event = createPublishedEvent({
        ownerEmail: requesterUser.email,
        ownerName: requesterUser.displayName,
        ownerId: requesterUser.userId,
        ownerDepartment: requesterUser.department,
        eventType: 'singleInstance',
        startDate: '2026-04-20', startTime: '09:00',
        endDate: '2026-04-20', endTime: '10:00',
      });
      // Ensure no pre-existing recurrence
      event.recurrence = null;
      event.eventType = 'singleInstance';
      await insertEvents(db, [event]);

      const newRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
      };

      // Submit
      const submitRes = await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ recurrence: newRecurrence, _version: event._version });
      expect(submitRes.status).toBe(200);

      const submitted = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });

      // Publish
      const pubRes = await request(app)
        .put(`/api/admin/events/${event.eventId}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: submitted._version });
      expect(pubRes.status).toBe(200);

      const promoted = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });
      expect(promoted.eventType).toBe('seriesMaster');
      expect(promoted.recurrence).toEqual(newRecurrence);
    });
  });
```

- [ ] **Step 2: Run**

Run: `cd backend && npm test -- editRequestRecurrence`
Expected: ER-R8 passes (Task 13's `updateFields.eventType = 'seriesMaster'` already implemented this).

- [ ] **Step 3: Commit**

```bash
git add backend/__tests__/integration/events/editRequestRecurrence.test.js
git commit -m "test(recurrence-edit): assert singleInstance->seriesMaster promotion via edit request"
```

---

## Task 15: Conflict detection on recurrence change

**Files:**
- Modify: `backend/__tests__/integration/events/editRequestRecurrence.test.js`

The existing `checkRoomConflicts()` already expands recurring series. Task 13 Step 1 wired `finalChanges.recurrence` into the conflict-trigger. This task just locks the behavior in via test.

- [ ] **Step 1: Add conflict test**

Append to the test file:

```javascript
  describe('ER-R5b: conflict detection runs when recurrence changes', () => {
    it('returns 409 SchedulingConflict when new pattern collides with another published event', async () => {
      // Create a conflicting event on Tuesday at 09:00 in the same room.
      const room = '507f1f77bcf86cd799439011';  // ObjectId-shaped string
      const conflictEvent = createPublishedEvent({
        ownerEmail: 'other@example.com',
        ownerId: 'other-id',
        ownerName: 'Other',
        eventType: 'singleInstance',
        startDate: '2026-04-21', startTime: '09:00',
        endDate: '2026-04-21', endTime: '10:00',
      });
      conflictEvent.calendarData.locations = [room];
      conflictEvent.recurrence = null;
      await insertEvents(db, [conflictEvent]);

      // Our seriesMaster currently meets on Mondays in the same room.
      const event = createPublishedEvent({
        ownerEmail: requesterUser.email,
        ownerName: requesterUser.displayName,
        ownerId: requesterUser.userId,
        ownerDepartment: requesterUser.department,
        eventType: 'seriesMaster',
        startDate: '2026-04-20', startTime: '09:00',
        endDate: '2026-04-20', endTime: '10:00',
      });
      event.calendarData.locations = [room];
      event.recurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-04-30' }
      };
      event.eventType = 'seriesMaster';
      await insertEvents(db, [event]);

      // Propose moving the series to Tuesdays — collides with conflictEvent on 2026-04-21.
      const newRecurrence = {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
        range: { type: 'endDate', startDate: '2026-04-21', endDate: '2026-04-30' }
      };

      await request(app)
        .post(`/api/events/${event.eventId}/request-edit`)
        .set('Authorization', `Bearer ${requesterToken}`)
        .send({ recurrence: newRecurrence, _version: event._version });

      const submitted = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId: event.eventId });

      const res = await request(app)
        .put(`/api/admin/events/${event.eventId}/publish-edit`)
        .set('Authorization', `Bearer ${approverToken}`)
        .send({ _version: submitted._version });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('SchedulingConflict');
    });
  });
```

- [ ] **Step 2: Run**

Run: `cd backend && npm test -- editRequestRecurrence`
Expected: ER-R5b passes (Task 13 Step 1 enabled the trigger; existing `checkRoomConflicts` expansion does the work).

- [ ] **Step 3: Commit**

```bash
git add backend/__tests__/integration/events/editRequestRecurrence.test.js
git commit -m "test(recurrence-edit): conflict detection fires when pattern moves into occupied slots"
```

---

## Task 16: Frontend smoke test — full round-trip via mocked fetch

**Files:**
- Create: `src/__tests__/unit/components/ReservationRequests.recurrenceEdit.test.jsx` (OR pick the closest existing test file that exercises the request-edit handler — confirm during implementation; if no obvious match exists, create the new file)

The point of this task is to verify the FE pipeline (form → payload → fetch) actually wires recurrence in. We don't need a deep DOM assertion — a single behavioural test is enough.

- [ ] **Step 1: Write the test**

Create `src/__tests__/unit/components/ReservationRequests.recurrenceEdit.test.jsx`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildEditRequestPayload } from '../../../utils/eventPayloadBuilder';

describe('Edit-request payload — recurrence wiring', () => {
  it('sends recurrence on the wire when form data includes it', () => {
    const formData = {
      eventTitle: 'Title',
      startDate: '2026-04-20', startTime: '09:00',
      endDate: '2026-04-20', endTime: '10:00',
      recurrence: {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] },
        range: { type: 'noEnd', startDate: '2026-04-20' },
      },
    };
    const payload = buildEditRequestPayload(formData, { eventVersion: 7 });

    // Ensure recurrence travels through serialization
    const serialized = JSON.parse(JSON.stringify(payload));
    expect(serialized.recurrence).toEqual(formData.recurrence);
  });

  it('does NOT send recurrence key when form data omits it', () => {
    const formData = {
      eventTitle: 'Title',
      startDate: '2026-04-20', startTime: '09:00',
      endDate: '2026-04-20', endTime: '10:00',
    };
    const payload = buildEditRequestPayload(formData, { eventVersion: 7 });
    const serialized = JSON.parse(JSON.stringify(payload));
    expect('recurrence' in serialized).toBe(false);
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test -- ReservationRequests.recurrenceEdit`
Expected: Both tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/unit/components/ReservationRequests.recurrenceEdit.test.jsx
git commit -m "test(recurrence-edit): smoke-test frontend payload wiring for recurrence"
```

---

## Task 17: Email template — render recurrence in change list

**Files:**
- Modify: `backend/services/emailTemplates.js` (or wherever the changes-table for `sendEditRequestApprovedNotification` is built — confirm during implementation)

When the audit `changesArray` includes a `recurrence` entry with stringified JSON values, the email becomes unreadable. Replace the JSON with a one-line summary.

- [ ] **Step 1: Find the renderer**

Run: `grep -n "field" /mnt/c/Users/Stephen.Fang/OneDrive/Documents/workspace/github.com/fullstackfang/emanuel-resource-calendar-app/backend/services/emailTemplates.js | head -20`

Identify the template function that iterates over `changes` array. Read that section to confirm the rendering loop.

- [ ] **Step 2: Add a recurrence-aware case**

In the rendering loop (locate the line that maps `changes` to `<tr>` rows), add a special case at the top of the row mapper:

```javascript
function formatChangeRow(change) {
  if (change.field === 'recurrence') {
    const oldVal = change.oldValue && change.oldValue !== '(none)' ? summarizeFromJson(change.oldValue) : '(none)';
    const newVal = change.newValue && change.newValue !== '(none)' ? summarizeFromJson(change.newValue) : '(none)';
    return { label: 'Recurrence', oldValue: oldVal, newValue: newVal };
  }
  return change;
}

function summarizeFromJson(jsonOrString) {
  try {
    const r = typeof jsonOrString === 'string' ? JSON.parse(jsonOrString) : jsonOrString;
    if (!r || !r.pattern) return '(none)';
    const interval = r.pattern.interval || 1;
    const days = Array.isArray(r.pattern.daysOfWeek) ? r.pattern.daysOfWeek.join(',') : '';
    const rangeBits = [];
    if (r.range && r.range.startDate) rangeBits.push(`from ${r.range.startDate}`);
    if (r.range && r.range.endDate) rangeBits.push(`until ${r.range.endDate}`);
    return `${r.pattern.type} every ${interval}${days ? ` on ${days}` : ''}${rangeBits.length ? ' ' + rangeBits.join(' ') : ''}`;
  } catch {
    return '(invalid)';
  }
}
```

Wire `formatChangeRow` into the existing iteration so each row passes through it before being rendered.

- [ ] **Step 3: Spot-check via a test if there is an email-templates test file**

Check `backend/__tests__/unit/services/` for `emailTemplates.test.js`. If present, add:

```javascript
test('formats recurrence change row with summary, not JSON', () => {
  const change = {
    field: 'recurrence',
    oldValue: JSON.stringify({ pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } }),
    newValue: JSON.stringify({ pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } })
  };
  // ...  call template renderer ...
  // expect rendered HTML/text to contain 'monday' and 'wednesday' but NOT '{"pattern"'
});
```

If no test file exists, skip the test step — manual verification in the next E2E task is acceptable.

- [ ] **Step 4: Commit**

```bash
git add backend/services/emailTemplates.js
git commit -m "feat(recurrence-edit): render recurrence summary (not JSON) in approval emails"
```

---

## Task 18: E2E manual verification

- [ ] **Step 1: Start the app**

Run in two terminals:
```
cd backend && npm run dev
npm run dev
```

- [ ] **Step 2: Manual test — happy path**

1. Sign in as a requester. Find a published recurring event you own (or have an admin create one).
2. Open the event in the review modal. Click "Request Edit".
3. Switch to the Recurrence tab. Modify the days of week (e.g., add Wednesday).
4. The detected-changes panel should now show a "Recurrence" row with old vs new summary.
5. Click "Submit Edit Request". Toast: success.
6. Sign out. Sign in as approver. Open the event. View the pending edit request.
7. Click "Approve & Publish". Toast: success.
8. Confirm in MongoDB Compass: `event.recurrence.pattern.daysOfWeek` is updated, `_version` incremented.
9. Confirm in Outlook/Teams calendar: the series now meets on the additional day.

- [ ] **Step 3: Manual test — exclusion-removal block**

1. As requester, on a series with an existing exclusion, try to submit an edit request that removes the exclusion.
2. Expected: 400 error toast with "Removing previously-cancelled occurrences..." message.

- [ ] **Step 4: Manual test — orphan cleanup**

1. Have an admin create an exception/override on a date.
2. As requester, submit a recurrence change that drops that day from the pattern.
3. As approver, publish the edit.
4. Confirm: response includes `orphanedDocsCleaned: [...]`. Override doc in MongoDB has `isDeleted: true` and `status: 'deleted'`.

- [ ] **Step 5: Document any deviations and commit them as fixes**

If any step above fails, treat it as a bug. Add a regression test to the relevant suite, fix the code, commit. Repeat until all 4 manual tests pass.

---

## Task 19: Final regression sweep

- [ ] **Step 1: Run full backend suite**

Run: `cd backend && npm test`
Expected: All suites pass. Note any flakes — investigate before merge.

- [ ] **Step 2: Run full frontend suite**

Run: `npm run test:run`
Expected: All suites pass.

- [ ] **Step 3: Commit any test fixes from regressions**

If regressions are surfaced, fix them and commit each fix separately with a clear message.

- [ ] **Step 4: Open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(recurrence): allow requesters to propose recurrence changes via edit request" --body "$(cat <<'EOF'
## Summary
- Requesters can now edit a recurring series' pattern, range, exclusions (add only), and additions through the existing request-edit workflow.
- singleInstance events can be promoted to seriesMaster via edit request (Q2=B).
- Approval auto-derives master start/end dates from recurrence.range.startDate (Q3=A).
- Override docs (exception/addition) that no longer fit the new pattern are auto-deleted with audit trail (Q1=B).
- Removing previously-cancelled occurrences via edit request is blocked (Q5=A) — Graph cannot un-cancel.

## Test plan
- [ ] Backend: 'npm test -- editRequestRecurrence recurrenceCompare recurrenceOrphanCleanup' all green
- [ ] Frontend: 'npm test -- recurrenceCompare editRequestUtilsRecurrence useCurrentUserGates' all green
- [ ] Manual round-trip per Task 18 (4 scenarios)
- [ ] No regression in approverChanges, editRequest, or publishEdit existing suites

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Execution Notes

- Most tasks land cleanly in sequence. Tasks 9–10 and 12–13 are paired RED/GREEN — do not commit Step 1 of a GREEN-half until the RED-half is in.
- Tasks 4 and 7 add tests to the same file iteratively; that's intentional — they share fixture setup.
- Task 17 (email template) has the loosest verification because email rendering doesn't have established test coverage in this codebase. If email rendering breaks during manual E2E (Task 18), add a regression test then.
- The single biggest risk lives in Task 13 Step 6 (Graph recurrence sync). Microsoft Graph sometimes 400s when promoting a singleInstance to a series via PATCH; if it does, the fallback is delete-and-recreate. That's a follow-on if the manual E2E catches it.
- If the Cosmos DB `seriesMasterEventId` query in Task 13 Step 5 returns silently empty (the documented warming bug), retry once before treating empty as authoritative.

## Self-Review Notes

After writing this plan, reviewed it against the locked decisions (Q1–Q5), the file structure list, and the existing tests/utilities surfaced in the pre-plan investigation. Findings:

- **Spec coverage:** Q1 → Tasks 11+13 (orphan helper + cleanup); Q2 → Task 13 step 4 + Task 14; Q3 → Task 13 step 3 + Task 12 ER-R6; Q4 → Tasks 4+5 (approverChanges); Q5 → Tasks 9+10. All decisions covered.
- **Placeholder scan:** No "TBD"/"implement later"/"similar to Task N" patterns. Each step has either real code or an explicit grep-then-modify directive (Tasks 17 step 1 — necessary because email-template structure varies).
- **Type consistency:** `recurrenceEquals(a, b)` — same signature in FE (`src/utils/recurrenceCompare.js`) and BE (`backend/utils/recurrenceCompare.js`). `findOrphanedOverrides(newRecurrence, overrideDocs)` consistent across Tasks 11 and 13. Field name `orphanedDocsCleaned` consistent in Tasks 13 and 19 PR body.
- **Known soft spots:** Task 17 (email template) and Task 18 (manual E2E) cannot have placeholder-free code without inspecting code interactively — those are fundamentally exploratory steps. Marked as such in Execution Notes.
