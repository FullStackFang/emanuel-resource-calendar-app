import React, { useState, useEffect, useCallback } from 'react';
import { useMsal } from '@azure/msal-react';
import APP_CONFIG from '../../config/config';
import { formatHoursMinutes, formatTimeFromDateTimeString } from '../../utils/appTimeUtils';
import useScrollLock from '../../hooks/useScrollLock';
import useBackDismiss from '../../hooks/useBackDismiss';
import useFloorPlan from '../../hooks/useFloorPlan';
import { useAuthenticatedFetch } from '../../hooks/useAuthenticatedFetch';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import { logger } from '../../utils/logger';
import { STATUS_MAP, DAY_NAMES, MONTH_NAMES, MONTH_NAMES_SHORT } from './mobileConstants';
import './MobileEventDetail.css';

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const date = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  return `${DAY_NAMES[date.getDay()]}, ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Format a statusHistory `changedAt` (an ISO string once it has crossed JSON)
 * as e.g. "May 1, 2:30 PM". Unparseable values yield '' so the timeline entry
 * degrades to status + actor rather than rendering "Invalid Date".
 */
function formatHistoryTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  return `${MONTH_NAMES_SHORT[date.getMonth()]} ${date.getDate()}, ${formatHoursMinutes(date.getHours(), date.getMinutes())}`;
}

function formatTime(timeStr, fallbackDateTime) {
  if (timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    if (!isNaN(h) && !isNaN(m)) return formatHoursMinutes(h, m);
  }
  return formatTimeFromDateTimeString(fallbackDateTime) || '';
}

/**
 * @param {boolean} [showReservationContext] Opened from the Requests tab: adds
 *   the review timeline, the rejection notice, and (for the viewer's own pending
 *   request) the withdraw action. Off elsewhere — the calendar agenda shows the
 *   same sheet as a pure read-only event view.
 * @param {Function} [onWithdrawn] Called after a withdraw resolves — including
 *   the "already handled" 409 path. The owner closes the sheet and refetches.
 */
function MobileEventDetail({ event, onClose, showReservationContext = false, onWithdrawn }) {
  const isOpen = !!event;
  useScrollLock(isOpen);

  const { apiToken } = useAuth();
  const { accounts } = useMsal();
  const authFetch = useAuthenticatedFetch();
  const { showSuccess, showError, showWarning } = useNotification();
  const { floorPlanUrl, fileName } = useFloorPlan(event?.eventId, { apiToken, enabled: isOpen });

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [isWithdrawConfirming, setIsWithdrawConfirming] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');

  // The device Back button unwinds one layer at a time — lightbox, then sheet,
  // then out of the app. Declared outermost-first so the layers stack in the
  // order they appear on screen. See useBackDismiss for why this is needed at
  // all: the mobile shell is state-driven and owns no routes.
  useBackDismiss(isOpen, onClose);
  useBackDismiss(lightboxOpen, () => setLightboxOpen(false));

  // Reset the viewer whenever the sheet closes or switches to another event,
  // so a recycled component never reopens onto a stale floor plan. The withdraw
  // confirmation rides the same signal for a sharper reason: a primed
  // "Confirm withdrawal?" surviving into the next event would arm a destructive
  // action against a request the user never looked at. The confirmation has no
  // auto-reset timeout by design (app-wide standard) — this is its only exit
  // besides confirming.
  useEffect(() => {
    setLightboxOpen(false);
    setZoomed(false);
    setIsWithdrawConfirming(false);
    setWithdrawReason('');
  }, [event?.eventId, isOpen]);

  // Escape dismisses the fullscreen viewer (keyboard / larger viewports).
  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightboxOpen]);

  // Withdraw: two taps, no browser dialog, no auto-reset. Tap 1 arms the button
  // and reveals the reason field; tap 2 (with a reason) submits.
  const handleWithdraw = useCallback(async () => {
    if (!event) return;

    if (!isWithdrawConfirming) {
      setIsWithdrawConfirming(true);
      return;
    }

    const reason = withdrawReason.trim();
    if (!reason) return;

    setIsWithdrawing(true);
    try {
      const response = await authFetch(
        `${APP_CONFIG.API_BASE_URL}/admin/events/${event._id}`,
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, _version: event._version }),
        }
      );

      if (response.status === 409) {
        const data = await response.json().catch(() => ({}));
        if (data.details?.code === 'VERSION_CONFLICT') {
          // Deliberately NOT the desktop ConflictDialog. On a phone the honest
          // report is one sentence; the list refetch below shows the new truth.
          showWarning('This request was already handled. Refreshing your requests.');
          setIsWithdrawConfirming(false);
          setWithdrawReason('');
          if (onWithdrawn) onWithdrawn();
          return;
        }
      }

      if (!response.ok) {
        throw new Error(`Failed to withdraw request (${response.status})`);
      }

      showSuccess('Request withdrawn');
      setIsWithdrawConfirming(false);
      setWithdrawReason('');
      if (onWithdrawn) onWithdrawn();
    } catch (err) {
      logger.error('MobileEventDetail: withdraw failed:', err);
      showError(err.message || 'Unable to withdraw this request. Please try again.');
      // Back to idle so the user gets a clean retry rather than a stuck confirm.
      setIsWithdrawConfirming(false);
    } finally {
      setIsWithdrawing(false);
    }
  }, [event, isWithdrawConfirming, withdrawReason, authFetch, showSuccess, showError, showWarning, onWithdrawn]);

  if (!event) return null;

  const status = STATUS_MAP[event.status] || STATUS_MAP.pending;
  const categories = Array.isArray(event.categories) ? event.categories.filter(Boolean) : [];
  const hasTimingDetails = event.setupTime || event.teardownTime || event.doorOpenTime || event.doorCloseTime;
  const descriptionText = event.eventDescription || '';

  // ── Reservation context (Requests tab only) ────────────────────────────
  const currentUserEmail = (accounts?.[0]?.username || '').toLowerCase();
  const isRequester = !!currentUserEmail
    && (event.requesterEmail || '').toLowerCase() === currentUserEmail;
  const rejectionReason = event.status === 'rejected' ? (event.reviewNotes || '') : '';
  const statusHistory = Array.isArray(event.statusHistory) ? event.statusHistory : [];
  // Oldest first — a timeline is read downward in time.
  const timeline = showReservationContext
    ? [...statusHistory].sort((a, b) =>
        new Date(a.changedAt || 0) - new Date(b.changedAt || 0))
    : [];
  // The sheet's only mutating action, and only ever for the viewer's own
  // pending request. Every other status, and everyone else's requests, get
  // no action at all.
  const canWithdraw = showReservationContext && isRequester && event.status === 'pending';

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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
            {/* Rejection reason — first in the body, so it sits above the
                timing details and is the first thing read after the hero. */}
            {showReservationContext && rejectionReason && (
              <div className="mobile-detail-notice red" role="status">
                <span className="mobile-detail-notice-label">Reason for rejection</span>
                <p className="mobile-detail-notice-text">{rejectionReason}</p>
              </div>
            )}

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

            {/* Review timeline — the one piece of this sheet that is genuinely
                better on a phone than on the desktop modal, which buries
                statusHistory. A tall narrow viewport suits a chronology. */}
            {showReservationContext && timeline.length > 0 && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Review History</span>
                <ol className="mobile-detail-timeline">
                  {timeline.map((entry, i) => {
                    const entryStatus = STATUS_MAP[entry.status] || STATUS_MAP.pending;
                    const timestamp = formatHistoryTimestamp(entry.changedAt);
                    const actor = entry.changedByEmail || entry.changedBy || '';
                    return (
                      <li key={`${entry.status}-${entry.changedAt || i}`} className="mobile-detail-timeline-item">
                        <span className={`mobile-detail-timeline-dot ${entryStatus.color}`} />
                        <div className="mobile-detail-timeline-body">
                          <span className="mobile-detail-timeline-status">{entryStatus.label}</span>
                          {timestamp && (
                            <span className="mobile-detail-timeline-meta">{timestamp}</span>
                          )}
                          {actor && (
                            <span className="mobile-detail-timeline-meta">{actor}</span>
                          )}
                          {entry.reason && (
                            <span className="mobile-detail-timeline-reason">{entry.reason}</span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {/* Floor plan (read-only) — last field; only when a plan image exists */}
            {floorPlanUrl && (
              <div className="mobile-detail-field">
                <span className="mobile-detail-label">Floor Plan</span>
                <button
                  type="button"
                  className="mobile-detail-floorplan"
                  aria-label="View floor plan full screen"
                  onClick={() => setLightboxOpen(true)}
                >
                  <img
                    className="mobile-detail-floorplan-img"
                    src={floorPlanUrl}
                    alt={fileName ? `Floor plan: ${fileName}` : 'Floor plan'}
                  />
                  <span className="mobile-detail-floorplan-hint">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15 3h6v6" />
                      <path d="M9 21H3v-6" />
                      <path d="M21 3l-7 7" />
                      <path d="M3 21l7-7" />
                    </svg>
                    Tap to enlarge
                  </span>
                </button>
              </div>
            )}

            {/* Withdraw — the sheet's only mutating control. In-button
                confirmation per the app-wide standard: no window.confirm, no
                auto-reset. The reason is required by the UI (the server would
                otherwise substitute a generic one) so the approver sees why. */}
            {canWithdraw && (
              <div className="mobile-detail-actions">
                {isWithdrawConfirming && (
                  <label className="mobile-detail-reason">
                    <span className="mobile-detail-label">Reason for withdrawing</span>
                    <textarea
                      className="mobile-detail-reason-input"
                      value={withdrawReason}
                      onChange={(e) => setWithdrawReason(e.target.value)}
                      placeholder="Let the approver know why"
                      rows={2}
                      disabled={isWithdrawing}
                      autoFocus
                    />
                  </label>
                )}
                <button
                  type="button"
                  className={`mobile-detail-withdraw${isWithdrawConfirming ? ' confirm' : ''}`}
                  onClick={handleWithdraw}
                  disabled={isWithdrawing || (isWithdrawConfirming && !withdrawReason.trim())}
                >
                  {isWithdrawing
                    ? 'Withdrawing...'
                    : isWithdrawConfirming
                      ? 'Confirm withdrawal?'
                      : 'Withdraw Request'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen floor-plan viewer. Tap the dark area or the close button to
          dismiss; tap the image to toggle zoom (the stage scrolls when zoomed). */}
      {lightboxOpen && floorPlanUrl && (
        <div
          className="mobile-detail-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Floor plan"
          onClick={() => setLightboxOpen(false)}
        >
          <button
            type="button"
            className="mobile-detail-lightbox-close"
            aria-label="Close floor plan"
            onClick={() => setLightboxOpen(false)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div
            className={`mobile-detail-lightbox-stage${zoomed ? ' zoomed' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <img
              className="mobile-detail-lightbox-img"
              src={floorPlanUrl}
              alt={fileName ? `Floor plan: ${fileName}` : 'Floor plan'}
              onClick={() => setZoomed((z) => !z)}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default MobileEventDetail;
