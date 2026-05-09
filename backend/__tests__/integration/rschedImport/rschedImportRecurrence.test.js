/**
 * Resource Scheduler Recurrence Detection Tests (REC-1 through REC-22).
 *
 * Algorithm tests (REC-1 to REC-10) are pure unit tests against the
 * detection module — no DB needed.
 *
 * Endpoint + commit conversion + Graph publish tests (REC-11 onward) are
 * filled in across commits 3, 4, 5, 6.
 */

const detection = require('../../../services/rschedRecurrenceDetection');

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
// Test data builders
// ---------------------------------------------------------------------------

let _rsIdCounter = 1000;
function nextRsId() {
  return _rsIdCounter++;
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
