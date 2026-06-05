import React, { useState, useEffect } from 'react';
import useScrollLock from '../../hooks/useScrollLock';
import { DAY_LABELS, DAY_NAMES, MONTH_NAMES, MONTH_NAMES_SHORT } from './mobileConstants';
import './MobileDatePicker.css';

// Local key formatter (matches MobileWeekStrip.formatDateKey) so this component
// stays free of a circular import with the strip that renders it.
function dateKey(year, month, day) {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

function isSameYMD(date, year, month, day) {
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
}

/**
 * Bottom-sheet date picker for the mobile agenda. Reuses the MobileEventDetail
 * backdrop/sheet visual language.
 *
 * Two tiers so distant months are reachable in a couple of taps instead of
 * paging the chevrons N times:
 *   - 'days'   — month day grid (default)
 *   - 'months' — 12-month grid with year stepping; tapping a month drops back
 *                to the day grid for that month.
 *
 * Props:
 *  - isOpen:       controls mount/visibility
 *  - initialDate:  Date the picker opens on (also the highlighted selection)
 *  - eventDates:   Set of 'YYYY-MM-DD' keys that should show an event dot
 *  - onSelect:     (Date) => void — fired when a day (or "today") is chosen
 *  - onClose:      () => void — fired on backdrop tap / after a selection
 */
function MobileDatePicker({ isOpen, initialDate, eventDates, onSelect, onClose }) {
  useScrollLock(isOpen);

  const base = initialDate instanceof Date ? initialDate : new Date();
  const [view, setView] = useState({ year: base.getFullYear(), month: base.getMonth() });
  const [mode, setMode] = useState('days');

  // Re-anchor to the incoming date and reset to the day grid each time the sheet
  // opens, so a recycled component never reopens onto a stale month or tier.
  useEffect(() => {
    if (isOpen) {
      setView({ year: base.getFullYear(), month: base.getMonth() });
      setMode('days');
    }
    // base is derived from initialDate; depending on its time avoids stale anchors
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, base.getTime()]);

  if (!isOpen) return null;

  const { year, month } = view;
  const today = new Date();
  const showingMonths = mode === 'months';

  const goPrevMonth = () =>
    setView(({ year: y, month: m }) => (m === 0 ? { year: y - 1, month: 11 } : { year: y, month: m - 1 }));
  const goNextMonth = () =>
    setView(({ year: y, month: m }) => (m === 11 ? { year: y + 1, month: 0 } : { year: y, month: m + 1 }));
  const goPrevYear = () => setView((v) => ({ ...v, year: v.year - 1 }));
  const goNextYear = () => setView((v) => ({ ...v, year: v.year + 1 }));

  const pickMonth = (m) => {
    setView((v) => ({ ...v, month: m }));
    setMode('days');
  };

  const pick = (date) => {
    onSelect(date);
    onClose();
  };

  // Day grid: leading blanks for the first-of-month weekday, then the days.
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <>
      <div className="mobile-datepicker-backdrop" onClick={onClose} />
      <div
        className="mobile-datepicker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Choose date"
      >
        <div className="mobile-datepicker-grabber" />

        {/* ── Header: month nav (days) or year nav (months) ── */}
        <div className="mobile-datepicker-header">
          {showingMonths ? (
            <>
              <button className="mobile-datepicker-nav" onClick={goPrevYear} aria-label="Previous year">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                className="mobile-datepicker-title is-open"
                onClick={() => setMode('days')}
                aria-label={`${year}, back to day view`}
              >
                <span>{year}</span>
                <svg className="mobile-datepicker-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <button className="mobile-datepicker-nav" onClick={goNextYear} aria-label="Next year">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <button className="mobile-datepicker-nav" onClick={goPrevMonth} aria-label="Previous month">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                className="mobile-datepicker-title"
                onClick={() => setMode('months')}
                aria-label={`${MONTH_NAMES[month]} ${year}, choose month`}
              >
                <span>{`${MONTH_NAMES[month]} ${year}`}</span>
                <svg className="mobile-datepicker-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              <button className="mobile-datepicker-nav" onClick={goNextMonth} aria-label="Next month">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* ── Body: 12-month grid or the day grid ── */}
        {showingMonths ? (
          <div className="mobile-datepicker-months" key={`months-${year}`}>
            {MONTH_NAMES_SHORT.map((label, m) => {
              const isSelected = base.getFullYear() === year && base.getMonth() === m;
              const isCurrent = today.getFullYear() === year && today.getMonth() === m;
              return (
                <button
                  key={m}
                  type="button"
                  className={`mobile-datepicker-month ${isCurrent ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                  onClick={() => pickMonth(m)}
                  aria-label={`${MONTH_NAMES[m]} ${year}`}
                  aria-pressed={isSelected}
                >
                  {label}
                </button>
              );
            })}
          </div>
        ) : (
          <div key={`days-${year}-${month}`} className="mobile-datepicker-dayview">
            <div className="mobile-datepicker-weekdays">
              {DAY_LABELS.map((label, i) => (
                <span key={i} className="mobile-datepicker-weekday">{label}</span>
              ))}
            </div>

            <div className="mobile-datepicker-grid">
              {cells.map((day, i) => {
                if (day === null) {
                  return <span key={`blank-${i}`} className="mobile-datepicker-cell empty" />;
                }
                const isSelected = isSameYMD(base, year, month, day);
                const isToday = isSameYMD(today, year, month, day);
                const hasEvent = eventDates?.has(dateKey(year, month, day));
                return (
                  <button
                    key={day}
                    type="button"
                    className={`mobile-datepicker-cell ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={() => pick(new Date(year, month, day))}
                    aria-label={`${DAY_NAMES[new Date(year, month, day).getDay()]} ${MONTH_NAMES[month]} ${day}, ${year}`}
                    aria-pressed={isSelected}
                  >
                    <span className="mobile-datepicker-cell-number">{day}</span>
                    {hasEvent && <span className="mobile-datepicker-dot" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mobile-datepicker-footer">
          <button
            className="mobile-datepicker-today-btn"
            onClick={() => pick(new Date())}
          >
            Jump to today
          </button>
        </div>
      </div>
    </>
  );
}

export default React.memo(MobileDatePicker);
