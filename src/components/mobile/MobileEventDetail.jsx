import React from 'react';
import { formatHoursMinutes, formatTimeFromDateTimeString } from '../../utils/appTimeUtils';
import useScrollLock from '../../hooks/useScrollLock';
import { STATUS_MAP, DAY_NAMES, MONTH_NAMES } from './mobileConstants';
import './MobileEventDetail.css';

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatTime(timeStr, fallbackDateTime) {
  if (timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    if (!isNaN(h) && !isNaN(m)) return formatHoursMinutes(h, m);
  }
  return formatTimeFromDateTimeString(fallbackDateTime) || '';
}

function MobileEventDetail({ event, onClose }) {
  const isOpen = !!event;
  useScrollLock(isOpen);

  if (!event) return null;

  const status = STATUS_MAP[event.status] || STATUS_MAP.pending;
  const categories = Array.isArray(event.categories) ? event.categories.filter(Boolean) : [];
  const hasTimingDetails = event.setupTime || event.teardownTime || event.doorOpenTime || event.doorCloseTime;
  const descriptionText = event.eventDescription || '';

  const timeDisplay = event.isAllDayEvent
    ? 'All Day'
    : `${formatTime(event.startTime, event.startDateTime)} - ${formatTime(event.endTime, event.endDateTime)}`;

  return (
    <>
      <div
        className={`mobile-detail-backdrop ${isOpen ? 'visible' : ''}`}
        onClick={onClose}
      />
      <div className={`mobile-detail-sheet ${isOpen ? 'open' : ''}`}>
        {/* Nav bar */}
        <div className="mobile-detail-nav">
          <button className="mobile-detail-back" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>
          <span className={`mobile-detail-badge ${status.color}`}>
            {status.label}
          </span>
        </div>

        {/* Scrollable content */}
        <div className="mobile-detail-scroll">
          {/* Hero header */}
          <div className={`mobile-detail-hero ${status.color}`}>
            <h1 className="mobile-detail-title">{event.eventTitle || 'Untitled Event'}</h1>
            <div className="mobile-detail-hero-meta">
              <span className="mobile-detail-hero-date">{formatDate(event.startDate)}</span>
              <span className="mobile-detail-hero-time">{timeDisplay}</span>
            </div>
          </div>

          {/* Detail sections */}
          <div className="mobile-detail-body">
            {/* Location */}
            {(event.locationDisplayNames || event.location) && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Location</span>
                <span className="mobile-detail-value">{event.locationDisplayNames || event.location}</span>
              </div>
            )}

            {/* Requester */}
            {event.requesterName && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Requested By</span>
                <span className="mobile-detail-value">{event.requesterName}</span>
                {event.department && (
                  <span className="mobile-detail-sub">{event.department}</span>
                )}
                {event.requesterEmail && (
                  <span className="mobile-detail-sub">{event.requesterEmail}</span>
                )}
              </div>
            )}

            {/* Categories */}
            {categories.length > 0 && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Category</span>
                <div className="mobile-detail-tags">
                  {categories.map((cat, i) => (
                    <span key={i} className="mobile-detail-tag">{cat}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Attendees */}
            {event.attendeeCount > 0 && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Attendees</span>
                <span className="mobile-detail-value">{event.attendeeCount} expected</span>
              </div>
            )}

            {/* Contact person (if on behalf of) */}
            {event.isOnBehalfOf && event.contactName && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Contact Person</span>
                <span className="mobile-detail-value">{event.contactName}</span>
                {event.contactEmail && (
                  <span className="mobile-detail-sub">{event.contactEmail}</span>
                )}
              </div>
            )}

            {/* Timing details */}
            {hasTimingDetails && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Timing</span>
                <div className="mobile-detail-timing-grid">
                  {event.setupTime && (
                    <div className="mobile-detail-timing-row">
                      <span className="mobile-detail-timing-key">Setup</span>
                      <span className="mobile-detail-timing-val">{formatTime(event.setupTime)}</span>
                    </div>
                  )}
                  {event.doorOpenTime && (
                    <div className="mobile-detail-timing-row">
                      <span className="mobile-detail-timing-key">Doors Open</span>
                      <span className="mobile-detail-timing-val">{formatTime(event.doorOpenTime)}</span>
                    </div>
                  )}
                  {event.doorCloseTime && (
                    <div className="mobile-detail-timing-row">
                      <span className="mobile-detail-timing-key">Doors Close</span>
                      <span className="mobile-detail-timing-val">{formatTime(event.doorCloseTime)}</span>
                    </div>
                  )}
                  {event.teardownTime && (
                    <div className="mobile-detail-timing-row">
                      <span className="mobile-detail-timing-key">Teardown</span>
                      <span className="mobile-detail-timing-val">{formatTime(event.teardownTime)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Special requirements */}
            {event.specialRequirements && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Special Requirements</span>
                <p className="mobile-detail-text">{event.specialRequirements}</p>
              </div>
            )}

            {/* Description */}
            {descriptionText && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Description</span>
                <p className="mobile-detail-text">{descriptionText}</p>
              </div>
            )}

            {/* Notes */}
            {(event.setupNotes || event.doorNotes || event.eventNotes) && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Notes</span>
                {event.setupNotes && <p className="mobile-detail-text"><strong>Setup:</strong> {event.setupNotes}</p>}
                {event.doorNotes && <p className="mobile-detail-text"><strong>Door:</strong> {event.doorNotes}</p>}
                {event.eventNotes && <p className="mobile-detail-text"><strong>Event:</strong> {event.eventNotes}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default MobileEventDetail;
