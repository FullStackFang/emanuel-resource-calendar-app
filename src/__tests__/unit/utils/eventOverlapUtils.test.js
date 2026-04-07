/**
 * Tests for eventOverlapUtils.js
 */

import { describe, it, expect } from 'vitest';
import {
  doEventsOverlap,
  getEventBounds,
  groupOverlappingEvents,
  calculateOverlapPercentages,
  areEventsConflicting,
  groupEventsForNestedDisplay,
  getLocationConflictInfo
} from '../../../utils/eventOverlapUtils';

describe('doEventsOverlap', () => {
  it('returns true when events overlap', () => {
    const start1 = new Date('2024-03-15T10:00:00');
    const end1 = new Date('2024-03-15T12:00:00');
    const start2 = new Date('2024-03-15T11:00:00');
    const end2 = new Date('2024-03-15T13:00:00');

    expect(doEventsOverlap(start1, end1, start2, end2)).toBe(true);
  });

  it('returns true when one event contains another', () => {
    const start1 = new Date('2024-03-15T09:00:00');
    const end1 = new Date('2024-03-15T17:00:00');
    const start2 = new Date('2024-03-15T11:00:00');
    const end2 = new Date('2024-03-15T13:00:00');

    expect(doEventsOverlap(start1, end1, start2, end2)).toBe(true);
  });

  it('returns false when events do not overlap', () => {
    const start1 = new Date('2024-03-15T10:00:00');
    const end1 = new Date('2024-03-15T11:00:00');
    const start2 = new Date('2024-03-15T12:00:00');
    const end2 = new Date('2024-03-15T13:00:00');

    expect(doEventsOverlap(start1, end1, start2, end2)).toBe(false);
  });

  it('returns false when events are adjacent (no gap, no overlap)', () => {
    const start1 = new Date('2024-03-15T10:00:00');
    const end1 = new Date('2024-03-15T11:00:00');
    const start2 = new Date('2024-03-15T11:00:00');
    const end2 = new Date('2024-03-15T12:00:00');

    expect(doEventsOverlap(start1, end1, start2, end2)).toBe(false);
  });
});

describe('getEventBounds', () => {
  it('returns event start and end without setup/teardown', () => {
    const event = {
      start: { dateTime: '2024-03-15T10:00:00' },
      end: { dateTime: '2024-03-15T12:00:00' }
    };

    const bounds = getEventBounds(event);

    // Verify the bounds match the original times (allowing for timezone conversion)
    expect(bounds.start.getTime()).toBe(new Date('2024-03-15T10:00:00').getTime());
    expect(bounds.end.getTime()).toBe(new Date('2024-03-15T12:00:00').getTime());
  });

  it('includes setup time before event', () => {
    const event = {
      start: { dateTime: '2024-03-15T10:00:00' },
      end: { dateTime: '2024-03-15T12:00:00' },
      setupMinutes: 30
    };

    const bounds = getEventBounds(event);

    // Setup time should be 30 minutes before start
    const expectedStart = new Date('2024-03-15T10:00:00');
    expectedStart.setMinutes(expectedStart.getMinutes() - 30);
    expect(bounds.start.getTime()).toBe(expectedStart.getTime());
    expect(bounds.end.getTime()).toBe(new Date('2024-03-15T12:00:00').getTime());
  });

  it('includes teardown time after event', () => {
    const event = {
      start: { dateTime: '2024-03-15T10:00:00' },
      end: { dateTime: '2024-03-15T12:00:00' },
      teardownMinutes: 45
    };

    const bounds = getEventBounds(event);

    // Teardown should extend end by 45 minutes
    const expectedEnd = new Date('2024-03-15T12:00:00');
    expectedEnd.setMinutes(expectedEnd.getMinutes() + 45);
    expect(bounds.start.getTime()).toBe(new Date('2024-03-15T10:00:00').getTime());
    expect(bounds.end.getTime()).toBe(expectedEnd.getTime());
  });

  it('includes both setup and teardown', () => {
    const event = {
      start: { dateTime: '2024-03-15T10:00:00' },
      end: { dateTime: '2024-03-15T12:00:00' },
      setupMinutes: 30,
      teardownMinutes: 30
    };

    const bounds = getEventBounds(event);

    const expectedStart = new Date('2024-03-15T10:00:00');
    expectedStart.setMinutes(expectedStart.getMinutes() - 30);
    const expectedEnd = new Date('2024-03-15T12:00:00');
    expectedEnd.setMinutes(expectedEnd.getMinutes() + 30);

    expect(bounds.start.getTime()).toBe(expectedStart.getTime());
    expect(bounds.end.getTime()).toBe(expectedEnd.getTime());
  });
});

describe('groupOverlappingEvents', () => {
  it('returns empty array for empty input', () => {
    expect(groupOverlappingEvents([])).toEqual([]);
    expect(groupOverlappingEvents(null)).toEqual([]);
  });

  it('groups non-overlapping events separately', () => {
    const events = [
      { id: '1', start: { dateTime: '2024-03-15T09:00:00' }, end: { dateTime: '2024-03-15T10:00:00' } },
      { id: '2', start: { dateTime: '2024-03-15T11:00:00' }, end: { dateTime: '2024-03-15T12:00:00' } },
      { id: '3', start: { dateTime: '2024-03-15T14:00:00' }, end: { dateTime: '2024-03-15T15:00:00' } }
    ];

    const groups = groupOverlappingEvents(events);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);
    expect(groups[2]).toHaveLength(1);
  });

  it('groups overlapping events together', () => {
    const events = [
      { id: '1', start: { dateTime: '2024-03-15T09:00:00' }, end: { dateTime: '2024-03-15T11:00:00' } },
      { id: '2', start: { dateTime: '2024-03-15T10:00:00' }, end: { dateTime: '2024-03-15T12:00:00' } },
      { id: '3', start: { dateTime: '2024-03-15T14:00:00' }, end: { dateTime: '2024-03-15T15:00:00' } }
    ];

    const groups = groupOverlappingEvents(events);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2); // Events 1 and 2 overlap
    expect(groups[1]).toHaveLength(1); // Event 3 is separate
  });

  it('handles single event', () => {
    const events = [
      { id: '1', start: { dateTime: '2024-03-15T09:00:00' }, end: { dateTime: '2024-03-15T10:00:00' } }
    ];

    const groups = groupOverlappingEvents(events);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
  });
});

describe('calculateOverlapPercentages', () => {
  it('calculates 50% overlap when events overlap halfway', () => {
    const event1 = {
      start: { dateTime: '2024-03-15T10:00:00' },
      end: { dateTime: '2024-03-15T12:00:00' } // 2 hours
    };
    const event2 = {
      start: { dateTime: '2024-03-15T11:00:00' },
      end: { dateTime: '2024-03-15T13:00:00' } // 2 hours
    };

    const result = calculateOverlapPercentages(event1, event2);

    // 1 hour overlap out of 2 hours each = 50%
    expect(result.event1.percentage).toBe(50);
    expect(result.event2.percentage).toBe(50);
  });

  it('returns 0% when events do not overlap', () => {
    const event1 = {
      start: { dateTime: '2024-03-15T10:00:00' },
      end: { dateTime: '2024-03-15T11:00:00' }
    };
    const event2 = {
      start: { dateTime: '2024-03-15T12:00:00' },
      end: { dateTime: '2024-03-15T13:00:00' }
    };

    const result = calculateOverlapPercentages(event1, event2);

    expect(result.event1).toBe(0);
    expect(result.event2).toBe(0);
  });

  it('calculates 100% when one event fully contains another', () => {
    const event1 = {
      start: { dateTime: '2024-03-15T09:00:00' },
      end: { dateTime: '2024-03-15T17:00:00' } // 8 hours
    };
    const event2 = {
      start: { dateTime: '2024-03-15T11:00:00' },
      end: { dateTime: '2024-03-15T13:00:00' } // 2 hours
    };

    const result = calculateOverlapPercentages(event1, event2);

    // Event 2 is fully inside event 1
    expect(result.event2.percentage).toBe(100);
    expect(result.event1.percentage).toBe(25); // 2 hours out of 8
  });
});

describe('areEventsConflicting', () => {
  const baseEvent = {
    start: { dateTime: '2024-03-15T10:00:00' },
    end: { dateTime: '2024-03-15T12:00:00' }
  };

  it('returns false when events do not overlap', () => {
    const event1 = { ...baseEvent };
    const event2 = {
      start: { dateTime: '2024-03-15T13:00:00' },
      end: { dateTime: '2024-03-15T14:00:00' }
    };

    expect(areEventsConflicting(event1, event2)).toBe(false);
  });

  it('returns true when overlapping events both disallow concurrent', () => {
    const event1 = { ...baseEvent, isAllowedConcurrent: false };
    const event2 = {
      start: { dateTime: '2024-03-15T11:00:00' },
      end: { dateTime: '2024-03-15T13:00:00' },
      isAllowedConcurrent: false
    };

    expect(areEventsConflicting(event1, event2)).toBe(true);
  });

  it('returns true when both events have undefined isAllowedConcurrent (defaults to false)', () => {
    const event1 = { ...baseEvent };
    const event2 = {
      start: { dateTime: '2024-03-15T11:00:00' },
      end: { dateTime: '2024-03-15T13:00:00' }
    };

    expect(areEventsConflicting(event1, event2)).toBe(true);
  });

  it('returns false when one event allows concurrent with no category restrictions', () => {
    const event1 = {
      ...baseEvent,
      isAllowedConcurrent: true,
      allowedConcurrentCategories: []
    };
    const event2 = {
      start: { dateTime: '2024-03-15T11:00:00' },
      end: { dateTime: '2024-03-15T13:00:00' },
      isAllowedConcurrent: false
    };

    expect(areEventsConflicting(event1, event2)).toBe(false);
  });

  it('considers setup/teardown times when checking overlap', () => {
    const event1 = {
      ...baseEvent,
      teardownMinutes: 60 // Extends to 13:00
    };
    const event2 = {
      start: { dateTime: '2024-03-15T12:30:00' },
      end: { dateTime: '2024-03-15T13:30:00' }
    };

    // Without teardown, events don't overlap. With teardown, they do.
    expect(areEventsConflicting(event1, event2)).toBe(true);
  });
});

describe('groupEventsForNestedDisplay', () => {
  it('returns empty array for empty input', () => {
    expect(groupEventsForNestedDisplay([])).toEqual([]);
    expect(groupEventsForNestedDisplay(null)).toEqual([]);
  });

  it('marks standalone events correctly', () => {
    const events = [
      { id: '1', start: { dateTime: '2024-03-15T09:00:00' }, end: { dateTime: '2024-03-15T10:00:00' } },
      { id: '2', start: { dateTime: '2024-03-15T12:00:00' }, end: { dateTime: '2024-03-15T13:00:00' } }
    ];

    const result = groupEventsForNestedDisplay(events);

    expect(result).toHaveLength(2);
    expect(result[0].standalone).toBe(true);
    expect(result[1].standalone).toBe(true);
  });

  it('groups overlapping events under parent with isAllowedConcurrent', () => {
    const events = [
      {
        id: '1',
        eventId: 'evt-1',
        start: { dateTime: '2024-03-15T09:00:00' },
        end: { dateTime: '2024-03-15T17:00:00' },
        isAllowedConcurrent: true
      },
      {
        id: '2',
        eventId: 'evt-2',
        start: { dateTime: '2024-03-15T10:00:00' },
        end: { dateTime: '2024-03-15T11:00:00' },
        isAllowedConcurrent: false
      },
      {
        id: '3',
        eventId: 'evt-3',
        start: { dateTime: '2024-03-15T14:00:00' },
        end: { dateTime: '2024-03-15T15:00:00' },
        isAllowedConcurrent: false
      }
    ];

    const result = groupEventsForNestedDisplay(events);

    // Event 1 is parent, events 2 and 3 are children (they overlap with event 1)
    expect(result).toHaveLength(1);
    expect(result[0].parent.eventId).toBe('evt-1');
    expect(result[0].children).toHaveLength(2);
    expect(result[0].standalone).toBe(false);
  });

  it('handles events that do not overlap with parent', () => {
    const events = [
      {
        id: '1',
        eventId: 'evt-1',
        start: { dateTime: '2024-03-15T09:00:00' },
        end: { dateTime: '2024-03-15T10:00:00' },
        isAllowedConcurrent: true
      },
      {
        id: '2',
        eventId: 'evt-2',
        start: { dateTime: '2024-03-15T12:00:00' },
        end: { dateTime: '2024-03-15T13:00:00' }
      }
    ];

    const result = groupEventsForNestedDisplay(events);

    // Parent group has no children (events don't overlap)
    // And there's a standalone event
    expect(result).toHaveLength(2);
  });
});

describe('getLocationConflictInfo', () => {
  // Helper to create a test event with location ObjectIds
  const makeEvent = (id, start, end, locationIds = [], overrides = {}) => ({
    eventId: id,
    start: { dateTime: start },
    end: { dateTime: end },
    calendarData: {
      locations: locationIds,
      startTime: '10:00',
      endTime: '12:00',
      ...overrides.calendarData,
    },
    location: { displayName: overrides.displayName || '' },
    ...overrides,
  });

  const LOC_SANCTUARY = 'loc-sanctuary-001';
  const LOC_CHAPEL = 'loc-chapel-002';
  const LOC_ANNEX = 'loc-annex-003';

  // --- Core conflict: same location + time overlap ---

  it('LC-1: flags conflict when two events share a location and overlap in time', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY]);
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T13:00:00', [LOC_SANCTUARY]);

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(1);
  });

  it('LC-2: no conflict when events share a location but do not overlap in time', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T11:00:00', [LOC_SANCTUARY]);
    const eventB = makeEvent('b', '2024-03-15T12:00:00', '2024-03-15T13:00:00', [LOC_SANCTUARY]);

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(0);
  });

  it('LC-3: no conflict when events overlap in time but have different locations', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY]);
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T13:00:00', [LOC_CHAPEL]);

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(0);
  });

  // --- Multi-room events ---

  it('LC-4: flags conflict when multi-room events share at least one location', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY, LOC_ANNEX]);
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T13:00:00', [LOC_SANCTUARY, LOC_CHAPEL]);

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(1);
  });

  it('LC-5: no conflict when multi-room events share no locations', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY]);
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T13:00:00', [LOC_CHAPEL, LOC_ANNEX]);

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(0);
  });

  // --- Events without locations ---

  it('LC-6: no conflict when neither event has locations', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', []);
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T13:00:00', []);

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(0);
  });

  it('LC-7: no conflict when only one event has a location', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY]);
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T13:00:00', []);

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(0);
  });

  // --- Timeless drafts ---

  it('LC-8: timeless drafts never participate in conflict detection', () => {
    const draft = makeEvent('d', '2024-03-15T00:00:00', '2024-03-15T23:59:00', [LOC_SANCTUARY], {
      status: 'draft',
      calendarData: { locations: [LOC_SANCTUARY], startTime: null, endTime: null },
    });
    const eventB = makeEvent('b', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY]);

    // Draft as the target event — should show 0
    const draftResult = getLocationConflictInfo(draft, [draft, eventB]);
    expect(draftResult.overlapCount).toBe(0);

    // Draft as a candidate — should not count
    const eventResult = getLocationConflictInfo(eventB, [draft, eventB]);
    expect(eventResult.overlapCount).toBe(0);
  });

  // --- Self-exclusion ---

  it('LC-9: event does not conflict with itself', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY]);

    const result = getLocationConflictInfo(eventA, [eventA]);

    expect(result.overlapCount).toBe(0);
  });

  // --- Multiple conflicts ---

  it('LC-10: counts multiple conflicting events correctly', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T14:00:00', [LOC_SANCTUARY]);
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY]);
    const eventC = makeEvent('c', '2024-03-15T13:00:00', '2024-03-15T15:00:00', [LOC_SANCTUARY]);
    const eventD = makeEvent('d', '2024-03-15T11:00:00', '2024-03-15T12:00:00', [LOC_CHAPEL]); // different location

    const result = getLocationConflictInfo(eventA, [eventA, eventB, eventC, eventD]);

    expect(result.overlapCount).toBe(2); // B and C, not D
  });

  // --- isAllowedConcurrent / hasParentEvent ---

  it('LC-11: reports hasParentEvent and isParentEvent flags', () => {
    const parent = makeEvent('p', '2024-03-15T09:00:00', '2024-03-15T17:00:00', [LOC_SANCTUARY], {
      isAllowedConcurrent: true,
    });
    const child = makeEvent('c', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY]);

    const parentResult = getLocationConflictInfo(parent, [parent, child]);
    expect(parentResult.isParentEvent).toBe(true);
    expect(parentResult.overlapCount).toBe(1);

    const childResult = getLocationConflictInfo(child, [parent, child]);
    expect(childResult.hasParentEvent).toBe(true);
    expect(childResult.overlapCount).toBe(1);
  });

  // --- Cross-category: the key scenario ---

  it('LC-12: detects conflict across different categories (same room, same time)', () => {
    // Event A is in "Services" category, Event B is in "Music" category
    // Both use Sanctuary — this IS a conflict regardless of category grouping
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY], {
      categories: ['Services'],
    });
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T13:00:00', [LOC_SANCTUARY], {
      categories: ['Music'],
    });

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(1);
  });

  // --- Fallback to displayName when no ObjectIds ---

  it('LC-13: falls back to location.displayName when calendarData.locations is empty', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [], {
      displayName: 'Sanctuary',
    });
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T13:00:00', [], {
      displayName: 'Sanctuary',
    });

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(1);
  });

  it('LC-14: displayName fallback does not match different locations', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [], {
      displayName: 'Sanctuary',
    });
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T13:00:00', [], {
      displayName: 'Chapel',
    });

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(0);
  });

  it('LC-15: displayName fallback ignores empty and Unspecified', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T12:00:00', [], {
      displayName: '',
    });
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T13:00:00', [], {
      displayName: 'Unspecified',
    });

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(0);
  });

  // --- Adjacent events (boundary) ---

  it('LC-16: adjacent events (end === start) are not conflicts', () => {
    const eventA = makeEvent('a', '2024-03-15T10:00:00', '2024-03-15T11:00:00', [LOC_SANCTUARY]);
    const eventB = makeEvent('b', '2024-03-15T11:00:00', '2024-03-15T12:00:00', [LOC_SANCTUARY]);

    const result = getLocationConflictInfo(eventA, [eventA, eventB]);

    expect(result.overlapCount).toBe(0);
  });
});
