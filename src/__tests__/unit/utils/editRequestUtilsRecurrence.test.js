import { describe, it, expect } from 'vitest';
import { computeDetectedChanges, computeApproverChanges, buildEditRequestViewData } from '../../../utils/editRequestUtils';
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
});
