import React from 'react';
import { formatTimeFromDateTimeString } from '../../utils/appTimeUtils';
import { STATUS_MAP } from './mobileConstants';
import './MobileEventCard.css';

function MobileEventCard({ event, onTap }) {
  const status = STATUS_MAP[event.status] || STATUS_MAP.pending;

  const timeDisplay = event.isAllDayEvent
    ? 'All Day'
    : formatTimeFromDateTimeString(event.startDateTime);

  const location = event.locationDisplayNames || event.location || '';
  const categories = Array.isArray(event.categories) ? event.categories : [];
  const firstCategory = categories[0] || '';

  return (
    <button className="mobile-event-card" onClick={() => onTap(event)}>
      <div className={`mobile-event-card-dot ${status.color}`} />
      <div className="mobile-event-card-body">
        <div className="mobile-event-card-top">
          <span className="mobile-event-card-time">{timeDisplay}</span>
          {firstCategory && (
            <span className="mobile-event-card-category">{firstCategory}</span>
          )}
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
