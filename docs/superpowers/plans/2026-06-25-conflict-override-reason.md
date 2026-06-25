# Conflict Override with Forced Reason & Auto-Clear — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let approvers and admins force past a hard scheduling conflict only by supplying a mandatory reason, recorded permanently in both events' audit trails, surfaced live on both records, and auto-cleared on both when the conflict later resolves.

**Architecture:** A dedicated `templeEvents__ConflictOverrides` edge collection (one doc per overridden pair, own `_version`) is the single source of truth for live overrides. A new `backend/services/conflictOverrideService.js` owns the edge writes, the dual-event audit, the auto-clear reconcile, and the enrichment query. The four existing force flags (`forcePublish`/`forceUpdate`/`forcePublishEdit`/`forceRestore`) unify into one `forceConflicts` + `overrideReason` body contract, opened from admin-only to `canApproveReservations`. Auto-clear re-uses `checkRoomConflicts` (never re-implements overlap geometry) via an injected `conflictChecker` thunk.

**Tech Stack:** Node.js/Express, MongoDB (Azure Cosmos DB), Jest + MongoDB Memory Server (backend), React 19 + Vitest (frontend).

## Global Constraints

- **Reason required for everyone** — approvers AND admins. Server-side gate; never trust UI validation. Missing/blank reason on a forced hard conflict → `400 { error: 'OVERRIDE_REASON_REQUIRED' }`.
- **Atomic ship, no back-compat alias** — backend (`api-server.js` + `testApp.js`), the one live UI caller, and the tests all change together. The body field is renamed `forceConflicts`; `forceField` in 409 responses becomes `'forceConflicts'`.
- **`testApp.js` is a parallel reimplementation** — every backend force-path change MUST be mirrored in `backend/__tests__/__helpers__/testApp.js` in the same task, or integration tests silently keep testing old behavior.
- **Audit writes are best-effort** (swallow-and-log via `auditService.recordEvent`); never let an audit failure throw into the main op.
- **Auto-clear re-uses `checkRoomConflicts`** — never re-implement overlap geometry. Pass the event's own `_id` as `excludeId` so it isn't compared to itself; test membership of each counterpart `_id` in the returned `hardConflicts[].id`.
- **Soft conflicts unchanged** — keep the existing `acknowledgeSoftConflicts` flow, no reason.
- **Never use double quotes in git commit messages** — use single quotes (project rule).
- **No curly/smart quotes** anywhere.

**Reference spec:** `docs/superpowers/specs/2026-06-25-conflict-override-reason-design.md`

---

## Shared Override Branch (used verbatim by Tasks 6-9)

Every single-event force site replaces its old `if (hardConflicts.length > 0) return 409`
block with this exact branch. Only the two ALL-CAPS placeholders change per site:
`MESSAGE` (the 409 message string) and `CONTEXT` (`'publish'|'adminSave'|'publishEdit'|'restore'`).
Declare `let pendingConflictOverride = null;` just above the conflict-check section, and change
the surrounding force guard from the legacy `if (!forceX)` to `if (!forceConflicts)`.

```javascript
const { hardConflicts, softConflicts, allConflicts } = await checkRoomConflicts(reservationForConflict, id);
if (hardConflicts.length > 0) {
  if (!forceConflicts) {
    return res.status(409).json({
      error: 'SchedulingConflict',
      conflictTier: 'hard',
      message: MESSAGE,            // per-site, see each task
      hardConflicts, softConflicts, conflicts: allConflicts,
      canForce: hasApproverAccess, // admin-restore site uses `true`
      forceField: 'forceConflicts',
      requiresReason: true,
      _version: event._version
    });
  }
  const trimmedReason = (overrideReason || '').trim();
  if (!trimmedReason) {
    return res.status(400).json({ error: 'OVERRIDE_REASON_REQUIRED',
      message: 'An override reason is required to force past a scheduling conflict.' });
  }
  pendingConflictOverride = { hardConflicts, reason: trimmedReason };
}
```

After the operation's successful write (with the post-write doc available), every site runs:

```javascript
if (pendingConflictOverride) {
  await conflictOverrideService.recordConflictOverride({
    primaryEvent: POST_WRITE_DOC,   // `event` for publish/publishEdit, `resultEvent` for save/restore
    hardConflicts: pendingConflictOverride.hardConflicts,
    reason: pendingConflictOverride.reason,
    actor: { userId, email: userEmail, name: user?.displayName || userEmail },
    context: CONTEXT,
  });
}
// Reconcile (trigger #3): clear any overrides this operation may have resolved.
await conflictOverrideService.clearStaleConflictEdges({
  eventDoc: POST_WRITE_DOC,
  conflictChecker: async (doc) => (await checkRoomConflicts(doc, doc._id.toString())).hardConflicts,
  actor: { userId, email: userEmail },
  context: CONTEXT,
});
```

In `testApp.js`, the `conflictChecker` uses the test checker:
`async (doc) => (await checkTestConflicts(doc, doc._id, testCollections.events, testCollections.categories)).hardConflicts`.

---

## File Structure

- **Create** `backend/utils/conflictOverrideKey.js` — pure `buildPairKey(idA, idB)` (canonical sorted key) + `OVERRIDE_REASON_REQUIRED` constant. Unit-testable without a DB.
- **Create** `backend/services/conflictOverrideService.js` — `setDbConnection`, `ensureIndexes`, `recordConflictOverride`, `clearStaleConflictEdges`, `getActiveOverridesForEvents`. Mirrors the `auditService.js` connection pattern.
- **Create** `backend/__tests__/unit/utils/conflictOverrideKey.test.js`
- **Create** `backend/__tests__/integration/events/conflictOverride.test.js` — the feature's behavioral guard.
- **Modify** `backend/api-server.js` — collection wiring + index; require + wire service; transform the 4 force sites; add reconcile calls (delete/reject/update/restore); enrichment on load/list.
- **Modify** `backend/__tests__/__helpers__/testApp.js` — mirror the 4 force sites + service wiring + reconcile.
- **Modify** existing tests: `publishConflict.test.js`, `recurringConflict.test.js`, `saveConflict.test.js`, `restoreOccurrence.test.js`, `eventAdminRestore.test.js`, `editRequestsApprove.test.js`.
- **Modify** frontend: `src/components/EventManagement.jsx` (restore-button reason), `src/hooks/useReviewModal.jsx` + the conflict UI in `src/components/shared/` (approver publish override + surface reason).

---

## Task 1: Canonical pair-key util

**Files:**
- Create: `backend/utils/conflictOverrideKey.js`
- Test: `backend/__tests__/unit/utils/conflictOverrideKey.test.js`

**Interfaces:**
- Produces: `buildPairKey(idA: string|ObjectId, idB: string|ObjectId): string` — returns `"<lower>_<higher>"` of the two hex strings, sorted lexicographically so the pair is order-independent. `OVERRIDE_REASON_REQUIRED: 'OVERRIDE_REASON_REQUIRED'` (string constant).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/__tests__/unit/utils/conflictOverrideKey.test.js
const { buildPairKey, OVERRIDE_REASON_REQUIRED } = require('../../../utils/conflictOverrideKey');

describe('buildPairKey', () => {
  const a = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const b = 'ffffffffffffffffffffffff';

  test('is order-independent', () => {
    expect(buildPairKey(a, b)).toBe(buildPairKey(b, a));
  });

  test('produces sorted lower_higher form', () => {
    expect(buildPairKey(b, a)).toBe(`${a}_${b}`);
  });

  test('accepts ObjectId-like values via String()', () => {
    const oid = { toString: () => b };
    expect(buildPairKey(a, oid)).toBe(`${a}_${b}`);
  });

  test('exposes the reason-required code', () => {
    expect(OVERRIDE_REASON_REQUIRED).toBe('OVERRIDE_REASON_REQUIRED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- conflictOverrideKey.test.js`
Expected: FAIL with "Cannot find module '../../../utils/conflictOverrideKey'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/utils/conflictOverrideKey.js
'use strict';

const OVERRIDE_REASON_REQUIRED = 'OVERRIDE_REASON_REQUIRED';

/**
 * Canonical, order-independent key for a pair of event ids.
 * The conflict-override relationship is symmetric, so E<->C and C<->E
 * must collapse to one key. Sorts the two hex strings lexicographically.
 *
 * @param {string|object} idA
 * @param {string|object} idB
 * @returns {string} "<lower>_<higher>"
 */
function buildPairKey(idA, idB) {
  const a = String(idA);
  const b = String(idB);
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

module.exports = { buildPairKey, OVERRIDE_REASON_REQUIRED };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- conflictOverrideKey.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/utils/conflictOverrideKey.js backend/__tests__/unit/utils/conflictOverrideKey.test.js
git commit -m 'feat(conflict-override): add canonical pair-key util'
```

---

## Task 2: conflictOverrideService — record + indexes

**Files:**
- Create: `backend/services/conflictOverrideService.js`
- Test: `backend/__tests__/integration/events/conflictOverride.test.js` (new file; record-path tests first)

**Interfaces:**
- Consumes: `buildPairKey` (Task 1); `auditService.recordEvent` (existing); `conditionalUpdate` (existing).
- Produces:
  - `setDbConnection(db): void` — wires the Db handle (lazy collection accessors, like auditService).
  - `ensureIndexes(): Promise<void>` — creates `{ eventIds: 1, active: 1 }` and the partial-unique `{ pairKey: 1 }` where `active: true`.
  - `recordConflictOverride({ primaryEvent, hardConflicts, actor, context }): Promise<void>` — `primaryEvent` is the full event doc (`{ _id, eventId }`); `hardConflicts` is the `checkRoomConflicts` array (`[{ id, eventTitle, ... }]`); `actor` is `{ userId, email, name }`; `context` ∈ `'publish'|'publishEdit'|'adminSave'|'restore'`. Upserts one active edge per counterpart and writes a dual-event audit entry. Best-effort (never throws).

- [ ] **Step 1: Write the failing test**

```javascript
// backend/__tests__/integration/events/conflictOverride.test.js
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const auditService = require('../../../services/auditService');
const overrideService = require('../../../services/conflictOverrideService');
const { buildPairKey } = require('../../../utils/conflictOverrideKey');

let mongod, client, db;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongod.getUri());
  db = client.db('test');
  auditService.setDbConnection(db);
  overrideService.setDbConnection(db);
  await overrideService.ensureIndexes();
});

afterAll(async () => { await client.close(); await mongod.stop(); });

afterEach(async () => {
  await db.collection('templeEvents__ConflictOverrides').deleteMany({});
  await db.collection('templeEvents__EventAuditHistory').deleteMany({});
});

function evt(eventId) {
  return { _id: new ObjectId(), eventId };
}

describe('recordConflictOverride', () => {
  test('creates one active edge per counterpart with a dual-event audit', async () => {
    const e = evt('E-1');
    const c1 = evt('C-1');
    const c2 = evt('C-2');
    // counterparts must exist for audit eventId lookup
    await db.collection('templeEvents__Events').insertMany([e, c1, c2]);

    await overrideService.recordConflictOverride({
      primaryEvent: e,
      hardConflicts: [{ id: c1._id.toString() }, { id: c2._id.toString() }],
      actor: { userId: 'u1', email: 'jane@x.org', name: 'Jane' },
      context: 'publish',
    });

    const edges = await db.collection('templeEvents__ConflictOverrides').find({ active: true }).toArray();
    expect(edges).toHaveLength(2);
    expect(edges.map(x => x.pairKey).sort()).toEqual(
      [buildPairKey(e._id, c1._id), buildPairKey(e._id, c2._id)].sort()
    );
    const audits = await db.collection('templeEvents__EventAuditHistory').find({}).toArray();
    // dual write: E + C1 + E + C2 = 4 entries
    expect(audits).toHaveLength(4);
    expect(audits.every(a => a.metadata.action === 'conflict_override')).toBe(true);
  });

  test('re-override replaces reason in place (still one active edge)', async () => {
    const e = evt('E-1');
    const c1 = evt('C-1');
    await db.collection('templeEvents__Events').insertMany([e, c1]);
    const base = {
      primaryEvent: e,
      hardConflicts: [{ id: c1._id.toString() }],
      actor: { userId: 'u1', email: 'jane@x.org', name: 'Jane' },
      context: 'publish',
    };
    await overrideService.recordConflictOverride({ ...base, reason: 'first' });
    await overrideService.recordConflictOverride({ ...base, reason: 'second' });

    const edges = await db.collection('templeEvents__ConflictOverrides').find({ active: true }).toArray();
    expect(edges).toHaveLength(1);
    expect(edges[0].reason).toBe('second');
  });
});
```

> Note: the first test's `reason` assertion line is illustrative only; the binding assertion is in the second test. Pass `reason` in the call as shown in Step 3's signature.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- conflictOverride.test.js`
Expected: FAIL with "Cannot find module '../../../services/conflictOverrideService'".

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/services/conflictOverrideService.js
'use strict';

const { ObjectId } = require('mongodb');
const logger = require('../utils/logger');
const auditService = require('./auditService');
const { buildPairKey } = require('../utils/conflictOverrideKey');

let dbConnection = null;

function setDbConnection(db) { dbConnection = db; }

function edges() {
  if (!dbConnection) throw new Error('conflictOverrideService: setDbConnection() not called yet');
  return dbConnection.collection('templeEvents__ConflictOverrides');
}
function events() {
  return dbConnection.collection('templeEvents__Events');
}

async function ensureIndexes() {
  await edges().createIndex({ eventIds: 1, active: 1 }, { name: 'override_by_event', background: true });
  await edges().createIndex(
    { pairKey: 1 },
    { name: 'override_active_pair_unique', unique: true, partialFilterExpression: { active: true }, background: true }
  );
}

/** Best-effort dual-event audit. Never throws. */
async function auditBoth(eventIdA, eventIdB, changeType, metadata) {
  for (const eventId of [eventIdA, eventIdB]) {
    if (!eventId) continue;
    await auditService.recordEvent({
      eventId,
      userId: metadata.actorUserId || 'system',
      changeType, // 'update' — audit changeType enum is create|update|delete|import
      source: 'ConflictOverride',
      metadata,
    });
  }
}

/**
 * Upsert an active override edge per counterpart + dual audit.
 * @param {Object} params
 * @param {Object} params.primaryEvent - full event doc { _id, eventId }
 * @param {Array<{id:string}>} params.hardConflicts - checkRoomConflicts hard list
 * @param {string} params.reason
 * @param {{userId,email,name}} params.actor
 * @param {'publish'|'publishEdit'|'adminSave'|'restore'} params.context
 */
async function recordConflictOverride({ primaryEvent, hardConflicts, reason, actor, context }) {
  try {
    const eId = primaryEvent._id;
    for (const hc of hardConflicts) {
      const cId = new ObjectId(hc.id);
      const pairKey = buildPairKey(eId, cId);
      const now = new Date();
      await edges().updateOne(
        { pairKey, active: true },
        {
          $set: {
            pairKey,
            eventIds: [eId, cId],
            reason,
            overriddenBy: { userId: actor.userId, email: actor.email, name: actor.name },
            overriddenAt: now,
            context,
            active: true,
          },
          $setOnInsert: { createdAt: now, _version: 0 },
        },
        { upsert: true }
      );
      // counterpart eventId (business id) for audit
      const counterpart = await events().findOne({ _id: cId }, { projection: { eventId: 1 } });
      await auditBoth(primaryEvent.eventId, counterpart?.eventId, 'update', {
        action: 'conflict_override',
        reason,
        counterpartEventId: counterpart?.eventId || null,
        context,
        actorUserId: actor.userId,
        actorEmail: actor.email,
      });
    }
  } catch (error) {
    logger.error('recordConflictOverride failed (non-fatal):', error);
  }
}

module.exports = { setDbConnection, ensureIndexes, recordConflictOverride };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- conflictOverride.test.js`
Expected: PASS (record describe block green).

- [ ] **Step 5: Commit**

```bash
git add backend/services/conflictOverrideService.js backend/__tests__/integration/events/conflictOverride.test.js
git commit -m 'feat(conflict-override): edge-record service + indexes'
```

---

## Task 3: conflictOverrideService — clearStaleConflictEdges (auto-clear)

**Files:**
- Modify: `backend/services/conflictOverrideService.js`
- Test: `backend/__tests__/integration/events/conflictOverride.test.js` (append)

**Interfaces:**
- Produces: `clearStaleConflictEdges({ eventDoc, conflictChecker, actor, context }): Promise<void>`.
  - `eventDoc` — the POST-write event doc (`{ _id, eventId, status }`); its `status` drives the "event removed" path.
  - `conflictChecker` — `async (eventDoc) => hardConflicts[]` (caller injects; in api-server it wraps `checkRoomConflicts(doc, doc._id)`).
  - Deactivates each stale edge (`active:false` + `resolvedAt/By/Reason`) and writes a dual-event "cleared" audit. Best-effort.

- [ ] **Step 1: Write the failing test (append to conflictOverride.test.js)**

```javascript
describe('clearStaleConflictEdges', () => {
  async function seedActiveEdge(e, c, reason = 'because') {
    await db.collection('templeEvents__Events').insertMany([e, c].filter(Boolean));
    await overrideService.recordConflictOverride({
      primaryEvent: e, hardConflicts: [{ id: c._id.toString() }],
      reason, actor: { userId: 'u1', email: 'j@x.org', name: 'J' }, context: 'publish',
    });
  }

  test('clears all edges when the event itself is no longer published (event_removed)', async () => {
    const e = { _id: new ObjectId(), eventId: 'E', status: 'published' };
    const c = { _id: new ObjectId(), eventId: 'C', status: 'published' };
    await seedActiveEdge(e, c);

    await overrideService.clearStaleConflictEdges({
      eventDoc: { ...e, status: 'deleted' },
      conflictChecker: async () => { throw new Error('should not run when event removed'); },
      actor: { userId: 'u1', email: 'j@x.org' }, context: 'delete',
    });

    const active = await db.collection('templeEvents__ConflictOverrides').countDocuments({ active: true });
    expect(active).toBe(0);
    const cleared = await db.collection('templeEvents__ConflictOverrides').findOne({ active: false });
    expect(cleared.resolvedReason).toBe('event_removed');
  });

  test('clears when counterpart no longer appears in hardConflicts (time_room_edit)', async () => {
    const e = { _id: new ObjectId(), eventId: 'E', status: 'published' };
    const c = { _id: new ObjectId(), eventId: 'C', status: 'published' };
    await seedActiveEdge(e, c);

    await overrideService.clearStaleConflictEdges({
      eventDoc: e,
      conflictChecker: async () => [], // no longer conflicting
      actor: { userId: 'u1', email: 'j@x.org' }, context: 'adminSave',
    });

    const cleared = await db.collection('templeEvents__ConflictOverrides').findOne({});
    expect(cleared.active).toBe(false);
    expect(cleared.resolvedReason).toBe('time_room_edit');
  });

  test('keeps the edge when the counterpart still conflicts', async () => {
    const e = { _id: new ObjectId(), eventId: 'E', status: 'published' };
    const c = { _id: new ObjectId(), eventId: 'C', status: 'published' };
    await seedActiveEdge(e, c);

    await overrideService.clearStaleConflictEdges({
      eventDoc: e,
      conflictChecker: async () => [{ id: c._id.toString() }], // still conflicts
      actor: { userId: 'u1', email: 'j@x.org' }, context: 'adminSave',
    });

    const active = await db.collection('templeEvents__ConflictOverrides').countDocuments({ active: true });
    expect(active).toBe(1);
  });

  test('clears only the resolved edge, keeps the still-conflicting one', async () => {
    const e = { _id: new ObjectId(), eventId: 'E', status: 'published' };
    const c1 = { _id: new ObjectId(), eventId: 'C1', status: 'published' };
    const c2 = { _id: new ObjectId(), eventId: 'C2', status: 'published' };
    await db.collection('templeEvents__Events').insertMany([e, c1, c2]);
    await overrideService.recordConflictOverride({
      primaryEvent: e, hardConflicts: [{ id: c1._id.toString() }, { id: c2._id.toString() }],
      reason: 'r', actor: { userId: 'u1', email: 'j@x.org', name: 'J' }, context: 'publish',
    });

    await overrideService.clearStaleConflictEdges({
      eventDoc: e,
      conflictChecker: async () => [{ id: c2._id.toString() }], // only C2 still conflicts
      actor: { userId: 'u1', email: 'j@x.org' }, context: 'adminSave',
    });

    const active = await db.collection('templeEvents__ConflictOverrides').find({ active: true }).toArray();
    expect(active).toHaveLength(1);
    expect(active[0].pairKey).toBe(buildPairKey(e._id, c2._id));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- conflictOverride.test.js -t clearStaleConflictEdges`
Expected: FAIL with "overrideService.clearStaleConflictEdges is not a function".

- [ ] **Step 3: Write minimal implementation (add to conflictOverrideService.js)**

```javascript
function otherId(edge, selfId) {
  const [a, b] = edge.eventIds.map(x => x.toString());
  return a === selfId.toString() ? b : a;
}

/**
 * Deactivate override edges that no longer correspond to a live hard conflict.
 * @param {Object} params
 * @param {Object} params.eventDoc - post-write doc { _id, eventId, status }
 * @param {Function} params.conflictChecker - async (eventDoc) => hardConflicts[]
 * @param {{userId,email}} params.actor
 * @param {string} params.context - trigger label for the audit note
 */
async function clearStaleConflictEdges({ eventDoc, conflictChecker, actor, context }) {
  try {
    const active = await edges().find({ eventIds: eventDoc._id, active: true }).toArray();
    if (active.length === 0) return;

    const eventRemoved = eventDoc.status !== 'published';
    let stillConflictingIds = null;
    if (!eventRemoved) {
      const hard = await conflictChecker(eventDoc);
      stillConflictingIds = new Set(hard.map(h => h.id));
    }

    for (const edge of active) {
      const counterpartId = otherId(edge, eventDoc._id);
      let resolvedReason = null;

      if (eventRemoved) {
        resolvedReason = 'event_removed';
      } else {
        const counterpart = await events().findOne(
          { _id: new ObjectId(counterpartId) }, { projection: { eventId: 1, status: 1 } }
        );
        if (!counterpart || counterpart.status !== 'published') {
          resolvedReason = 'event_removed';
        } else if (!stillConflictingIds.has(counterpartId)) {
          resolvedReason = 'time_room_edit';
        }
      }

      if (!resolvedReason) continue;

      await edges().updateOne(
        { _id: edge._id, active: true },
        { $set: { active: false, resolvedAt: new Date(),
                  resolvedBy: { userId: actor.userId, email: actor.email },
                  resolvedReason },
          $inc: { _version: 1 } }
      );

      const counterpart = await events().findOne(
        { _id: new ObjectId(counterpartId) }, { projection: { eventId: 1 } }
      );
      await auditBoth(eventDoc.eventId, counterpart?.eventId, 'update', {
        action: 'conflict_override_cleared',
        resolvedReason, context,
        counterpartEventId: counterpart?.eventId || null,
        actorUserId: actor.userId, actorEmail: actor.email,
      });
    }
  } catch (error) {
    logger.error('clearStaleConflictEdges failed (non-fatal):', error);
  }
}

// extend module.exports:
module.exports = { setDbConnection, ensureIndexes, recordConflictOverride, clearStaleConflictEdges };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- conflictOverride.test.js`
Expected: PASS (record + clear blocks).

- [ ] **Step 5: Commit**

```bash
git add backend/services/conflictOverrideService.js backend/__tests__/integration/events/conflictOverride.test.js
git commit -m 'feat(conflict-override): auto-clear stale edges via injected conflict checker'
```

---

## Task 4: conflictOverrideService — enrichment query

**Files:**
- Modify: `backend/services/conflictOverrideService.js`
- Test: `backend/__tests__/integration/events/conflictOverride.test.js` (append)

**Interfaces:**
- Produces: `getActiveOverridesForEvents(eventObjectIds: ObjectId[]): Promise<Map<string, Array<{counterpartId, reason, overriddenBy, overriddenAt}>>>` — keyed by event `_id` string; each entry lists the active overrides touching that event. Used by load/list enrichment.

- [ ] **Step 1: Write the failing test (append)**

```javascript
describe('getActiveOverridesForEvents', () => {
  test('maps active overrides by event _id, both directions', async () => {
    const e = { _id: new ObjectId(), eventId: 'E' };
    const c = { _id: new ObjectId(), eventId: 'C' };
    await db.collection('templeEvents__Events').insertMany([e, c]);
    await overrideService.recordConflictOverride({
      primaryEvent: e, hardConflicts: [{ id: c._id.toString() }],
      reason: 'vip event', actor: { userId: 'u1', email: 'j@x.org', name: 'J' }, context: 'publish',
    });

    const map = await overrideService.getActiveOverridesForEvents([e._id, c._id]);
    expect(map.get(e._id.toString())[0].reason).toBe('vip event');
    expect(map.get(c._id.toString())[0].reason).toBe('vip event'); // surfaces on the counterpart too
    expect(map.get(e._id.toString())[0].counterpartId).toBe(c._id.toString());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- conflictOverride.test.js -t getActiveOverridesForEvents`
Expected: FAIL with "getActiveOverridesForEvents is not a function".

- [ ] **Step 3: Write minimal implementation (add + export)**

```javascript
async function getActiveOverridesForEvents(eventObjectIds) {
  const map = new Map();
  if (!Array.isArray(eventObjectIds) || eventObjectIds.length === 0) return map;
  const docs = await edges().find({ eventIds: { $in: eventObjectIds }, active: true }).toArray();
  for (const edge of docs) {
    const [a, b] = edge.eventIds.map(x => x.toString());
    for (const selfId of [a, b]) {
      const counterpartId = selfId === a ? b : a;
      if (!map.has(selfId)) map.set(selfId, []);
      map.get(selfId).push({
        counterpartId,
        reason: edge.reason,
        overriddenBy: edge.overriddenBy,
        overriddenAt: edge.overriddenAt,
      });
    }
  }
  return map;
}

// add getActiveOverridesForEvents to module.exports
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- conflictOverride.test.js`
Expected: PASS (all three describe blocks).

- [ ] **Step 5: Commit**

```bash
git add backend/services/conflictOverrideService.js backend/__tests__/integration/events/conflictOverride.test.js
git commit -m 'feat(conflict-override): active-override enrichment query'
```

---

## Task 5: Wire collection, indexes, and service into startup (api-server + testApp)

**Files:**
- Modify: `backend/api-server.js` — collection var declaration; assignment block (~3307-3343); `ensureIndexes()` call near other `createIndex`; `require` + `setDbConnection`.
- Modify: `backend/__tests__/__helpers__/testApp.js` — `setDbConnection` + `ensureIndexes` against the test db.

**Interfaces:**
- Consumes: the service from Tasks 2-4.
- Produces: a live `conflictOverridesCollection` and a wired `conflictOverrideService` in both engines. No behavior change at force sites yet.

- [ ] **Step 1: Add the require + collection var (api-server.js)**

Near the other service requires (top of file, with `auditService`):
```javascript
const conflictOverrideService = require('./services/conflictOverrideService');
```
Near the other `let xCollection;` declarations:
```javascript
let conflictOverridesCollection;
```

- [ ] **Step 2: Assign the collection + wire the service (api-server.js ~3307-3343)**

In the collection-assignment block, after `calendarMarkersCollection = ...`:
```javascript
    conflictOverridesCollection = withRetryCollection(db.collection('templeEvents__ConflictOverrides'));
```
In the service-wiring block, after `auditService.setDbConnection(db);`:
```javascript
    conflictOverrideService.setDbConnection(db);
    await conflictOverrideService.ensureIndexes();
```

- [ ] **Step 3: Mirror in testApp.js**

In testApp's db/collection setup (where `auditService.setDbConnection` is called for tests, or alongside `testCollections`), add:
```javascript
    conflictOverrideService.setDbConnection(db);
    await conflictOverrideService.ensureIndexes();
```
with `const conflictOverrideService = require('../../services/conflictOverrideService');` at the top of testApp.js.

- [ ] **Step 4: Verify the suite still boots**

Run: `cd backend && npm test -- conflictOverride.test.js publishConflict.test.js`
Expected: PASS — no behavior changed; both engines wire cleanly.

- [ ] **Step 5: Commit**

```bash
git add backend/api-server.js backend/__tests__/__helpers__/testApp.js
git commit -m 'chore(conflict-override): wire collection, indexes, service in both engines'
```

---

## Task 6: Publish site — unified forceConflicts + reason + record (api-server + testApp + tests)

**Files:**
- Modify: `backend/api-server.js` (~21507-21601 destructure/gate/409; post-publish success ~22017 to record).
- Modify: `backend/__tests__/__helpers__/testApp.js` (~1591-1628 mirror).
- Modify: `backend/__tests__/integration/events/publishConflict.test.js:132`, `recurringConflict.test.js:316`.
- Test: `backend/__tests__/integration/events/conflictOverride.test.js` (append end-to-end publish cases — requires testApp request helper; if the file is pure-service, add a sibling `conflictOverride.publish.test.js` using `testApp`).

**Interfaces:**
- Consumes: `recordConflictOverride` (Task 2).
- Produces: publish endpoint accepting `{ forceConflicts, overrideReason }`; 409 returns `forceField: 'forceConflicts', requiresReason: true, canForce: hasApproverAccess`.

- [ ] **Step 1: Update existing conflict tests to the new contract (make them fail first)**

In `publishConflict.test.js:132` change the force send from:
```javascript
.send({ forcePublish: true, _version: ... })
```
to:
```javascript
.send({ forceConflicts: true, overrideReason: 'known double-book, approved by clergy', _version: ... })
```
Do the same at `recurringConflict.test.js:316`. (Recurring publish is non-blocking for hard conflicts, so the reason is inert there but keeps the contract uniform.)

Add a new failing case to the publish e2e test asserting the reason gate and edge creation:
```javascript
test('publish force without reason is rejected 400', async () => {
  // ...seed E conflicting with a published C, then:
  const res = await request(app)
    .put(`/api/admin/events/${eId}/publish`)
    .set(authHeader(approver))
    .send({ forceConflicts: true, _version: 0 });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('OVERRIDE_REASON_REQUIRED');
});

test('publish force with reason succeeds and records an active edge', async () => {
  const res = await request(app)
    .put(`/api/admin/events/${eId}/publish`)
    .set(authHeader(approver))
    .send({ forceConflicts: true, overrideReason: 'clergy approved', _version: 0 });
  expect(res.status).toBe(200);
  const edge = await db.collection('templeEvents__ConflictOverrides').findOne({ active: true });
  expect(edge.reason).toBe('clergy approved');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- publishConflict.test.js conflictOverride.publish.test.js`
Expected: FAIL — old code still gates force on `effectiveRole !== 'admin'` and `forcePublish`; reason gate + edge absent.

- [ ] **Step 3: Transform the publish site (api-server.js)**

Replace the admin-only gate (~21525):
```javascript
    // REMOVE:
    // if (forcePublish && effectiveRole !== 'admin') {
    //   return res.status(403).json({ error: 'Only admins can force-override scheduling conflicts' });
    // }
```
Update destructuring (~21507) to add the new fields (keep existing ones):
```javascript
    const { notes, calendarMode, createCalendarEvent, forceConflicts, overrideReason, targetCalendar, _version, acknowledgeSoftConflicts } = req.body;
```
Replace the single-event conflict block (~21586-21601) with the **Shared Override Branch** (see top of plan), using `MESSAGE = `Cannot publish: ${hardConflicts.length} scheduling conflict(s) with published events``. Declare `let pendingConflictOverride = null;` just before the conflict-check section. Also change the recurring guard at ~21555 from `if (!forcePublish)` to `if (!forceConflicts)`.

- [ ] **Step 4: Record + reconcile after a successful publish (api-server.js ~22017)**

In the post-publish success path (after the Graph event is created and the event doc reflects `status: 'published'`), insert the **Shared Override Branch** post-write block, with `POST_WRITE_DOC = event` and `CONTEXT = 'publish'`. (The reconcile call covers trigger #3 — a republish that resolves a stale edge involving this event.)

- [ ] **Step 5: Mirror the transform in testApp.js (~1591-1628)**

Apply the same edits: rename `forcePublish`→`forceConflicts`, add `overrideReason`, swap the conflict block for the Shared Override Branch (`MESSAGE` = the publish message), and after the test publish write add the Shared Override Branch post-write block with the testApp `conflictChecker`. Use the same 409 shape (`forceField: 'forceConflicts', requiresReason: true, canForce: true`).

- [ ] **Step 6: Run the publish tests**

Run: `cd backend && npm test -- publishConflict.test.js recurringConflict.test.js conflictOverride.publish.test.js`
Expected: PASS — reason gate, edge creation, and existing force-publish happy path all green.

- [ ] **Step 7: Commit**

```bash
git add backend/api-server.js backend/__tests__/__helpers__/testApp.js backend/__tests__/integration/events/publishConflict.test.js backend/__tests__/integration/events/recurringConflict.test.js backend/__tests__/integration/events/conflictOverride.publish.test.js
git commit -m 'feat(conflict-override): publish path requires reason and records edges'
```

---

## Task 7: Admin update site — forceConflicts + reason + record + reconcile-on-edit

**Files:**
- Modify: `backend/api-server.js` (~24469 gate, ~24822 409 block, post-update success, and the edit-success path for reconcile).
- Modify: `backend/__tests__/__helpers__/testApp.js` (~4647-4676 mirror).
- Modify: `backend/__tests__/integration/events/saveConflict.test.js:139`, `restoreOccurrence.test.js:464`.

**Interfaces:**
- Consumes: `recordConflictOverride`, `clearStaleConflictEdges`.
- Produces: admin update accepting `{ forceConflicts, overrideReason }`; reconcile fired after any successful update.

- [ ] **Step 1: Update existing tests to the new contract**

`saveConflict.test.js:139` and `restoreOccurrence.test.js:464`: change `forceUpdate: true` → `forceConflicts: true, overrideReason: 'admin override for save'`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- saveConflict.test.js restoreOccurrence.test.js`
Expected: FAIL — old gate/field names.

- [ ] **Step 3: Transform the admin-update site (api-server.js)**

Remove the admin-only gate (~24469-24472). In the update body destructuring add `forceConflicts`/`overrideReason` (replace `forceUpdate` usages). Replace the 409 block (~24822-24835) with the **Shared Override Branch**, `MESSAGE = `Cannot save: ${hardConflicts.length} scheduling conflict(s) with published events``. Declare `let pendingConflictOverride = null;` before the check. Change the `if (!updates.forceUpdate)` conflict guard to `if (!forceConflicts)`.

- [ ] **Step 4: Record + reconcile after a successful update**

After the successful `conditionalUpdate` returns `resultEvent` in this handler:
```javascript
    if (pendingConflictOverride) {
      await conflictOverrideService.recordConflictOverride({
        primaryEvent: resultEvent,
        hardConflicts: pendingConflictOverride.hardConflicts,
        reason: pendingConflictOverride.reason,
        actor: { userId, email: userEmail, name: user?.displayName || userEmail },
        context: 'adminSave',
      });
    }
    // Auto-clear any overrides this edit may have resolved (failure-isolated)
    await conflictOverrideService.clearStaleConflictEdges({
      eventDoc: resultEvent,
      conflictChecker: async (doc) => (await checkRoomConflicts(doc, doc._id.toString())).hardConflicts,
      actor: { userId, email: userEmail },
      context: 'adminSave',
    });
```

- [ ] **Step 5: Mirror in testApp.js (~4647-4676)**

Same transform + the same `recordConflictOverride` / `clearStaleConflictEdges` calls, using testApp's conflict checker: `conflictChecker: async (doc) => (await checkTestConflicts(doc, doc._id, testCollections.events, testCollections.categories)).hardConflicts`.

- [ ] **Step 6: Add a reconcile integration test (append to conflictOverride.publish.test.js or a new save test)**

```javascript
test('editing the event off the conflict clears the override on both', async () => {
  // publish E with override against C (reuse Task 6 setup), then PUT E to a non-conflicting time
  const res = await request(app).put(`/api/admin/events/${eId}`)
    .set(authHeader(admin))
    .send({ startDateTime: nonConflictingStart, endDateTime: nonConflictingEnd, _version: 1 });
  expect(res.status).toBe(200);
  const active = await db.collection('templeEvents__ConflictOverrides').countDocuments({ active: true });
  expect(active).toBe(0);
});
```

- [ ] **Step 7: Run + commit**

Run: `cd backend && npm test -- saveConflict.test.js restoreOccurrence.test.js conflictOverride.publish.test.js`
Expected: PASS.
```bash
git add backend/api-server.js backend/__tests__/__helpers__/testApp.js backend/__tests__/integration/events/saveConflict.test.js backend/__tests__/integration/events/restoreOccurrence.test.js backend/__tests__/integration/events/conflictOverride.publish.test.js
git commit -m 'feat(conflict-override): admin save requires reason, records + reconciles'
```

---

## Task 8: PublishEdit site — forceConflicts + reason + record + fix permission test

**Files:**
- Modify: `backend/api-server.js` (~23435 destructure, ~23448 gate, ~23553 409 block, post-success record).
- Modify: `backend/__tests__/__helpers__/testApp.js` (~3538-3575 mirror).
- Modify: `backend/__tests__/integration/events/editRequestsApprove.test.js:291-305`.

- [ ] **Step 1: Update the permission test**

At `editRequestsApprove.test.js:291-305`, the test currently sends `{ forcePublishEdit: true }` as an approver and asserts a 403 `/admin/i`. Change it to assert the new behavior — an approver forcing without a reason gets `400 OVERRIDE_REASON_REQUIRED`:
```javascript
  test('approver force-publishing an edit without a reason is rejected', async () => {
    const res = await request(app).post(`/api/admin/edit-requests/${reqId}/publish`)
      .set(authHeader(approver))
      .send({ forceConflicts: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('OVERRIDE_REASON_REQUIRED');
  });
```
Update the test's description/title accordingly (it previously documented "admin-only").

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- editRequestsApprove.test.js`
Expected: FAIL.

- [ ] **Step 3: Transform the publishEdit site (api-server.js)**

Replace destructuring (~23432) `forcePublishEdit` → `forceConflicts` + add `overrideReason`. Remove the admin-only gate at ~23448 (`if (forcePublishEdit && effectiveRole !== 'admin')`). Replace the 409 block (~23553-23564) with the **Shared Override Branch**, `MESSAGE = 'The proposed edit changes conflict with published events'`. Note this site reads conflicts via `checkRoomConflicts(conflictReservation, event._id.toString())` — keep that call, only the post-check branch changes. After the edit publishes successfully, insert the Shared Override Branch post-write block with `POST_WRITE_DOC = event` and `CONTEXT = 'publishEdit'`.

- [ ] **Step 4: Mirror in testApp.js (~3538-3575).**

- [ ] **Step 5: Run + commit**

Run: `cd backend && npm test -- editRequestsApprove.test.js`
Expected: PASS.
```bash
git add backend/api-server.js backend/__tests__/__helpers__/testApp.js backend/__tests__/integration/events/editRequestsApprove.test.js
git commit -m 'feat(conflict-override): publishEdit requires reason, opens force to approvers'
```

---

## Task 9: Admin restore site — forceConflicts + reason + record + reconcile

**Files:**
- Modify: `backend/api-server.js` (~16771 destructure, ~16806 409 block, post-restore record + reconcile).
- Modify: `backend/__tests__/__helpers__/testApp.js` (~2376-2440 mirror).
- Modify: `backend/__tests__/integration/events/eventAdminRestore.test.js:605`.

- [ ] **Step 1: Update the existing test**

`eventAdminRestore.test.js:605`: `forceRestore: true` → `forceConflicts: true, overrideReason: 'restoring per facilities'`.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- eventAdminRestore.test.js`
Expected: FAIL.

- [ ] **Step 3: Transform the admin-restore site (api-server.js)**

Destructure (~16771) `forceRestore` → `forceConflicts` + `overrideReason`. (This endpoint is admin-gated at the top; the reason requirement still applies — admins are not exempt.) Replace the 409 block (~16806-16822) with the **Shared Override Branch**, `MESSAGE = `Cannot restore: ${hardConflicts.length} scheduling conflict(s) with published events``, `canForce: true` (admin-only endpoint), and keep the extra `previousStatus` field in the 409 body. After the successful restore `conditionalUpdate`, insert the Shared Override Branch post-write block with `POST_WRITE_DOC = resultEvent` and `CONTEXT = 'restore'`. The reconcile here covers trigger #3 (counterpart re-checked on its own restore).

- [ ] **Step 4: Mirror in testApp.js (~2376-2440).**

- [ ] **Step 5: Run + commit**

Run: `cd backend && npm test -- eventAdminRestore.test.js`
Expected: PASS.
```bash
git add backend/api-server.js backend/__tests__/__helpers__/testApp.js backend/__tests__/integration/events/eventAdminRestore.test.js
git commit -m 'feat(conflict-override): admin restore requires reason, records + reconciles'
```

---

## Task 10: Reconcile on delete / reject / cancel

**Files:**
- Modify: `backend/api-server.js` — the DELETE event handler and the reject endpoint (grep `status: 'deleted'` / `status: 'rejected'` set sites in the admin event delete + reject handlers).
- Modify: `backend/__tests__/__helpers__/testApp.js` — mirror at the same handlers.
- Test: `backend/__tests__/integration/events/conflictOverride.publish.test.js` (append).

- [ ] **Step 1: Write the failing test**

```javascript
test('deleting the counterpart clears the override on the surviving event', async () => {
  // publish E with override vs C, then delete C
  const res = await request(app).delete(`/api/admin/events/${cId}`)
    .set(authHeader(admin)).send({ reason: 'cancelled' });
  expect(res.status).toBe(200);
  const active = await db.collection('templeEvents__ConflictOverrides').countDocuments({ active: true });
  expect(active).toBe(0);
  const cleared = await db.collection('templeEvents__ConflictOverrides').findOne({});
  expect(cleared.resolvedReason).toBe('event_removed');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- conflictOverride.publish.test.js -t 'deleting the counterpart'`
Expected: FAIL (edge stays active).

- [ ] **Step 3: Add reconcile after the delete/reject status write (api-server.js)**

After the event's status is set to `deleted` (and after reject sets `rejected`), with the updated doc in hand:
```javascript
    await conflictOverrideService.clearStaleConflictEdges({
      eventDoc: { ...event, status: 'deleted' }, // or 'rejected'
      conflictChecker: async (doc) => (await checkRoomConflicts(doc, doc._id.toString())).hardConflicts,
      actor: { userId, email: userEmail }, context: 'delete',
    });
```
Because `status !== 'published'`, the helper clears all edges touching this event without running the checker. Mirror in testApp.js at the same handlers.

- [ ] **Step 4: Run + commit**

Run: `cd backend && npm test -- conflictOverride.publish.test.js`
Expected: PASS.
```bash
git add backend/api-server.js backend/__tests__/__helpers__/testApp.js backend/__tests__/integration/events/conflictOverride.publish.test.js
git commit -m 'feat(conflict-override): clear edges when an event is deleted or rejected'
```

---

## Task 11: Surface active overrides on event load/list (enrichment)

**Files:**
- Modify: `backend/api-server.js` — the load endpoint (~6816) and list endpoint (~7671), after `enrichSeriesMastersWithOverrides`.
- Test: `backend/__tests__/integration/events/conflictOverride.publish.test.js` (append).

- [ ] **Step 1: Write the failing test**

```javascript
test('list endpoint surfaces activeConflictOverrides on both events', async () => {
  // publish E with override vs C, then list
  const res = await request(app).get('/api/events/list?view=all').set(authHeader(admin));
  const eRow = res.body.events.find(x => x._id === eId);
  expect(eRow.activeConflictOverrides[0].reason).toBeTruthy();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npm test -- conflictOverride.publish.test.js -t 'surfaces activeConflictOverrides'`
Expected: FAIL (field absent).

- [ ] **Step 3: Attach the enrichment (api-server.js, both endpoints)**

After the events array is built and series-enriched, before sending:
```javascript
    const overrideMap = await conflictOverrideService.getActiveOverridesForEvents(
      events.map(e => e._id).filter(Boolean)
    );
    for (const e of events) {
      e.activeConflictOverrides = overrideMap.get(e._id?.toString()) || [];
    }
```
Apply at both the load (~6816 result) and list (~7671 result) sites, matching each site's local array variable name.

- [ ] **Step 4: Run + commit**

Run: `cd backend && npm test -- conflictOverride.publish.test.js`
Expected: PASS.
```bash
git add backend/api-server.js backend/__tests__/integration/events/conflictOverride.publish.test.js
git commit -m 'feat(conflict-override): surface active overrides on load and list'
```

- [ ] **Step 5: Full backend conflict-suite regression check**

Run: `cd backend && npm test -- publishConflict editConflict saveConflict recurringConflict crossCalendarConflict ownerRestore eventAdminRestore restoreOccurrence editRequestsApprove conflictOverride`
Expected: ALL PASS — the regression guard for the four force paths.

---

## Task 12: Frontend — restore-button reason field (the one live caller)

**Files:**
- Modify: `src/components/EventManagement.jsx` (~424-475 `handleRestore`, ~954-994 the "Override & Restore" button).
- Test: `src/__tests__/unit/components/` (add or extend an EventManagement test if one exists; otherwise a focused render test).

**Interfaces:**
- Consumes: backend publish/restore contract `{ forceConflicts, overrideReason }`.

- [ ] **Step 1: Add a reason prompt before forcing the restore**

`handleRestore(event, force)` at ~430 currently sends `{ _version, forceRestore: true }`. Change the force branch to require a reason captured in component state (`overrideReasonDraft`) and send the new contract:
```javascript
    const body = { _version: event._version };
    if (force) {
      const reason = (overrideReasonDraft || '').trim();
      if (!reason) { showError('Enter an override reason to restore past the conflict.'); return; }
      body.forceConflicts = true;
      body.overrideReason = reason;
    }
```

- [ ] **Step 2: Render a reason textarea in the conflict dialog**

In the conflict dialog block (~954-994), above the "Override & Restore" button, add a controlled textarea bound to `overrideReasonDraft`/`setOverrideReasonDraft`, following the in-button confirmation UX (button stays disabled until a non-empty reason is present). Reset `overrideReasonDraft` to `''` when the dialog closes.

- [ ] **Step 3: Verify**

Run: `npm run test:run -- EventManagement`
Expected: PASS (existing + the new reason-required interaction). If no test exists, add one asserting the button is disabled with an empty reason and the request body carries `forceConflicts`/`overrideReason` when submitted.

- [ ] **Step 4: Commit**

```bash
git add src/components/EventManagement.jsx src/__tests__/unit/components/
git commit -m 'feat(conflict-override): restore button collects override reason'
```

---

## Task 13: Frontend — approver publish override control + reason

**Files:**
- Modify: `src/hooks/useReviewModal.jsx` (~883-962 publish path / 409 handling).
- Modify: the conflict UI in `src/components/shared/` (ReviewModal / RoomReservationReview / EventReviewExperience — the conflict section).
- Test: `src/__tests__/` relevant hook/component test.

**Interfaces:**
- Consumes: 409 `{ canForce, forceField: 'forceConflicts', requiresReason: true, hardConflicts }`; backend publish contract.

- [ ] **Step 1: Add force state + reason to the publish flow**

In `useReviewModal.jsx`, replace the always-`false` `forcePublish` send (~893) with `forceConflicts: overrideState.active` and `overrideReason: overrideState.reason`. On a hard-conflict 409 with `canForce && requiresReason`, set state to reveal the override control instead of dead-ending the error (~960).

- [ ] **Step 2: Render the override control in the conflict section**

In the shared conflict UI, when `canForce && requiresReason`, show a required reason textarea + an in-button-confirmation "Override & Publish" action (red/warning per the UI standard). Disable until the reason is non-empty. Submitting re-invokes publish with `{ forceConflicts: true, overrideReason }`.

- [ ] **Step 3: Verify**

Run: `npm run test:run -- useReviewModal ReviewModal`
Expected: PASS (new override-path test: 409 reveals control; submit sends the new contract).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useReviewModal.jsx src/components/shared/ src/__tests__/
git commit -m 'feat(conflict-override): approver publish override control with reason'
```

---

## Task 14: Frontend — display the live override reason on the record

**Files:**
- Modify: the conflict section in `src/components/shared/` (read `reservation.activeConflictOverrides`).
- Modify: `src/utils/eventTransformers.js` — pass `activeConflictOverrides` through `transformEventToFlatStructure`.
- Test: `src/__tests__/` transform + component test.

- [ ] **Step 1: Carry the field through the transform**

In `transformEventToFlatStructure` add:
```javascript
  activeConflictOverrides: event.activeConflictOverrides || [],
```

- [ ] **Step 2: Render the override banner**

In the conflict section, when `activeConflictOverrides.length > 0`, render a non-blocking banner per override: "Conflict overridden by {overriddenBy.name} on {date} — reason: {reason}". This is what lets a reviewer see why a double-book was allowed.

- [ ] **Step 3: Verify**

Run: `npm run test:run -- eventTransformers ReviewModal`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/eventTransformers.js src/components/shared/ src/__tests__/
git commit -m 'feat(conflict-override): surface live override reason in review UI'
```

---

## Final Verification

- [ ] **Backend full conflict + override suites:**

Run: `cd backend && npm test -- publishConflict editConflict saveConflict recurringConflict crossCalendarConflict ownerRestore eventAdminRestore restoreOccurrence editRequestsApprove publishRecurringConflict recurringBatchConflict conflictOverride`
Expected: ALL PASS.

- [ ] **Frontend:**

Run: `npm run test:run`
Expected: ALL PASS.

- [ ] **Manual smoke (optional, per CLAUDE.md verify-app):** publish a conflicting event as an approver → reason prompt appears → submit with reason → both events show the override banner → edit one event off the conflict → banner clears on both.

---

## Notes for the Implementer

- **`hasApproverAccess`** is computed at the publish and publishEdit sites already. At the admin-update site, if it is not in scope, compute it: `const hasApproverAccess = ROLE_HIERARCHY[effectiveRole] >= ROLE_HIERARCHY['approver'];`. The admin-restore site stays `canForce: true` (admin-only endpoint). Use it for `canForce`; do NOT re-gate the force on `effectiveRole !== 'admin'` — that admin-only gate is being removed by design.
- **Audit `changeType`** must stay within `create|update|delete|import` (enum enforced by `buildEventAuditEntry`). The override semantics live in `metadata.action` (`conflict_override` / `conflict_override_cleared`), not in `changeType`.
- **`recordConflictOverride` reads counterpart docs** for their business `eventId` (audit keys on `eventId`, edges key on `_id`). This is why both events must exist in `templeEvents__Events` when it runs (always true at publish/save/restore time).
- **Reconcile is failure-isolated** — it is wrapped in try/catch and only writes to the edge + audit collections, never to event docs, so it cannot break the triggering operation or cause a write cycle.
- **Recurring publish is intentionally out of scope** for edge recording — it is non-blocking for hard conflicts (downgrades approvers to pending), so no 409/force path exists there to gate.
