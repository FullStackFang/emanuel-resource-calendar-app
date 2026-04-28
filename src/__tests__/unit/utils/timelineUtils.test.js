import { describe, it, expect } from 'vitest';
import { isTimelessDraft } from '../../../utils/timelineUtils';

describe('isTimelessDraft', () => {
  it('TD-1: returns true for draft with no times of any kind', () => {
    const event = {
      status: 'draft',
      calendarData: {
        startTime: null,
        endTime: null,
        reservationStartTime: null,
        reservationEndTime: null,
      },
    };
    expect(isTimelessDraft(event)).toBe(true);
  });

  it('TD-2: returns false for draft with event times set, no reservation times', () => {
    const event = {
      status: 'draft',
      calendarData: {
        startTime: '14:00',
        endTime: '16:00',
        reservationStartTime: null,
        reservationEndTime: null,
      },
    };
    expect(isTimelessDraft(event)).toBe(false);
  });

  it('TD-3: returns false for [Hold] draft with only reservation times set (regression for All Day bug)', () => {
    const event = {
      status: 'draft',
      calendarData: {
        startTime: '',
        endTime: '',
        reservationStartTime: '19:00',
        reservationEndTime: '21:00',
      },
    };
    expect(isTimelessDraft(event)).toBe(false);
  });

  it('TD-4: returns false for draft with both event AND reservation times', () => {
    const event = {
      status: 'draft',
      calendarData: {
        startTime: '19:00',
        endTime: '21:00',
        reservationStartTime: '18:30',
        reservationEndTime: '21:30',
      },
    };
    expect(isTimelessDraft(event)).toBe(false);
  });

  it('TD-5: returns false for pending event with no times (status guard)', () => {
    const event = {
      status: 'pending',
      calendarData: {
        startTime: null,
        endTime: null,
      },
    };
    expect(isTimelessDraft(event)).toBe(false);
  });

  it('TD-6: returns false for published event regardless of times (status guard)', () => {
    const event = {
      status: 'published',
      calendarData: {
        startTime: null,
        endTime: null,
      },
    };
    expect(isTimelessDraft(event)).toBe(false);
  });

  it('TD-7: returns false for null or undefined event (null safety)', () => {
    expect(isTimelessDraft(null)).toBe(false);
    expect(isTimelessDraft(undefined)).toBe(false);
  });

  it('TD-8: returns true for draft with missing calendarData (treats absence as no times)', () => {
    const event = { status: 'draft' };
    expect(isTimelessDraft(event)).toBe(true);
  });

  it('TD-9: empty-string event times still count as no event times when reservations exist', () => {
    const event = {
      status: 'draft',
      calendarData: {
        startTime: '',
        endTime: '',
        reservationStartTime: '09:00',
        reservationEndTime: '10:00',
      },
    };
    expect(isTimelessDraft(event)).toBe(false);
  });

  it('TD-10: only reservationStartTime set (not endTime) still counts as having reservation times', () => {
    const event = {
      status: 'draft',
      calendarData: {
        startTime: null,
        endTime: null,
        reservationStartTime: '09:00',
        reservationEndTime: null,
      },
    };
    expect(isTimelessDraft(event)).toBe(false);
  });
});
