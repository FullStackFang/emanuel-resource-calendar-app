import { useEffect, useRef, useState } from 'react';
import {
  computeChipCapacity,
  ELLIPSIS_SLOTS,
  FALLBACK_CAPACITY,
  MIN_WINDOW,
} from '../utils/seriesChipCapacity';
import './SeriesOccurrenceBand.css';

// Density thresholds carried from the retired RecurringConflictSummary strip
// (design D9 there, D10 here): above DENSE the chips drop their date labels;
// above COMPACT the chip row is replaced by a text summary + conflict list —
// past that density the row stops being glanceable and starts being wallpaper.
const DENSE_THRESHOLD = 60;
const COMPACT_THRESHOLD = 150;

// Truncation (SOB-19..23): the all-dates row is ALWAYS exactly one row.
// Capacity is MEASURED from the row's width (ResizeObserver) — as many chips
// as actually fit — with two slots reserved for the ellipsis chips that PAGE
// the window (as does a horizontal swipe). There is no expanded state at
// all, so the row cannot grow past one page by construction. Selection
// changes re-anchor the window to keep the selected chip visible. The
// conflicts focus never windows: a conflict must not hide behind '…'.
const SWIPE_THRESHOLD_PX = 40;

/**
 * SeriesOccurrenceBand
 *
 * The series surface inside the SchedulingAssistant
 * (scheduling-assistant-series-mode): a meta line with the series verdict,
 * one date chip per occurrence (conflicted / clear / skipped), a
 * conflicts-only focus toggle, and a stepper that walks conflicted dates.
 * Purely presentational — selection, skip, and restore all live with the
 * form base; this component only reports intent via onSelectDate.
 *
 * The verdict keeps the locked 'N of M occurrences have room conflicts'
 * phrasing from recurring-publish-conflict-blocking (RCS-1/2/4).
 */
export default function SeriesOccurrenceBand({
  occurrences = [],
  conflictedDates = [],
  conflicts = [],
  totalOccurrences = 0,
  conflictingOccurrences = 0,
  selectedDate = null,
  recurrenceSummary = null,
  loading = false,
  hasData = false,
  inputsIncomplete = false,
  error = null,
  onRetry = null,
  onSelectDate = null,
}) {
  // Conflicts-only focus is band-local UI state (design D6): the row lists
  // ONLY the conflicted chips, with one quiet placeholder per run of clear/
  // skipped dates — the temporal shape of the series ("the conflicts cluster
  // in early fall") survives in abbreviated form.
  const [focusMode, setFocusMode] = useState('all');

  // Measured row width drives capacity — as many chips as actually fit.
  // The row element lives in STATE (callback ref), not a ref: the band
  // mounts showing the skeleton, so the chip row does not exist yet when a
  // mount-time effect would look for it — the observer must attach whenever
  // the row actually appears (SOB-24).
  const [rowEl, setRowEl] = useState(null);
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    if (!rowEl || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? 0;
      setRowWidth(prev => (Math.abs(prev - w) < 1 ? prev : w));
    });
    ro.observe(rowEl);
    return () => ro.disconnect();
  }, [rowEl]);

  // The window's start index (band-local, like focusMode). Lazy-initialized
  // centered on the mount-time selection so the first paint already shows it
  // (fallback capacity — the row is not measured yet at init time).
  const [windowStart, setWindowStart] = useState(() => {
    const idx = occurrences.findIndex(o => o.date === selectedDate);
    if (idx < 0) return 0;
    const size = FALLBACK_CAPACITY - ELLIPSIS_SLOTS;
    return Math.min(
      Math.max(0, idx - Math.floor(size / 2)),
      Math.max(0, occurrences.length - size)
    );
  });
  const touchStartXRef = useRef(null);

  // Re-anchor ONLY when the selection actually changes (stepper, chip click,
  // focus jump) — a paged-away window must survive unrelated re-renders, so
  // this cannot key on occurrences identity alone. Reads the current window
  // size through a ref because size derives from measured width per render.
  const windowSizeRef = useRef(FALLBACK_CAPACITY - ELLIPSIS_SLOTS);
  const prevSelectedRef = useRef(selectedDate);
  useEffect(() => {
    if (prevSelectedRef.current === selectedDate) return;
    prevSelectedRef.current = selectedDate;
    const idx = occurrences.findIndex(o => o.date === selectedDate);
    if (idx < 0) return;
    const size = windowSizeRef.current;
    setWindowStart(prev => {
      const maxStart = Math.max(0, occurrences.length - size);
      const clamped = Math.min(Math.max(0, prev), maxStart);
      if (idx >= clamped && idx < clamped + size) return clamped;
      return Math.min(Math.max(0, idx - Math.floor(size / 2)), maxStart);
    });
  }, [selectedDate, occurrences]);

  const blocked = conflictingOccurrences > 0;
  const skippedCount = occurrences.filter(o => o.state === 'skipped').length;
  const dense = occurrences.length > DENSE_THRESHOLD;
  const compact = occurrences.length > COMPACT_THRESHOLD;
  const focusConflicts = focusMode === 'conflicts';

  const selectDate = (date) => {
    if (onSelectDate) onSelectDate(date);
  };

  // ── Truncation (all-dates row): a paged one-row window sized to fit ──
  // A slot is reserved ONLY for an ellipsis chip that actually renders: at
  // the start of the series there is no leading ellipsis, and a window that
  // reaches the end reclaims the trailing slot (and shifts back to fill it)
  // — the row always uses every slot it has.
  const total = occurrences.length;
  const capacity = computeChipCapacity(rowWidth, dense);
  const truncated = total > capacity;
  let start = 0;
  let windowSize = total;
  if (truncated) {
    start = Math.min(Math.max(0, windowStart), total - 1);
    const needBefore = start > 0;
    // Assume a trailing ellipsis, then reclaim its slot if the window
    // reaches the series end
    windowSize = Math.max(MIN_WINDOW, capacity - (needBefore ? 1 : 0) - 1);
    if (start + windowSize >= total) {
      windowSize = Math.max(MIN_WINDOW, capacity - (needBefore ? 1 : 0));
      start = Math.max(0, total - windowSize);
    }
  }
  windowSizeRef.current = windowSize;
  const visibleOccurrences = truncated
    ? occurrences.slice(start, start + windowSize)
    : occurrences;
  const hiddenBefore = truncated ? occurrences.slice(0, start) : [];
  const hiddenAfter = truncated ? occurrences.slice(start + windowSize) : [];

  const pageWindow = (dir) => {
    if (!truncated) return;
    // Deliberately clamped only to the series bounds, NOT to (total - size):
    // an overshooting forward page is what triggers the end-of-series slot
    // reclaim above, so the last page always fills the row.
    setWindowStart(prev => Math.min(Math.max(0, prev + dir * windowSize), total - 1));
  };

  // Horizontal swipe pages the window too (all-dates mode only)
  const handleTouchStart = (e) => {
    touchStartXRef.current = e.changedTouches?.[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e) => {
    if (touchStartXRef.current == null || focusConflicts) return;
    const dx = (e.changedTouches?.[0]?.clientX ?? touchStartXRef.current) - touchStartXRef.current;
    touchStartXRef.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    pageWindow(dx < 0 ? 1 : -1);
  };

  // ── Conflicts focus: conflicted chips + one placeholder per clear run ──
  const focusItems = [];
  if (focusConflicts) {
    let run = 0;
    for (const occ of occurrences) {
      if (occ.state === 'conflicted') {
        if (run > 0) { focusItems.push(run); run = 0; }
        focusItems.push(occ);
      } else {
        run++;
      }
    }
    if (run > 0) focusItems.push(run);
  }

  // Ellipsis chip for one side of the window — it PAGES the window, never
  // expands it. Red-tinted (and saying so) when conflicts hide behind it:
  // a hidden conflict must not look neutral.
  const renderMoreChip = (hiddenList, side) => {
    if (hiddenList.length === 0) return null;
    const hiddenConflicts = hiddenList.filter(o => o.state === 'conflicted').length;
    const label = `Show ${side === 'before' ? 'earlier' : 'later'} dates (${hiddenList.length}${
      hiddenConflicts > 0 ? `, ${hiddenConflicts} with conflicts` : ''})`;
    return (
      <button
        type="button"
        className={`sob-chip sob-chip-more${hiddenConflicts > 0 ? ' has-conflicts' : ''}`}
        data-testid={side === 'before' ? 'sob-chip-more-before' : 'sob-chip-more'}
        title={label}
        aria-label={label}
        onClick={() => pageWindow(side === 'before' ? -1 : 1)}
      >
        <span className="sob-more-ellipsis" aria-hidden="true">&hellip;</span>
        <span className="sob-more-count" aria-hidden="true">+{hiddenList.length}</span>
      </button>
    );
  };

  const renderChip = (occ) => {
    const isSelected = occ.date === selectedDate;
    const stateLabel = occ.state === 'skipped'
      ? (occ.pending ? 'skipped (not saved yet)' : 'skipped')
      : occ.state;
    return (
      <button
        key={occ.date}
        type="button"
        role="listitem"
        className={`sob-chip ${occ.state}${isSelected ? ' selected' : ''}`}
        data-testid={`sob-chip-${occ.date}`}
        data-date={occ.date}
        data-state={occ.state}
        data-pending={String(!!occ.pending)}
        data-selected={String(isSelected)}
        title={`${formatChipAria(occ.date)} — ${stateLabel}`}
        aria-label={`${formatChipAria(occ.date)} — ${stateLabel}`}
        aria-current={isSelected ? 'date' : undefined}
        onClick={() => selectDate(occ.date)}
      >
        {(!dense || focusConflicts) && (
          <>
            <span className="sob-chip-month" aria-hidden="true">{formatChipMonth(occ.date)}</span>
            <span className="sob-chip-day" aria-hidden="true">{formatChipDay(occ.date)}</span>
          </>
        )}
      </button>
    );
  };

  const enterConflictsFocus = () => {
    setFocusMode('conflicts');
    // Entering focus from a non-conflicted selection jumps to the first
    // conflict — focus mode exists to triage, not to stare at clear days.
    const selectedIsConflicted = conflictedDates.includes(selectedDate);
    if (!selectedIsConflicted && conflictedDates.length > 0) {
      selectDate(conflictedDates[0]);
    }
  };

  const stepConflict = (dir) => {
    if (conflictedDates.length === 0) return;
    const idx = conflictedDates.indexOf(selectedDate);
    const next = idx === -1
      ? conflictedDates[0]
      : conflictedDates[(idx + dir + conflictedDates.length) % conflictedDates.length];
    selectDate(next);
  };

  // Honest empty states: NEVER claim a verdict without data. The retired
  // panel showed a skeleton while loading and an error + Retry on failure;
  // a fetch failure that painted a green all-clear is exactly how a
  // conflicted series read as conflict-free.
  if (error) {
    return (
      <div className="series-occurrence-band" data-testid="series-occurrence-band">
        <div className="sob-meta">
          <span className="sob-title">Series</span>
        </div>
        <div className="sob-error" data-testid="sob-error" role="alert">
          <span aria-hidden="true">&#9888;</span>
          <span>Conflict check failed: {error}</span>
          {onRetry && (
            <button type="button" className="sob-retry" data-testid="sob-retry" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="series-occurrence-band" data-testid="series-occurrence-band">
        <div className="sob-meta">
          <span className="sob-title">Series</span>
        </div>
        {inputsIncomplete ? (
          // Not a loading state: the check cannot run until the form has a
          // time window (event times or a reservation window). An endless
          // skeleton here would be a lie.
          <p className="sob-incomplete" data-testid="sob-incomplete">
            Add event or reservation times to check the series for room conflicts.
          </p>
        ) : (
          <div className="sob-skeleton" data-testid="sob-skeleton" aria-label="Checking series for conflicts" />
        )}
      </div>
    );
  }

  const selectedConflictIndex = conflictedDates.indexOf(selectedDate);
  const positionText = conflictedDates.length === 0
    ? 'no conflicts'
    : selectedConflictIndex >= 0
      ? `conflict ${selectedConflictIndex + 1} of ${conflictedDates.length}`
      : `${conflictedDates.length} conflict${conflictedDates.length === 1 ? '' : 's'}`;

  return (
    <div className="series-occurrence-band" data-testid="series-occurrence-band">
      <div className="sob-meta">
        <span className="sob-title">
          Series{recurrenceSummary ? <span className="sob-pattern"> &middot; {recurrenceSummary}</span> : null}
        </span>
        <span
          className={`sob-verdict ${blocked ? 'is-blocked' : 'is-clear'}`}
          data-testid="sob-verdict"
          role="status"
        >
          <span className="sob-verdict-dot" aria-hidden="true" />
          {blocked ? (
            <>
              <strong>{conflictingOccurrences}</strong>{' '}of {totalOccurrences} occurrences have room conflicts
              {skippedCount > 0 && <> &middot; {skippedCount} skipped</>}
              {' '}&middot; publishing blocked
            </>
          ) : (
            <>
              All {totalOccurrences} occurrences are clear of room conflicts
              {skippedCount > 0 && <> &middot; {skippedCount} skipped</>}
            </>
          )}
          {loading && <span className="sob-refreshing">Refreshing&hellip;</span>}
        </span>
      </div>

      {compact ? (
        <>
          <p className="sob-compact-summary" data-testid="sob-compact-summary">
            {occurrences.length} occurrences &mdash; too many to chart individually.
            The conflicted dates are listed below.
          </p>
          <div className="sob-conflict-list">
            {conflicts.map((occ) => (
              <button
                key={occ.occurrenceDate}
                type="button"
                className={`sob-conflict-row${occ.occurrenceDate === selectedDate ? ' selected' : ''}`}
                data-testid={`sob-conflict-row-${occ.occurrenceDate}`}
                onClick={() => selectDate(occ.occurrenceDate)}
              >
                <span className="sob-row-date">{formatChipAria(occ.occurrenceDate)}</span>
                <span className="sob-row-count">
                  {occ.hardConflicts.length} blocking event{occ.hardConflicts.length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div
          className={`sob-chips${dense && !focusConflicts ? ' dense' : ''}${focusConflicts ? ' focus-conflicts' : ''}`}
          ref={setRowEl}
          role="list"
          aria-label="Occurrences"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          {focusConflicts
            ? focusItems.map((item, i) =>
                typeof item === 'number' ? (
                  <span
                    key={`gap-${i}`}
                    role="listitem"
                    className="sob-gap"
                    data-testid="sob-gap"
                    title={formatGapLabel(item)}
                    aria-label={formatGapLabel(item)}
                  >
                    {item === 1 ? '·' : item <= 3 ? '··' : '···'}
                  </span>
                ) : renderChip(item)
              )
            : (
              <>
                {renderMoreChip(hiddenBefore, 'before')}
                {visibleOccurrences.map(renderChip)}
                {renderMoreChip(hiddenAfter, 'after')}
              </>
            )}
        </div>
      )}

      <div className="sob-controls">
        <div className="sob-focus-toggle" role="group" aria-label="Occurrence focus">
          <button
            type="button"
            data-testid="sob-focus-all"
            className={focusMode === 'all' ? 'active' : ''}
            onClick={() => setFocusMode('all')}
          >
            All dates
          </button>
          <button
            type="button"
            data-testid="sob-focus-conflicts"
            className={focusConflicts ? 'active' : ''}
            onClick={enterConflictsFocus}
          >
            Conflicts
            <span
              className={`sob-focus-count${conflictedDates.length === 0 ? ' zero' : ''}`}
              data-testid="sob-focus-count"
            >
              {conflictedDates.length}
            </span>
          </button>
        </div>
        <div className="sob-stepper">
          <span className="sob-conflict-position" data-testid="sob-conflict-position">{positionText}</span>
          <button
            type="button"
            data-testid="sob-prev-conflict"
            aria-label="Previous conflict"
            disabled={conflictedDates.length === 0}
            onClick={() => stepConflict(-1)}
          >
            &lsaquo;
          </button>
          <button
            type="button"
            data-testid="sob-next-conflict"
            aria-label="Next conflict"
            disabled={conflictedDates.length === 0}
            onClick={() => stepConflict(1)}
          >
            &rsaquo;
          </button>
        </div>
      </div>
    </div>
  );
}

function formatChipMonth(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
}

function formatChipDay(dateStr) {
  return new Date(dateStr + 'T12:00:00').getDate();
}

function formatGapLabel(n) {
  return `${n} date${n === 1 ? '' : 's'} without conflicts`;
}

function formatChipAria(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}
