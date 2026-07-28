/**
 * Unit tests for the pure reconcile decision layer.
 *
 * Everything safety-critical about reconcile is decided here: whether a delete
 * is justified, whether reality moved since the plan was made, and whether an
 * Outlook event that looks like a duplicate already exists. None of it needs a
 * database or a Graph client, so all of it is tested directly.
 */

const {
  PLAN_TTL_MS,
  FINDING_TYPE,
  ACTION,
  MATCH_TIER,
  classifyLinkMatch,
  ARCHIVE_REASON,
  normalizeSubject,
  findDuplicateCandidates,
  fingerprintOf,
  verifyExpectedState,
  buildPlan,
  isIrreversible,
} = require('../../../utils/syncReconcilePlan');

const NOW = new Date('2026-08-01T12:00:00Z');

// --- observation fixtures ---------------------------------------------------

const deletedDocObservation = (overrides = {}) => ({
  findingType: FINDING_TYPE.SHOULD_NOT_BE_IN_OUTLOOK,
  calendarOwner: 'templeevents@emanuelnyc.org',
  doc: null,
  justification: { kind: 'deletedDoc', mongoId: 'm1', _version: 4, isDeleted: true },
  outlookProbe: {
    found: true, graphId: 'zombie-1', subject: 'Cancelled Concert', date: '2026-08-14',
    type: 'singleInstance', seriesMasterId: null, attendeeCount: 0,
  },
  ...overrides,
});

const untetheredObservation = (overrides = {}) => ({
  findingType: FINDING_TYPE.UNTETHERED,
  calendarOwner: 'templeevents@emanuelnyc.org',
  doc: {
    mongoId: 'm9', _version: 2, status: 'published', isDeleted: false,
    eventType: 'singleInstance', eventTitle: 'WISE HALL CLOSED',
    graphDataId: null, graphEventId: null,
    date: '2026-08-14', startTime: '', endTime: '',
  },
  justification: null,
  outlookProbe: null,
  candidates: [],
  ...overrides,
});

describe('normalizeSubject', () => {
  // buildGraphSubject prefixes every timeless title with [Hold], and the whole
  // legacy untethered population is timeless. One side carrying the prefix must
  // not stop the two from matching.
  it('ignores the [Hold] prefix, case and whitespace', () => {
    expect(normalizeSubject('[Hold] WISE HALL CLOSED')).toBe('wise hall closed');
    expect(normalizeSubject('  wise   hall  closed ')).toBe('wise hall closed');
    expect(normalizeSubject('[hold] Wise Hall Closed')).toBe(normalizeSubject('WISE HALL CLOSED'));
  });

  it('is empty for nothing', () => {
    expect(normalizeSubject(null)).toBe('');
    expect(normalizeSubject('')).toBe('');
  });
});

describe('findDuplicateCandidates', () => {
  const doc = { eventTitle: 'WISE HALL CLOSED', startTime: '', endTime: '', date: '2026-08-14' };

  it('finds nothing when Outlook has nothing like it', () => {
    expect(findDuplicateCandidates(doc, [
      { graphId: 'a', subject: 'Board Meeting', date: '2026-08-14' },
      { graphId: 'b', subject: 'WISE HALL CLOSED', date: '2026-08-15' }, // wrong day
    ])).toEqual([]);
  });

  it('matches an untracked entry with the same name on the same date', () => {
    const hit = { graphId: 'dup-1', subject: '[Hold] WISE HALL CLOSED', date: '2026-08-14' };
    expect(findDuplicateCandidates(doc, [hit])).toEqual([hit]);
  });

  it('matches whether or not the stored subject carries the prefix', () => {
    const found = findDuplicateCandidates(doc, [
      { graphId: 'dup-1', subject: 'wise hall closed', date: '2026-08-14' },
      { graphId: 'dup-2', subject: '[Hold] WISE HALL CLOSED', date: '2026-08-14' },
    ]);
    expect(found.map(c => c.graphId)).toEqual(['dup-1', 'dup-2']);
  });

  it('finds nothing for a document with no date', () => {
    expect(findDuplicateCandidates({ ...doc, date: null }, [
      { graphId: 'x', subject: 'WISE HALL CLOSED', date: '2026-08-14' },
    ])).toEqual([]);
  });
});

describe('classifyLinkMatch', () => {
  const doc = { eventTitle: 'B/M Charlotte Duber', date: '2027-01-23', startTime: '17:00' };
  const candidate = (over = {}) => ({
    graphId: 'c1', subject: 'B/M Charlotte Duber', date: '2027-01-23', startTime: '17:00', ...over,
  });

  it('is confident when name, date and start time all agree', () => {
    const result = classifyLinkMatch(doc, [candidate()]);
    expect(result.tier).toBe(MATCH_TIER.CONFIDENT);
    expect(result.candidate.graphId).toBe('c1');
  });

  // The live data holds TWO separate app records titled 'Hold Streicker'.
  // Subject+date cannot tell them apart, and linking the wrong pair is silent.
  it('holds back when several Outlook entries share the name that day', () => {
    const result = classifyLinkMatch(doc, [candidate(), candidate({ graphId: 'c2' })]);
    expect(result.tier).toBe(MATCH_TIER.AMBIGUOUS);
    expect(result.candidate).toBeNull();
    expect(result.reason).toMatch(/2 entries/);
  });

  it('holds back when the times disagree', () => {
    const result = classifyLinkMatch(doc, [candidate({ startTime: '19:30' })]);
    expect(result.tier).toBe(MATCH_TIER.AMBIGUOUS);
    // ...but still names the candidate, so a human can accept it deliberately.
    expect(result.candidate.graphId).toBe('c1');
    expect(result.reason).toMatch(/17:00.*19:30/);
  });

  // A '[Hold]' placeholder has no times — that is what makes buildGraphSubject
  // prefix it — so name+date is all there is, which is not enough to automate.
  it('holds back when the app record has no start time', () => {
    const result = classifyLinkMatch({ ...doc, startTime: '' }, [candidate()]);
    expect(result.tier).toBe(MATCH_TIER.AMBIGUOUS);
    expect(result.reason).toMatch(/no start time/i);
  });

  it('holds back when the Outlook entry has no readable start time', () => {
    const result = classifyLinkMatch(doc, [candidate({ startTime: null })]);
    expect(result.tier).toBe(MATCH_TIER.AMBIGUOUS);
  });

  it('reports no match at all when Outlook has nothing', () => {
    const result = classifyLinkMatch(doc, []);
    expect(result.tier).toBe(MATCH_TIER.NONE);
    expect(result.candidate).toBeNull();
  });
});

describe('fingerprintOf', () => {
  it('survives a JSON round-trip unchanged', () => {
    const fp = fingerprintOf(untetheredObservation(), NOW);
    expect(JSON.parse(JSON.stringify(fp))).toEqual(fp);
  });

  it('stamps a soft expiry', () => {
    const fp = fingerprintOf(untetheredObservation(), NOW);
    expect(new Date(fp.expiresAt).getTime()).toBe(NOW.getTime() + PLAN_TTL_MS);
  });

  // Candidates are NOT fingerprinted: an unrelated Outlook event appearing on
  // the same day must not invalidate an archive. The duplicate guard is
  // enforced at apply instead.
  it('does not fingerprint duplicate candidates', () => {
    const withCandidates = untetheredObservation({
      candidates: [{ graphId: 'dup-1', subject: 'x', date: '2026-08-14' }],
    });
    expect(fingerprintOf(withCandidates, NOW)).toEqual(fingerprintOf(untetheredObservation(), NOW));
  });
});

describe('verifyExpectedState — drift detection', () => {
  const fpOf = (obs) => fingerprintOf(obs, NOW);
  const fieldsOf = (drifts) => drifts.map(d => d.field);

  it('finds no drift when nothing moved', () => {
    expect(verifyExpectedState(fpOf(untetheredObservation()), fpOf(untetheredObservation()), NOW))
      .toEqual([]);
  });

  it('catches a _version bump', () => {
    const observed = untetheredObservation();
    observed.doc._version = 3;
    const drifts = verifyExpectedState(fpOf(untetheredObservation()), fpOf(observed), NOW);
    expect(fieldsOf(drifts)).toContain('doc.version');
  });

  // The most important untethered drift: someone else already fixed it.
  it('catches a Graph link appearing', () => {
    const observed = untetheredObservation();
    observed.doc.graphDataId = 'AAMkNEW';
    const drifts = verifyExpectedState(fpOf(untetheredObservation()), fpOf(observed), NOW);
    expect(fieldsOf(drifts)).toContain('doc.graphDataId');
    expect(drifts.find(d => d.field === 'doc.graphDataId').message).toMatch(/now linked/i);
  });

  it('catches the record being restored', () => {
    const expected = deletedDocObservation();
    const observed = deletedDocObservation();
    observed.justification.isDeleted = false;
    const drifts = verifyExpectedState(fpOf(expected), fpOf(observed), NOW);
    expect(fieldsOf(drifts)).toContain('justification.isDeleted');
  });

  it('catches an exclusion being removed', () => {
    const exclusion = (present) => deletedDocObservation({
      justification: {
        kind: 'exclusion', mongoId: 'master-1', _version: 7,
        exclusionDate: '2026-08-14', exclusionDatePresent: present,
      },
    });
    const drifts = verifyExpectedState(fpOf(exclusion(true)), fpOf(exclusion(false)), NOW);
    expect(fieldsOf(drifts)).toContain('justification.exclusionDatePresent');
  });

  it('catches the Outlook entry disappearing', () => {
    const observed = deletedDocObservation();
    observed.outlookProbe = { found: false, graphId: null, subject: null, type: null, seriesMasterId: null };
    const drifts = verifyExpectedState(fpOf(deletedDocObservation()), fpOf(observed), NOW);
    expect(fieldsOf(drifts)).toContain('outlook.found');
  });

  it('catches the Outlook entry being renamed', () => {
    const observed = deletedDocObservation();
    observed.outlookProbe.subject = 'Something Else Entirely';
    const drifts = verifyExpectedState(fpOf(deletedDocObservation()), fpOf(observed), NOW);
    expect(fieldsOf(drifts)).toContain('outlook.subject');
  });

  // Deleting a master destroys every occurrence, so this drift is fatal even
  // though the id is unchanged.
  it('catches the target becoming a series master', () => {
    const observed = deletedDocObservation();
    observed.outlookProbe.type = 'seriesMaster';
    const drifts = verifyExpectedState(fpOf(deletedDocObservation()), fpOf(observed), NOW);
    const hit = drifts.find(d => d.field === 'outlook.type');
    expect(hit).toBeDefined();
    expect(hit.message).toMatch(/whole recurring series/i);
  });

  it('catches the app record vanishing entirely', () => {
    const observed = untetheredObservation({ doc: null });
    const drifts = verifyExpectedState(fpOf(untetheredObservation()), fpOf(observed), NOW);
    expect(fieldsOf(drifts)).toContain('doc');
  });

  it('treats an expired plan as drift', () => {
    const expected = fpOf(untetheredObservation());
    const later = new Date(NOW.getTime() + PLAN_TTL_MS + 1000);
    const drifts = verifyExpectedState(expected, fpOf(untetheredObservation()), later);
    expect(fieldsOf(drifts)).toContain('expiresAt');
  });

  it('rejects a missing expectedState outright', () => {
    expect(verifyExpectedState(undefined, fpOf(untetheredObservation()), NOW)).toHaveLength(1);
  });
});

describe('buildPlan — shouldNotBeInOutlook / delete', () => {
  const plan = (obs) => buildPlan(FINDING_TYPE.SHOULD_NOT_BE_IN_OUTLOOK, ACTION.DELETE_OUTLOOK, obs);

  it('plans one irreversible Graph delete', () => {
    const result = plan(deletedDocObservation());
    expect(result.abort).toBe(false);
    expect(result.ops).toHaveLength(1);
    expect(result.ops[0]).toMatchObject({ op: 'graphDelete', graphId: 'zombie-1', irreversible: true });
    expect(isIrreversible(result)).toBe(true);
  });

  // The Outlook item existing is not a reason to delete it — the app has to
  // still say it should be gone.
  it('refuses when the app record was restored', () => {
    const result = plan(deletedDocObservation({
      justification: { kind: 'deletedDoc', mongoId: 'm1', _version: 4, isDeleted: false },
    }));
    expect(result.abort).toBe(true);
    expect(result.code).toBe('NO_JUSTIFICATION');
    expect(result.ops).toEqual([]);
  });

  it('refuses when the excluded date is no longer excluded', () => {
    const result = plan(deletedDocObservation({
      justification: {
        kind: 'exclusion', mongoId: 'master-1', _version: 7,
        exclusionDate: '2026-08-14', exclusionDatePresent: false,
      },
    }));
    expect(result.code).toBe('NO_JUSTIFICATION');
  });

  it('refuses with no justification at all', () => {
    const result = plan(deletedDocObservation({ justification: null }));
    expect(result.code).toBe('NO_JUSTIFICATION');
  });

  it('refuses to delete a series master id', () => {
    const obs = deletedDocObservation();
    obs.outlookProbe.type = 'seriesMaster';
    const result = plan(obs);
    expect(result.code).toBe('SERIES_MASTER_TARGET');
    expect(result.ops).toEqual([]);
  });

  it('reports nothing to do when the entry is already gone', () => {
    const obs = deletedDocObservation();
    obs.outlookProbe.found = false;
    expect(plan(obs).code).toBe('ALREADY_RESOLVED');
  });

  it('warns that attendees will be sent a cancellation', () => {
    const obs = deletedDocObservation();
    obs.outlookProbe.attendeeCount = 3;
    const result = plan(obs);
    expect(result.warnings.join(' ')).toMatch(/3 attendee\(s\).*cancellation/i);
  });
});

describe('buildPlan — untethered / archive', () => {
  const plan = (obs) => buildPlan(FINDING_TYPE.UNTETHERED, ACTION.ARCHIVE, obs);

  it('plans a reversible, Mongo-only archive', () => {
    const result = plan(untetheredObservation());
    expect(result.abort).toBe(false);
    expect(result.ops).toEqual([expect.objectContaining({ op: 'mongoArchive', reason: ARCHIVE_REASON })]);
    expect(isIrreversible(result)).toBe(false);
  });

  it('is a no-op when the record is already archived', () => {
    const obs = untetheredObservation();
    obs.doc.isDeleted = true;
    expect(plan(obs).code).toBe('ALREADY_RESOLVED');
  });
});

describe('buildPlan — untethered / link to existing', () => {
  const candidate = { graphId: 'dup-1', subject: '[Hold] WISE HALL CLOSED', date: '2026-08-14' };
  const plan = (obs) => buildPlan(FINDING_TYPE.UNTETHERED, ACTION.LINK_EXISTING, obs);

  it('plans a Mongo-only link to a probed candidate', () => {
    const result = plan(untetheredObservation({ candidates: [candidate], linkTargetGraphId: 'dup-1' }));
    expect(result.abort).toBe(false);
    expect(result.ops).toEqual([expect.objectContaining({ op: 'mongoLink', graphId: 'dup-1' })]);
    // Nothing may touch Outlook on this path.
    expect(result.ops.some(o => o.op.startsWith('graph'))).toBe(false);
  });

  it('refuses an id that was not among the probed candidates', () => {
    const result = plan(untetheredObservation({ candidates: [candidate], linkTargetGraphId: 'typed-by-hand' }));
    expect(result.code).toBe('UNKNOWN_CANDIDATE');
  });

  it('refuses without a chosen target', () => {
    expect(plan(untetheredObservation({ candidates: [candidate] })).code).toBe('NO_LINK_TARGET');
  });

  it('is a no-op when already linked to that id', () => {
    const obs = untetheredObservation({ candidates: [candidate], linkTargetGraphId: 'dup-1' });
    obs.doc.graphDataId = 'dup-1';
    expect(plan(obs).code).toBe('ALREADY_RESOLVED');
  });

  it('refuses when the record is already linked elsewhere', () => {
    const obs = untetheredObservation({ candidates: [candidate], linkTargetGraphId: 'dup-1' });
    obs.doc.graphDataId = 'SOMETHING-ELSE';
    expect(plan(obs).code).toBe('ALREADY_LINKED');
  });
});

describe('buildPlan — untethered / publish', () => {
  const plan = (obs) => buildPlan(FINDING_TYPE.UNTETHERED, ACTION.PUBLISH, obs);

  it('plans create-then-link, in that order', () => {
    const result = plan(untetheredObservation());
    expect(result.abort).toBe(false);
    // Graph create BEFORE the Mongo link persist — a crash then leaves a
    // recoverable orphan, not a record pointing at nothing.
    expect(result.ops.map(o => o.op)).toEqual(['graphCreate', 'mongoLink']);
    expect(result.requiresAllowDuplicate).toBe(false);
  });

  // v1 refusal: creating a master without syncing its exclusions and child
  // documents would immediately manufacture new shouldNotBeInOutlook findings.
  it('refuses a series master', () => {
    const obs = untetheredObservation();
    obs.doc.eventType = 'seriesMaster';
    const result = plan(obs);
    expect(result.code).toBe('SERIES_NOT_SUPPORTED');
    expect(result.reason).toMatch(/not supported yet/i);
    expect(result.ops).toEqual([]);
  });

  it('refuses a record that is already linked', () => {
    const obs = untetheredObservation();
    obs.doc.graphDataId = 'AAMkEXISTING';
    expect(plan(obs).code).toBe('ALREADY_RESOLVED');
  });

  it('refuses a record that is not published', () => {
    const obs = untetheredObservation();
    obs.doc.status = 'draft';
    expect(plan(obs).code).toBe('NOT_PUBLISHED');
  });

  // Without this, buildGraphEventDataFromRecord emits
  // `start: { dateTime: undefined }` and Graph rejects the create — a failure
  // an admin cannot interpret. Archive is the only real option for such a record.
  it('refuses a record with no date and says archiving is the option', () => {
    const obs = untetheredObservation();
    obs.doc.date = null;
    const result = plan(obs);
    expect(result.code).toBe('NO_DATE');
    expect(result.reason).toMatch(/archiv/i);
    expect(result.ops).toEqual([]);
  });

  // Archive must remain available for exactly those records.
  it('still allows archiving a dateless record', () => {
    const obs = untetheredObservation();
    obs.doc.date = null;
    expect(buildPlan(FINDING_TYPE.UNTETHERED, ACTION.ARCHIVE, obs).abort).toBe(false);
  });

  // The specific guard against re-pushing 'Hold Streicker' onto a calendar
  // that already shows it.
  it('flips the recommendation to link when a duplicate candidate exists', () => {
    const result = plan(untetheredObservation({
      candidates: [{ graphId: 'dup-1', subject: '[Hold] WISE HALL CLOSED', date: '2026-08-14' }],
    }));
    expect(result.recommendation).toBe(ACTION.LINK_EXISTING);
    expect(result.requiresAllowDuplicate).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/already has 1 entry/i);
  });
});

describe('buildPlan — unknown inputs', () => {
  it('refuses a finding type with no actions', () => {
    expect(buildPlan('untracked', ACTION.ARCHIVE, {}).code).toBe('UNKNOWN_FINDING_TYPE');
  });

  it('refuses an action the finding type does not offer', () => {
    const result = buildPlan(FINDING_TYPE.SHOULD_NOT_BE_IN_OUTLOOK, ACTION.PUBLISH, {});
    expect(result.code).toBe('UNKNOWN_ACTION');
    expect(result.reason).toMatch(/deleteOutlook/);
  });
});
