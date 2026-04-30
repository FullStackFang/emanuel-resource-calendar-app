/**
 * Tests for calendarSelection.js
 *
 * Validates the default-calendar cascade. The cascade is the load-bearing fix
 * for the "main calendar loads blank on first visit" bug — a regression where
 * the legacy fallback `cal.isDefaultCalendar` / `calendars[0]` would resolve
 * to the user's personal Outlook calendar, which has no reservations in
 * `templeEvents__Events` and produces a silently blank calendar grid.
 *
 * Cases C1-C6 directly correspond to the test list in the implementation plan.
 * C7 (recovery path) and C8 (preference-write guard) involve component-level
 * effects and are covered by the integration/E2E suite.
 */

import { describe, it, expect } from 'vitest';
import {
  selectDefaultCalendar,
  SELECT_DEFAULT_CALENDAR_REASONS,
} from '../../../utils/calendarSelection';

const makeCal = (overrides = {}) => ({
  id: overrides.id || `cal-${Math.random().toString(36).slice(2, 8)}`,
  name: overrides.name || 'Calendar',
  owner: overrides.owner || { address: 'someone@example.com' },
  isDefaultCalendar: false,
  ...overrides,
});

const SHARED_CONFIG = {
  defaultCalendar: 'admin-default@example.com',
  allowedDisplayCalendars: [
    'TempleEventsSandbox@emanuelnyc.org',
    'TempleEvents@emanuelnyc.org',
  ],
};

describe('selectDefaultCalendar', () => {
  describe('C1: saved preference', () => {
    it('picks the calendar matching the saved owner email', () => {
      const target = makeCal({ owner: { address: 'TempleEvents@emanuelnyc.org' } });
      const result = selectDefaultCalendar({
        calendars: [
          makeCal({ owner: { address: 'admin-default@example.com' } }),
          target,
          makeCal({ owner: { address: 'TempleEventsSandbox@emanuelnyc.org' } }),
        ],
        allowedConfig: SHARED_CONFIG,
        savedOwner: 'templeevents@emanuelnyc.org',
        appConfigDefault: 'TempleEventsSandbox@emanuelnyc.org',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.SAVED_PREF);
    });

    it('is case-insensitive on saved owner email', () => {
      const target = makeCal({ owner: { address: 'TempleEvents@emanuelnyc.org' } });
      const result = selectDefaultCalendar({
        calendars: [target],
        allowedConfig: SHARED_CONFIG,
        savedOwner: 'TEMPLEEVENTS@EMANUELNYC.ORG',
        appConfigDefault: 'whatever@example.com',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.SAVED_PREF);
    });
  });

  describe('C2: admin-configured default', () => {
    it('falls through to admin default when no saved pref', () => {
      const target = makeCal({ owner: { address: 'admin-default@example.com' } });
      const result = selectDefaultCalendar({
        calendars: [
          target,
          makeCal({ owner: { address: 'TempleEvents@emanuelnyc.org' } }),
        ],
        allowedConfig: SHARED_CONFIG,
        savedOwner: null,
        appConfigDefault: 'TempleEventsSandbox@emanuelnyc.org',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.ADMIN_DEFAULT);
    });

    it('skips admin default when saved-pref calendar no longer exists', () => {
      const target = makeCal({ owner: { address: 'admin-default@example.com' } });
      const result = selectDefaultCalendar({
        calendars: [target],
        allowedConfig: SHARED_CONFIG,
        savedOwner: 'gone@elsewhere.org',
        appConfigDefault: 'TempleEventsSandbox@emanuelnyc.org',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.ADMIN_DEFAULT);
    });
  });

  describe('C3: APP_CONFIG default', () => {
    it('falls through to APP_CONFIG default when admin default missing', () => {
      const target = makeCal({ owner: { address: 'TempleEventsSandbox@emanuelnyc.org' } });
      const result = selectDefaultCalendar({
        calendars: [target],
        allowedConfig: { allowedDisplayCalendars: SHARED_CONFIG.allowedDisplayCalendars },
        savedOwner: null,
        appConfigDefault: 'TempleEventsSandbox@emanuelnyc.org',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.APP_CONFIG_DEFAULT);
    });
  });

  describe('C4: first allowed calendar', () => {
    it('falls through to first calendar whose owner is in allowedDisplayCalendars', () => {
      const target = makeCal({ owner: { address: 'TempleEventsSandbox@emanuelnyc.org' } });
      const result = selectDefaultCalendar({
        calendars: [
          makeCal({ owner: { address: 'unrelated@example.com' } }),
          target,
          makeCal({ owner: { address: 'TempleEvents@emanuelnyc.org' } }),
        ],
        allowedConfig: { allowedDisplayCalendars: SHARED_CONFIG.allowedDisplayCalendars },
        savedOwner: null,
        appConfigDefault: 'NotInList@example.com',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.FIRST_ALLOWED);
    });
  });

  describe('C5: hard-fail when no allowed match', () => {
    it('returns null when calendars list is empty', () => {
      const result = selectDefaultCalendar({
        calendars: [],
        allowedConfig: SHARED_CONFIG,
        savedOwner: null,
        appConfigDefault: 'whatever@example.com',
      });
      expect(result.calendar).toBeNull();
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.NONE);
    });

    it('returns null when no calendar matches and no allowed-list match', () => {
      const result = selectDefaultCalendar({
        calendars: [
          makeCal({ owner: { address: 'unrelated@example.com' } }),
          makeCal({ owner: { address: 'another@example.com' } }),
        ],
        allowedConfig: SHARED_CONFIG,
        savedOwner: 'gone@elsewhere.org',
        appConfigDefault: 'NotInList@example.com',
      });
      expect(result.calendar).toBeNull();
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.NONE);
    });

    it('returns null when allowedConfig has no allowedDisplayCalendars and other steps miss', () => {
      const result = selectDefaultCalendar({
        calendars: [makeCal({ owner: { address: 'unrelated@example.com' } })],
        allowedConfig: {},
        savedOwner: null,
        appConfigDefault: 'NotInList@example.com',
      });
      expect(result.calendar).toBeNull();
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.NONE);
    });
  });

  describe('C6: regression-lock — never picks personal Outlook calendar', () => {
    it('does NOT pick a calendar with isDefaultCalendar=true if its owner is not allowed', () => {
      // Simulates the bug: only the user's personal Outlook calendar is in scope.
      // The legacy cascade would have picked this; the new cascade must NOT.
      const personalOutlook = makeCal({
        id: 'personal-outlook-id',
        name: 'Calendar',
        owner: { address: 'stephen.fang@emanuelnyc.org' },
        isDefaultCalendar: true,
      });
      const result = selectDefaultCalendar({
        calendars: [personalOutlook],
        allowedConfig: SHARED_CONFIG, // does not include stephen.fang
        savedOwner: null,
        appConfigDefault: 'TempleEventsSandbox@emanuelnyc.org',
      });
      expect(result.calendar).toBeNull();
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.NONE);
    });

    it('does NOT default to calendars[0] when no other rule matches', () => {
      const first = makeCal({ owner: { address: 'first@unrelated.com' } });
      const result = selectDefaultCalendar({
        calendars: [
          first,
          makeCal({ owner: { address: 'second@unrelated.com' } }),
        ],
        allowedConfig: SHARED_CONFIG,
        savedOwner: null,
        appConfigDefault: 'whatever@example.com',
      });
      expect(result.calendar).toBeNull();
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.NONE);
      // Sanity: the function did not silently pick `first` even though it's
      // the first calendar in the array. This is the load-bearing assertion
      // for the bug fix.
      expect(result.calendar).not.toBe(first);
    });
  });

  describe('input handling', () => {
    it('returns null when calendars is undefined', () => {
      const result = selectDefaultCalendar({});
      expect(result.calendar).toBeNull();
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.NONE);
    });

    it('handles missing owner.address on individual calendars without throwing', () => {
      const result = selectDefaultCalendar({
        calendars: [
          { id: 'a', name: 'No owner' }, // no owner field
          { id: 'b', name: 'Owner without address', owner: {} },
          makeCal({ owner: { address: 'TempleEvents@emanuelnyc.org' } }),
        ],
        allowedConfig: SHARED_CONFIG,
        savedOwner: 'TempleEvents@emanuelnyc.org',
        appConfigDefault: 'NotInList@example.com',
      });
      expect(result.calendar?.owner?.address).toBe('TempleEvents@emanuelnyc.org');
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.SAVED_PREF);
    });
  });
});
