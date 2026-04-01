/**
 * Tests for editRequestUtils.js
 *
 * Tests the computeApproverChanges utility that determines what fields
 * an approver/admin has modified when reviewing an edit request.
 */

import { describe, it, expect } from 'vitest';
import { computeApproverChanges, decomposeProposedChanges } from '../../../utils/editRequestUtils';

describe('decomposeProposedChanges', () => {
  it('returns empty object for null/undefined input', () => {
    expect(decomposeProposedChanges(null)).toEqual({});
    expect(decomposeProposedChanges(undefined)).toEqual({});
  });

  it('passes through non-datetime fields unchanged', () => {
    const input = { eventTitle: 'Test', attendeeCount: 50, setupTime: '08:30' };
    const result = decomposeProposedChanges(input);
    expect(result.eventTitle).toBe('Test');
    expect(result.attendeeCount).toBe(50);
    expect(result.setupTime).toBe('08:30');
  });

  it('decomposes startDateTime into startDate and startTime', () => {
    const result = decomposeProposedChanges({ startDateTime: '2026-03-25T14:30:00' });
    expect(result.startDateTime).toBe('2026-03-25T14:30:00');
    expect(result.startDate).toBe('2026-03-25');
    expect(result.startTime).toBe('14:30');
  });

  it('decomposes endDateTime into endDate and endTime', () => {
    const result = decomposeProposedChanges({ endDateTime: '2026-03-25T18:00:00' });
    expect(result.endDateTime).toBe('2026-03-25T18:00:00');
    expect(result.endDate).toBe('2026-03-25');
    expect(result.endTime).toBe('18:00');
  });

  it('decomposes both start and end datetimes', () => {
    const result = decomposeProposedChanges({
      startDateTime: '2026-04-01T09:00:00',
      endDateTime: '2026-04-01T17:00:00',
    });
    expect(result.startDate).toBe('2026-04-01');
    expect(result.startTime).toBe('09:00');
    expect(result.endDate).toBe('2026-04-01');
    expect(result.endTime).toBe('17:00');
  });

  it('handles datetime without seconds (HH:MM format)', () => {
    const result = decomposeProposedChanges({ startDateTime: '2026-03-25T14:30' });
    expect(result.startDate).toBe('2026-03-25');
    expect(result.startTime).toBe('14:30');
  });

  it('does not add date/time fields when no datetime is present', () => {
    const result = decomposeProposedChanges({ eventTitle: 'Test' });
    expect(result.startDate).toBeUndefined();
    expect(result.startTime).toBeUndefined();
    expect(result.endDate).toBeUndefined();
    expect(result.endTime).toBeUndefined();
  });

  it('does not mutate the original object', () => {
    const input = { startDateTime: '2026-03-25T14:30:00' };
    decomposeProposedChanges(input);
    expect(input.startDate).toBeUndefined();
    expect(input.startTime).toBeUndefined();
  });
});

describe('computeApproverChanges', () => {
  describe('null/undefined handling', () => {
    it('returns null when currentFormData is null', () => {
      expect(computeApproverChanges(null, { eventTitle: 'Test' })).toBeNull();
    });

    it('returns null when originalEventData is null', () => {
      expect(computeApproverChanges({ eventTitle: 'Test' }, null)).toBeNull();
    });

    it('returns null when both are null', () => {
      expect(computeApproverChanges(null, null)).toBeNull();
    });
  });

  describe('no changes detected', () => {
    it('returns null when form data matches original', () => {
      const original = {
        eventTitle: 'Test Event',
        eventDescription: 'A description',
        startDate: '2026-03-01',
        startTime: '10:00',
      };
      const result = computeApproverChanges({ ...original }, original);
      expect(result).toBeNull();
    });

    it('treats empty string and undefined as equivalent', () => {
      const original = { eventTitle: 'Test', setupNotes: undefined };
      const current = { eventTitle: 'Test', setupNotes: '' };
      expect(computeApproverChanges(current, original)).toBeNull();
    });

    it('treats null and empty string as equivalent', () => {
      const original = { eventTitle: 'Test', doorNotes: null };
      const current = { eventTitle: 'Test', doorNotes: '' };
      expect(computeApproverChanges(current, original)).toBeNull();
    });
  });

  describe('simple field changes', () => {
    it('detects title change', () => {
      const original = { eventTitle: 'Original' };
      const current = { eventTitle: 'Modified' };
      const result = computeApproverChanges(current, original);
      expect(result).toEqual({ eventTitle: 'Modified' });
    });

    it('detects description change', () => {
      const original = { eventDescription: 'Old desc' };
      const current = { eventDescription: 'New desc' };
      const result = computeApproverChanges(current, original);
      expect(result).toEqual({ eventDescription: 'New desc' });
    });

    it('detects multiple field changes', () => {
      const original = { eventTitle: 'Old', eventDescription: 'Old desc', attendeeCount: '50' };
      const current = { eventTitle: 'New', eventDescription: 'New desc', attendeeCount: '100' };
      const result = computeApproverChanges(current, original);
      expect(result).toEqual({
        eventTitle: 'New',
        eventDescription: 'New desc',
        attendeeCount: '100',
      });
    });

    it('only returns changed fields, not unchanged ones', () => {
      const original = { eventTitle: 'Same', eventDescription: 'Old desc' };
      const current = { eventTitle: 'Same', eventDescription: 'New desc' };
      const result = computeApproverChanges(current, original);
      expect(result).toEqual({ eventDescription: 'New desc' });
      expect(result.eventTitle).toBeUndefined();
    });
  });

  describe('date/time changes', () => {
    it('composes startDateTime from date and time changes', () => {
      const original = { startDate: '2026-03-01', startTime: '10:00' };
      const current = { startDate: '2026-03-01', startTime: '14:00' };
      const result = computeApproverChanges(current, original);
      expect(result.startDateTime).toBe('2026-03-01T14:00');
      expect(result.startTime).toBe('14:00');
    });

    it('composes endDateTime from date and time changes', () => {
      const original = { endDate: '2026-03-01', endTime: '17:00' };
      const current = { endDate: '2026-03-02', endTime: '17:00' };
      const result = computeApproverChanges(current, original);
      expect(result.endDateTime).toBe('2026-03-02T17:00');
      expect(result.endDate).toBe('2026-03-02');
    });

    it('does not compose dateTime when dates have not changed', () => {
      const original = { startDate: '2026-03-01', startTime: '10:00', endDate: '2026-03-01', endTime: '17:00' };
      const current = { startDate: '2026-03-01', startTime: '10:00', endDate: '2026-03-01', endTime: '17:00' };
      const result = computeApproverChanges(current, original);
      expect(result).toBeNull();
    });
  });

  describe('array field changes', () => {
    it('detects locations change', () => {
      const original = { locations: ['room1', 'room2'] };
      const current = { locations: ['room1', 'room3'] };
      const result = computeApproverChanges(current, original);
      expect(result.locations).toEqual(['room1', 'room3']);
    });

    it('detects categories change', () => {
      const original = { categories: ['Music'] };
      const current = { categories: ['Music', 'Art'] };
      const result = computeApproverChanges(current, original);
      expect(result.categories).toEqual(['Music', 'Art']);
    });

    it('treats same elements in different order as equal', () => {
      const original = { locations: ['room2', 'room1'] };
      const current = { locations: ['room1', 'room2'] };
      const result = computeApproverChanges(current, original);
      expect(result).toBeNull();
    });

    it('handles empty vs non-empty arrays', () => {
      const original = { locations: [] };
      const current = { locations: ['room1'] };
      const result = computeApproverChanges(current, original);
      expect(result.locations).toEqual(['room1']);
    });
  });

  describe('object field changes', () => {
    it('detects services change', () => {
      const original = { services: { catering: 'yes' } };
      const current = { services: { catering: 'yes', av: 'yes' } };
      const result = computeApproverChanges(current, original);
      expect(result.services).toEqual({ catering: 'yes', av: 'yes' });
    });

    it('treats identical objects as equal', () => {
      const original = { services: { catering: 'yes' } };
      const current = { services: { catering: 'yes' } };
      const result = computeApproverChanges(current, original);
      expect(result).toBeNull();
    });
  });

  describe('realistic edit request scenario', () => {
    it('detects only approver modifications on top of requester changes', () => {
      // Original published event
      const original = {
        eventTitle: 'Board Meeting',
        eventDescription: 'Monthly board meeting',
        startDate: '2026-03-15',
        startTime: '09:00',
        endDate: '2026-03-15',
        endTime: '11:00',
        locations: ['room-a'],
        categories: ['Meeting'],
        attendeeCount: '20',
      };

      // Form state after requester proposed title + description change,
      // and approver further modified the title
      const current = {
        eventTitle: 'Approver Modified Title',          // Approver changed from requester's proposal
        eventDescription: 'Updated board meeting desc',  // Requester's proposed change
        startDate: '2026-03-15',
        startTime: '09:00',
        endDate: '2026-03-15',
        endTime: '11:00',
        locations: ['room-a'],
        categories: ['Meeting'],
        attendeeCount: '20',
      };

      const result = computeApproverChanges(current, original);
      // Should detect both title and description as changed from original
      expect(result).toEqual({
        eventTitle: 'Approver Modified Title',
        eventDescription: 'Updated board meeting desc',
      });
    });
  });
});
