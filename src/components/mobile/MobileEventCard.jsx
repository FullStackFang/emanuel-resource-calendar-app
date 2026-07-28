import React from 'react';
import { formatTimeFromDateTimeString } from '../../utils/appTimeUtils';
import { STATUS_MAP, MONTH_NAMES_SHORT } from './mobileConstants';
import './MobileEventCard.css';

/** 'YYYY-MM-DD' → 'May 1'. Parsed by parts, never `new Date(str)`, which would
 *  reinterpret a bare date as UTC midnight and shift it a day in the Americas. */
function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const [, month, day] = dateStr.split('-');
  const monthIndex = parseInt(month, 10) - 1;
  if (isNaN(monthIndex) || !MONTH_NAMES_SHORT[monthIndex]) return '';
  return `${MONTH_NAMES_SHORT[monthIndex]} ${parseInt(day, 10)}`;
}

/**
 * @param {boolean} [showDate]   Prefix the time with the event's date. The
 *   agenda groups by day so it does not need this; a flat list (Requests) does.
 * @param {boolean} [showStatus] Render the status label as a pill. Replaces the
 *   category chip rather than joining it — on a phone the top row fits one.
 */
function MobileEventCard({ event, onTap, showDate = false, showStatus = false }) {
  const status = STATUS_MAP[event.status] || STATUS_MAP.pending;

  const timeOfDay = event.isAllDayEvent
    ? 'All Day'
    : formatTimeFromDateTimeString(event.startDateTime);
  const datePart = showDate ? formatShortDate(event.startDate) : '';
  const timeDisplay = datePart ? `${datePart} · ${timeOfDay}` : timeOfDay;

  const location = event.locationDisplayNames || event.location || '';
  const categories = Array.isArray(event.categories) ? event.categories : [];
  const firstCategory = categories[0] || '';

  return (
    <button className="mobile-event-card" onClick={() => onTap(event)}>
      <div className={`mobile-event-card-dot ${status.color}`} />
      <div className="mobile-event-card-body">
        <div className="mobile-event-card-top">
          <span className="mobile-event-card-time">{timeDisplay}</span>
          {showStatus ? (
            <span className={`mobile-event-card-status ${status.color}`}>{status.label}</span>
          ) : firstCategory ? (
            <span className="mobile-event-card-category">{firstCategory}</span>
          ) : null}
        </div>
        <span className="mobile-event-card-title">{event.eventTitle || 'Untitled Event'}</span>
        {location && (
          <span className="mobile-event-card-location">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {location}
          </span>
        )}
      </div>
    </button>
  );
}

export default React.memo(MobileEventCard);
