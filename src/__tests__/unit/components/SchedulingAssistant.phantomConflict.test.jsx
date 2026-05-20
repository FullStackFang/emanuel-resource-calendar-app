// src/__tests__/unit/components/SchedulingAssistant.phantomConflict.test.jsx
//
// Regression tests for the "phantom conflict" bug: a recurring series master
// returned by the backend BOTH as a day-scoped occurrence AND as a full-range
// entry produces two blocks for the same room. buildBlockFromStrings clamps the
// full-range entry to day boundaries (start -> 0, end -> 24), creating a
// midnight-to-midnight phantom block that overlaps any user event. The phantom
// is deduped before render, so the timeline shows only the real (non-overlapping)
// occurrence — yet the conflict count was tallied BEFORE dedup, so the room tab
// badge shows a conflict that the user cannot see.
//
// Reproduces the screenshot scenario: a 6-8 PM user event flagged as conflicting
// with a "Nursery School Drop off and Dismissal" event that runs 8:45 AM-2:30 PM.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import SchedulingAssistant from '../../../components/SchedulingAssistant';

const VIEWED_DATE = '2026-09-16';
const ROOM = { _id: 'room-lls', name: 'LLS Auditorium' };

// A series master that the backend returns twice for the same room:
//  - a full-range entry (spans prior day through far future) -> clamps to 0..24
//  - the real day-scoped occurrence on the viewed day (8:45 AM - 2:30 PM)
function makeDuplicateNurserySchool() {
  return [
    {
      _id: 'nursery-school', // SAME id -> dedup key collision
      eventTitle: 'Nursery School Drop off and Dismissal at 65th Street',
      status: 'published',
      effectiveStart: '2026-09-15T08:45:00', // prior day -> startHours clamps to 0
      effectiveEnd: '2026-09-30T14:30:00',   // far future -> endHours clamps to 24
    },
    {
      _id: 'nursery-school', // SAME id
      eventTitle: 'Nursery School Drop off and Dismissal at 65th Street',
      status: 'published',
      effectiveStart: '2026-09-16T08:45:00', // viewed day occurrence
      effectiveEnd: '2026-09-16T14:30:00',
    },
  ];
}

function renderAssistant(props) {
  const onConflictChange = vi.fn();
  render(
    <SchedulingAssistant
      selectedRooms={[ROOM]}
      selectedDate={VIEWED_DATE}
      availability={[{ room: ROOM, conflicts: { reservations: props.reservations } }]}
      availabilityLoading={false}
      eventStartTime={props.eventStartTime}
      eventEndTime={props.eventEndTime}
      eventTitle="Teen High Holiday Rehearsal"
      onConflictChange={onConflictChange}
    />
  );
  return onConflictChange;
}

describe('SchedulingAssistant — phantom conflict from duplicate series-master blocks', () => {
  beforeEach(() => {
    // Silence the dedup console.warn so test output stays clean
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('does NOT report a conflict when the only overlap is a deduped phantom block (6-8 PM vs 8:45 AM-2:30 PM)', () => {
    const onConflictChange = renderAssistant({
      reservations: makeDuplicateNurserySchool(),
      eventStartTime: '18:00', // 6:00 PM
      eventEndTime: '20:00',   // 8:00 PM
    });

    expect(onConflictChange).toHaveBeenCalled();
    const [hasConflicts, total] = onConflictChange.mock.calls.at(-1);
    expect(hasConflicts).toBe(false);
    expect(total).toBe(0);
  });

  it('STILL reports a real conflict when the user event genuinely overlaps the day-scoped occurrence (10 AM-noon vs 8:45 AM-2:30 PM)', () => {
    const onConflictChange = renderAssistant({
      reservations: makeDuplicateNurserySchool(),
      eventStartTime: '10:00', // 10:00 AM — truly overlaps 8:45 AM-2:30 PM
      eventEndTime: '12:00',   // 12:00 PM
    });

    expect(onConflictChange).toHaveBeenCalled();
    const [hasConflicts, total] = onConflictChange.mock.calls.at(-1);
    expect(hasConflicts).toBe(true);
    expect(total).toBe(1);
  });
});
