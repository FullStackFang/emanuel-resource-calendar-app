/**
 * Tests for calendarSelection.js
 *
 * Validates the default-calendar cascade. The cascade is the load-bearing fix
 * for the "main calendar loads blank on first visit" bug — a regression where
 * the legacy fallback `cal.isDefaultCalendar` / `calendars[0]` would resolve
 * to the user's personal Outlook calendar, which has no reservations in
 * `templeEvents__Events` and produces a silently blank calendar grid.
 *
 * Per-user saved preferences are intentionally NOT part of the cascade.
 * The displayed calendar is a delegated-access, system-wide setting controlled
 * by the admin's 'Default Calendar' config.
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
  describe('CS-1: admin-configured default', () => {
    it('picks the calendar matching admin defaultCalendar', () => {
      const target = makeCal({ owner: { address: 'admin-default@example.com' } });
      const result = selectDefaultCalendar({
        calendars: [
          target,
          makeCal({ owner: { address: 'TempleEvents@emanuelnyc.org' } }),
        ],
        allowedConfig: SHARED_CONFIG,
        appConfigDefault: 'TempleEventsSandbox@emanuelnyc.org',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.ADMIN_DEFAULT);
    });

    it('is case-insensitive on admin defaultCalendar', () => {
      const target = makeCal({ owner: { address: 'TempleEvents@emanuelnyc.org' } });
      const result = selectDefaultCalendar({
        calendars: [target],
        allowedConfig: {
          ...SHARED_CONFIG,
          defaultCalendar: 'TEMPLEEVENTS@EMANUELNYC.ORG',
        },
        appConfigDefault: 'whatever@example.com',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.ADMIN_DEFAULT);
    });
  });

  describe('CS-2: APP_CONFIG default fallback', () => {
    it('falls through to APP_CONFIG default when admin default is missing', () => {
      const target = makeCal({ owner: { address: 'TempleEventsSandbox@emanuelnyc.org' } });
      const result = selectDefaultCalendar({
        calendars: [target],
        allowedConfig: { allowedDisplayCalendars: SHARED_CONFIG.allowedDisplayCalendars },
        appConfigDefault: 'TempleEventsSandbox@emanuelnyc.org',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.APP_CONFIG_DEFAULT);
    });

    it('falls through to APP_CONFIG default when admin defaultCalendar does not match available calendars', () => {
      const target = makeCal({ owner: { address: 'TempleEventsSandbox@emanuelnyc.org' } });
      const result = selectDefaultCalendar({
        calendars: [target],
        allowedConfig: {
          defaultCalendar: 'admin-default@example.com', // not in calendars
          allowedDisplayCalendars: SHARED_CONFIG.allowedDisplayCalendars,
        },
        appConfigDefault: 'TempleEventsSandbox@emanuelnyc.org',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.APP_CONFIG_DEFAULT);
    });
  });

  describe('CS-3: first allowed calendar fallback', () => {
    it('falls through to first calendar whose owner is in allowedDisplayCalendars', () => {
      const target = makeCal({ owner: { address: 'TempleEventsSandbox@emanuelnyc.org' } });
      const result = selectDefaultCalendar({
        calendars: [
          makeCal({ owner: { address: 'unrelated@example.com' } }),
          target,
          makeCal({ owner: { address: 'TempleEvents@emanuelnyc.org' } }),
        ],
        allowedConfig: { allowedDisplayCalendars: SHARED_CONFIG.allowedDisplayCalendars },
        appConfigDefault: 'NotInList@example.com',
      });
      expect(result.calendar).toBe(target);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.FIRST_ALLOWED);
    });
  });

  describe('CS-4: hard-fail when no allowed match', () => {
    it('returns null when calendars list is empty', () => {
      const result = selectDefaultCalendar({
        calendars: [],
        allowedConfig: SHARED_CONFIG,
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
        appConfigDefault: 'NotInList@example.com',
      });
      expect(result.calendar).toBeNull();
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.NONE);
    });

    it('returns null when allowedConfig has no allowedDisplayCalendars and other steps miss', () => {
      const result = selectDefaultCalendar({
        calendars: [makeCal({ owner: { address: 'unrelated@example.com' } })],
        allowedConfig: {},
        appConfigDefault: 'NotInList@example.com',
      });
      expect(result.calendar).toBeNull();
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.NONE);
    });
  });

  describe('CS-5: regression-lock — never picks personal Outlook calendar', () => {
    it('does NOT pick a calendar with isDefaultCalendar=true if its owner is not allowed', () => {
      const personalOutlook = makeCal({
        id: 'personal-outlook-id',
        name: 'Calendar',
        owner: { address: 'stephen.fang@emanuelnyc.org' },
        isDefaultCalendar: true,
      });
      const result = selectDefaultCalendar({
        calendars: [personalOutlook],
        allowedConfig: SHARED_CONFIG,
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
        appConfigDefault: 'whatever@example.com',
      });
      expect(result.calendar).toBeNull();
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.NONE);
      expect(result.calendar).not.toBe(first);
    });
  });

  describe('CS-6: per-user preference is intentionally ignored', () => {
    // Lock-in test: extra fields like savedOwner must NOT influence the cascade.
    // If someone reintroduces SAVED_PREF priority, this test fails.
    it('ignores any savedOwner field and resolves via admin default', () => {
      const adminPick = makeCal({ owner: { address: 'admin-default@example.com' } });
      const userSavedPick = makeCal({ owner: { address: 'TempleEvents@emanuelnyc.org' } });
      const result = selectDefaultCalendar({
        calendars: [adminPick, userSavedPick],
        allowedConfig: SHARED_CONFIG,
        appConfigDefault: 'TempleEventsSandbox@emanuelnyc.org',
        // Even if a caller passes savedOwner, the function ignores it.
        savedOwner: 'templeevents@emanuelnyc.org',
      });
      expect(result.calendar).toBe(adminPick);
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.ADMIN_DEFAULT);
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
          { id: 'a', name: 'No owner' },
          { id: 'b', name: 'Owner without address', owner: {} },
          makeCal({ owner: { address: 'TempleEvents@emanuelnyc.org' } }),
        ],
        allowedConfig: {
          defaultCalendar: 'TempleEvents@emanuelnyc.org',
          allowedDisplayCalendars: SHARED_CONFIG.allowedDisplayCalendars,
        },
        appConfigDefault: 'NotInList@example.com',
      });
      expect(result.calendar?.owner?.address).toBe('TempleEvents@emanuelnyc.org');
      expect(result.reason).toBe(SELECT_DEFAULT_CALENDAR_REASONS.ADMIN_DEFAULT);
    });
  });
});
