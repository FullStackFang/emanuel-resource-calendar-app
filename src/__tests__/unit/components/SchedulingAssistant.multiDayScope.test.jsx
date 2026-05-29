// src/__tests__/unit/components/SchedulingAssistant.multiDayScope.test.jsx
//
// The Scheduling Assistant timeline + verdict only ever cover the START DAY
// (buildBlockFromStrings clamps multi-day events to the viewed day). For a
// multi-day event that misled the original bug report ("preview looks like no
// conflicts because it constrains to the day"), the assistant must be HONEST
// about that scope rather than implying a whole-event clearance. These tests
// lock that honest labeling: a scope note appears for multi-day events
// (independent of start-day event count) and is absent for single-day events.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SchedulingAssistant from '../../../components/SchedulingAssistant';

const VIEWED_DATE = '2027-06-18';
const ROOM = { _id: 'room-sanctuary', name: '5th Avenue Sanctuary' };

function renderAssistant(extraProps = {}) {
  return render(
    <SchedulingAssistant
      selectedRooms={[ROOM]}
      selectedDate={VIEWED_DATE}
      availability={[{ room: ROOM, conflicts: { reservations: [] } }]}
      availabilityLoading={false}
      eventStartTime="12:30"
      eventEndTime="19:30"
      eventTitle="Kingdon Wedding"
      onConflictChange={vi.fn()}
      {...extraProps}
    />
  );
}

describe('SchedulingAssistant — multi-day scope honesty', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('shows the start-day-only scope note when isMultiDaySpan is true', () => {
    renderAssistant({ isMultiDaySpan: true });
    expect(screen.queryByText(/shows the start day only/i)).toBeTruthy();
  });

  it('does NOT show the scope note for a single-day event (default)', () => {
    renderAssistant({ isMultiDaySpan: false });
    expect(screen.queryByText(/shows the start day only/i)).toBeNull();
  });

  it('hides the scope note when no rooms are selected even if multi-day', () => {
    render(
      <SchedulingAssistant
        selectedRooms={[]}
        selectedDate={VIEWED_DATE}
        isMultiDaySpan={true}
        availability={[]}
        availabilityLoading={false}
        eventStartTime="12:30"
        eventEndTime="19:30"
        eventTitle="Kingdon Wedding"
        onConflictChange={vi.fn()}
      />
    );
    expect(screen.queryByText(/shows the start day only/i)).toBeNull();
  });

  it('shows a full-span conflict warning (room, day, title) when the dry-run finds conflicts', () => {
    renderAssistant({
      isMultiDaySpan: true,
      spanConflicts: {
        hardConflicts: [
          { eventTitle: '[Hold] Test Conflict', startDateTime: '2027-06-18T10:00:00', locationDisplayNames: '5th Avenue Sanctuary' },
        ],
        softConflicts: [],
      },
    });
    expect(screen.queryByText(/1 conflict across the event span/i)).toBeTruthy();
    // Query the conflict line specifically (room name also appears in the room tab);
    // "· Jun 18" is unique to the conflict-list item and confirms room + day + title render.
    expect(screen.queryByText(/5th Avenue Sanctuary · Jun 18 — \[Hold\] Test Conflict/)).toBeTruthy();
    // a real verdict replaces the "start day only" scope note
    expect(screen.queryByText(/shows the start day only/i)).toBeNull();
  });

  it('shows an all-clear verdict when the full span has no conflicts', () => {
    renderAssistant({ isMultiDaySpan: true, spanConflicts: { hardConflicts: [], softConflicts: [] } });
    expect(screen.queryByText(/No conflicts across any day/i)).toBeTruthy();
  });

  it('shows a checking state while the span dry-run is in flight', () => {
    renderAssistant({ isMultiDaySpan: true, spanConflictsLoading: true, spanConflicts: null });
    expect(screen.queryByText(/Checking all days/i)).toBeTruthy();
  });
});
