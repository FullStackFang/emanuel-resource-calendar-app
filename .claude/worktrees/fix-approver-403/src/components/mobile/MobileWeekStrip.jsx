import React from 'react';
import { DAY_LABELS, DAY_NAMES, MONTH_NAMES } from './mobileConstants';
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

function MobileWeekStrip({ selectedDate, onDateSelect, eventDates }) {
  const today = new Date();
  const weekDays = getWeekDays(selectedDate);

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

  // Month/year label — handles cross-year weeks (e.g., Dec/Jan)
  const monthLabel = (() => {
    const firstMonth = weekDays[0].getMonth();
    const lastMonth = weekDays[6].getMonth();
    const firstYear = weekDays[0].getFullYear();
    const lastYear = weekDays[6].getFullYear();
    if (firstMonth === lastMonth) {
      return `${MONTH_NAMES[firstMonth]} ${firstYear}`;
    }
    if (firstYear !== lastYear) {
      return `${MONTH_NAMES[firstMonth]} ${firstYear} / ${MONTH_NAMES[lastMonth]} ${lastYear}`;
    }
    return `${MONTH_NAMES[firstMonth]} / ${MONTH_NAMES[lastMonth]} ${firstYear}`;
  })();

  return (
    <div className="mobile-week-strip">
      <div className="mobile-week-strip-header">
        <button className="mobile-week-nav" onClick={goToPrevWeek} aria-label="Previous week">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="mobile-week-label">{monthLabel}</span>
        <button className="mobile-week-nav" onClick={goToNextWeek} aria-label="Next week">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
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
      {showTodayButton && (
        <button className="mobile-week-today-btn" onClick={goToToday}>
          Today
        </button>
      )}
    </div>
  );
}

export { formatDateKey, getWeekDays, isSameDay };
export default React.memo(MobileWeekStrip);
