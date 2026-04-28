import { describe, it, expect } from 'vitest';
import {
  computeDetectedChanges,
  computeApproverChanges,
  buildEditRequestViewData,
  getRecurrenceChangeBanner,
} from '../../../utils/editRequestUtils';
import { buildEditRequestPayload } from '../../../utils/eventPayloadBuilder';

const baseFields = {
  eventTitle: 'Weekly Standup',
  eventDescription: '',
  startDate: '2026-04-20',
  startTime: '09:00',
  endDate: '2026-04-20',
  endTime: '10:00',
};

const weeklyMonday = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
const weeklyMonWed = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };

describe('computeDetectedChanges — recurrence', () => {
  it('detects no change when recurrence is identical', () => {
    const original = { ...baseFields, recurrence: weeklyMonday };
    const current = { ...baseFields, recurrence: { ...weeklyMonday } };
    const changes = computeDetectedChanges(original, current);
    expect(changes.find(c => c.field === 'recurrence')).toBeUndefined();
  });

  it('detects change when daysOfWeek differs', () => {
    const original = { ...baseFields, recurrence: weeklyMonday };
    const current = { ...baseFields, recurrence: weeklyMonWed };
    const changes = computeDetectedChanges(original, current);
    const recRow = changes.find(c => c.field === 'recurrence');
    expect(recRow).toBeDefined();
    expect(recRow.label).toBe('Recurrence');
    expect(recRow.oldValue).toContain('Monday');
    expect(recRow.newValue).toContain('Monday');
    expect(recRow.newValue).toContain('Wednesday');
  });

  it('detects change when adding recurrence to a non-recurring event (promotion, Q2=B)', () => {
    const original = { ...baseFields, recurrence: null };
    const current = { ...baseFields, recurrence: weeklyMonday };
    const changes = computeDetectedChanges(original, current);
    const recRow = changes.find(c => c.field === 'recurrence');
    expect(recRow).toBeDefined();
    expect(recRow.oldValue).toBe('(none)');
  });

  it('detects change when exclusions added', () => {
    const original = { ...baseFields, recurrence: { ...weeklyMonday, exclusions: [] } };
    const current = { ...baseFields, recurrence: { ...weeklyMonday, exclusions: ['2026-04-27'] } };
    const changes = computeDetectedChanges(original, current);
    expect(changes.find(c => c.field === 'recurrence')).toBeDefined();
  });

  it('treats permuted daysOfWeek arrays as no change', () => {
    const a = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday', 'monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const original = { ...baseFields, recurrence: a };
    const current = { ...baseFields, recurrence: b };
    expect(computeDetectedChanges(original, current).find(c => c.field === 'recurrence')).toBeUndefined();
  });
});

describe('computeApproverChanges — recurrence', () => {
  it('omits recurrence when unchanged from original', () => {
    const original = { ...baseFields, recurrence: weeklyMonday };
    const current = { ...baseFields, recurrence: { ...weeklyMonday } };
    expect(computeApproverChanges(current, original)?.recurrence).toBeUndefined();
  });

  it('includes recurrence when approver tweaked it', () => {
    const original = { ...baseFields, recurrence: weeklyMonday };
    const current = { ...baseFields, recurrence: weeklyMonWed };
    const delta = computeApproverChanges(current, original);
    expect(delta).not.toBeNull();
    expect(delta.recurrence).toEqual(weeklyMonWed);
  });
});

describe('getRecurrenceChangeBanner', () => {
  it('returns null when both sides are missing', () => {
    expect(getRecurrenceChangeBanner(null, null)).toBeNull();
    expect(getRecurrenceChangeBanner(undefined, undefined)).toBeNull();
  });

  it('returns null when recurrence is unchanged', () => {
    expect(getRecurrenceChangeBanner(weeklyMonday, { ...weeklyMonday })).toBeNull();
  });

  it('returns null for permuted daysOfWeek (set-equal)', () => {
    const a = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    const b = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['wednesday', 'monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } };
    expect(getRecurrenceChangeBanner(a, b)).toBeNull();
  });

  it('returns oldText/newText with summaries when pattern changed', () => {
    const result = getRecurrenceChangeBanner(weeklyMonday, weeklyMonWed);
    expect(result).not.toBeNull();
    expect(result.oldText).toContain('Monday');
    expect(result.newText).toContain('Wednesday');
  });

  it('returns oldText="(none)" when promoting a non-recurring event', () => {
    const result = getRecurrenceChangeBanner(null, weeklyMonday);
    expect(result).not.toBeNull();
    expect(result.oldText).toBe('(none)');
    expect(result.newText).toContain('Monday');
  });

  it('returns newText="(none)" when removing recurrence', () => {
    const result = getRecurrenceChangeBanner(weeklyMonday, null);
    expect(result).not.toBeNull();
    expect(result.oldText).toContain('Monday');
    expect(result.newText).toBe('(none)');
  });

  it('detects exclusion-only changes', () => {
    const before = { ...weeklyMonday, exclusions: [] };
    const after = { ...weeklyMonday, exclusions: ['2026-04-27'] };
    expect(getRecurrenceChangeBanner(before, after)).not.toBeNull();
  });
});

describe('buildEditRequestViewData — recurrence overlay', () => {
  it('overlays proposed recurrence at top level', () => {
    const event = {
      _version: 3,
      calendarData: { eventTitle: 'X' },
      recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } },
      pendingEditRequest: {
        proposedChanges: {
          recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } },
        },
      },
    };
    const result = buildEditRequestViewData(event, { calendarData: event.calendarData, recurrence: event.recurrence });
    expect(result.recurrence.pattern.daysOfWeek).toEqual(['monday', 'wednesday']);
    expect(result.calendarData.recurrence.pattern.daysOfWeek).toEqual(['monday', 'wednesday']);
  });
});

describe('buildEditRequestPayload — recurrence', () => {
  it('includes recurrence when provided', () => {
    const data = {
      eventTitle: 'X',
      startDate: '2026-04-20', startTime: '09:00',
      endDate: '2026-04-20', endTime: '10:00',
      attendeeCount: 5,
      recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday'] }, range: { type: 'noEnd', startDate: '2026-04-20' } },
    };
    const payload = buildEditRequestPayload(data, { eventVersion: 1 });
    expect(payload.recurrence).toEqual(data.recurrence);
  });

  it('omits recurrence key when not provided (gets stripped by JSON.stringify)', () => {
    const data = { eventTitle: 'X', startDate: '2026-04-20', startTime: '09:00', endDate: '2026-04-20', endTime: '10:00' };
    const payload = buildEditRequestPayload(data, { eventVersion: 1 });
    expect(JSON.parse(JSON.stringify(payload)).recurrence).toBeUndefined();
  });

  // Regression: editing a series master from any entry that bypasses
  // RecurringScopeDialog (deep link, search/jump, MyReservations,
  // ReservationRequests) used to be blocked by a frontend guard in
  // useReviewModal.handleSubmitEditRequest. The fix defaults the scope to
  // 'allEvents' since editing the master document IS a series-level edit.
  // This locks the resulting payload contract.
  it('preserves editScope=allEvents and seriesMasterId for direct series-master edits', () => {
    const data = {
      eventTitle: 'Master',
      startDate: '2026-04-28', startTime: '10:00',
      endDate: '2026-04-28', endTime: '11:00',
    };
    const payload = buildEditRequestPayload(data, {
      eventVersion: 5,
      editScope: 'allEvents',
      seriesMasterId: 'master-graph-id',
    });
    const serialized = JSON.parse(JSON.stringify(payload));
    expect(serialized.editScope).toBe('allEvents');
    expect(serialized.seriesMasterId).toBe('master-graph-id');
    expect('occurrenceDate' in serialized).toBe(false);
  });
});
