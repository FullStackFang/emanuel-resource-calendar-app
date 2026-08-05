// SchedulingAssistant availability loading states.
// The day timeline must never present an empty grid as a verdict: before the
// FIRST availability response arrives, an empty timeline reads as "the room is
// free all day", which is a lie nobody checked. Same honesty rule the series
// band enforces (SOB-15..18), applied to the single-day surface:
//   SAL-1  first load (no data yet)  -> covering spinner, no silent empty grid
//   SAL-2  background refresh        -> data stays painted, subtle tag only
//   SAL-3  settled                   -> neither indicator

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SchedulingAssistant from '../../../components/SchedulingAssistant';

const ROOM = { _id: 'room-1', name: 'Chapel' };

const baseProps = {
  selectedRooms: [ROOM],
  selectedDate: '2026-03-17',
  eventStartTime: '14:00',
  eventEndTime: '15:00',
  eventTitle: 'Board Meeting',
  onConflictChange: vi.fn(),
};

describe('SchedulingAssistant — availability loading states', () => {
  it('SAL-1: first load (loading with no data yet) shows the checking overlay, not a silent empty grid', () => {
    render(
      <SchedulingAssistant {...baseProps} availability={[]} availabilityLoading={true} />
    );

    expect(screen.getByText(/Checking availability/)).toBeTruthy();
    expect(screen.queryByTestId('sa-refreshing')).toBeNull();
  });

  it('SAL-2: a refresh with data already present shows the subtle tag and keeps the timeline', () => {
    render(
      <SchedulingAssistant
        {...baseProps}
        availability={[{ room: ROOM, conflicts: { reservations: [] } }]}
        availabilityLoading={true}
      />
    );

    expect(screen.getByTestId('sa-refreshing')).toBeTruthy();
    expect(screen.queryByText(/Checking availability/)).toBeNull();
    // The timeline chrome stays interactive behind the tag
    expect(document.querySelector('.timeline-container')).toBeTruthy();
  });

  it('SAL-3: settled data shows neither indicator', () => {
    render(
      <SchedulingAssistant
        {...baseProps}
        availability={[{ room: ROOM, conflicts: { reservations: [] } }]}
        availabilityLoading={false}
      />
    );

    expect(screen.queryByText(/Checking availability/)).toBeNull();
    expect(screen.queryByTestId('sa-refreshing')).toBeNull();
  });
});
