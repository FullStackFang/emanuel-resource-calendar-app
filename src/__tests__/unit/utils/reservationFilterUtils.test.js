/**
 * Tests for reservationFilterUtils.js
 *
 * Covers the [Hold] prefix search fix: the search filter must match against
 * the display-decorated title (with [Hold] prefix for hold events), not just
 * the raw eventTitle.
 */

import { describe, it, expect } from 'vitest';
import { filterBySearchAndDate, sortReservations } from '../../../utils/reservationFilterUtils';

// --- Test data factories ---

function makeEvent(overrides = {}) {
  return {
    eventTitle: 'Board Meeting',
    requesterName: 'Jane Doe',
    roomReservationData: { requestedBy: { name: 'Jane Doe' } },
    locationDisplayNames: 'Chapel',
    eventDescription: 'Quarterly board meeting',
    startDate: '2026-04-19',
    isHold: false,
    ...overrides,
  };
}

function makeHoldEvent(overrides = {}) {
  return makeEvent({ isHold: true, eventTitle: 'Test 4/19 #14', ...overrides });
}

// --- filterBySearchAndDate ---

describe('filterBySearchAndDate', () => {
  describe('[Hold] prefix search', () => {
    const holdEvent = makeHoldEvent();
    const normalEvent = makeEvent();
    const items = [holdEvent, normalEvent];

    it('finds hold event by raw title (without [Hold])', () => {
      const result = filterBySearchAndDate(items, { searchTerm: 'Test 4/19' });
      expect(result).toEqual([holdEvent]);
    });

    it('finds hold event by display title (with [Hold] prefix)', () => {
      const result = filterBySearchAndDate(items, { searchTerm: '[Hold] Test 4/19' });
      expect(result).toEqual([holdEvent]);
    });

    it('finds all hold events when searching bare [Hold]', () => {
      const hold1 = makeHoldEvent({ eventTitle: 'Event A' });
      const hold2 = makeHoldEvent({ eventTitle: 'Event B' });
      const normal = makeEvent({ eventTitle: 'Event C' });
      const result = filterBySearchAndDate([hold1, hold2, normal], { searchTerm: '[Hold]' });
      expect(result).toEqual([hold1, hold2]);
    });

    it('is case-insensitive for [hold] prefix', () => {
      const result = filterBySearchAndDate(items, { searchTerm: '[hold] test 4/19' });
      expect(result).toEqual([holdEvent]);
    });

    it('matches partial prefix like "Hold" without brackets', () => {
      const result = filterBySearchAndDate([holdEvent, normalEvent], { searchTerm: 'Hold' });
      // "Hold" is a substring of "[Hold] Test 4/19 #14"
      expect(result).toContain(holdEvent);
    });

    it('does not double-prefix when eventTitle already starts with [Hold]', () => {
      const preDecorated = makeHoldEvent({ eventTitle: '[Hold] Already Prefixed' });
      const result = filterBySearchAndDate([preDecorated], { searchTerm: '[Hold] Already' });
      expect(result).toEqual([preDecorated]);
    });

    it('does not match non-hold events for [Hold] search', () => {
      const result = filterBySearchAndDate([normalEvent], { searchTerm: '[Hold]' });
      expect(result).toEqual([]);
    });
  });

  describe('other field matching', () => {
    const event = makeEvent();

    it('matches by requesterName', () => {
      const result = filterBySearchAndDate([event], { searchTerm: 'Jane' });
      expect(result).toEqual([event]);
    });

    it('matches by roomReservationData.requestedBy.name', () => {
      const e = makeEvent({ requesterName: '', roomReservationData: { requestedBy: { name: 'John Smith' } } });
      const result = filterBySearchAndDate([e], { searchTerm: 'John' });
      expect(result).toEqual([e]);
    });

    it('matches by locationDisplayNames', () => {
      const result = filterBySearchAndDate([event], { searchTerm: 'Chapel' });
      expect(result).toEqual([event]);
    });

    it('matches by eventDescription', () => {
      const result = filterBySearchAndDate([event], { searchTerm: 'quarterly' });
      expect(result).toEqual([event]);
    });
  });

  describe('search term trimming', () => {
    it('trims leading whitespace from search term', () => {
      const event = makeEvent();
      const result = filterBySearchAndDate([event], { searchTerm: '  Board' });
      expect(result).toEqual([event]);
    });

    it('trims trailing whitespace from search term', () => {
      const event = makeEvent();
      const result = filterBySearchAndDate([event], { searchTerm: 'Board  ' });
      expect(result).toEqual([event]);
    });

    it('handles search term that is only whitespace', () => {
      const event = makeEvent();
      const result = filterBySearchAndDate([event], { searchTerm: '   ' });
      // Empty after trim → no filter applied → returns all
      expect(result).toEqual([event]);
    });
  });

  describe('date filtering', () => {
    const earlyEvent = makeEvent({ startDate: '2026-04-10' });
    const midEvent = makeEvent({ startDate: '2026-04-15' });
    const lateEvent = makeEvent({ startDate: '2026-04-20' });
    const items = [earlyEvent, midEvent, lateEvent];

    it('filters by dateFrom (inclusive)', () => {
      const result = filterBySearchAndDate(items, { searchTerm: '', dateFrom: '2026-04-15' });
      expect(result).toEqual([midEvent, lateEvent]);
    });

    it('filters by dateTo (inclusive)', () => {
      const result = filterBySearchAndDate(items, { searchTerm: '', dateTo: '2026-04-15' });
      expect(result).toEqual([earlyEvent, midEvent]);
    });

    it('filters by both dateFrom and dateTo', () => {
      const result = filterBySearchAndDate(items, { searchTerm: '', dateFrom: '2026-04-12', dateTo: '2026-04-18' });
      expect(result).toEqual([midEvent]);
    });
  });

  describe('no filter', () => {
    it('returns all items when no filters are provided', () => {
      const items = [makeEvent(), makeHoldEvent()];
      const result = filterBySearchAndDate(items, {});
      expect(result).toEqual(items);
    });
  });
});

// --- sortReservations (regression) ---

describe('sortReservations', () => {
  const a = makeEvent({ startDate: '2026-04-10', submittedAt: '2026-04-01' });
  const b = makeEvent({ startDate: '2026-04-20', submittedAt: '2026-04-05' });

  it('sorts by date descending by default', () => {
    expect(sortReservations([a, b], 'date_desc')).toEqual([b, a]);
  });

  it('sorts by date ascending', () => {
    expect(sortReservations([b, a], 'date_asc')).toEqual([a, b]);
  });

  it('sorts by submitted descending', () => {
    expect(sortReservations([a, b], 'submitted_desc')).toEqual([b, a]);
  });

  it('sorts by submitted ascending', () => {
    expect(sortReservations([b, a], 'submitted_asc')).toEqual([a, b]);
  });
});
