import React, { useState } from 'react';
import { DAY_LABELS, DAY_NAMES, MONTH_NAMES, MONTH_NAMES_SHORT } from './mobileConstants';
import MobileDatePicker from './MobileDatePicker';
import MobileViewSwitcher from './MobileViewSwitcher';
import './MobileWeekStrip.css';

function getWeekDays(date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay()); // Sunday
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

/**
 * The month row, the seven day cells, and — when the caller owns a view
 * preference — the calendar's view switcher.
 *
 * The switcher is passed as `activeView`/`onViewChange` rather than as a
 * rendered child so `React.memo` still bites: a JSX element prop would be a new
 * object on every parent render and defeat it.
 */
function MobileWeekStrip({ selectedDate, onDateSelect, eventDates, activeView, onViewChange }) {
  const today = new Date();
  const weekDays = getWeekDays(selectedDate);
  const [pickerOpen, setPickerOpen] = useState(false);

  const goToPrevWeek = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 7);
    onDateSelect(prev);
  };

  const goToNextWeek = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 7);
    onDateSelect(next);
  };

  const goToToday = () => {
    onDateSelect(new Date());
  };

  // Check if current week contains today
  const currentWeekStart = new Date(today);
  currentWeekStart.setDate(currentWeekStart.getDate() - currentWeekStart.getDay());
  const showTodayButton = !isSameDay(weekDays[0], currentWeekStart);

  // Month/year label — handles cross-year weeks (e.g., Dec/Jan).
  //
  // The two-month forms abbreviate. Once the view switcher joined this row there
  // is roughly 90px left for the label, and 'July / August 2026' wants 114 — it
  // would ellipsize to 'July / Au…' for one week of every month. The one-month
  // form (the other three weeks) fits comfortably and stays spelled out.
  const monthLabel = (() => {
    const firstMonth = weekDays[0].getMonth();
    const lastMonth = weekDays[6].getMonth();
    const firstYear = weekDays[0].getFullYear();
    const lastYear = weekDays[6].getFullYear();
    if (firstMonth === lastMonth) {
      return `${MONTH_NAMES[firstMonth]} ${firstYear}`;
    }
    if (firstYear !== lastYear) {
      return `${MONTH_NAMES_SHORT[firstMonth]} ${firstYear} / ${MONTH_NAMES_SHORT[lastMonth]} ${lastYear}`;
    }
    return `${MONTH_NAMES_SHORT[firstMonth]} / ${MONTH_NAMES_SHORT[lastMonth]} ${firstYear}`;
  })();

  return (
    <div className="mobile-week-strip">
      <div className="mobile-week-strip-header">
        <div className="mobile-week-header-main">
          <button className="mobile-week-nav" onClick={goToPrevWeek} aria-label="Previous week">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button className="mobile-week-nav" onClick={goToNextWeek} aria-label="Next week">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button
            className="mobile-week-label"
            onClick={() => setPickerOpen(true)}
            aria-label={`${monthLabel} — choose date`}
            aria-haspopup="dialog"
          >
            <span>{monthLabel}</span>
            <svg className="mobile-week-label-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          {showTodayButton && (
            <button className="mobile-week-today-btn" onClick={goToToday}>
              Today
            </button>
          )}
        </div>
        {onViewChange && (
          <MobileViewSwitcher activeView={activeView} onChange={onViewChange} />
        )}
      </div>
      <div className="mobile-week-days">
        {weekDays.map((date, i) => (
          <button
            key={i}
            className={`mobile-week-day ${isSameDay(date, today) ? 'today' : ''} ${isSameDay(date, selectedDate) ? 'selected' : ''}`}
            onClick={() => onDateSelect(date)}
            aria-label={`${DAY_NAMES[date.getDay()]} ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`}
            aria-pressed={isSameDay(date, selectedDate)}
          >
            <span className="mobile-week-day-label">{DAY_LABELS[i]}</span>
            <span className="mobile-week-day-number">{date.getDate()}</span>
            {eventDates?.has(formatDateKey(date)) && <span className="mobile-week-day-dot" />}
          </button>
        ))}
      </div>
      <MobileDatePicker
        isOpen={pickerOpen}
        initialDate={selectedDate}
        eventDates={eventDates}
        onSelect={onDateSelect}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

export { formatDateKey, getWeekDays, isSameDay };
export default React.memo(MobileWeekStrip);
