// SeriesVerdictBand — the selected day's verdict below the assistant's
// timeline (scheduling-assistant-series-mode): conflicted (blocker detail +
// open/skip), clear (quiet line), skipped (pending-removal note + restore).
// Skip and Restore both use the app's two-step in-button confirmation; arming
// clears on selection change, never by timeout. Restore is offered for saved
// and pending exclusions alike — a skipped date is never a free pass.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../utils/appTimeUtils', () => ({
  formatTimeFromDateTimeString: (s) => (s ? s.slice(11, 16) : ''),
}));

import SeriesVerdictBand from '../../../components/SeriesVerdictBand';

const CONFLICT = {
  occurrenceDate: '2026-03-17',
  occurrenceStart: '2026-03-17T14:00:00',
  occurrenceEnd: '2026-03-17T15:00:00',
  hardConflicts: [
    {
      id: 'c1',
      eventTitle: 'Existing Meeting',
      startDateTime: '2026-03-17T14:00:00',
      endDateTime: '2026-03-17T15:00:00',
      roomNames: ['Chapel'],
      status: 'published',
      requestedBy: 'Alice Levine',
    },
    {
      id: 'c2',
      eventTitle: 'Outlook Sync Item',
      startDateTime: '2026-03-17T14:30:00',
      endDateTime: '2026-03-17T15:30:00',
      roomNames: ['Chapel'],
      status: 'published',
      requestedBy: null,
    },
  ],
};

const baseProps = (overrides = {}) => ({
  selectedDate: '2026-03-17',
  occurrence: { date: '2026-03-17', state: 'conflicted', pending: false },
  conflict: CONFLICT,
  lastKnownBlockers: {},
  skipRefused: false,
  readOnly: false,
  outstandingConflictCount: 2,
  onOpenBlockingEvent: vi.fn(),
  onSkipOccurrence: vi.fn(),
  onRestoreOccurrence: vi.fn(),
  ...overrides,
});

describe('SeriesVerdictBand', () => {
  // ─── Conflicted verdict ────────────────────────────────────────────────

  it('SVB-1: lists every blocker with detail and a per-blocker open action', () => {
    const onOpenBlockingEvent = vi.fn();
    render(<SeriesVerdictBand {...baseProps({ onOpenBlockingEvent })} />);

    const band = screen.getByTestId('series-verdict-band');
    expect(band).toHaveTextContent('Existing Meeting');
    expect(band).toHaveTextContent('published');
    expect(band).toHaveTextContent('Chapel');
    expect(band).toHaveTextContent('Alice Levine');
    expect(band).toHaveTextContent('Outlook Sync Item');

    fireEvent.click(screen.getByTestId('svb-open-c1'));
    expect(onOpenBlockingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', eventTitle: 'Existing Meeting' }),
      { occurrenceDate: '2026-03-17', outstandingConflictCount: 2 }
    );
  });

  it('SVB-2: a null requester is identified as synced from Outlook', () => {
    render(<SeriesVerdictBand {...baseProps()} />);
    expect(screen.getByTestId('series-verdict-band')).toHaveTextContent(/synced from Outlook/i);
  });

  // ─── Clear verdict ─────────────────────────────────────────────────────

  it('SVB-3: a clear day shows a quiet line with no actions', () => {
    render(
      <SeriesVerdictBand
        {...baseProps({
          occurrence: { date: '2026-03-10', state: 'clear', pending: false },
          selectedDate: '2026-03-10',
          conflict: null,
        })}
      />
    );

    const band = screen.getByTestId('series-verdict-band');
    expect(band).toHaveTextContent(/no conflicts on this day/i);
    expect(band.querySelectorAll('button')).toHaveLength(0);
  });

  // ─── Skipped verdict + restore ─────────────────────────────────────────

  const skippedProps = (overrides = {}) => baseProps({
    selectedDate: '2026-03-31',
    occurrence: { date: '2026-03-31', state: 'skipped', pending: true },
    conflict: null,
    ...overrides,
  });

  it('SVB-4: a skipped day states pending removal and offers restore', () => {
    render(<SeriesVerdictBand {...skippedProps()} />);

    const band = screen.getByTestId('series-verdict-band');
    expect(band).toHaveTextContent(/leaves the series when you save/i);
    expect(screen.getByTestId('svb-restore')).toHaveTextContent(/restore this date/i);
    // Saved-or-unknown blockers: no still-booked warning without session memory
    expect(band.textContent).not.toMatch(/still booked/i);
  });

  it('SVB-5: session-skipped dates with known blockers warn that restore re-flags', () => {
    render(
      <SeriesVerdictBand
        {...skippedProps({
          lastKnownBlockers: { '2026-03-31': [{ id: 'c7', eventTitle: 'Board Meeting' }] },
        })}
      />
    );

    expect(screen.getByTestId('series-verdict-band')).toHaveTextContent(/still booked/i);
  });

  // ─── Two-step confirmation ─────────────────────────────────────────────

  it('SVB-6: skip arms on first click and executes on the second', () => {
    const onSkipOccurrence = vi.fn();
    render(<SeriesVerdictBand {...baseProps({ onSkipOccurrence })} />);

    const skipBtn = screen.getByTestId('svb-skip');
    expect(skipBtn).toHaveTextContent(/skip this date/i);

    fireEvent.click(skipBtn);
    expect(onSkipOccurrence).not.toHaveBeenCalled();
    expect(screen.getByTestId('svb-skip')).toHaveTextContent(/confirm/i);
    expect(screen.getByTestId('svb-skip').className).toContain('confirm');

    fireEvent.click(screen.getByTestId('svb-skip'));
    expect(onSkipOccurrence).toHaveBeenCalledWith('2026-03-17');
  });

  it('SVB-7: restore arms on first click and executes on the second', () => {
    const onRestoreOccurrence = vi.fn();
    render(<SeriesVerdictBand {...skippedProps({ onRestoreOccurrence })} />);

    fireEvent.click(screen.getByTestId('svb-restore'));
    expect(onRestoreOccurrence).not.toHaveBeenCalled();
    expect(screen.getByTestId('svb-restore')).toHaveTextContent(/confirm/i);

    fireEvent.click(screen.getByTestId('svb-restore'));
    expect(onRestoreOccurrence).toHaveBeenCalledWith('2026-03-31');
  });

  it('SVB-8: arming clears when the selection changes', () => {
    const onSkipOccurrence = vi.fn();
    const { rerender } = render(<SeriesVerdictBand {...baseProps({ onSkipOccurrence })} />);

    fireEvent.click(screen.getByTestId('svb-skip'));
    expect(screen.getByTestId('svb-skip')).toHaveTextContent(/confirm/i);

    const otherConflict = {
      ...CONFLICT,
      occurrenceDate: '2026-03-24',
      hardConflicts: [CONFLICT.hardConflicts[0]],
    };
    rerender(
      <SeriesVerdictBand
        {...baseProps({
          onSkipOccurrence,
          selectedDate: '2026-03-24',
          occurrence: { date: '2026-03-24', state: 'conflicted', pending: false },
          conflict: otherConflict,
        })}
      />
    );

    expect(screen.getByTestId('svb-skip')).toHaveTextContent(/skip this date/i);
    fireEvent.click(screen.getByTestId('svb-skip'));
    expect(onSkipOccurrence).not.toHaveBeenCalled(); // first click on the new date arms again
  });

  // ─── Guards ────────────────────────────────────────────────────────────

  it('SVB-9: the last remaining occurrence cannot be skipped and says why', () => {
    render(<SeriesVerdictBand {...baseProps({ skipRefused: true })} />);

    expect(screen.queryByTestId('svb-skip')).toBeNull();
    expect(screen.getByTestId('series-verdict-band')).toHaveTextContent(/only remaining occurrence/i);
  });

  it('SVB-10: read-only mode keeps navigation but offers no skip or restore', () => {
    render(
      <SeriesVerdictBand
        {...baseProps({ readOnly: true, onSkipOccurrence: null, onRestoreOccurrence: null })}
      />
    );
    expect(screen.getByTestId('svb-open-c1')).toBeTruthy();
    expect(screen.queryByTestId('svb-skip')).toBeNull();

    render(
      <SeriesVerdictBand
        {...skippedProps({ readOnly: true, onSkipOccurrence: null, onRestoreOccurrence: null })}
      />
    );
    expect(screen.queryByTestId('svb-restore')).toBeNull();
  });

  it('SVB-11: renders nothing when the selected date is not an occurrence', () => {
    const { container } = render(
      <SeriesVerdictBand {...baseProps({ occurrence: null, conflict: null })} />
    );
    expect(container.firstChild).toBeNull();
  });
});
