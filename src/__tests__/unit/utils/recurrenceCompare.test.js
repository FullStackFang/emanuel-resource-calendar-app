// src/__tests__/unit/utils/recurrenceCompare.test.js
import { describe, it, expect } from 'vitest';
import { recurrenceEquals, summarizeRecurrenceShort } from '../../../utils/recurrenceCompare';

describe('recurrenceEquals', () => {
  it('returns true when both null', () => {
    expect(recurrenceEquals(null, null)).toBe(true);
  });

  it('returns false when one side is null', () => {
    const r = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(null, r)).toBe(false);
    expect(recurrenceEquals(r, null)).toBe(false);
  });

  it('returns true for identical patterns', () => {
    const r = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(r, { ...r })).toBe(true);
  });

  it('order of daysOfWeek does not matter', () => {
    const a = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday', 'friday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['friday', 'monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(a, b)).toBe(true);
  });

  it('returns false when interval differs', () => {
    const a = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(recurrenceEquals(a, b)).toBe(false);
  });

  it('returns false when range.endDate differs', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-04-30' } };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'endDate', startDate: '2026-04-20', endDate: '2026-05-30' } };
    expect(recurrenceEquals(a, b)).toBe(false);
  });

  it('exclusions order does not matter', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: ['2026-04-22', '2026-04-25'] };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: ['2026-04-25', '2026-04-22'] };
    expect(recurrenceEquals(a, b)).toBe(true);
  });

  it('returns false when exclusion list differs', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: ['2026-04-22'] };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: [] };
    expect(recurrenceEquals(a, b)).toBe(false);
  });

  it('treats missing exclusions and empty array as equal', () => {
    const a = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-04-20' }, exclusions: [] };
    expect(recurrenceEquals(a, b)).toBe(true);
  });
});

describe('summarizeRecurrenceShort', () => {
  it('returns empty string for null', () => {
    expect(summarizeRecurrenceShort(null)).toBe('');
  });

  it('returns a non-empty string for a populated pattern', () => {
    const r = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const s = summarizeRecurrenceShort(r);
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(0);
  });
});
