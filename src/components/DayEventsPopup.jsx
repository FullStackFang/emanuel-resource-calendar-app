import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTimezone } from '../context/TimezoneContext';
import { usePermissions } from '../hooks/usePermissions';
import { sortEventsByStartTime } from '../utils/eventTransformers';
import { getLocationConflictInfo } from '../utils/eventOverlapUtils';
import { RecurringIcon, WarningIcon, ConcurrentIcon, TimerIcon, LocationIcon, VideoIcon, TagIcon } from './shared/CalendarIcons';
import './DayEventsPopup.css';

const POPUP_WIDTH = 340;
const POPUP_MAX_H = 420;
const MARGIN = 8;
const OFFSET = 4;

function computePosition(anchorRect) {
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Vertically center the popup in the viewport, clamped to safe bounds
  const popupHeight = Math.min(POPUP_MAX_H, vh - MARGIN * 2);
  let top = Math.round((vh - popupHeight) / 2);
  top = Math.max(MARGIN, Math.min(top, vh - popupHeight - MARGIN));

  // Horizontally: prefer right of anchor, fall back to left
  let left = anchorRect.right + OFFSET;
  if (left + POPUP_WIDTH + MARGIN > vw) {
    left = anchorRect.left - POPUP_WIDTH - OFFSET;
  }
  left = Math.max(MARGIN, Math.min(left, vw - POPUP_WIDTH - MARGIN));

  return { top, left };
}

// Check if a location is a virtual meeting URL
function isVirtualLocation(locationString) {
  if (!locationString) return false;
  try {
    new URL(locationString);
    return true;
  } catch {
    return /^https?:\/\//i.test(locationString) ||
           /zoom\.us|teams\.microsoft\.com|meet\.google\.com|webex\.com/i.test(locationString);
  }
}

// Get the virtual platform name
function getVirtualPlatform(locationString) {
  if (!locationString) return null;
  const lower = locationString.toLowerCase();
  if (lower.includes('zoom')) return 'Zoom';
  if (lower.includes('teams')) return 'Teams';
  if (lower.includes('meet.google')) return 'Google Meet';
  if (lower.includes('webex')) return 'Webex';
  return 'Virtual';
}

const DayEventsPopup = ({
  day,
  events,
  anchorRect,
  onClose,
  onEventClick,
  formatEventTime,
  getCategoryColor,
  getLocationColor,
  groupBy,
  onRequestEdit
}) => {
  const { userTimezone } = useTimezone();
  const { canSubmitReservation, canEditEvents } = usePermissions();
  const popupRef = useRef(null);
  const [expandedOverlaps, setExpandedOverlaps] = useState({});

  // ESC key listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const handleEventCardClick = useCallback((event, e) => {
    e.stopPropagation();
    if (onEventClick) onEventClick(event, e);
    onClose();
  }, [onEventClick, onClose]);

  const formatTime = useCallback((dateTimeString, eventSubject, sourceTimezone) => {
    if (!dateTimeString) return 'Time unavailable';
    if (formatEventTime && typeof formatEventTime === 'function') {
      return formatEventTime(dateTimeString, userTimezone, eventSubject, sourceTimezone);
    }
    return 'Time unavailable';
  }, [formatEventTime, userTimezone]);

  if (!day || !anchorRect) return null;

  const sortedEvents = sortEventsByStartTime(events || []);
  const position = computePosition(anchorRect);

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  };

  const content = (
    <div className="dep-backdrop" onClick={handleBackdropClick}>
      <div
        ref={popupRef}
        className="dep-popup"
        style={{ top: position.top, left: position.left }}
      >
        {/* Header */}
        <div className="dep-header">
          <div className="dep-header-info">
            <div className="dep-header-date">{formatDate(day.date)}</div>
            <div className="dep-header-count">
              {sortedEvents.length} {sortedEvents.length === 1 ? 'event' : 'events'}
            </div>
          </div>
          <button className="dep-close-btn" onClick={onClose} title="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3L11 11M11 3L3 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Event list */}
        <div className="dep-body">
          {sortedEvents.length === 0 ? (
            <div className="dep-empty">No events scheduled</div>
          ) : (
            sortedEvents.map((event) => {
              const { overlapCount, overlappingEvents, hasParentEvent, isParentEvent } = getLocationConflictInfo(event, sortedEvents);
              const eventKey = event.eventId || event.id;
              const isOverlapExpanded = !!expandedOverlaps[eventKey];
              const isPending = event.status === 'pending';
              const hasPendingEditRequest = !!event.showPendingEditBadge;
              const eventCategories = event.calendarData?.categories || event.categories || event.graphData?.categories || (event.category ? [event.category] : ['Uncategorized']);
              const primaryCategory = eventCategories[0] || 'Uncategorized';
              const borderColor = isParentEvent
                ? '#4aba6d'
                : (groupBy === 'categories'
                  ? getCategoryColor(primaryCategory)
                  : getLocationColor(event.location?.displayName || 'Unspecified'));

              return (
                <div
                  key={event.eventId || event.id}
                  className={`dep-event-item ${isPending ? 'dep-pending' : ''} ${isParentEvent ? 'dep-parent' : ''}`}
                  onClick={(e) => handleEventCardClick(event, e)}
                  style={{
                    borderLeft: `4px ${isPending ? 'dashed' : 'solid'} ${borderColor}`,
                    opacity: isPending ? 0.85 : 1,
                    backgroundColor: isParentEvent ? 'rgba(74, 186, 109, 0.08)' : undefined
                  }}
                >
                  {/* Recurring indicator */}
                  {((event.eventType || event.graphData?.type) === 'seriesMaster' ||
                    (event.seriesMasterId || event.graphData?.seriesMasterId) ||
                    (event.recurrence || event.graphData?.recurrence)) && (
                    <div className="dep-recurring-icon" style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      <RecurringIcon size={14} />
                    </div>
                  )}

                  {/* Overlap badge (click to expand) */}
                  {overlapCount > 0 && (
                    <>
                      <div
                        className={`dep-overlap-badge dep-overlap-toggle ${hasParentEvent ? 'dep-overlap-nested' : 'dep-overlap-conflict'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedOverlaps(prev => ({ ...prev, [eventKey]: !prev[eventKey] }));
                        }}
                        title="Click to see overlapping events"
                      >
                        {hasParentEvent
                          ? `+${overlapCount} nested`
                          : <><WarningIcon size={10} /> {overlapCount + 1} overlapping</>}
                        <span className={`dep-overlap-chevron ${isOverlapExpanded ? 'dep-chevron-open' : ''}`}>&#9662;</span>
                      </div>
                      {isOverlapExpanded && (
                        <div className="dep-overlap-list">
                          {overlappingEvents.map(oe => (
                            <div
                              key={oe.eventId || oe.id}
                              className="dep-overlap-list-item"
                              onClick={(e) => { e.stopPropagation(); handleEventCardClick(oe, e); }}
                            >
                              <span className="dep-overlap-list-name">{oe.subject}</span>
                              <span className="dep-overlap-list-time">
                                {formatTime(oe.start?.dateTime, oe.subject, oe.start?.timeZone || oe.graphData?.start?.timeZone)}
                                {' - '}
                                {formatTime(oe.end?.dateTime, oe.subject, oe.end?.timeZone || oe.graphData?.end?.timeZone)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* Time */}
                  <div className="dep-event-time">
                    {isParentEvent && <span style={{ marginRight: '4px' }}><ConcurrentIcon size={12} /></span>}
                    {formatTime(event.start.dateTime, event.subject, event.start?.timeZone || event.graphData?.start?.timeZone)}
                    {' - '}
                    {formatTime(event.end.dateTime, event.subject, event.end?.timeZone || event.graphData?.end?.timeZone)}
                  </div>

                  {/* Subject */}
                  <div className="dep-event-subject">{event.subject}</div>

                  {/* Location */}
                  {event.location?.displayName && event.location.displayName !== 'Unspecified' && (
                    <div className="dep-event-detail">
                      {isVirtualLocation(event.location.displayName) ? (
                        <>
                          <span className="dep-detail-icon"><VideoIcon size={13} /></span>
                          <span className="dep-virtual-badge">
                            {getVirtualPlatform(event.location.displayName)} Meeting
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="dep-detail-icon"><LocationIcon size={13} /></span>
                          {event.location.displayName}
                        </>
                      )}
                    </div>
                  )}

                  {/* Category */}
                  <div className="dep-event-detail">
                    <span className="dep-detail-icon"><TagIcon size={13} /></span>
                    {primaryCategory}
                  </div>

                  {/* Setup/Teardown */}
                  {(event.setupMinutes > 0 || event.teardownMinutes > 0) && (
                    <div className="dep-event-detail dep-setup-info">
                      <span className="dep-detail-icon"><TimerIcon size={13} /></span>
                      Setup/Teardown:
                      {event.setupMinutes > 0 && <span> {event.setupMinutes}min before</span>}
                      {event.setupMinutes > 0 && event.teardownMinutes > 0 && <span>,</span>}
                      {event.teardownMinutes > 0 && <span> {event.teardownMinutes}min after</span>}
                    </div>
                  )}

                  {/* Status badges */}
                  {isPending && <div className="dep-status-badge dep-badge-pending">PENDING</div>}
                  {hasPendingEditRequest && <div className="dep-status-badge dep-badge-edit-pending">EDIT PENDING</div>}
                  {event.isRecurringOccurrence && (
                    <span className="dep-status-badge" style={{ color: '#1e40af', backgroundColor: '#dbeafe', border: '1px solid rgba(96, 165, 250, 0.5)' }}>
                      {event.showOccurrenceNumbers
                        ? `${event.occurrenceNumber}/${event.totalOccurrences}${event.isInfiniteSeries ? '\u221E' : ''}`
                        : '\u21BB'}
                    </span>
                  )}

                  {/* Request Edit button */}
                  {event.status === 'published' && canSubmitReservation && !canEditEvents && onRequestEdit && event.pendingEditRequest?.status !== 'pending' && (
                    <button
                      className="dep-request-edit-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestEdit(event);
                        onClose();
                      }}
                    >
                      Request Edit
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

export default DayEventsPopup;
