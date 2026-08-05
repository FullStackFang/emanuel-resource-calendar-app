// SeriesOccurrenceBand — the occurrence chips + series verdict + focus toggle
// + conflict stepper inside the SchedulingAssistant
// (scheduling-assistant-series-mode). The verdict chip carries the locked
// 'N of M occurrences have room conflicts' phrasing migrated from the retired
// RecurringConflictSummary header (RCS-1/2/4 of
// recurring-publish-conflict-blocking).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import SeriesOccurrenceBand from '../../../components/SeriesOccurrenceBand';
import { computeChipCapacity } from '../../../utils/seriesChipCapacity';

const OCC_DATES = [
  '2026-03-10', '2026-03-17', '2026-03-24', '2026-03-31',
  '2026-04-07', '2026-04-14', '2026-04-21', '2026-04-28',
  '2026-05-05', '2026-05-12', '2026-05-19', '2026-05-26',
];

const occurrencesFor = (dates, { conflicted = [], skipped = [], pending = [] } = {}) =>
  dates.map(d => ({
    date: d,
    state: skipped.includes(d) ? 'skipped' : conflicted.includes(d) ? 'conflicted' : 'clear',
    pending: pending.includes(d),
  }));

const CONFLICTS = [
  {
    occurrenceDate: '2026-03-17',
    occurrenceStart: '2026-03-17T14:00:00',
    occurrenceEnd: '2026-03-17T15:00:00',
    hardConflicts: [{ id: 'c1', eventTitle: 'Existing Meeting' }],
  },
  {
    occurrenceDate: '2026-03-24',
    occurrenceStart: '2026-03-24T14:00:00',
    occurrenceEnd: '2026-03-24T15:00:00',
    hardConflicts: [{ id: 'c2', eventTitle: 'Other Meeting' }],
  },
];

const baseProps = (overrides = {}) => ({
  occurrences: occurrencesFor(OCC_DATES, { conflicted: ['2026-03-17', '2026-03-24'] }),
  conflictedDates: ['2026-03-17', '2026-03-24'],
  conflicts: CONFLICTS,
  totalOccurrences: 12,
  conflictingOccurrences: 2,
  selectedDate: '2026-03-10',
  hasData: true,
  error: null,
  onRetry: vi.fn(),
  onSelectDate: vi.fn(),
  ...overrides,
});

const chip = (date) => screen.getByTestId(`sob-chip-${date}`);

describe('SeriesOccurrenceBand', () => {
  // ─── Chips ─────────────────────────────────────────────────────────────

  it('SOB-1: renders one chip per occurrence, in series order, with states', () => {
    const { container } = render(<SeriesOccurrenceBand {...baseProps()} />);

    const chips = Array.from(container.querySelectorAll('[data-testid^="sob-chip-"]'));
    expect(chips).toHaveLength(12);
    expect(chips.map(c => c.getAttribute('data-date'))).toEqual(OCC_DATES);
    expect(chip('2026-03-17').getAttribute('data-state')).toBe('conflicted');
    expect(chip('2026-03-10').getAttribute('data-state')).toBe('clear');
  });

  // 20-occurrence MWF-style series for the truncation cases
  const MANY_DATES = Array.from({ length: 20 }, (_, i) => {
    const d = new Date(2026, 7, 10 + i * 2, 12);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const dateChips = (container) =>
    container.querySelectorAll('[data-testid^="sob-chip-2"]');

  it('SOB-19: above 12 occurrences the row is one page of 10 chips; ellipsis chips page the window, NEVER expand it', () => {
    // One conflict hidden beyond the window: the ellipsis chip must warn.
    const { container } = render(
      <SeriesOccurrenceBand
        {...baseProps({
          occurrences: occurrencesFor(MANY_DATES, { conflicted: [MANY_DATES[15]] }),
          conflictedDates: [MANY_DATES[15]],
          conflicts: [],
          totalOccurrences: 20,
          conflictingOccurrences: 1,
          selectedDate: MANY_DATES[0],
        })}
      />
    );

    // At the start only the trailing ellipsis renders, so its slot is the
    // only one reserved: fallback capacity 12 - 1 = 11 chips
    expect(dateChips(container)).toHaveLength(11);
    const more = screen.getByTestId('sob-chip-more');
    expect(more).toHaveTextContent('+9');
    expect(more.className).toContain('has-conflicts');
    expect(more.getAttribute('aria-label')).toMatch(/later dates.*1 with conflicts/i);

    // Paging forward: the window reaches the end, reclaims the trailing
    // slot, and still fills the row — never more than one row
    fireEvent.click(more);
    expect(dateChips(container)).toHaveLength(11);
    expect(screen.getByTestId(`sob-chip-${MANY_DATES[15]}`)).toBeTruthy();
    expect(screen.queryByTestId('sob-chip-more')).toBeNull();
    expect(screen.getByTestId('sob-chip-more-before')).toHaveTextContent('+9');

    // Paging back returns to the start
    fireEvent.click(screen.getByTestId('sob-chip-more-before'));
    expect(dateChips(container)).toHaveLength(11);
    expect(screen.getByTestId(`sob-chip-${MANY_DATES[0]}`)).toBeTruthy();
  });

  it('SOB-23: chip capacity derives from the measured row width, not a fixed count', () => {
    // Unmeasured (first paint, jsdom): fall back to the 12-chip capacity
    expect(computeChipCapacity(0, false)).toBe(12);
    expect(computeChipCapacity(undefined, false)).toBe(12);
    // 35px chips + 5px gaps: floor((width + 5) / 40)
    expect(computeChipCapacity(445, false)).toBe(11);
    expect(computeChipCapacity(560, false)).toBe(14);
    expect(computeChipCapacity(800, false)).toBe(20);
    // Dense squares (14px) pack far more per row
    expect(computeChipCapacity(560, true)).toBe(29);
    // Never below the floor that leaves a usable window
    expect(computeChipCapacity(60, false)).toBe(5);
  });

  it('SOB-24: measurement engages even when the row mounts AFTER the skeleton (real fetch flow), widening the window to fill the row', () => {
    // The real band mounts showing the skeleton (no data yet) — the chip row
    // does not exist at mount time. Measurement must still attach when the
    // row appears, or the band silently stays at the narrow fallback width.
    let roCallback = null;
    class FakeResizeObserver {
      constructor(cb) { roCallback = cb; }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    try {
      const manyProps = () => baseProps({
        occurrences: occurrencesFor(MANY_DATES, { conflicted: [MANY_DATES[15]] }),
        conflictedDates: [MANY_DATES[15]],
        conflicts: [],
        totalOccurrences: 20,
        conflictingOccurrences: 1,
        selectedDate: MANY_DATES[0],
      });

      // Mount in the pre-data skeleton state, then data arrives
      const { container, rerender } = render(
        <SeriesOccurrenceBand {...manyProps()} hasData={false} occurrences={[]} />
      );
      expect(screen.getByTestId('sob-skeleton')).toBeTruthy();
      rerender(<SeriesOccurrenceBand {...manyProps()} />);

      // Pre-measurement: fallback capacity 12, one trailing ellipsis slot
      expect(dateChips(container)).toHaveLength(11);

      // The observer fires with the real row width: 600px fits 15 chips,
      // minus the single trailing ellipsis slot = a 14-chip window
      expect(roCallback).not.toBeNull();
      act(() => {
        roCallback([{ contentRect: { width: 600 } }]);
      });
      expect(dateChips(container)).toHaveLength(14);
      expect(screen.getByTestId('sob-chip-more')).toHaveTextContent('+6');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('SOB-22: swiping the row pages the window', () => {
    const { container } = render(
      <SeriesOccurrenceBand
        {...baseProps({
          occurrences: occurrencesFor(MANY_DATES, { conflicted: [MANY_DATES[15]] }),
          conflictedDates: [MANY_DATES[15]],
          conflicts: [],
          totalOccurrences: 20,
          conflictingOccurrences: 1,
          selectedDate: MANY_DATES[0],
        })}
      />
    );
    const row = container.querySelector('.sob-chips');

    // Swipe left (finger moves left) → later dates
    fireEvent.touchStart(row, { changedTouches: [{ clientX: 200 }] });
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 100 }] });
    expect(dateChips(container)).toHaveLength(11);
    expect(screen.getByTestId(`sob-chip-${MANY_DATES[15]}`)).toBeTruthy();

    // Swipe right → back to earlier dates
    fireEvent.touchStart(row, { changedTouches: [{ clientX: 100 }] });
    fireEvent.touchEnd(row, { changedTouches: [{ clientX: 200 }] });
    expect(screen.getByTestId(`sob-chip-${MANY_DATES[0]}`)).toBeTruthy();
  });

  it('SOB-20: a selection beyond the cutoff slides the one-row window to contain it (never auto-expands)', () => {
    // Stepper lands on the deep conflict at index 15: the row stays ONE row,
    // windowed around the selection, with an ellipsis chip for the earlier
    // dates. Returning from the Conflicts tab must not leave a wall of chips.
    const { container } = render(
      <SeriesOccurrenceBand
        {...baseProps({
          occurrences: occurrencesFor(MANY_DATES, { conflicted: [MANY_DATES[15]] }),
          conflictedDates: [MANY_DATES[15]],
          conflicts: [],
          totalOccurrences: 20,
          conflictingOccurrences: 1,
          selectedDate: MANY_DATES[15],
        })}
      />
    );

    // End-of-series window reclaims the unused trailing slot: 11 chips
    expect(dateChips(container)).toHaveLength(11);
    expect(screen.getByTestId(`sob-chip-${MANY_DATES[15]}`)).toBeTruthy();
    // Window is [9..19]: nine hidden before, none after
    const before = screen.getByTestId('sob-chip-more-before');
    expect(before).toHaveTextContent('+9');
    expect(screen.queryByTestId('sob-chip-more')).toBeNull();
  });

  it('SOB-21: conflicts focus surfaces a conflicted date hidden behind the overflow chip', () => {
    const { container } = render(
      <SeriesOccurrenceBand
        {...baseProps({
          occurrences: occurrencesFor(MANY_DATES, { conflicted: [MANY_DATES[15]] }),
          conflictedDates: [MANY_DATES[15]],
          conflicts: [],
          totalOccurrences: 20,
          conflictingOccurrences: 1,
          selectedDate: MANY_DATES[0],
        })}
      />
    );
    expect(dateChips(container)).toHaveLength(11);

    fireEvent.click(screen.getByTestId('sob-focus-conflicts'));

    // Only the conflict renders as a chip; the clear runs become placeholders
    expect(dateChips(container)).toHaveLength(1);
    expect(screen.getByTestId(`sob-chip-${MANY_DATES[15]}`)).toBeTruthy();
    const gaps = screen.getAllByTestId('sob-gap');
    expect(gaps).toHaveLength(2);
    expect(gaps[0].getAttribute('aria-label')).toBe('15 dates without conflicts');
    expect(gaps[1].getAttribute('aria-label')).toBe('4 dates without conflicts');
  });

  it('SOB-2: skipped chips render distinctly, pending or saved', () => {
    render(
      <SeriesOccurrenceBand
        {...baseProps({
          occurrences: occurrencesFor(OCC_DATES, {
            conflicted: ['2026-03-17'],
            skipped: ['2026-03-31', '2026-04-07'],
            pending: ['2026-04-07'],
          }),
          conflictedDates: ['2026-03-17'],
          conflictingOccurrences: 1,
        })}
      />
    );

    expect(chip('2026-03-31').getAttribute('data-state')).toBe('skipped');
    expect(chip('2026-03-31').getAttribute('data-pending')).toBe('false');
    expect(chip('2026-04-07').getAttribute('data-pending')).toBe('true');
  });

  it('SOB-3: clicking a chip selects its date; the selected chip is marked', () => {
    const onSelectDate = vi.fn();
    render(<SeriesOccurrenceBand {...baseProps({ onSelectDate })} />);

    fireEvent.click(chip('2026-03-17'));
    expect(onSelectDate).toHaveBeenCalledWith('2026-03-17');

    expect(chip('2026-03-10').getAttribute('data-selected')).toBe('true');
    expect(chip('2026-03-17').getAttribute('data-selected')).toBe('false');
  });

  // ─── Verdict chip (locked phrasing) ────────────────────────────────────

  it('SOB-4: the blocked verdict keeps the locked counts phrasing and reads as a publish gate', () => {
    render(<SeriesOccurrenceBand {...baseProps()} />);

    const verdict = screen.getByTestId('sob-verdict');
    expect(verdict.textContent).toMatch(/2 of 12 occurrences have room conflicts/);
    expect(verdict.querySelector('strong')).toHaveTextContent('2');
    expect(verdict.textContent).toMatch(/publish/i);
    expect(verdict.textContent).toMatch(/blocked/i);
  });

  it('SOB-5: the clear verdict is quiet', () => {
    render(
      <SeriesOccurrenceBand
        {...baseProps({
          occurrences: occurrencesFor(OCC_DATES),
          conflictedDates: [],
          conflicts: [],
          conflictingOccurrences: 0,
        })}
      />
    );

    const verdict = screen.getByTestId('sob-verdict');
    expect(verdict.textContent).toMatch(/All 12 occurrences are clear of room conflicts/);
    expect(verdict.textContent).not.toMatch(/blocked/i);
  });

  // ─── Conflicts-only focus ──────────────────────────────────────────────

  it('SOB-6: conflicts focus lists only conflicted dates, with placeholders for the clear runs', () => {
    const onSelectDate = vi.fn();
    render(<SeriesOccurrenceBand {...baseProps({ onSelectDate, selectedDate: '2026-03-17' })} />);

    fireEvent.click(screen.getByTestId('sob-focus-conflicts'));

    // Only the two conflicted chips remain as chips
    expect(chip('2026-03-17')).toBeTruthy();
    expect(chip('2026-03-24')).toBeTruthy();
    expect(screen.queryByTestId('sob-chip-2026-03-10')).toBeNull();

    // Clear runs collapse into labeled placeholders: 1 before, 9 after
    const gaps = screen.getAllByTestId('sob-gap');
    expect(gaps).toHaveLength(2);
    expect(gaps[0].getAttribute('aria-label')).toBe('1 date without conflicts');
    expect(gaps[1].getAttribute('aria-label')).toBe('9 dates without conflicts');

    fireEvent.click(chip('2026-03-24'));
    expect(onSelectDate).toHaveBeenCalledWith('2026-03-24');
  });

  it('SOB-7: entering conflicts focus from a clear selection jumps to the first conflict', () => {
    const onSelectDate = vi.fn();
    render(<SeriesOccurrenceBand {...baseProps({ onSelectDate, selectedDate: '2026-03-10' })} />);

    fireEvent.click(screen.getByTestId('sob-focus-conflicts'));
    expect(onSelectDate).toHaveBeenCalledWith('2026-03-17');
  });

  it('SOB-8: the focus toggle shows a live conflicted count', () => {
    render(<SeriesOccurrenceBand {...baseProps()} />);
    expect(screen.getByTestId('sob-focus-count')).toHaveTextContent('2');
  });

  // ─── Conflict stepper ──────────────────────────────────────────────────

  it('SOB-9: next/prev step through conflicted dates only, wrapping', () => {
    const onSelectDate = vi.fn();
    const { rerender } = render(
      <SeriesOccurrenceBand {...baseProps({ onSelectDate, selectedDate: '2026-03-17' })} />
    );

    fireEvent.click(screen.getByTestId('sob-next-conflict'));
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-03-24');

    rerender(<SeriesOccurrenceBand {...baseProps({ onSelectDate, selectedDate: '2026-03-24' })} />);
    fireEvent.click(screen.getByTestId('sob-next-conflict'));
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-03-17'); // wraps

    fireEvent.click(screen.getByTestId('sob-prev-conflict'));
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-03-17'); // 03-24 → prev wraps to... prev of 03-24 is 03-17
  });

  it('SOB-10: from a non-conflicted selection, next goes to the first conflict', () => {
    const onSelectDate = vi.fn();
    render(<SeriesOccurrenceBand {...baseProps({ onSelectDate, selectedDate: '2026-03-10' })} />);

    fireEvent.click(screen.getByTestId('sob-next-conflict'));
    expect(onSelectDate).toHaveBeenLastCalledWith('2026-03-17');
  });

  it('SOB-11: the position indicator names which conflict of how many is selected', () => {
    render(<SeriesOccurrenceBand {...baseProps({ selectedDate: '2026-03-24' })} />);
    expect(screen.getByTestId('sob-conflict-position')).toHaveTextContent('conflict 2 of 2');
  });

  it('SOB-12: stepper controls are disabled when nothing conflicts', () => {
    render(
      <SeriesOccurrenceBand
        {...baseProps({
          occurrences: occurrencesFor(OCC_DATES),
          conflictedDates: [],
          conflicts: [],
          conflictingOccurrences: 0,
        })}
      />
    );

    expect(screen.getByTestId('sob-next-conflict')).toBeDisabled();
    expect(screen.getByTestId('sob-prev-conflict')).toBeDisabled();
  });

  // ─── Honest empty states (regression: false all-clear) ─────────────────
  // The retired panel never claimed 'clear' without data: it rendered a
  // skeleton while loading and an error box with Retry on failure. The band
  // must do the same — a fetch failure painting a green verdict is how a
  // genuinely conflicted series ('[Hold] Test Fang Recurrence 8/9 #1' vs
  // 'RS Staff meeting.') read as conflict-free.

  it('SOB-15: a fetch error renders the error with a retry action and NO verdict or chips', () => {
    const onRetry = vi.fn();
    const { container } = render(
      <SeriesOccurrenceBand
        {...baseProps({
          hasData: false,
          error: 'Server error (401)',
          onRetry,
          occurrences: [],
          conflictedDates: [],
          conflicts: [],
          totalOccurrences: 0,
          conflictingOccurrences: 0,
        })}
      />
    );

    expect(screen.getByTestId('sob-error')).toHaveTextContent('Server error (401)');
    expect(container.textContent).not.toMatch(/clear of room conflicts/i);
    expect(screen.queryByTestId('sob-verdict')).toBeNull();
    expect(container.querySelectorAll('[data-testid^="sob-chip-"]')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('sob-retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('SOB-16: before data resolves (loading) the band shows a skeleton, never a clear verdict', () => {
    const { container } = render(
      <SeriesOccurrenceBand
        {...baseProps({
          hasData: false,
          loading: true,
          occurrences: [],
          conflictedDates: [],
          conflicts: [],
          totalOccurrences: 0,
          conflictingOccurrences: 0,
        })}
      />
    );

    expect(screen.getByTestId('sob-skeleton')).toBeTruthy();
    expect(container.textContent).not.toMatch(/clear of room conflicts/i);
    expect(screen.queryByTestId('sob-verdict')).toBeNull();
  });

  it('SOB-17: the pre-debounce window (no data, not loading, no error) also shows the skeleton', () => {
    const { container } = render(
      <SeriesOccurrenceBand
        {...baseProps({
          hasData: false,
          loading: false,
          occurrences: [],
          conflictedDates: [],
          conflicts: [],
          totalOccurrences: 0,
          conflictingOccurrences: 0,
        })}
      />
    );

    expect(screen.getByTestId('sob-skeleton')).toBeTruthy();
    expect(container.textContent).not.toMatch(/clear of room conflicts/i);
  });

  it('SOB-18: missing time inputs show an instruction, not an endless skeleton', () => {
    const { container } = render(
      <SeriesOccurrenceBand
        {...baseProps({
          hasData: false,
          inputsIncomplete: true,
          occurrences: [],
          conflictedDates: [],
          conflicts: [],
          totalOccurrences: 0,
          conflictingOccurrences: 0,
        })}
      />
    );

    expect(screen.getByTestId('sob-incomplete')).toHaveTextContent(/add event or reservation times/i);
    expect(screen.queryByTestId('sob-skeleton')).toBeNull();
    expect(container.textContent).not.toMatch(/clear of room conflicts/i);
  });

  // ─── Density fallbacks ─────────────────────────────────────────────────

  const longSeries = (count) => {
    const dates = [];
    const d = new Date('2026-01-06T12:00:00');
    for (let i = 0; i < count; i++) {
      dates.push(d.toISOString().split('T')[0]);
      d.setDate(d.getDate() + 7);
    }
    return dates;
  };

  it('SOB-13: above 60 occurrences chips drop their labels but stay selectable', () => {
    const dates = longSeries(61);
    const onSelectDate = vi.fn();
    const { container } = render(
      <SeriesOccurrenceBand
        {...baseProps({
          occurrences: occurrencesFor(dates, { conflicted: [dates[5]] }),
          conflictedDates: [dates[5]],
          conflicts: [],
          totalOccurrences: 61,
          conflictingOccurrences: 1,
          selectedDate: dates[0],
          onSelectDate,
        })}
      />
    );

    expect(container.querySelector('.sob-chips').className).toContain('dense');
    const target = screen.getByTestId(`sob-chip-${dates[5]}`);
    expect(target.textContent).toBe('');
    fireEvent.click(target);
    expect(onSelectDate).toHaveBeenCalledWith(dates[5]);
  });

  it('SOB-14: above 150 occurrences the chip row gives way to a compact summary + conflict list', () => {
    const dates = longSeries(151);
    const conflictDate = dates[3];
    const onSelectDate = vi.fn();
    const { container } = render(
      <SeriesOccurrenceBand
        {...baseProps({
          occurrences: occurrencesFor(dates, { conflicted: [conflictDate] }),
          conflictedDates: [conflictDate],
          conflicts: [{
            occurrenceDate: conflictDate,
            occurrenceStart: `${conflictDate}T14:00:00`,
            occurrenceEnd: `${conflictDate}T15:00:00`,
            hardConflicts: [{ id: 'c9', eventTitle: 'Long Series Blocker' }],
          }],
          totalOccurrences: 151,
          conflictingOccurrences: 1,
          selectedDate: dates[0],
          onSelectDate,
        })}
      />
    );

    expect(container.querySelector('.sob-chips')).toBeNull();
    expect(screen.getByTestId('sob-compact-summary')).toBeTruthy();

    // The conflict list is the remaining per-date surface; a row selects
    fireEvent.click(screen.getByTestId(`sob-conflict-row-${conflictDate}`));
    expect(onSelectDate).toHaveBeenCalledWith(conflictDate);

    // The stepper still navigates
    expect(screen.getByTestId('sob-next-conflict')).not.toBeDisabled();
  });
});
