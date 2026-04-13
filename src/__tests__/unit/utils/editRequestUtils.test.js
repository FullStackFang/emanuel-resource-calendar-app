/**
 * Tests for editRequestUtils.js
 *
 * Tests the computeApproverChanges utility that determines what fields
 * an approver/admin has modified when reviewing an edit request.
 */

import { describe, it, expect } from 'vitest';
import { computeApproverChanges, decomposeProposedChanges, buildEditRequestViewData } from '../../../utils/editRequestUtils';

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

// ============================================================================
// buildEditRequestViewData
// ============================================================================

describe('buildEditRequestViewData', () => {
  // Helper: build a realistic currentData (the editableData before overlay)
  const makeCurrentData = (overrides = {}) => ({
    _id: 'event-123',
    eventId: 'evt-abc',
    status: 'published',
    _version: 5,
    eventTitle: 'Board Meeting',
    startDate: '2026-04-15',
    startTime: '10:00',
    endDate: '2026-04-15',
    endTime: '11:00',
    setupTime: '09:30',
    doorOpenTime: '09:45',
    attendeeCount: 50,
    specialRequirements: 'Projector needed',
    calendarData: {
      eventTitle: 'Board Meeting',
      startDateTime: '2026-04-15T10:00:00',
      endDateTime: '2026-04-15T11:00:00',
      startDate: '2026-04-15',
      startTime: '10:00',
      endDate: '2026-04-15',
      endTime: '11:00',
      setupTime: '09:30',
      doorOpenTime: '09:45',
      attendeeCount: 50,
      specialRequirements: 'Projector needed',
      locations: ['room-a'],
      locationDisplayNames: 'Room A',
      categories: ['Meeting'],
    },
    roomReservationData: {
      requestedBy: { name: 'Jane Doe', email: 'jane@example.com', userId: 'user-1' },
      organizer: { name: 'John Org', phone: '555-1234', email: 'john@example.com' },
    },
    graphData: { id: 'graph-event-1', subject: 'Board Meeting' },
    pendingEditRequest: null,
    ...overrides,
  });

  // Helper: build a realistic event (from reviewModal.currentItem)
  const makeEvent = (proposedChanges, overrides = {}) => ({
    _id: 'event-123',
    eventId: 'evt-abc',
    status: 'published',
    _version: 5,
    pendingEditRequest: {
      id: 'edit-req-001',
      status: 'pending',
      requestedBy: { userId: 'user-1', email: 'jane@example.com', name: 'Jane Doe', requestedAt: new Date('2026-04-13') },
      proposedChanges,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: '',
    },
    ...overrides,
  });

  describe('null/edge case handling', () => {
    it('returns currentData when event has no pendingEditRequest', () => {
      const currentData = makeCurrentData();
      const event = { _id: 'event-123', status: 'published' }; // no pendingEditRequest
      const result = buildEditRequestViewData(event, currentData);
      expect(result).toBe(currentData);
    });

    it('returns currentData when event is null', () => {
      const currentData = makeCurrentData();
      const result = buildEditRequestViewData(null, currentData);
      expect(result).toBe(currentData);
    });

    it('handles empty proposedChanges gracefully', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({});
      const result = buildEditRequestViewData(event, currentData);
      // calendarData should still be present (original preserved)
      expect(result.calendarData.eventTitle).toBe('Board Meeting');
    });
  });

  describe('preserves original event metadata', () => {
    it('preserves roomReservationData from currentData', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ eventTitle: 'New Title' });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.roomReservationData).toEqual(currentData.roomReservationData);
      expect(result.roomReservationData.organizer.name).toBe('John Org');
    });

    it('preserves graphData from currentData', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ eventTitle: 'New Title' });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.graphData).toEqual(currentData.graphData);
    });

    it('preserves _version from currentData', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ eventTitle: 'New Title' });
      const result = buildEditRequestViewData(event, currentData);
      expect(result._version).toBe(5);
    });

    it('preserves event status (published), NOT edit request status (pending)', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ eventTitle: 'New Title' });
      const result = buildEditRequestViewData(event, currentData);
      // Event status must remain 'published', not clobbered by edit request 'pending'
      expect(result.status).toBe('published');
    });

    it('attaches pendingEditRequest from event', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ eventTitle: 'New Title' });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.pendingEditRequest.id).toBe('edit-req-001');
      expect(result.pendingEditRequest.status).toBe('pending');
      expect(result.pendingEditRequest.proposedChanges.eventTitle).toBe('New Title');
    });
  });

  describe('overlays proposed changes correctly', () => {
    it('overlays eventTitle onto calendarData and top level', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ eventTitle: 'Staff Meeting' });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.calendarData.eventTitle).toBe('Staff Meeting');
      expect(result.eventTitle).toBe('Staff Meeting');
    });

    it('overlays startDateTime with decomposed date/time fields', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ startDateTime: '2026-04-15T14:00:00' });
      const result = buildEditRequestViewData(event, currentData);
      // calendarData overlay
      expect(result.calendarData.startDateTime).toBe('2026-04-15T14:00:00');
      expect(result.calendarData.startDate).toBe('2026-04-15');
      expect(result.calendarData.startTime).toBe('14:00');
      // top-level flat overlay (for computeDetectedChanges)
      expect(result.startDate).toBe('2026-04-15');
      expect(result.startTime).toBe('14:00');
    });

    it('preserves unchanged calendarData fields when only title changed', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ eventTitle: 'New Title' });
      const result = buildEditRequestViewData(event, currentData);
      // Unchanged fields should still come from original calendarData
      expect(result.calendarData.startDateTime).toBe('2026-04-15T10:00:00');
      expect(result.calendarData.setupTime).toBe('09:30');
      expect(result.calendarData.locations).toEqual(['room-a']);
    });

    it('overlays multiple proposed changes at once', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({
        eventTitle: 'Updated Meeting',
        setupTime: '08:00',
        attendeeCount: 100,
        categories: ['Meeting', 'Board'],
      });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.calendarData.eventTitle).toBe('Updated Meeting');
      expect(result.calendarData.setupTime).toBe('08:00');
      expect(result.calendarData.attendeeCount).toBe(100);
      expect(result.calendarData.categories).toEqual(['Meeting', 'Board']);
    });
  });

  describe('falsy value preservation (the || bug fix)', () => {
    it('preserves empty string eventTitle (cleared by requester)', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ eventTitle: '' });
      const result = buildEditRequestViewData(event, currentData);
      // Must be empty string, NOT fall back to 'Board Meeting'
      expect(result.calendarData.eventTitle).toBe('');
      expect(result.eventTitle).toBe('');
    });

    it('preserves empty string setupTime (cleared by requester)', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ setupTime: '' });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.calendarData.setupTime).toBe('');
      expect(result.setupTime).toBe('');
    });

    it('preserves null attendeeCount (cleared by requester)', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ attendeeCount: null });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.calendarData.attendeeCount).toBeNull();
      expect(result.attendeeCount).toBeNull();
    });

    it('preserves 0 as a valid proposed value', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ setupTimeMinutes: 0 });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.calendarData.setupTimeMinutes).toBe(0);
      expect(result.setupTimeMinutes).toBe(0);
    });

    it('preserves false as a valid proposed value', () => {
      const currentData = makeCurrentData({
        calendarData: {
          ...makeCurrentData().calendarData,
          isOffsite: true,
        },
        isOffsite: true,
      });
      const event = makeEvent({ isOffsite: false });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.calendarData.isOffsite).toBe(false);
      expect(result.isOffsite).toBe(false);
    });
  });

  describe('fields previously missing from manual mapping', () => {
    it('overlays virtualMeetingUrl from proposedChanges', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ virtualMeetingUrl: 'https://zoom.us/meeting/123' });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.calendarData.virtualMeetingUrl).toBe('https://zoom.us/meeting/123');
    });

    it('overlays contactName from proposedChanges', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ contactName: 'Alice Smith', isOnBehalfOf: true });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.calendarData.contactName).toBe('Alice Smith');
      expect(result.calendarData.isOnBehalfOf).toBe(true);
    });

    it('overlays offsiteLat/offsiteLon from proposedChanges', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ offsiteLat: 40.7128, offsiteLon: -74.006 });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.calendarData.offsiteLat).toBe(40.7128);
      expect(result.calendarData.offsiteLon).toBe(-74.006);
    });

    it('overlays organizerName from proposedChanges', () => {
      const currentData = makeCurrentData();
      const event = makeEvent({ organizerName: 'New Organizer' });
      const result = buildEditRequestViewData(event, currentData);
      expect(result.calendarData.organizerName).toBe('New Organizer');
      expect(result.organizerName).toBe('New Organizer');
    });
  });
});
