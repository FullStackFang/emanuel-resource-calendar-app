// src/components/shared/MarkerWarningDialog.jsx
//
// Blocking confirmation shown at SUBMIT time when the selected booking date is
// covered by a warnOnReservation marker (holiday / office closure). Unlike the
// inline ReservationMarkerAdvisory (a passive banner near the date field), this
// interrupts submission and requires an explicit "Submit Anyway" before the
// request is sent. Cancel returns the user to the form without submitting.

import React, { useEffect, useCallback } from 'react';
import useScrollLock from '../../hooks/useScrollLock';
import './MarkerWarningDialog.css';

const TYPE_LABELS = { holiday: 'Holiday', officeClosed: 'Office Closed' };

// Format a date-only YYYY-MM-DD string as e.g. "Dec 25, 2026" without any
// timezone shift (parse as local midnight, not UTC).
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * @param {boolean} isOpen
 * @param {Array}   markers - warnOnReservation markers covering the selected date
 * @param {string}  date - selected booking date (YYYY-MM-DD)
 * @param {Function} onConfirm - "Submit Anyway" — proceed with submission
 * @param {Function} onCancel - return to the form without submitting
 * @param {boolean} submitting - disables buttons while the submission is in flight
 */
export default function MarkerWarningDialog({
  isOpen,
  markers = [],
  date,
  onConfirm,
  onCancel,
  submitting = false,
}) {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && isOpen && !submitting) onCancel();
  }, [isOpen, onCancel, submitting]);

  useScrollLock(isOpen);

  useEffect(() => {
    if (isOpen) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !submitting) onCancel();
  };

  if (!isOpen) return null;

  return (
    <div className="marker-warning-overlay" onClick={handleOverlayClick}>
      <div className="marker-warning-dialog" role="alertdialog" aria-modal="true" aria-labelledby="marker-warning-title">
        <div className="marker-warning-header">
          <h3 className="marker-warning-title" id="marker-warning-title">⚠ Heads up</h3>
          <button
            className="marker-warning-close"
            onClick={onCancel}
            aria-label="Close"
            disabled={submitting}
          >
            &times;
          </button>
        </div>

        <div className="marker-warning-content">
          <p className="marker-warning-message">The selected date is marked:</p>
          <ul className="marker-warning-list">
            {markers.map((m) => (
              <li key={m._id} className={`marker-warning-item mw--${m.type}`}>
                <strong>{TYPE_LABELS[m.type] || m.type}: {m.name}</strong>
                {' '}falls on {formatDate(date)}.
              </li>
            ))}
          </ul>
          <p className="marker-warning-hint">
            You can still submit this request. Do you want to continue?
          </p>
        </div>

        <div className="marker-warning-footer">
          <button
            className="marker-warning-btn marker-warning-btn-cancel"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="marker-warning-btn marker-warning-btn-confirm"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? 'Submitting...' : 'Submit Anyway'}
          </button>
        </div>
      </div>
    </div>
  );
}
