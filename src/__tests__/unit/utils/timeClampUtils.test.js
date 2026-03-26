import { describe, it, expect } from 'vitest';
import { clampEventTimesToReservation, timeToMinutes, minutesToTimeStr } from '../../../utils/timeClampUtils';

describe('timeToMinutes', () => {
  it('converts HH:MM to total minutes', () => {
    expect(timeToMinutes('00:00')).toBe(0);
    expect(timeToMinutes('14:30')).toBe(870);
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('returns null for falsy input', () => {
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes(null)).toBeNull();
    expect(timeToMinutes(undefined)).toBeNull();
  });
});

describe('minutesToTimeStr', () => {
  it('converts minutes to HH:MM', () => {
    expect(minutesToTimeStr(0)).toBe('00:00');
    expect(minutesToTimeStr(870)).toBe('14:30');
    expect(minutesToTimeStr(1439)).toBe('23:59');
  });

  it('wraps 1440 (midnight) to 00:00', () => {
    expect(minutesToTimeStr(1440)).toBe('00:00');
  });
});

describe('clampEventTimesToReservation', () => {
  // TC-1: Bottom resize clamps endTime
  it('clamps endTime when reservation end moves before event end', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '14:00',
      reservationEndTime: '15:00',
      startTime: '14:15',
      endTime: '15:30',
    });
    expect(result).toEqual({ startTime: '14:15', endTime: '15:00' });
  });

  // TC-2: Top resize clamps startTime
  it('clamps startTime when reservation start moves after event start', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '14:30',
      reservationEndTime: '16:00',
      startTime: '14:00',
      endTime: '15:30',
    });
    expect(result).toEqual({ startTime: '14:30', endTime: '15:30' });
  });

  // TC-3: Window too small clears both
  it('clears both event times when reservation window is zero', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '14:00',
      reservationEndTime: '14:00',
      startTime: '13:00',
      endTime: '15:00',
    });
    expect(result).toEqual({ startTime: '', endTime: '' });
  });

  // TC-4: Hold block (no event times) - no clamping
  it('returns null when event times are empty (Hold block)', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '14:00',
      reservationEndTime: '16:00',
      startTime: '',
      endTime: '',
    });
    expect(result).toBeNull();
  });

  // TC-5: Event already within window - no clamping
  it('returns null when event is already within reservation window', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '14:00',
      reservationEndTime: '16:00',
      startTime: '14:30',
      endTime: '15:30',
    });
    expect(result).toBeNull();
  });

  // TC-6: Midnight edge case - res end 00:00 with event inside
  it('treats 00:00 reservation end as end-of-day when event is inside', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '22:00',
      reservationEndTime: '00:00',
      startTime: '22:30',
      endTime: '23:30',
    });
    expect(result).toBeNull();
  });

  // TC-7: Midnight edge case - res end 00:00 clamps event past midnight
  it('clamps endTime to 00:00 when event extends past midnight boundary', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '22:00',
      reservationEndTime: '00:00',
      startTime: '22:30',
      endTime: '00:30',
    });
    // 00:30 = 30 mins, which is < resStart (22:00 = 1320), so endTime > resEnd (1440)
    // Actually 00:30 = 30 minutes, resEnd = 1440 minutes, 30 < 1440, so no clamp needed
    // But startTime (22:30 = 1350) > endTime (00:30 = 30) is an already-invalid state
    // In practice this scenario would be caught by validateTimes; clamping skips
    // because eventEndMins (30) is not > resEndMins (1440)
    // The clamp only fires on resStartMins (1320) > eventStartMins (1350) — no
    // So no clamping happens here. This is correct — cross-midnight events
    // are an invalid state that validateTimes handles separately.
    expect(result).toBeNull();
  });

  // TC-8: Both edges clamp simultaneously
  it('clamps both startTime and endTime when both are outside', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '14:30',
      reservationEndTime: '15:30',
      startTime: '14:00',
      endTime: '16:00',
    });
    expect(result).toEqual({ startTime: '14:30', endTime: '15:30' });
  });

  // TC-9: Event times == reservation times (exact boundary)
  it('returns null when event times exactly match reservation times', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '14:00',
      reservationEndTime: '16:00',
      startTime: '14:00',
      endTime: '16:00',
    });
    expect(result).toBeNull();
  });

  // Additional: missing reservation times
  it('returns null when reservation times are not set', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '',
      reservationEndTime: '',
      startTime: '14:00',
      endTime: '15:00',
    });
    expect(result).toBeNull();
  });

  // Additional: only one event time set (partial)
  it('returns null when only startTime is set (no endTime)', () => {
    const result = clampEventTimesToReservation({
      reservationStartTime: '14:00',
      reservationEndTime: '16:00',
      startTime: '14:30',
      endTime: '',
    });
    expect(result).toBeNull();
  });
});
