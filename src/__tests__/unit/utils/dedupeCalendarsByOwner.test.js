/**
 * Tests for dedupeCalendarsByOwner.js
 *
 * Graph's /users/{owner}/calendars returns every folder in a mailbox, including
 * stray ones like 'Untitled Calendar' that share owner.address with the default
 * calendar. Without deduping, the dropdown renders two confusing rows for the
 * same mailbox (both load the same events because the load is keyed on
 * calendarOwner not calendarId).
 *
 * The dedupe is owner-scoped so each allowed mailbox produces exactly one
 * dropdown entry. Tiebreaker rule: prefer isDefaultCalendar: true.
 */

import { describe, it, expect } from 'vitest';
import { dedupeCalendarsByOwner } from '../../../utils/dedupeCalendarsByOwner';

const makeCal = (overrides = {}) => ({
  id: overrides.id || `cal-${Math.random().toString(36).slice(2, 8)}`,
  name: overrides.name || 'Calendar',
  owner: overrides.owner || { address: 'someone@example.com' },
  isDefaultCalendar: false,
  ...overrides,
});

describe('dedupeCalendarsByOwner', () => {
  describe('DCO-1: same owner.address collapses to one entry', () => {
    it('keeps the isDefaultCalendar entry when both share an owner', () => {
      const def = makeCal({
        id: 'default-id',
        name: 'Temple Events',
        owner: { address: 'TempleEvents@emanuelnyc.org', name: 'Temple Events' },
        isDefaultCalendar: true,
      });
      const stray = makeCal({
        id: 'stray-id',
        name: 'Untitled Calendar',
        owner: { address: 'TempleEvents@emanuelnyc.org', name: 'Temple Events' },
        isDefaultCalendar: false,
      });

      const result = dedupeCalendarsByOwner([stray, def]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('default-id');
      expect(result[0].name).toBe('Temple Events');
    });
  });

  describe('DCO-2: dedupe is case-insensitive on owner.address', () => {
    it('treats mixed-case and lowercase owner.address as the same mailbox', () => {
      const a = makeCal({
        id: 'a',
        owner: { address: 'TempleEvents@emanuelnyc.org' },
        isDefaultCalendar: true,
      });
      const b = makeCal({
        id: 'b',
        owner: { address: 'templeevents@emanuelnyc.org' },
        isDefaultCalendar: false,
      });

      const result = dedupeCalendarsByOwner([a, b]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a');
    });
  });

  describe('DCO-3: different owners stay separate', () => {
    it('preserves one entry per distinct owner.address', () => {
      const prod = makeCal({
        id: 'prod',
        owner: { address: 'templeevents@emanuelnyc.org' },
        isDefaultCalendar: true,
      });
      const sandbox = makeCal({
        id: 'sandbox',
        owner: { address: 'templeeventssandbox@emanuelnyc.org' },
        isDefaultCalendar: true,
      });

      const result = dedupeCalendarsByOwner([prod, sandbox]);

      expect(result).toHaveLength(2);
      const ids = result.map(c => c.id).sort();
      expect(ids).toEqual(['prod', 'sandbox']);
    });
  });

  describe('DCO-4: fallback when no default flag is set', () => {
    it('keeps the first-seen entry when neither calendar is isDefaultCalendar', () => {
      const first = makeCal({
        id: 'first',
        owner: { address: 'TempleEvents@emanuelnyc.org' },
        isDefaultCalendar: false,
      });
      const second = makeCal({
        id: 'second',
        owner: { address: 'TempleEvents@emanuelnyc.org' },
        isDefaultCalendar: false,
      });

      const result = dedupeCalendarsByOwner([first, second]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('first');
    });
  });

  describe('DCO-5: entries with no owner.address are dropped', () => {
    it('filters out calendars that have no usable owner email', () => {
      const noOwner = makeCal({ id: 'no-owner', owner: undefined });
      const emptyAddr = makeCal({ id: 'empty', owner: { address: '' } });
      const valid = makeCal({
        id: 'valid',
        owner: { address: 'templeevents@emanuelnyc.org' },
      });

      const result = dedupeCalendarsByOwner([noOwner, emptyAddr, valid]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('valid');
    });
  });

  describe('DCO-6: handles non-array input gracefully', () => {
    it('returns [] for undefined/null/non-array inputs', () => {
      expect(dedupeCalendarsByOwner(undefined)).toEqual([]);
      expect(dedupeCalendarsByOwner(null)).toEqual([]);
      expect(dedupeCalendarsByOwner({})).toEqual([]);
      expect(dedupeCalendarsByOwner('not an array')).toEqual([]);
    });
  });

  describe('DCO-7: does not mutate the input array', () => {
    it('leaves the original array order intact', () => {
      const input = [
        makeCal({ id: 'a', owner: { address: 'a@example.com' }, isDefaultCalendar: false }),
        makeCal({ id: 'b', owner: { address: 'a@example.com' }, isDefaultCalendar: true }),
        makeCal({ id: 'c', owner: { address: 'c@example.com' }, isDefaultCalendar: true }),
      ];
      const snapshot = [...input];

      dedupeCalendarsByOwner(input);

      expect(input).toEqual(snapshot);
    });
  });
});
