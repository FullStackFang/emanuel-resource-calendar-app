/**
 * Category Rename Propagation Tests (CR-RENAME-1..3)
 *
 * Renaming a category via PUT /api/categories/:id must refresh the denormalized
 * calendarData.categories display strings on every event that references the
 * category — whether the event was tagged AFTER the categoryIds backfill (has
 * calendarData.categoryIds) or BEFORE it (has the name string only).
 *
 * Root cause this locks: the original cascade matched events only by
 * calendarData.categoryIds, so pre-backfill events (no categoryIds) were silently
 * skipped and kept the stale old name on the calendar. See
 * project-category-objectid-migration memory + api-server PUT /api/categories/:id.
 */

const request = require('supertest');
const { ObjectId } = require('mongodb');

const { setupTestApp } = require('../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../__helpers__/userFactory');
const { createPublishedEvent, insertEvents } = require('../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../__helpers__/authHelpers');
const { COLLECTIONS } = require('../__helpers__/testConstants');

describe('Category rename propagation (CR-RENAME-1..3)', () => {
  let mongoClient, db, app;
  let adminUser, adminToken;
  let categoryId;

  const OLD_NAME = 'Concert';
  const NEW_NAME = 'Live Music';

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('categoryRename'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    await db.collection(COLLECTIONS.CATEGORIES).deleteMany({});

    adminUser = createAdmin();
    await insertUsers(db, [adminUser]);
    adminToken = await createMockToken(adminUser);

    categoryId = new ObjectId();
    await db.collection(COLLECTIONS.CATEGORIES).insertOne({
      _id: categoryId,
      name: OLD_NAME,
      color: 'preset0',
      displayOrder: 1,
      active: true,
    });
  });

  function rename(newName) {
    return request(app)
      .put(`/api/categories/${categoryId.toString()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: newName });
  }

  async function categoriesFor(eventId) {
    const doc = await db.collection(COLLECTIONS.EVENTS).findOne({ eventId });
    return doc.calendarData.categories;
  }

  it('CR-RENAME-1: refreshes events that reference the category by stable categoryId', async () => {
    const ev = createPublishedEvent({
      eventTitle: 'Tagged with id',
      calendarData: { eventTitle: 'Tagged with id', categories: [OLD_NAME], categoryIds: [categoryId] },
    });
    await insertEvents(db, [ev]);

    const res = await rename(NEW_NAME);
    expect(res.status).toBe(200);

    expect(await categoriesFor(ev.eventId)).toEqual([NEW_NAME]);
  });

  it('CR-RENAME-2: refreshes events that reference the category by NAME only (no categoryIds — pre-backfill)', async () => {
    const ev = createPublishedEvent({
      eventTitle: 'Tagged by name only',
      // No categoryIds — models an event created before the categoryIds backfill.
      calendarData: { eventTitle: 'Tagged by name only', categories: [OLD_NAME] },
    });
    await insertEvents(db, [ev]);

    const res = await rename(NEW_NAME);
    expect(res.status).toBe(200);

    expect(await categoriesFor(ev.eventId)).toEqual([NEW_NAME]);
  });

  it('CR-RENAME-4: records the old name as an alias on the category (external sources keep resolving)', async () => {
    const res = await rename(NEW_NAME);
    expect(res.status).toBe(200);

    const cat = await db.collection(COLLECTIONS.CATEGORIES).findOne({ _id: categoryId });
    expect(cat.name).toBe(NEW_NAME);
    expect(cat.aliases || []).toContain(OLD_NAME); // 'Concert' now resolves to 'Live Music'
  });

  it('CR-RENAME-3: leaves events for OTHER categories untouched (name-match must not over-reach)', async () => {
    const ev = createPublishedEvent({
      eventTitle: 'Different category',
      calendarData: { eventTitle: 'Different category', categories: ['Lecture'] },
    });
    await insertEvents(db, [ev]);

    const res = await rename(NEW_NAME);
    expect(res.status).toBe(200);

    expect(await categoriesFor(ev.eventId)).toEqual(['Lecture']);
  });
});
