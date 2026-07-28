import { describe, it, expect } from 'vitest';
import {
  groupFindingsByEvent,
  reconcile,
  countEventsNeedingAttention,
  APP_FINDING,
  OUTLOOK_FINDING,
} from '../../../utils/syncHealthGrouping';

describe('syncHealthGrouping — groupFindingsByEvent', () => {
  // The whole point: a broken weekly series is ONE problem, not N.
  it('collapses many dated instances of one event into a single group', () => {
    const rows = ['2026-07-01', '2026-07-02', '2026-07-08', '2026-07-09'].map((date) => ({
      mongoId: 'm1', eventTitle: 'NS Pick Up', eventType: 'seriesMaster', date,
    }));

    const groups = groupFindingsByEvent(rows, APP_FINDING);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('NS Pick Up');
    expect(groups[0].count).toBe(4);
    expect(groups[0].dates).toEqual(['2026-07-01', '2026-07-02', '2026-07-08', '2026-07-09']);
  });

  it('keeps separate events separate', () => {
    const groups = groupFindingsByEvent([
      { mongoId: 'm1', eventTitle: 'NS Pick Up', date: '2026-07-01' },
      { mongoId: 'm2', eventTitle: 'YMC Committee Meeting', date: '2026-11-02' },
    ], APP_FINDING);

    expect(groups).toHaveLength(2);
  });

  // Two different events can share a title; mongoId is the identity.
  it('does not merge different events that share a title', () => {
    const groups = groupFindingsByEvent([
      { mongoId: 'm1', eventTitle: 'Staff Meeting', date: '2026-07-01' },
      { mongoId: 'm2', eventTitle: 'Staff Meeting', date: '2026-07-02' },
    ], APP_FINDING);

    expect(groups).toHaveLength(2);
  });

  it('sorts by date count descending, then title', () => {
    const groups = groupFindingsByEvent([
      { mongoId: 'a', eventTitle: 'Zebra', date: '2026-07-01' },
      { mongoId: 'b', eventTitle: 'Alpha', date: '2026-07-01' },
      { mongoId: 'c', eventTitle: 'Big Break', date: '2026-07-01' },
      { mongoId: 'c', eventTitle: 'Big Break', date: '2026-07-02' },
    ], APP_FINDING);

    expect(groups.map((g) => g.title)).toEqual(['Big Break', 'Alpha', 'Zebra']);
  });

  it('deduplicates repeated dates for the same event', () => {
    const groups = groupFindingsByEvent([
      { mongoId: 'm1', eventTitle: 'Dup', date: '2026-07-01' },
      { mongoId: 'm1', eventTitle: 'Dup', date: '2026-07-01' },
    ], APP_FINDING);

    expect(groups[0].count).toBe(1);
    expect(groups[0].dates).toEqual(['2026-07-01']);
  });

  // An untethered series has no single date; it must still count as one problem.
  it('counts an undated finding as one', () => {
    const groups = groupFindingsByEvent([
      { mongoId: 'm1', eventTitle: 'Orphan Series', eventType: 'seriesMaster' },
    ], APP_FINDING);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
    expect(groups[0].dates).toEqual([]);
  });

  // Outlook-side rows have no mongoId; each date is its own graphId, so the
  // subject is what collapses a repeating Outlook event.
  it('groups Outlook-only rows by subject', () => {
    const rows = ['2026-06-25', '2026-06-26', '2026-06-27'].map((date, i) => ({
      graphId: `g${i}`, subject: '[Hold] WISE HALL CLOSED', date,
    }));

    const groups = groupFindingsByEvent(rows, OUTLOOK_FINDING);

    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('[Hold] WISE HALL CLOSED');
    expect(groups[0].count).toBe(3);
  });

  it('tolerates empty and missing input', () => {
    expect(groupFindingsByEvent([], APP_FINDING)).toEqual([]);
    expect(groupFindingsByEvent(undefined, APP_FINDING)).toEqual([]);
  });
});

describe('syncHealthGrouping — reconcile', () => {
  // n undated Outlook-only rows, enough to stand in for a real untracked array.
  const untracked = (n) =>
    Array.from({ length: n }, (_, i) => ({ graphId: `g${i}`, subject: 'Stray', date: '2026-07-01' }));

  // The live templeevents numbers: 119 unmatched Outlook instances, all of them
  // genuinely unmanaged.
  it('splits the counts into agreement and the two disagreements', () => {
    expect(reconcile({
      counts: { appExpected: 1384, outlookFound: 1444, matched: 1325 },
      untracked: untracked(119),
    })).toEqual({ appOnly: 59, matched: 1325, outlookOnly: 119, total: 1503 });
  });

  it('reports no disagreement when both sides agree', () => {
    expect(reconcile({
      counts: { appExpected: 10, outlookFound: 10, matched: 10 },
      untracked: [],
    })).toEqual({ appOnly: 0, matched: 10, outlookOnly: 0, total: 10 });
  });

  // THE FIX: unmatched Outlook instances split two ways. A failed deletion is a
  // problem listed under shouldNotBeInOutlook, and must not be summarized as an
  // event the app does not manage. Arithmetic (outlookFound - matched) would
  // say 3 here; the array says 2.
  it('excludes failed deletions from the Outlook-only segment', () => {
    expect(reconcile({
      counts: { appExpected: 5, outlookFound: 8, matched: 5 },
      shouldNotBeInOutlook: [{ graphId: 'zombie', subject: 'Cancelled', date: '2026-07-01' }],
      untracked: untracked(2),
    }).outlookOnly).toBe(2);
  });

  // A calendar whose Graph call failed reports zeroes; it must not go negative.
  it('never returns a negative segment', () => {
    expect(reconcile({
      counts: { appExpected: 4, outlookFound: 0, matched: 0 },
      untracked: [],
    })).toEqual({ appOnly: 4, matched: 0, outlookOnly: 0, total: 4 });
  });

  it('tolerates a missing calendar object', () => {
    expect(reconcile()).toEqual({ appOnly: 0, matched: 0, outlookOnly: 0, total: 0 });
  });
});

describe('syncHealthGrouping — countEventsNeedingAttention', () => {
  it('counts distinct events across the actionable sections', () => {
    const calendar = {
      untethered: [{ mongoId: 'a', eventTitle: 'A' }],
      missingFromOutlook: [
        { mongoId: 'b', eventTitle: 'B', date: '2026-07-01' },
        { mongoId: 'b', eventTitle: 'B', date: '2026-07-02' },
      ],
      shouldNotBeInOutlook: [{ graphId: 'g1', subject: 'C', date: '2026-07-03' }],
      untracked: [{ graphId: 'g2', subject: 'D', date: '2026-07-04' }],
    };

    // A + B (once, not twice) + C = 3. D is informational and excluded.
    expect(countEventsNeedingAttention(calendar)).toBe(3);
  });

  it('is zero for a clean calendar even with Outlook-only events', () => {
    expect(countEventsNeedingAttention({
      untethered: [], missingFromOutlook: [], shouldNotBeInOutlook: [],
      untracked: [{ graphId: 'g', subject: 'Booked in Outlook', date: '2026-07-01' }],
    })).toBe(0);
  });
});
