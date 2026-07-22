import { describe, it, expect } from 'vitest';
import { prepareEventsForAgenda } from '../../../utils/agendaEventPipeline';

// Weekly Tuesdays 2026-03-10 .. 2026-06-30, 10:00-11:00.
// 2026-06-16 / 2026-06-23 are Tuesdays.
function makeMaster(overrides = {}) {
  return {
    _id: 'master-oid-1',
    eventId: 'master-1',
    eventType: 'seriesMaster',
    status: 'published',
    eventTitle: 'Intro to Judaism',
    startDateTime: '2026-03-10T10:00:00',
    endDateTime: '2026-03-10T11:00:00',
    recurrence: {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
      range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
      additions: [],
      exclusions: [],
    },
    calendarData: {
      eventTitle: 'Intro to Judaism',
      startDateTime: '2026-03-10T10:00:00',
      endDateTime: '2026-03-10T11:00:00',
      locationDisplayNames: ['Room 402 - Leventritt', 'Library'],
    },
    locationDisplayNames: ['Room 402 - Leventritt', 'Library'],
    ...overrides,
  };
}

function makeExceptionChild(overrides = {}) {
  return {
    _id: 'child-oid-1',
    eventId: 'master-1-2026-06-16',
    eventType: 'exception',
    seriesMasterEventId: 'master-1',
    occurrenceDate: '2026-06-16',
    status: 'published',
    eventTitle: 'Intro to Judaism',
    startDateTime: '2026-06-16T10:00:00',
    endDateTime: '2026-06-16T11:00:00',
    locationDisplayNames: ['Room 402 - Leventritt'],
    calendarData: {
      eventTitle: 'Intro to Judaism',
      startDateTime: '2026-06-16T10:00:00',
      endDateTime: '2026-06-16T11:00:00',
      locationDisplayNames: ['Room 402 - Leventritt'],
    },
    ...overrides,
  };
}

const RANGE_START = new Date(2026, 5, 14); // 2026-06-14 local
const RANGE_END = new Date(2026, 5, 27, 23, 59, 59); // 2026-06-27 local

describe('prepareEventsForAgenda', () => {
  it('expands a master into occurrence rows and removes the master itself', () => {
    const out = prepareEventsForAgenda([makeMaster()], RANGE_START, RANGE_END);
    expect(out.some(e => e.eventType === 'seriesMaster')).toBe(false);
    const dates = out.map(e => e.startDate).sort();
    expect(dates).toEqual(['2026-06-16', '2026-06-23']);
    expect(out[0].eventType).toBe('occurrence');
    expect(out[0].isRecurringOccurrence).toBe(true);
  });

  it('gives every occurrence row a unique eventId (list keys and append-dedupe rely on it)', () => {
    const out = prepareEventsForAgenda([makeMaster()], RANGE_START, RANGE_END);
    const ids = out.map(e => e.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('master-1-occurrence-2026-06-16');
  });

  it('renders a customized date exactly once — the child doc, not a master expansion (the phone duplicate bug)', () => {
    const out = prepareEventsForAgenda([makeMaster(), makeExceptionChild()], RANGE_START, RANGE_END);
    const june16 = out.filter(e => (e.startDate || e.occurrenceDate) === '2026-06-16'
      || e.startDateTime?.startsWith('2026-06-16'));
    expect(june16).toHaveLength(1);
    expect(june16[0].eventType).toBe('exception');
    expect(june16[0].hasOccurrenceOverride).toBe(true);
    expect(june16[0].masterEventId).toBe('master-1');
    // The child's own room list wins — no second card with the master's rooms.
    expect(june16[0].locationDisplayNames).toEqual(['Room 402 - Leventritt']);
  });

  it('drops stored Graph occurrence records (they are regenerated from the master)', () => {
    const graphOccurrence = {
      eventId: 'graph-occ-1',
      eventType: 'occurrence',
      seriesMasterId: 'master-1',
      startDateTime: '2026-06-16T10:00:00',
    };
    const out = prepareEventsForAgenda([makeMaster(), graphOccurrence], RANGE_START, RANGE_END);
    expect(out.some(e => e.eventId === 'graph-occ-1')).toBe(false);
  });

  it('passes standalone events through untouched', () => {
    const single = { eventId: 'single-1', eventType: 'singleInstance', status: 'published', startDateTime: '2026-06-17T09:00:00' };
    const out = prepareEventsForAgenda([single], RANGE_START, RANGE_END);
    expect(out).toContain(single);
  });

  it('keeps a corrupt master (no recurrence) as a plain event instead of dropping it', () => {
    const stale = makeMaster({ eventId: 'master-stale', recurrence: null });
    const out = prepareEventsForAgenda([stale], RANGE_START, RANGE_END);
    expect(out.some(e => e.eventId === 'master-stale')).toBe(true);
  });
});
