// src/__tests__/unit/hooks/useReviewModal.prefetchParams.test.js
//
// Locks in calendarOwner scoping for the modal-open availability prefetch.
//
// Background: commit a98c66b ("fix(scheduling): scope room availability +
// conflict checks to single calendar") patched the form-base's own fetches
// (RoomReservationFormBase.checkAvailability / checkDayAvailability) but
// missed the prefetch in useReviewModal.openModal -> prefetchModalData.
//
// Without this scoping, editing an rsSched event surfaces BOTH the
// sandbox and prod copies (templeevents@... + templeeventssandbox@...,
// same eventId, by-design (eventId, calendarOwner) duplicates) as
// side-by-side conflicts in the SchedulingAssistant.
//
// These tests guard the prefetch param construction directly. They do not
// exercise the full hook (which has heavy dependencies); the assumption
// is that prefetchModalData forwards the result to fetch() unchanged.
import { describe, it, expect, afterEach } from 'vitest';
import { buildPrefetchAvailabilityParams } from '../../../hooks/useReviewModal';
import APP_CONFIG from '../../../config/config';

const ITEM_BASE = {
  _id: '6720d3a9b6a7f0123456abcd',
  startDate: '2026-05-16',
};
const GATES_BASE = {
  itemStartDate: '2026-05-16',
  roomIds: ['6912551e9a0bc143b1444386'],
};

describe('buildPrefetchAvailabilityParams', () => {
  const originalDefault = APP_CONFIG.DEFAULT_DISPLAY_CALENDAR;
  afterEach(() => {
    APP_CONFIG.DEFAULT_DISPLAY_CALENDAR = originalDefault;
  });

  it('PP-1: uses item.calendarOwner when present', () => {
    const item = { ...ITEM_BASE, calendarOwner: 'templeevents@emanuelnyc.org' };
    const params = buildPrefetchAvailabilityParams(item, GATES_BASE);
    expect(params.get('calendarOwner')).toBe('templeevents@emanuelnyc.org');
  });

  it('PP-2: prefers item.calendarOwner over APP_CONFIG default', () => {
    APP_CONFIG.DEFAULT_DISPLAY_CALENDAR = 'templeeventssandbox@emanuelnyc.org';
    const item = { ...ITEM_BASE, calendarOwner: 'templeevents@emanuelnyc.org' };
    const params = buildPrefetchAvailabilityParams(item, GATES_BASE);
    expect(params.get('calendarOwner')).toBe('templeevents@emanuelnyc.org');
  });

  it('PP-3: falls back to APP_CONFIG.DEFAULT_DISPLAY_CALENDAR when item.calendarOwner is absent', () => {
    APP_CONFIG.DEFAULT_DISPLAY_CALENDAR = 'templeevents@emanuelnyc.org';
    const item = { ...ITEM_BASE };
    const params = buildPrefetchAvailabilityParams(item, GATES_BASE);
    expect(params.get('calendarOwner')).toBe('templeevents@emanuelnyc.org');
  });

  it('PP-4: omits calendarOwner when both item and APP_CONFIG default are empty', () => {
    APP_CONFIG.DEFAULT_DISPLAY_CALENDAR = '';
    const item = { ...ITEM_BASE };
    const params = buildPrefetchAvailabilityParams(item, GATES_BASE);
    // Backend will return unfiltered results in this case; the warning the
    // backend logs is the safety net. Frontend shouldn't fabricate a scope.
    expect(params.get('calendarOwner')).toBeNull();
  });

  it('PP-5: includes excludeEventId from item._id (current event exclusion)', () => {
    const item = { ...ITEM_BASE, calendarOwner: 'templeevents@emanuelnyc.org' };
    const params = buildPrefetchAvailabilityParams(item, GATES_BASE);
    expect(params.get('excludeEventId')).toBe(ITEM_BASE._id);
  });

  it('PP-6: omits excludeEventId when item has no _id (new event)', () => {
    const item = { calendarOwner: 'templeevents@emanuelnyc.org' };
    const params = buildPrefetchAvailabilityParams(item, GATES_BASE);
    expect(params.get('excludeEventId')).toBeNull();
  });

  it('PP-7: builds the full-day window from gates.itemStartDate', () => {
    const item = { ...ITEM_BASE, calendarOwner: 'templeevents@emanuelnyc.org' };
    const params = buildPrefetchAvailabilityParams(item, GATES_BASE);
    expect(params.get('startDateTime')).toBe('2026-05-16T00:00:00');
    expect(params.get('endDateTime')).toBe('2026-05-16T23:59:59');
  });

  it('PP-8: joins multiple roomIds with comma', () => {
    const item = { ...ITEM_BASE, calendarOwner: 'templeevents@emanuelnyc.org' };
    const gates = { itemStartDate: '2026-05-16', roomIds: ['room-a', 'room-b', 'room-c'] };
    const params = buildPrefetchAvailabilityParams(item, gates);
    expect(params.get('roomIds')).toBe('room-a,room-b,room-c');
  });

  it('PP-9: lowercases calendarOwner so the backend (which normalizes to lowercase) matches exactly', () => {
    // Backend does String(req.query.calendarOwner).toLowerCase() and stores
    // calendarOwner lowercased on docs. Sending mixed-case is functionally
    // fine but normalizing here keeps URLs identical across callers.
    const item = { ...ITEM_BASE, calendarOwner: 'TempleEvents@emanuelnyc.org' };
    const params = buildPrefetchAvailabilityParams(item, GATES_BASE);
    expect(params.get('calendarOwner')).toBe('templeevents@emanuelnyc.org');
  });
});
