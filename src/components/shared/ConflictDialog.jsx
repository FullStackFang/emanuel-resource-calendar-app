// src/components/shared/ConflictDialog.jsx
import React, { useEffect, useCallback } from 'react';
import { computeConflictDiff } from '../../utils/conflictDiffUtils';
import './ConflictDialog.css';

/**
 * ConflictDialog - Modal dialog shown when a 409 version conflict occurs
 *
 * Three modes based on conflictType:
 * - "status_changed": Event status was changed by another user (approved/rejected)
 * - "data_changed": Event data was modified by another user
 * - "already_actioned": Event was already approved/rejected
 *
 * @param {boolean} isOpen - Whether the dialog is open
 * @param {Function} onClose - Called when dialog is closed
 * @param {Function} onRefresh - Called when user clicks "Reload & Re-edit"
 * @param {string} conflictType - One of: 'status_changed', 'data_changed', 'already_actioned'
 * @param {string} eventTitle - The event title to display
 * @param {Object} details - Conflict details from the 409 response
 * @param {number} details.currentVersion - Current document version
 * @param {string} details.currentStatus - Current document status
 * @param {string} details.lastModifiedBy - Who last modified the document
 * @param {string} details.lastModifiedDateTime - When it was last modified
 * @param {Object} details.snapshot - Current field values for diff display
 * @param {Object} staleData - The user's form data at the time of the failed save (for diff)
 */
export default function ConflictDialog({
  isOpen,
  onClose,
  onRefresh,
  conflictType = 'data_changed',
  eventTitle = 'Event',
  details = {},
  staleData = null
}) {
  // Handle ESC key to close
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && isOpen) {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleKeyDown]);

  // Handle overlay click to close
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const { currentStatus, lastModifiedBy, lastModifiedDateTime, snapshot } = details;

  // Compute field-level diff between user's stale data and server snapshot
  const changedFields = staleData && snapshot ? computeConflictDiff(staleData, snapshot) : [];

  // Format the modification time
  const formattedTime = lastModifiedDateTime
    ? new Date(lastModifiedDateTime).toLocaleString()
    : 'recently';

  // Format the modifier name
  const modifierName = lastModifiedBy || 'another user';

  // Status display name
  const statusDisplay = currentStatus
    ? currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)
    : '';

  // Determine heading, message, and icon based on conflict type
  let heading, message, iconClass;

  switch (conflictType) {
    case 'status_changed':
      heading = `Event Has Been ${statusDisplay}`;
      message = `This event was ${currentStatus} by ${modifierName} at ${formattedTime}. Your changes were not saved.`;
      iconClass = 'conflict-icon-status';
      break;
    case 'already_actioned':
      heading = `Already ${statusDisplay}`;
      message = `${modifierName} already ${currentStatus} this event at ${formattedTime}.`;
      iconClass = 'conflict-icon-actioned';
      break;
    case 'data_changed':
    default:
      heading = 'Conflict Detected';
      message = `This event was modified by ${modifierName} at ${formattedTime}. Your changes could not be saved because they were based on an older version.`;
      iconClass = 'conflict-icon-data';
      break;
  }

  return (
    <div className="conflict-dialog-overlay" onClick={handleOverlayClick}>
      <div className="conflict-dialog">
        {/* Header */}
        <div className={`conflict-dialog-header ${iconClass}`}>
          <div className="conflict-dialog-icon">
            {conflictType === 'data_changed' ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            )}
          </div>
          <h3 className="conflict-dialog-title">{heading}</h3>
          <button
            className="conflict-dialog-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="conflict-dialog-content">
          <p className="conflict-dialog-event-title">{eventTitle}</p>
          <p className="conflict-dialog-message">{message}</p>

          {changedFields.length > 0 && (
            <div className="conflict-dialog-changes">
              <div className="conflict-dialog-changes-heading">What changed</div>
              <ul className="conflict-dialog-changes-list">
                {changedFields.map(({ field, label, staleValue, currentValue }) => (
                  <li key={field} className="conflict-dialog-change-item">
                    <span className="conflict-dialog-change-label">{label}:</span>
                    <span className="conflict-dialog-change-values">
                      <span className="conflict-dialog-change-old">{staleValue}</span>
                      <span className="conflict-dialog-change-arrow">&rarr;</span>
                      <span className="conflict-dialog-change-new">{currentValue}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {currentStatus && (
            <div className="conflict-dialog-status">
              <span className="conflict-dialog-status-label">Current status:</span>
              <span className={`conflict-dialog-status-badge status-${currentStatus}`}>
                {statusDisplay}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="conflict-dialog-footer">
          <button
            className="conflict-dialog-btn conflict-dialog-btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
          {conflictType === 'data_changed' && onRefresh && (
            <button
              className="conflict-dialog-btn conflict-dialog-btn-primary"
              onClick={onRefresh}
            >
              Reload & Re-edit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
