// src/__tests__/unit/hooks/buildConflictErrorMessage.test.js
//
// Part 3 of the multi-day conflict work: the 409 conflict message should name the
// room + day (from data the backend already returns) instead of a bare count, so a
// failed save tells the user WHAT collided. buildConflictErrorMessage is the pure
// formatter behind that message.

import { describe, it, expect } from 'vitest';
import { buildConflictErrorMessage } from '../../../hooks/useReviewModal';

const conflict = (over = {}) => ({
  eventTitle: 'Shabbat Service',
  startDateTime: '2027-06-25T18:00:00',
  locationDisplayNames: 'Sanctuary',
  ...over,
});

describe('buildConflictErrorMessage', () => {
  it('falls back to a generic message for empty / missing input', () => {
    expect(buildConflictErrorMessage([], 'Cannot save'))
      .toBe('Cannot save: scheduling conflict with a published event. Adjust dates or rooms.');
    expect(buildConflictErrorMessage(undefined, 'Cannot save')).toContain('scheduling conflict');
  });

  it('names the room, day, and event for a single conflict', () => {
    expect(buildConflictErrorMessage([conflict()], 'Cannot save'))
      .toBe('Cannot save: Sanctuary is booked Jun 25 (Shabbat Service). Adjust dates or rooms.');
  });

  it('joins array-valued locationDisplayNames', () => {
    expect(buildConflictErrorMessage([conflict({ locationDisplayNames: ['Sanctuary', 'Lobby'] })], 'Cannot save'))
      .toContain('Sanctuary, Lobby is booked Jun 25');
  });

  it('uses "A room" when no display name is present', () => {
    expect(buildConflictErrorMessage([conflict({ locationDisplayNames: undefined })], 'Cannot save'))
      .toContain('A room is booked Jun 25');
  });

  it('lists two conflicts separated by a semicolon', () => {
    const msg = buildConflictErrorMessage([
      conflict(),
      conflict({ eventTitle: 'Board Meeting', startDateTime: '2027-06-28T10:00:00', locationDisplayNames: 'Chapel' }),
    ], 'Cannot save');
    expect(msg).toContain('Sanctuary is booked Jun 25 (Shabbat Service)');
    expect(msg).toContain('; Chapel is booked Jun 28 (Board Meeting)');
  });

  it('summarizes 3+ conflicts with a +N more tail', () => {
    const msg = buildConflictErrorMessage([
      conflict({ startDateTime: '2027-06-25T18:00:00', locationDisplayNames: 'Sanctuary' }),
      conflict({ startDateTime: '2027-06-28T10:00:00', locationDisplayNames: 'Chapel' }),
      conflict({ startDateTime: '2027-06-30T10:00:00', locationDisplayNames: 'Lobby' }),
    ], 'Cannot save');
    expect(msg).toBe('Cannot save: 3 conflicts: Sanctuary Jun 25, Chapel Jun 28, +1 more. Adjust dates or rooms.');
  });

  it('honors a custom prefix (publish path)', () => {
    expect(buildConflictErrorMessage([conflict()], 'Cannot publish')).toMatch(/^Cannot publish:/);
  });

  it('omits the day when startDateTime is missing', () => {
    expect(buildConflictErrorMessage([conflict({ startDateTime: undefined })], 'Cannot save'))
      .toBe('Cannot save: Sanctuary is booked (Shabbat Service). Adjust dates or rooms.');
  });
});
