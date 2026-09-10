// backend/__tests__/unit/utils/schedulingScopePlan.test.js
//
// The pure half of schedule distribution: which days a send covers, which
// recipients are eligible, and whether the client's view of the sheet is still
// current. Kept separate from api-server.js so every rejection path can be
// tested WITHOUT a database or a mail service — the whole point being that an
// invalid request must be provably rejected before anything is delivered.
//
// Two rejections deserve their own note, because both are the difference
// between a bug and a silent mass-mailing:
//   - An EXPLICIT empty selection (`dayIds: []`, `recipients: []`) is a 400,
//     never "then send to everyone". `wholeSheet` on an empty workbook is a
//     different thing and stays legal.
//   - An unknown day id and a day belonging to somebody else's workbook are
//     the SAME 404 with the same message, so a caller cannot probe for the
//     existence of days outside the workbook they asked about.
//
// Test IDs: SP-1 to SP-17

const {
  planScope,
  checkDayVersions,
  normalizeRecipients,
} = require('../../../utils/schedulingScopePlan');

// Deliberately NOT in date order: the planner is responsible for ordering, so
// a fixture that is already sorted could not catch its absence.
const SHEET_DAYS = [
  { _id: 'day-kol-nidre', date: '2026-09-20', _version: 7 },
  { _id: 'day-erev-rh', date: '2026-09-11', _version: 3 },
  { _id: 'day-rh-two', date: '2026-09-13', _version: 1 },
];

const ok = (result) => {
  if (!result.ok) throw new Error(`expected a plan, got ${result.code}: ${result.message}`);
  return result.plan;
};

describe('planScope — day selection (SP-1 to SP-10)', () => {
  test('SP-1: selected days are ordered chronologically, not in the order supplied', () => {
    const plan = ok(planScope({ dayIds: ['day-kol-nidre', 'day-erev-rh'] }, SHEET_DAYS));
    expect(plan.dayIds).toEqual(['day-erev-rh', 'day-kol-nidre']);
    expect(plan.days.map((d) => d.date)).toEqual(['2026-09-11', '2026-09-20']);
  });

  test('SP-2: nonconsecutive days are kept exactly as chosen, without filling the gap', () => {
    const plan = ok(planScope({ dayIds: ['day-erev-rh', 'day-kol-nidre'] }, SHEET_DAYS));
    // 2026-09-13 sits between the two and was NOT selected.
    expect(plan.dayIds).not.toContain('day-rh-two');
    expect(plan.days).toHaveLength(2);
  });

  test('SP-3: an explicitly empty dayIds list is rejected and never means "all days"', () => {
    const result = planScope({ dayIds: [] }, SHEET_DAYS);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.code).toBe('EMPTY_SCOPE');
  });

  test('SP-4: duplicate day ids are rejected rather than silently de-duplicated', () => {
    const result = planScope({ dayIds: ['day-erev-rh', 'day-erev-rh'] }, SHEET_DAYS);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.code).toBe('DUPLICATE_DAYS');
  });

  test('SP-5: an unknown day id is a 404 that does not reveal another workbook', () => {
    const result = planScope({ dayIds: ['day-erev-rh', 'day-not-here'] }, SHEET_DAYS);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.code).toBe('DAY_NOT_FOUND');
    // The id is echoed (the caller sent it) but nothing about where it lives.
    expect(result.message).not.toMatch(/workbook|sheet|belongs|other/i);
  });

  test('SP-6: a foreign-workbook day is indistinguishable from an unknown one', () => {
    // The endpoint only ever passes days from the addressed workbook, so a day
    // that exists elsewhere arrives here exactly as an unknown id does. Pinned
    // so the two can never drift into distinguishable responses.
    //
    // Echoing back the id the CALLER supplied leaks nothing — they already know
    // it. What must not differ is anything else, so the two messages are
    // compared with each caller's own id factored out.
    const unknown = planScope({ dayIds: ['day-nonexistent'] }, SHEET_DAYS);
    const foreign = planScope({ dayIds: ['day-in-another-workbook'] }, SHEET_DAYS);
    expect(foreign.status).toBe(unknown.status);
    expect(foreign.code).toBe(unknown.code);
    expect(foreign.message.replace('day-in-another-workbook', '<id>'))
      .toBe(unknown.message.replace('day-nonexistent', '<id>'));
  });

  test('SP-7: mixing legacy and new scope fields is rejected instead of one winning', () => {
    const result = planScope({ dayIds: ['day-erev-rh'], wholeSheet: true }, SHEET_DAYS);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.code).toBe('MIXED_SCOPE');
  });

  test('SP-8: supplying no scope at all is rejected', () => {
    const result = planScope({}, SHEET_DAYS);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.code).toBe('MISSING_SCOPE');
  });

  test('SP-9: a non-array dayIds, or one holding a non-string, is rejected', () => {
    // A bare string has a .length and is iterable, so without an explicit array
    // check it would be read character by character.
    expect(planScope({ dayIds: 'day-erev-rh' }, SHEET_DAYS).code).toBe('INVALID_SCOPE');
    expect(planScope({ dayIds: [{ _id: 'day-erev-rh' }] }, SHEET_DAYS).code).toBe('INVALID_SCOPE');
    expect(planScope({ dayIds: [''] }, SHEET_DAYS).code).toBe('INVALID_SCOPE');
  });

  test('SP-10: ObjectId-like day ids match by string value', () => {
    const days = [{ _id: { toString: () => 'day-erev-rh' }, date: '2026-09-11', _version: 3 }];
    const plan = ok(planScope({ dayIds: ['day-erev-rh'] }, days));
    expect(plan.dayIds).toEqual(['day-erev-rh']);
  });
});

describe('planScope — legacy compatibility and grouping (SP-11 to SP-13)', () => {
  test('SP-11: a legacy single dayId produces the same one-day combined plan', () => {
    const plan = ok(planScope({ dayId: 'day-kol-nidre' }, SHEET_DAYS));
    expect(plan.dayIds).toEqual(['day-kol-nidre']);
    expect(plan.grouping).toBe('combined');
    expect(plan.legacy).toBe(true);
  });

  test('SP-12: legacy wholeSheet covers every day in order, and an empty workbook stays legal', () => {
    const plan = ok(planScope({ wholeSheet: true }, SHEET_DAYS));
    expect(plan.dayIds).toEqual(['day-erev-rh', 'day-rh-two', 'day-kol-nidre']);
    // Distinct from SP-3: this is not an explicit empty SELECTION, so it is not
    // the 400 that guards against an accidental send-to-everyone.
    expect(ok(planScope({ wholeSheet: true }, [])).dayIds).toEqual([]);
  });

  test('SP-17: wholeSheet stays sheet-scoped even when the workbook holds one day', () => {
    // Load-bearing distinction. The email subject names a SINGLE day by its own
    // date but anything wider by the workbook, and "wholeSheet on a one-day
    // workbook" must take the workbook name — a whole-sheet send is a statement
    // about the sheet, not about the day that happens to be its only one.
    // Collapsing the two broke SE-14, which sends wholeSheet at a one-day sheet.
    const oneDay = [{ _id: 'day-erev-rh', date: '2026-09-11', _version: 3 }];
    expect(ok(planScope({ wholeSheet: true }, oneDay)).scopeKind).toBe('sheet');
    expect(ok(planScope({ dayIds: ['day-erev-rh'] }, oneDay)).scopeKind).toBe('days');
    expect(ok(planScope({ dayId: 'day-erev-rh' }, oneDay)).scopeKind).toBe('days');
  });

  test('SP-13: grouping defaults to combined; perDay and nonsense are both refused', () => {
    expect(ok(planScope({ dayIds: ['day-erev-rh'] }, SHEET_DAYS)).groups)
      .toEqual([{ groupId: 'combined', dayIds: ['day-erev-rh'] }]);
    // perDay is specified but not implemented in this slice. Refusing it is the
    // honest outcome: silently sending one combined email to a client that
    // asked for one per day would be worse than an error.
    expect(planScope({ dayIds: ['day-erev-rh'], grouping: 'perDay' }, SHEET_DAYS).code)
      .toBe('UNSUPPORTED_GROUPING');
    expect(planScope({ dayIds: ['day-erev-rh'], grouping: 'weekly' }, SHEET_DAYS).code)
      .toBe('UNSUPPORTED_GROUPING');
  });
});

describe('checkDayVersions (SP-14)', () => {
  const planned = [
    { _id: 'day-erev-rh', _version: 3 },
    { _id: 'day-kol-nidre', _version: 7 },
  ];

  test('SP-14: a stale version is a 409 naming the day; an absent map stays legal for old clients', () => {
    expect(checkDayVersions(planned, { 'day-erev-rh': 3, 'day-kol-nidre': 7 }).ok).toBe(true);

    const stale = checkDayVersions(planned, { 'day-erev-rh': 3, 'day-kol-nidre': 6 });
    expect(stale.ok).toBe(false);
    expect(stale.status).toBe(409);
    expect(stale.code).toBe('STALE_SHEET');
    expect(stale.staleDayIds).toEqual(['day-kol-nidre']);

    // A legacy client sends no map at all and must not be blocked by one.
    expect(checkDayVersions(planned, undefined).ok).toBe(true);

    // But a new client that sends a PARTIAL map is a bug, not a legacy client.
    const partial = checkDayVersions(planned, { 'day-erev-rh': 3 });
    expect(partial.ok).toBe(false);
    expect(partial.status).toBe(400);
    expect(partial.code).toBe('INCOMPLETE_VERSIONS');
  });
});

describe('normalizeRecipients (SP-15 to SP-16)', () => {
  const eligible = ['Sarah.Levine@emanuelnyc.org', 'ben.ortiz@emanuelnyc.org'];

  test('SP-15: omitted means all eligible, but an explicit empty list is rejected', () => {
    expect(normalizeRecipients(undefined, eligible)).toEqual({ ok: true, emails: eligible });

    const empty = normalizeRecipients([], eligible);
    expect(empty.ok).toBe(false);
    expect(empty.status).toBe(400);
    expect(empty.code).toBe('EMPTY_RECIPIENTS');

    // Same hazard as SP-9: a bare string would otherwise be walked per character.
    expect(normalizeRecipients('sarah@x.org', eligible).code).toBe('INVALID_RECIPIENTS');
  });

  test('SP-16: an ineligible address is refused, and a case difference still resolves', () => {
    const bad = normalizeRecipients(['stranger@example.org'], eligible);
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(400);
    expect(bad.code).toBe('INELIGIBLE_RECIPIENT');

    // Chip emails are free text, so the caller may not reproduce the stored
    // casing. Match case-insensitively but hand back the ELIGIBLE spelling,
    // which is the key the assignment extractor grouped by.
    const matched = normalizeRecipients(['sarah.levine@EMANUELNYC.ORG'], eligible);
    expect(matched).toEqual({ ok: true, emails: ['Sarah.Levine@emanuelnyc.org'] });
  });
});
