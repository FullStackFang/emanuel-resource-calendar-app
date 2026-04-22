import { describe, it, expect } from 'vitest';
import { formatDraftAge } from '../../../utils/draftAgeUtils';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-04-22T19:20:00Z').getTime();

describe('formatDraftAge', () => {
  describe('nullish / invalid inputs', () => {
    it('returns null for null', () => {
      expect(formatDraftAge(null, NOW)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(formatDraftAge(undefined, NOW)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(formatDraftAge('', NOW)).toBeNull();
    });

    it('returns null for unparseable date strings', () => {
      expect(formatDraftAge('not-a-date', NOW)).toBeNull();
    });
  });

  describe('age labels', () => {
    it('returns "Today" for a timestamp saved just now', () => {
      expect(formatDraftAge(NOW, NOW)).toBe('Today');
    });

    it('returns "Today" for a timestamp under 24 hours old', () => {
      expect(formatDraftAge(NOW - (23 * 60 * 60 * 1000), NOW)).toBe('Today');
    });

    it('returns "1 day old" at exactly 24 hours', () => {
      expect(formatDraftAge(NOW - MS_PER_DAY, NOW)).toBe('1 day old');
    });

    it('returns "N days old" (plural) for multi-day ages', () => {
      expect(formatDraftAge(NOW - (2 * MS_PER_DAY), NOW)).toBe('2 days old');
      expect(formatDraftAge(NOW - (14 * MS_PER_DAY), NOW)).toBe('14 days old');
      expect(formatDraftAge(NOW - (365 * MS_PER_DAY), NOW)).toBe('365 days old');
    });

    it('clamps future timestamps (clock skew) to "Today"', () => {
      expect(formatDraftAge(NOW + (3 * MS_PER_DAY), NOW)).toBe('Today');
    });
  });

  describe('input format flexibility', () => {
    it('accepts ISO strings', () => {
      expect(formatDraftAge('2026-04-21T19:20:00Z', NOW)).toBe('1 day old');
    });

    it('accepts Date objects', () => {
      expect(formatDraftAge(new Date(NOW - (3 * MS_PER_DAY)), NOW)).toBe('3 days old');
    });

    it('accepts numeric epoch milliseconds', () => {
      expect(formatDraftAge(NOW - (5 * MS_PER_DAY), NOW)).toBe('5 days old');
    });
  });

  describe('default now parameter', () => {
    it('uses Date.now() when now is omitted', () => {
      const result = formatDraftAge(Date.now() - (2 * MS_PER_DAY));
      expect(result).toBe('2 days old');
    });
  });
});
