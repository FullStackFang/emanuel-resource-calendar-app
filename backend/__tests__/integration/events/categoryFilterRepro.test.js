/**
 * Category filter — calendarData.categories is the source of truth (CF-1..CF-5).
 *
 * The search/export category filter matches calendarData.categories ONLY (the
 * field that drives what renders on the calendar). These tests also pin down
 * that when an event is missing from results, it is the DATE WINDOW — not the
 * category match — doing the cutting (modeled on the real 'Intro to Judaism'
 * Skirball event dated 2026-05-26).
 */

const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const { connectToGlobalServer, disconnectFromGlobalServer } = require('../../__helpers__/testSetup');
const { createViewer, insertUsers } = require('../../__helpers__/userFactory');
const { createPublishedEvent, insertEvents } = require('../../__helpers__/eventFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, ENDPOINTS } = require('../../__helpers__/testConstants');

function search(app, token, { category, startDate, endDate }) {
  return request(app)
    .get(`${ENDPOINTS.LIST_EVENTS}?view=search&categories=${encodeURIComponent(category)}&categoryCount=10&startDate=${startDate}&endDate=${endDate}`)
    .set('Authorization', `Bearer ${token}`);
}

describe('Category filter (calendarData source of truth) CF-1..CF-5', () => {
  let mongoClient, db, app, viewerUser, viewerToken;

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('categoryFilterRepro'));
    app = await setupTestApp(db);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await db.collection(COLLECTIONS.USERS).deleteMany({});
    await db.collection(COLLECTIONS.EVENTS).deleteMany({});
    viewerUser = createViewer();
    await insertUsers(db, [viewerUser]);
    viewerToken = await createMockToken(viewerUser);
  });

  // The real event: Intro to Judaism, Skirball, 2026-05-26 18:30.
  function introToJudaism() {
    const ev = createPublishedEvent({ eventTitle: 'Intro to Judaism', categories: ['Skirball'] });
    ev.calendarData.startDateTime = '2026-05-26T18:30:00';
    ev.calendarData.endDateTime = '2026-05-26T20:30:00';
    return ev;
  }

  // CF-1: matched by its calendarData category when the window includes its date.
  it('CF-1: returns Skirball event when date window includes 2026-05-26', async () => {
    await insertEvents(db, [introToJudaism()]);
    const res = await search(app, viewerToken, { category: 'Skirball', startDate: '2026-05-26', endDate: '2026-06-01' });
    expect(res.status).toBe(200);
    const titles = res.body.events.map(e => e.calendarData?.eventTitle || e.eventTitle);
    expect(titles).toContain('Intro to Judaism');
  });

  // CF-2: same event is (correctly) excluded when the window starts after its date.
  //       This is the real cause of the reported "Skirball returns 0".
  it('CF-2: excludes the same Skirball event when window starts 2026-05-27', async () => {
    await insertEvents(db, [introToJudaism()]);
    const res = await search(app, viewerToken, { category: 'Skirball', startDate: '2026-05-27', endDate: '2026-06-02' });
    expect(res.status).toBe(200);
    const titles = res.body.events.map(e => e.calendarData?.eventTitle || e.eventTitle);
    expect(titles).not.toContain('Intro to Judaism');
  });

  // CF-3: control — unrelated category not returned.
  it('CF-3: does not match a different category', async () => {
    await insertEvents(db, [introToJudaism()]);
    const res = await search(app, viewerToken, { category: 'Services', startDate: '2026-05-26', endDate: '2026-06-01' });
    expect(res.status).toBe(200);
    const titles = res.body.events.map(e => e.calendarData?.eventTitle || e.eventTitle);
    expect(titles).not.toContain('Intro to Judaism');
  });

  // CF-4: calendarData is the source of truth — a category that exists ONLY in
  //       top-level/graphData (not calendarData) is intentionally NOT matched.
  it('CF-4: ignores categories that are not in calendarData.categories', async () => {
    const ev = introToJudaism();
    ev.calendarData.categories = [];     // not the source of truth value
    ev.categories = ['Skirball'];        // stray top-level value
    ev.graphData = { ...(ev.graphData || {}), categories: ['Skirball'] };
    await insertEvents(db, [ev]);
    const res = await search(app, viewerToken, { category: 'Skirball', startDate: '2026-05-26', endDate: '2026-06-01' });
    expect(res.status).toBe(200);
    const titles = res.body.events.map(e => e.calendarData?.eventTitle || e.eventTitle);
    expect(titles).not.toContain('Intro to Judaism');
  });

  // CF-5: Uncategorized matches an event with no calendarData category.
  it('CF-5: Uncategorized matches an event with empty calendarData.categories', async () => {
    const ev = introToJudaism();
    ev.calendarData.categories = [];
    ev.calendarData.eventTitle = 'No Cats';
    await insertEvents(db, [ev]);
    const res = await search(app, viewerToken, { category: 'Uncategorized', startDate: '2026-05-26', endDate: '2026-06-01' });
    expect(res.status).toBe(200);
    const titles = res.body.events.map(e => e.calendarData?.eventTitle || e.eventTitle);
    expect(titles).toContain('No Cats');
  });

  describe('categoryIds dual-write resolver (CI-1)', () => {
    it('CI-1: resolver auto-creates a category and returns an id for an unregistered name', async () => {
      const { buildNormalizedCategoryMap, resolveCategoryIds } = require('../../../utils/categoryResolver');
      const cats = db.collection(COLLECTIONS.CATEGORIES);
      await cats.deleteMany({});
      const cache = new Map((await cats.find({}).toArray()).map(c => [c.name, c]));
      const normMap = buildNormalizedCategoryMap(cache);
      const { ids, created } = await resolveCategoryIds(['Skirball'], { normMap, categoriesCollection: cats });
      expect(created).toBe(1);
      expect(ids).toHaveLength(1);
      const doc = await cats.findOne({ _id: ids[0] });
      expect(doc).toMatchObject({ name: 'Skirball', autoCreated: true });
    });
  });

  describe('categoryIds dual-write on create (CI-2)', () => {
    it('CI-2: an event with a category name but no categoryIds is matched via the name fallback', async () => {
      const cats = db.collection(COLLECTIONS.CATEGORIES);
      await cats.deleteMany({});
      const { insertedId } = await cats.insertOne({ name: 'Adult Ed', color: '#111', displayOrder: 1, active: true, createdAt: new Date() });
      const ev = createPublishedEvent({ eventTitle: 'Class', categories: ['Adult Ed'] });
      ev.calendarData.startDateTime = '2026-05-26T10:00:00';
      ev.calendarData.endDateTime = '2026-05-26T11:00:00';
      delete ev.calendarData.categoryIds;
      await insertEvents(db, [ev]);

      const res = await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=search&categoryIds=${insertedId}&categories=Adult%20Ed&categoryCount=10&startDate=2026-05-26&endDate=2026-06-01`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.events.map(e => e.calendarData?.eventTitle)).toContain('Class');
    });
  });

  describe('categoryIds id-only match (CI-3)', () => {
    it('CI-3: matches by categoryId alone (no name param) when the event has categoryIds', async () => {
      const cats = db.collection(COLLECTIONS.CATEGORIES);
      await cats.deleteMany({});
      const { insertedId } = await cats.insertOne({ name: 'Skirball', displayOrder: 1, active: true, createdAt: new Date() });
      const ev = createPublishedEvent({ eventTitle: 'Intro to Judaism', categories: ['Skirball'] });
      ev.calendarData.startDateTime = '2026-05-26T18:30:00';
      ev.calendarData.endDateTime = '2026-05-26T20:30:00';
      ev.calendarData.categoryIds = [insertedId];
      await insertEvents(db, [ev]);

      const res = await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=search&categoryIds=${insertedId}&categoryCount=10&startDate=2026-05-26&endDate=2026-06-01`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.events.map(e => e.calendarData?.eventTitle)).toContain('Intro to Judaism');
    });
  });

  describe('search + category composition (CI-4)', () => {
    it('CI-4: combining a search term with a categoryId returns only events matching BOTH', async () => {
      const cats = db.collection(COLLECTIONS.CATEGORIES);
      await cats.deleteMany({});
      const { insertedId } = await cats.insertOne({ name: 'Skirball', displayOrder: 1, active: true, createdAt: new Date() });

      const match = createPublishedEvent({ eventTitle: 'Intro to Judaism', categories: ['Skirball'] });
      match.calendarData.startDateTime = '2026-05-26T18:30:00';
      match.calendarData.endDateTime = '2026-05-26T20:30:00';
      match.calendarData.categoryIds = [insertedId];

      // Same category + same window, but title does NOT contain the search term.
      const other = createPublishedEvent({ eventTitle: 'Yoga Class', categories: ['Skirball'] });
      other.calendarData.startDateTime = '2026-05-26T09:00:00';
      other.calendarData.endDateTime = '2026-05-26T10:00:00';
      other.calendarData.categoryIds = [insertedId];

      await insertEvents(db, [match, other]);

      const res = await request(app)
        .get(`${ENDPOINTS.LIST_EVENTS}?view=search&search=Judaism&categoryIds=${insertedId}&categoryCount=10&startDate=2026-05-26&endDate=2026-06-01`)
        .set('Authorization', `Bearer ${viewerToken}`);
      expect(res.status).toBe(200);
      const titles = res.body.events.map(e => e.calendarData?.eventTitle);
      expect(titles).toContain('Intro to Judaism');   // matches search AND category
      expect(titles).not.toContain('Yoga Class');      // category matches but search does not
    });
  });
});
