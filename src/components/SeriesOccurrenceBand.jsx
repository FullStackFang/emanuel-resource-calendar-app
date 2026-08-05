import { useState } from 'react';
import './SeriesOccurrenceBand.css';

// Density thresholds carried from the retired RecurringConflictSummary strip
// (design D9 there, D10 here): above DENSE the chips drop their date labels;
// above COMPACT the chip row is replaced by a text summary + conflict list —
// past that density the row stops being glanceable and starts being wallpaper.
const DENSE_THRESHOLD = 60;
const COMPACT_THRESHOLD = 150;

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
  onSelectDate = null,
}) {
  // Conflicts-only focus is band-local UI state (design D6): compress, don't
  // hide — the temporal shape of the series ("the conflicts cluster in early
  // fall") must survive focusing.
  const [focusMode, setFocusMode] = useState('all');

  const blocked = conflictingOccurrences > 0;
  const skippedCount = occurrences.filter(o => o.state === 'skipped').length;
  const dense = occurrences.length > DENSE_THRESHOLD;
  const compact = occurrences.length > COMPACT_THRESHOLD;
  const focusConflicts = focusMode === 'conflicts';

  const selectDate = (date) => {
    if (onSelectDate) onSelectDate(date);
  };

  const handleChipClick = (occ) => {
    // Compressed chips are inert in conflicts focus
    if (focusConflicts && occ.state !== 'conflicted') return;
    selectDate(occ.date);
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
          className={`sob-chips${dense ? ' dense' : ''}${focusConflicts ? ' focus-conflicts' : ''}`}
          role="list"
          aria-label="Occurrences"
        >
          {occurrences.map((occ) => {
            const isSelected = occ.date === selectedDate;
            const compressed = focusConflicts && occ.state !== 'conflicted';
            const stateLabel = occ.state === 'skipped'
              ? (occ.pending ? 'skipped (not saved yet)' : 'skipped')
              : occ.state;
            return (
              <button
                key={occ.date}
                type="button"
                role="listitem"
                className={`sob-chip ${occ.state}${isSelected ? ' selected' : ''}${compressed ? ' compressed' : ''}`}
                data-testid={`sob-chip-${occ.date}`}
                data-date={occ.date}
                data-state={occ.state}
                data-pending={String(!!occ.pending)}
                data-selected={String(isSelected)}
                title={`${formatChipAria(occ.date)} — ${stateLabel}`}
                aria-label={`${formatChipAria(occ.date)} — ${stateLabel}`}
                aria-current={isSelected ? 'date' : undefined}
                onClick={() => handleChipClick(occ)}
              >
                {!dense && !compressed && (
                  <>
                    <span className="sob-chip-month" aria-hidden="true">{formatChipMonth(occ.date)}</span>
                    <span className="sob-chip-day" aria-hidden="true">{formatChipDay(occ.date)}</span>
                  </>
                )}
              </button>
            );
          })}
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

function formatChipAria(dateStr) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}
