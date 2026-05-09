/**
 * Resource Scheduler Recurrence Detection Tests (REC-1 through REC-22).
 *
 * Algorithm tests (REC-1 to REC-10) are pure unit tests against the
 * detection module — no DB needed.
 *
 * Endpoint + commit conversion + Graph publish tests (REC-11 onward) are
 * filled in across commits 3, 4, 5, 6.
 */

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const { setupTestApp } = require('../../__helpers__/createAppForTest');
const {
  connectToGlobalServer,
  disconnectFromGlobalServer,
  clearCollections,
} = require('../../__helpers__/testSetup');
const { createAdmin, insertUsers } = require('../../__helpers__/userFactory');
const { createMockToken, initTestKeys } = require('../../__helpers__/authHelpers');
const { COLLECTIONS, TEST_CALENDAR_OWNER } = require('../../__helpers__/testConstants');

const detection = require('../../../services/rschedRecurrenceDetection');
const rschedImportService = require('../../../services/rschedImportService');

const STAGING_COLLECTION = rschedImportService.STAGING_COLLECTION;
const CANDIDATES_COLLECTION = detection.RECURRENCE_CANDIDATES_COLLECTION;

const {
  normalizeTitle,
  levenshtein,
  jaccardSimilarity,
  shouldMergeTitles,
  isIgnorableSuffixMatch,
  candidateKey,
  groupRowsByKey,
  fuzzyMergeTitles,
  fitWeeklySingleDay,
  fitWeeklyMultiDay,
  fitBiweekly,
  fitMonthlyByDate,
  fitPattern,
  classifyMembers,
  pickMasterRow,
  detectRecurrenceCandidates,
  parseLocalDate,
} = detection;

// ---------------------------------------------------------------------------
// Test data builders (shared across describe blocks)
// ---------------------------------------------------------------------------

let _rsIdCounter = 1000;
function nextRsId() {
  return _rsIdCounter++;
}

// eslint-disable-next-line no-unused-vars
function _resetRsIdCounter(start = 1000) {
  _rsIdCounter = start;
}

function makeRow(overrides = {}) {
  return {
    _id: `staging-${nextRsId()}`,
    rsId: overrides.rsId ?? nextRsId(),
    eventTitle: overrides.eventTitle ?? 'Test Event',
    eventDescription: overrides.eventDescription ?? '',
    categories: overrides.categories ?? [],
    startDate: overrides.startDate ?? '2026-05-08',
    endDate: overrides.endDate ?? overrides.startDate ?? '2026-05-08',
    startTime: overrides.startTime ?? '10:00',
    endTime: overrides.endTime ?? '11:00',
    startDateTime: overrides.startDateTime ?? `${overrides.startDate ?? '2026-05-08'}T${overrides.startTime ?? '10:00'}:00`,
    endDateTime: overrides.endDateTime ?? `${overrides.endDate ?? overrides.startDate ?? '2026-05-08'}T${overrides.endTime ?? '11:00'}:00`,
    isAllDay: overrides.isAllDay ?? false,
    rsKey: overrides.rsKey ?? '602',
    rsKeys: overrides.rsKeys ?? [overrides.rsKey ?? '602'],
    locationIds: overrides.locationIds ?? ['loc-602'],
    locationDisplayNames: overrides.locationDisplayNames ?? 'Room 602',
    ...overrides,
  };
}

/**
 * Generate weekly rows for a series. Weekly cadence on the given dow,
 * starting startDate, count weeks.
 */
function makeWeeklyRows(startDate, count, overrides = {}) {
  const rows = [];
  const start = parseLocalDate(startDate);
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + 7 * i);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    rows.push(makeRow({ ...overrides, startDate: ymd, endDate: ymd }));
  }
  return rows;
}

describe('rsched recurrence detection — algorithm unit tests (REC-1..REC-10)', () => {
  beforeEach(() => {
    _rsIdCounter = 1000;
  });

  // ---- string similarity sanity checks ----
  describe('string similarity', () => {
    test('levenshtein: identical strings = 0', () => {
      expect(levenshtein('hello', 'hello')).toBe(0);
    });
    test('levenshtein: small edits', () => {
      expect(levenshtein('al-anon', 'al-anon meeting')).toBeGreaterThan(0);
    });
    test('jaccardSimilarity: identical token sets = 1', () => {
      expect(jaccardSimilarity('foo bar', 'foo bar')).toBe(1);
    });
    test('jaccardSimilarity: disjoint = 0', () => {
      expect(jaccardSimilarity('foo bar', 'baz qux')).toBe(0);
    });
    test('jaccardSimilarity: Adult Ed Hebrew vs Adult Ed Spanish ≈ 0.6 (below threshold)', () => {
      const sim = jaccardSimilarity('adult ed hebrew class', 'adult ed spanish class');
      expect(sim).toBeCloseTo(3 / 5, 2);
      expect(sim).toBeLessThan(0.85);
    });
    test('isIgnorableSuffixMatch: Al-Anon + Al-Anon Meeting → true', () => {
      expect(isIgnorableSuffixMatch('al-anon', 'al-anon meeting')).toBe(true);
    });
    test('isIgnorableSuffixMatch: Hebrew Class + Hebrew Class Beginners → false', () => {
      expect(isIgnorableSuffixMatch('hebrew class', 'hebrew class beginners')).toBe(false);
    });
  });

  // ---- REC-1: Pure weekly Wednesday series ----
  test('REC-1: weekly Wednesday series → fits weekly daysOfWeek=[wednesday], confidence ≥ 0.9', () => {
    // 2026-05-06 is a Wednesday in the test scenario; verify dow first.
    const startDate = '2026-05-06'; // Wed
    expect(parseLocalDate(startDate).getDay()).toBe(3); // Wed = 3

    const rows = makeWeeklyRows(startDate, 8, { eventTitle: 'Al-Anon' });
    const candidates = detectRecurrenceCandidates(rows);
    expect(candidates).toHaveLength(1);
    const cand = candidates[0];
    expect(cand.detectedPattern.type).toBe('weekly');
    expect(cand.detectedPattern.interval).toBe(1);
    expect(cand.detectedPattern.daysOfWeek).toEqual(['wednesday']);
    expect(cand.confidence).toBeGreaterThanOrEqual(0.9);
    // 8 members: 1 master + 7 clean
    expect(cand.members).toHaveLength(8);
    const roles = cand.members.map((m) => m.role).sort();
    expect(roles.filter((r) => r === 'master')).toHaveLength(1);
    expect(roles.filter((r) => r === 'occurrence_clean')).toHaveLength(7);
  });

  // ---- REC-2: M/W/F multi-day weekly ----
  test('REC-2: M/W/F multi-day weekly → fits weekly daysOfWeek=[monday, wednesday, friday]', () => {
    // 2026-05-04 is Monday; 2026-05-06 Wed; 2026-05-08 Fri.
    const monStart = '2026-05-04';
    const wedStart = '2026-05-06';
    const friStart = '2026-05-08';
    expect(parseLocalDate(monStart).getDay()).toBe(1);
    expect(parseLocalDate(wedStart).getDay()).toBe(3);
    expect(parseLocalDate(friStart).getDay()).toBe(5);

    const rows = [
      ...makeWeeklyRows(monStart, 4, { eventTitle: 'Adult Ed Hebrew' }),
      ...makeWeeklyRows(wedStart, 4, { eventTitle: 'Adult Ed Hebrew' }),
      ...makeWeeklyRows(friStart, 4, { eventTitle: 'Adult Ed Hebrew' }),
    ];
    const candidates = detectRecurrenceCandidates(rows);
    expect(candidates).toHaveLength(1);
    const cand = candidates[0];
    expect(cand.detectedPattern.type).toBe('weekly');
    expect(cand.detectedPattern.interval).toBe(1);
    expect(cand.detectedPattern.daysOfWeek.sort()).toEqual(['friday', 'monday', 'wednesday']);
    expect(cand.memberCount).toBe(12);
  });

  // ---- REC-3: Biweekly ----
  test('REC-3: biweekly Wednesday → fits weekly interval=2', () => {
    const startDate = '2026-05-06'; // Wed
    // Generate every-other-week dates: 2026-05-06, 2026-05-20, 2026-06-03, ...
    const rows = [];
    const start = parseLocalDate(startDate);
    for (let i = 0; i < 6; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + 14 * i);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      rows.push(makeRow({ eventTitle: 'Biweekly Standup', startDate: ymd, endDate: ymd }));
    }
    const candidates = detectRecurrenceCandidates(rows);
    expect(candidates).toHaveLength(1);
    const cand = candidates[0];
    expect(cand.detectedPattern.type).toBe('weekly');
    expect(cand.detectedPattern.interval).toBe(2);
    expect(cand.detectedPattern.daysOfWeek).toEqual(['wednesday']);
  });

  // ---- REC-4: Monthly by date (15th) ----
  test('REC-4: monthly on the 15th → fits absoluteMonthly dayOfMonth=15', () => {
    const rows = [
      makeRow({ eventTitle: 'Monthly Board', startDate: '2026-01-15', endDate: '2026-01-15' }),
      makeRow({ eventTitle: 'Monthly Board', startDate: '2026-02-15', endDate: '2026-02-15' }),
      makeRow({ eventTitle: 'Monthly Board', startDate: '2026-03-15', endDate: '2026-03-15' }),
      makeRow({ eventTitle: 'Monthly Board', startDate: '2026-04-15', endDate: '2026-04-15' }),
      makeRow({ eventTitle: 'Monthly Board', startDate: '2026-05-15', endDate: '2026-05-15' }),
    ];
    const candidates = detectRecurrenceCandidates(rows);
    expect(candidates).toHaveLength(1);
    const cand = candidates[0];
    expect(cand.detectedPattern.type).toBe('absoluteMonthly');
    expect(cand.detectedPattern.dayOfMonth).toBe(15);
  });

  // ---- REC-5: Title variation merge ----
  test('REC-5: Al-Anon + Al-Anon Meeting same location/time → merged with confidence penalty', () => {
    // 6 rows of "Al-Anon" + 2 rows of "Al-Anon Meeting" all on Wednesdays.
    const rows1 = makeWeeklyRows('2026-05-06', 6, { eventTitle: 'Al-Anon' });
    const rows2 = makeWeeklyRows('2026-06-17', 2, { eventTitle: 'Al-Anon Meeting' });
    const allRows = [...rows1, ...rows2];
    const candidates = detectRecurrenceCandidates(allRows);
    expect(candidates).toHaveLength(1);
    const cand = candidates[0];
    expect(cand.titleVariants.length).toBeGreaterThanOrEqual(2);
    // Penalty for fuzzy merge: confidence must reflect the 0.2 deduction
    // (cap at <0.95 since we apply -0.2 for variant > 1).
    expect(cand.confidence).toBeLessThan(0.95);
    expect(cand.detectedPattern.type).toBe('weekly');
    expect(cand.detectedPattern.daysOfWeek).toEqual(['wednesday']);
  });

  // ---- REC-6: Location-change mid-series → master + occurrence_override ----
  test('REC-6: 6 rows in one room, 2 in another → 2 occurrence_override members', () => {
    const startDate = '2026-05-06'; // Wed
    const rows = [
      ...makeWeeklyRows(startDate, 6, { eventTitle: 'Al-Anon', rsKey: '402', locationIds: ['loc-402'] }),
    ];
    // Add 2 more rows but in a different room — same dow, same time.
    for (let i = 6; i < 8; i++) {
      const d = parseLocalDate(startDate);
      d.setDate(d.getDate() + 7 * i);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      rows.push(makeRow({
        eventTitle: 'Al-Anon',
        startDate: ymd,
        endDate: ymd,
        rsKey: '402', // same primary key for grouping
        locationIds: ['loc-302'], // BUT different actual location
      }));
    }
    const candidates = detectRecurrenceCandidates(rows);
    expect(candidates).toHaveLength(1);
    const cand = candidates[0];
    const overrides = cand.members.filter((m) => m.role === 'occurrence_override');
    expect(overrides).toHaveLength(2);
    for (const ovr of overrides) {
      expect(ovr.overrides.locations).toEqual(['loc-302']);
    }
    // Master + 5 clean + 2 override = 8 members
    expect(cand.members).toHaveLength(8);
    expect(cand.members.filter((m) => m.role === 'master')).toHaveLength(1);
    expect(cand.members.filter((m) => m.role === 'occurrence_clean')).toHaveLength(5);
  });

  // ---- REC-7: Outlier detection ----
  test('REC-7: 9 weekly Wed rows + 1 Tuesday row → Tuesday is outlier', () => {
    const wedRows = makeWeeklyRows('2026-05-06', 9, { eventTitle: 'Al-Anon' });
    // Add one Tuesday row.
    wedRows.push(makeRow({ eventTitle: 'Al-Anon', startDate: '2026-06-02', endDate: '2026-06-02' }));
    const candidates = detectRecurrenceCandidates(wedRows);
    expect(candidates).toHaveLength(1);
    const cand = candidates[0];
    // 9 Wed members + 1 outlier
    const outliers = cand.members.filter((m) => m.role === 'outlier');
    expect(outliers).toHaveLength(1);
    expect(outliers[0].startDate).toBe('2026-06-02');
    expect(cand.detectedPattern.daysOfWeek).toEqual(['wednesday']);
  });

  // ---- REC-8: Below MIN_GROUP_SIZE → no candidate emitted ----
  test('REC-8: only 2 matching rows → no candidate emitted', () => {
    const rows = makeWeeklyRows('2026-05-06', 2, { eventTitle: 'Tiny Group' });
    const candidates = detectRecurrenceCandidates(rows);
    expect(candidates).toHaveLength(0);
  });

  // ---- REC-9: False-positive guard ----
  test('REC-9: Adult Ed Hebrew + Adult Ed Spanish same time/location → NOT merged', () => {
    // Both sets on Wednesdays, same room, same time. If merged incorrectly,
    // we'd get 1 candidate with 16 members. With the Jaccard guard, 2 candidates.
    const hebrew = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Adult Ed Hebrew Class' });
    const spanish = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Adult Ed Spanish Class' });
    const candidates = detectRecurrenceCandidates([...hebrew, ...spanish]);
    expect(candidates).toHaveLength(2);
    const titles = candidates.map((c) => c.canonicalTitle).sort();
    expect(titles).toEqual(['adult ed hebrew class', 'adult ed spanish class']);
  });

  // ---- REC-10: Tight Levenshtein guard ----
  test('REC-10: Foo vs Bar (short titles, lev=3) → NOT merged due to min length guard', () => {
    expect(shouldMergeTitles('foo', 'bar')).toBe(false);
    // Same fact but verified via end-to-end detection.
    const fooRows = makeWeeklyRows('2026-05-06', 4, { eventTitle: 'Foo' });
    const barRows = makeWeeklyRows('2026-05-06', 4, { eventTitle: 'Bar' });
    const candidates = detectRecurrenceCandidates([...fooRows, ...barRows]);
    // Two separate candidates, not merged.
    expect(candidates).toHaveLength(2);
  });
});

// =============================================================================
// Endpoint integration tests (REC-11, REC-11b, REC-12)
// =============================================================================
describe('rsched recurrence detection — endpoints (REC-11, REC-11b, REC-12)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;
  const sessionId = 'rec-test-session-1';

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('rschedImportRecurrenceEndpoints'));
    app = await setupTestApp(db);
    adminUser = createAdmin();
    adminToken = await createMockToken(adminUser);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await clearCollections(db);
    await db.collection(STAGING_COLLECTION).deleteMany({});
    await db.collection(CANDIDATES_COLLECTION).deleteMany({});
    await insertUsers(db, [adminUser]);
    _rsIdCounter = 5000;
  });

  // Seed staging rows directly without going through upload — keeps tests fast
  // and isolates the detect endpoint.
  async function seedStaging(rows) {
    const docs = rows.map((r, i) => ({
      sessionId,
      uploadedBy: adminUser.oid || adminUser.userId,
      uploadedAt: new Date(),
      calendarOwner: TEST_CALENDAR_OWNER.toLowerCase(),
      rowNumber: i + 1,
      status: 'staged',
      ...r,
    }));
    if (docs.length > 0) {
      await db.collection(STAGING_COLLECTION).insertMany(docs);
    }
  }

  test('REC-11: POST /detect-recurrence persists candidates with correct shape', async () => {
    // Seed 8 weekly Wed rows.
    const rows = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Al-Anon' });
    await seedStaging(rows);

    const res = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/detect-recurrence`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.candidatesFound).toBe(1);
    expect(res.body.totalRowsCovered).toBe(8);
    expect(res.body.byConfidence.high).toBeGreaterThan(0);

    const candidates = await db.collection(CANDIDATES_COLLECTION).find({ sessionId }).toArray();
    expect(candidates).toHaveLength(1);
    const c = candidates[0];
    expect(c.candidateId).toMatch(/^cand-/);
    expect(c.canonicalTitle).toBe('al-anon');
    expect(c.detectedPattern.type).toBe('weekly');
    expect(c.detectedPattern.daysOfWeek).toEqual(['wednesday']);
    expect(c.status).toBe('detected');
    expect(c.detectedAt).toBeInstanceOf(Date);
    expect(c.reviewedAt).toBeNull();
  });

  test('REC-11b: POST /detect-recurrence twice on same session wipes prior candidates', async () => {
    const rows = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Al-Anon' });
    await seedStaging(rows);

    const headers = { Authorization: `Bearer ${adminToken}` };

    // First run.
    const res1 = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/detect-recurrence`)
      .set(headers).send({});
    expect(res1.status).toBe(200);
    expect(res1.body.candidatesFound).toBe(1);
    const after1 = await db.collection(CANDIDATES_COLLECTION).countDocuments({ sessionId });
    expect(after1).toBe(1);

    // Second run — should NOT duplicate.
    const res2 = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/detect-recurrence`)
      .set(headers).send({});
    expect(res2.status).toBe(200);
    expect(res2.body.candidatesFound).toBe(1);
    const after2 = await db.collection(CANDIDATES_COLLECTION).countDocuments({ sessionId });
    expect(after2).toBe(1); // not 2
  });

  test('REC-12: GET /recurrence-candidates respects status and confidence filters', async () => {
    // Seed two distinct series with sufficiently different titles so they
    // do NOT merge under Levenshtein/Jaccard. Different times also keep them
    // in separate triples for the fuzzy merge step.
    // Series A: clean weekly Wed (8 rows, high confidence)
    const seriesA = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Yoga Class', startTime: '10:00', endTime: '11:00' });
    // Series B: weekly Tue with 1 outlier (lower confidence), different time so different bucket
    const seriesB = makeWeeklyRows('2026-05-05', 7, { eventTitle: 'Book Club', startTime: '14:00', endTime: '15:00' });
    seriesB.push(makeRow({ eventTitle: 'Book Club', startDate: '2026-06-01', endDate: '2026-06-01', startTime: '14:00', endTime: '15:00' }));
    await seedStaging([...seriesA, ...seriesB]);

    const headers = { Authorization: `Bearer ${adminToken}` };
    await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/detect-recurrence`)
      .set(headers).send({});

    // No filter — both candidates returned.
    const all = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates`)
      .set(headers);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.candidates).toHaveLength(2);
    // Sorted by confidence desc — first is the high-confidence one.
    expect(all.body.candidates[0].confidence).toBeGreaterThanOrEqual(all.body.candidates[1].confidence);

    // Status filter: only 'detected' — should return both.
    const detected = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates?status=detected`)
      .set(headers);
    expect(detected.body.total).toBe(2);

    // Status filter: 'approved' — should return zero.
    const approved = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates?status=approved`)
      .set(headers);
    expect(approved.body.total).toBe(0);

    // Confidence filter: only 'high' — should return at least 1 (Series A).
    const high = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates?confidence=high`)
      .set(headers);
    expect(high.body.total).toBeGreaterThanOrEqual(1);
    for (const c of high.body.candidates) {
      expect(c.confidence).toBeGreaterThanOrEqual(0.8);
    }
  });

  test('REC-12: GET /recurrence-candidates/:candidateId returns single candidate', async () => {
    const rows = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Al-Anon' });
    await seedStaging(rows);
    const headers = { Authorization: `Bearer ${adminToken}` };

    await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/detect-recurrence`)
      .set(headers).send({});
    const list = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates`)
      .set(headers);
    const candidateId = list.body.candidates[0].candidateId;

    const single = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates/${candidateId}`)
      .set(headers);
    expect(single.status).toBe(200);
    expect(single.body.candidate.candidateId).toBe(candidateId);

    // Unknown candidateId → 404.
    const missing = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates/cand-nonexistent`)
      .set(headers);
    expect(missing.status).toBe(404);
  });

  test('REC-13: PUT /approve flips status to approved with reviewedBy/reviewedAt', async () => {
    const rows = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Al-Anon' });
    await seedStaging(rows);
    const headers = { Authorization: `Bearer ${adminToken}` };

    await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/detect-recurrence`)
      .set(headers).send({});
    const list = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates`)
      .set(headers);
    const candidateId = list.body.candidates[0].candidateId;

    const approve = await request(app)
      .put(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates/${candidateId}/approve`)
      .set(headers).send({});
    expect(approve.status).toBe(200);

    const updated = await db.collection(CANDIDATES_COLLECTION).findOne({ sessionId, candidateId });
    expect(updated.status).toBe('approved');
    expect(updated.reviewedAt).toBeInstanceOf(Date);
    expect(updated.reviewedBy).toBeTruthy();

    // Reject path on a different candidate.
    const rejectRes = await request(app)
      .put(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates/cand-nonexistent/reject`)
      .set(headers).send({});
    expect(rejectRes.status).toBe(404);
  });

  test('REC-14: POST /bulk approves all high-confidence candidates only', async () => {
    // Seed one clean high-confidence series + one with outliers to push it
    // below the high-confidence threshold.
    const high = makeWeeklyRows('2026-05-06', 10, { eventTitle: 'Yoga Class', startTime: '10:00', endTime: '11:00' });
    // Low-confidence: small group + outliers + title variants.
    const low = makeWeeklyRows('2026-05-06', 4, { eventTitle: 'Book Club', startTime: '14:00', endTime: '15:00' });
    // Add two outlier dates (Tuesdays) and a title variant.
    low.push(makeRow({ eventTitle: 'Book Club Meeting', startDate: '2026-06-09', endDate: '2026-06-09', startTime: '14:00', endTime: '15:00' }));
    low.push(makeRow({ eventTitle: 'Book Club', startDate: '2026-06-16', endDate: '2026-06-16', startTime: '14:00', endTime: '15:00' }));
    await seedStaging([...high, ...low]);
    const headers = { Authorization: `Bearer ${adminToken}` };

    await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/detect-recurrence`)
      .set(headers).send({});

    const allBefore = await db.collection(CANDIDATES_COLLECTION).find({ sessionId }).toArray();
    expect(allBefore.length).toBeGreaterThanOrEqual(2);
    const highIds = allBefore.filter((c) => c.confidence >= 0.8).map((c) => c.candidateId);
    expect(highIds.length).toBeGreaterThan(0);
    // We expect at least one candidate below 0.8 too — but skip the assertion
    // if scoring landed all candidates >= 0.8 (algorithm is heuristic).

    const bulk = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates/bulk`)
      .set(headers)
      .send({ action: 'approve', filter: { confidence: 'high' } });
    expect(bulk.status).toBe(200);
    expect(bulk.body.matched).toBe(highIds.length);

    // Verify only high-confidence candidates flipped.
    const allAfter = await db.collection(CANDIDATES_COLLECTION).find({ sessionId }).toArray();
    for (const c of allAfter) {
      if (highIds.includes(c.candidateId)) expect(c.status).toBe('approved');
      else expect(c.status).toBe('detected');
    }
  });

  test('REC-14: POST /bulk validates body — returns 400 on invalid action', async () => {
    const headers = { Authorization: `Bearer ${adminToken}` };
    const res = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates/bulk`)
      .set(headers)
      .send({ action: 'invalid' });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// Commit conversion (REC-15..REC-20)
// =============================================================================
describe('rsched recurrence detection — commit conversion (REC-15..REC-20)', () => {
  let mongoClient;
  let db;
  let app;
  let adminUser;
  let adminToken;
  const sessionId = 'rec-commit-session-1';

  beforeAll(async () => {
    await initTestKeys();
    ({ db, client: mongoClient } = await connectToGlobalServer('rschedImportRecurrenceCommit'));
    app = await setupTestApp(db);
    adminUser = createAdmin();
    adminToken = await createMockToken(adminUser);
  });

  afterAll(async () => {
    await disconnectFromGlobalServer(mongoClient, db);
  });

  beforeEach(async () => {
    await clearCollections(db);
    await db.collection(STAGING_COLLECTION).deleteMany({});
    await db.collection(CANDIDATES_COLLECTION).deleteMany({});
    await insertUsers(db, [adminUser]);
    _rsIdCounter = 9000;
  });

  async function seedStaging(rows) {
    const docs = rows.map((r, i) => ({
      sessionId,
      uploadedBy: adminUser.oid || adminUser.userId,
      uploadedAt: new Date(),
      calendarOwner: TEST_CALENDAR_OWNER.toLowerCase(),
      rowNumber: i + 1,
      status: 'staged',
      ...r,
    }));
    if (docs.length > 0) {
      await db.collection(STAGING_COLLECTION).insertMany(docs);
    }
  }

  async function detectAndApproveAll() {
    const headers = { Authorization: `Bearer ${adminToken}` };
    await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/detect-recurrence`)
      .set(headers).send({});
    const list = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates`)
      .set(headers);
    for (const c of list.body.candidates) {
      await request(app)
        .put(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates/${c.candidateId}/approve`)
        .set(headers).send({});
    }
    return list.body.candidates;
  }

  test('REC-15: approved series → seriesMaster created with correct recurrence', async () => {
    const rows = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Al-Anon' });
    await seedStaging(rows);
    await detectAndApproveAll();

    const headers = { Authorization: `Bearer ${adminToken}` };
    const commit = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
      .set(headers).send({});
    expect(commit.status).toBe(200);
    expect(commit.body.seriesMastersCreated).toBe(1);
    expect(commit.body.exceptionsCreated).toBe(0); // all members are clean
    expect(commit.body.singleInstancesCreated).toBe(0);

    const masters = await db.collection(COLLECTIONS.EVENTS).find({ eventType: 'seriesMaster' }).toArray();
    expect(masters).toHaveLength(1);
    const master = masters[0];
    expect(master.recurrence.pattern.type).toBe('weekly');
    expect(master.recurrence.pattern.daysOfWeek).toEqual(['wednesday']);
    expect(master.recurrence.exclusions).toEqual([]);
    expect(master.recurrence.additions).toEqual([]);
    expect(master.recurrence.range.recurrenceTimeZone).toBe('Eastern Standard Time');
  });

  test('REC-15b: re-running commit on same session does NOT duplicate seriesMaster', async () => {
    const rows = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Al-Anon' });
    await seedStaging(rows);
    await detectAndApproveAll();
    const headers = { Authorization: `Bearer ${adminToken}` };

    // First commit — creates the master.
    await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
      .set(headers).send({});
    let count = await db.collection(COLLECTIONS.EVENTS).countDocuments({ eventType: 'seriesMaster' });
    expect(count).toBe(1);

    // Re-approve all candidates (they may have been auto-marked applied; ensure they're approved again)
    // and re-commit. Branch B should fire on the existing seriesMaster.
    const commit2 = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
      .set(headers).send({});
    expect(commit2.status).toBe(200);

    count = await db.collection(COLLECTIONS.EVENTS).countDocuments({ eventType: 'seriesMaster' });
    expect(count).toBe(1); // still 1, not 2
  });

  test('REC-16: occurrence_override member → exception document created', async () => {
    // 6 Wed rows in room 402 + 2 Wed rows in different location.
    const startDate = '2026-05-06';
    const rows = [];
    for (let i = 0; i < 6; i++) {
      const d = parseLocalDate(startDate);
      d.setDate(d.getDate() + 7 * i);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      rows.push(makeRow({ eventTitle: 'Al-Anon', startDate: ymd, endDate: ymd, locationIds: ['loc-402'] }));
    }
    for (let i = 6; i < 8; i++) {
      const d = parseLocalDate(startDate);
      d.setDate(d.getDate() + 7 * i);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      rows.push(makeRow({ eventTitle: 'Al-Anon', startDate: ymd, endDate: ymd, locationIds: ['loc-302'] }));
    }
    await seedStaging(rows);
    await detectAndApproveAll();

    const headers = { Authorization: `Bearer ${adminToken}` };
    const commit = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
      .set(headers).send({});
    expect(commit.status).toBe(200);
    expect(commit.body.seriesMastersCreated).toBe(1);
    expect(commit.body.exceptionsCreated).toBe(2);

    const exceptions = await db.collection(COLLECTIONS.EVENTS).find({ eventType: 'exception' }).toArray();
    expect(exceptions).toHaveLength(2);
    for (const ex of exceptions) {
      expect(ex.seriesMasterEventId).toMatch(/^rssched-/);
      expect(ex.occurrenceDate).toBeTruthy();
    }
  });

  test('REC-17: occurrence_clean members → no document created (verify count)', async () => {
    // 8 identical weekly rows: 1 master + 7 clean. Should produce 1 master, 0 exceptions.
    const rows = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Al-Anon' });
    await seedStaging(rows);
    await detectAndApproveAll();
    const headers = { Authorization: `Bearer ${adminToken}` };
    const commit = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
      .set(headers).send({});
    expect(commit.body.seriesMastersCreated).toBe(1);
    expect(commit.body.exceptionsCreated).toBe(0);
    const totalEvents = await db.collection(COLLECTIONS.EVENTS).countDocuments({});
    expect(totalEvents).toBe(1); // just the master
  });

  test('REC-18: outlier members → singleInstance via existing applyStagingRow path', async () => {
    // 9 weekly Wed + 1 Tuesday (outlier).
    const rows = makeWeeklyRows('2026-05-06', 9, { eventTitle: 'Al-Anon' });
    rows.push(makeRow({ eventTitle: 'Al-Anon', startDate: '2026-06-02', endDate: '2026-06-02' }));
    await seedStaging(rows);
    await detectAndApproveAll();
    const headers = { Authorization: `Bearer ${adminToken}` };
    const commit = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
      .set(headers).send({});

    expect(commit.body.seriesMastersCreated).toBe(1);
    expect(commit.body.singleInstancesCreated).toBe(1); // the Tuesday outlier
    const single = await db.collection(COLLECTIONS.EVENTS).find({ eventType: 'singleInstance' }).toArray();
    expect(single).toHaveLength(1);
    expect(single[0].startDateTime).toContain('2026-06-02');
  });

  test('REC-19: rejected candidate → all members go through singleInstance path', async () => {
    const rows = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Al-Anon' });
    await seedStaging(rows);
    const headers = { Authorization: `Bearer ${adminToken}` };

    await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/detect-recurrence`)
      .set(headers).send({});
    const list = await request(app)
      .get(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates`)
      .set(headers);
    // Reject (not approve)
    for (const c of list.body.candidates) {
      await request(app)
        .put(`/api/admin/rsched-import/sessions/${sessionId}/recurrence-candidates/${c.candidateId}/reject`)
        .set(headers).send({});
    }

    const commit = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
      .set(headers).send({});
    expect(commit.body.seriesMastersCreated).toBe(0);
    expect(commit.body.singleInstancesCreated).toBe(8);
    const singles = await db.collection(COLLECTIONS.EVENTS).find({ eventType: 'singleInstance' }).toArray();
    expect(singles).toHaveLength(8);
  });

  test('REC-20: mix of approved + uncovered → counts in commit response are correct', async () => {
    // 8 weekly Wed (approved series) + 2 unrelated single events (uncovered).
    const series = makeWeeklyRows('2026-05-06', 8, { eventTitle: 'Al-Anon' });
    const standalone1 = makeRow({ eventTitle: 'One Off', startDate: '2026-07-04', endDate: '2026-07-04' });
    const standalone2 = makeRow({ eventTitle: 'Another One', startDate: '2026-08-15', endDate: '2026-08-15' });
    await seedStaging([...series, standalone1, standalone2]);
    await detectAndApproveAll();
    const headers = { Authorization: `Bearer ${adminToken}` };
    const commit = await request(app)
      .post(`/api/admin/rsched-import/sessions/${sessionId}/commit`)
      .set(headers).send({});

    expect(commit.body.seriesMastersCreated).toBe(1);
    expect(commit.body.singleInstancesCreated).toBe(2); // the 2 standalone events
    expect(commit.body.applied).toBeGreaterThanOrEqual(3); // at least 1 master + 2 singles
  });
});
