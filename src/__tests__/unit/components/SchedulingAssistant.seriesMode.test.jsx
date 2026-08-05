// SchedulingAssistant series-mode composition
// (scheduling-assistant-series-mode): with a `series` prop the assistant
// mounts the occurrence band between its header and the room tabs and the
// per-day verdict band below the timeline; without it (single events) the
// assistant renders exactly as before — no band elements at all.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SchedulingAssistant from '../../../components/SchedulingAssistant';

const VIEWED_DATE = '2026-03-17';
const ROOM = { _id: 'room-1', name: 'Chapel' };

const SERIES = {
  viewDate: VIEWED_DATE,
  formStartDate: '2026-03-10',
  occurrences: [
    { date: '2026-03-10', state: 'clear', pending: false },
    { date: '2026-03-17', state: 'conflicted', pending: false },
    { date: '2026-03-24', state: 'clear', pending: false },
  ],
  conflictedDates: ['2026-03-17'],
  conflicts: [{
    occurrenceDate: '2026-03-17',
    occurrenceStart: '2026-03-17T14:00:00',
    occurrenceEnd: '2026-03-17T15:00:00',
    hardConflicts: [{
      id: 'c1',
      eventTitle: 'Existing Meeting',
      startDateTime: '2026-03-17T14:00:00',
      endDateTime: '2026-03-17T15:00:00',
      roomNames: ['Chapel'],
      status: 'published',
      requestedBy: 'Alice Levine',
    }],
  }],
  totalOccurrences: 3,
  conflictingOccurrences: 1,
  skipRefused: false,
  hasData: true,
  loading: false,
  error: null,
  retry: () => {},
  lastKnownBlockers: {},
  recurrencePattern: {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'] },
    range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-03-24' },
  },
  readOnly: false,
  onSelectDate: vi.fn(),
  onSkipOccurrence: vi.fn(),
  onRestoreOccurrence: vi.fn(),
  onOpenBlockingEvent: vi.fn(),
};

function renderAssistant(series) {
  return render(
    <SchedulingAssistant
      selectedRooms={[ROOM]}
      selectedDate={VIEWED_DATE}
      availability={[{ room: ROOM, conflicts: { reservations: [] } }]}
      availabilityLoading={false}
      eventStartTime="14:30"
      eventEndTime="15:30"
      eventTitle="Weekly Class"
      onConflictChange={vi.fn()}
      series={series}
    />
  );
}

describe('SchedulingAssistant — series mode composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SAM-1: with a series prop, both bands mount in their places', () => {
    const { container } = renderAssistant(SERIES);

    const band = screen.getByTestId('series-occurrence-band');
    const verdict = screen.getByTestId('series-verdict-band');
    expect(band).toBeTruthy();
    expect(verdict).toBeTruthy();

    // Band sits between the assistant header and the room tabs
    expect(band.previousElementSibling.className).toContain('assistant-header');
    expect(band.nextElementSibling.className).toContain('room-tabs-carousel');

    // The verdict band resolves the viewed day's blocker
    expect(verdict).toHaveTextContent('Existing Meeting');
    expect(verdict).toHaveTextContent('Alice Levine');
    expect(container.querySelectorAll('[data-testid^="sob-chip-"]')).toHaveLength(3);
  });

  it('SAM-2: chip selection reaches the series handler through the real band', () => {
    renderAssistant(SERIES);

    fireEvent.click(screen.getByTestId('sob-chip-2026-03-24'));
    expect(SERIES.onSelectDate).toHaveBeenCalledWith('2026-03-24');
  });

  it('SAM-3: without a series prop the assistant renders no band elements', () => {
    const { container } = renderAssistant(null);

    expect(screen.queryByTestId('series-occurrence-band')).toBeNull();
    expect(screen.queryByTestId('series-verdict-band')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="sob-"]')).toHaveLength(0);
    // The single-event chrome is untouched
    expect(container.querySelector('.assistant-header')).toBeTruthy();
    expect(container.querySelector('.room-tabs-carousel')).toBeTruthy();
  });
});
