// src/components/shared/DuplicateDateDialog.jsx
//
// Focused dialog for duplicating an event to multiple dates.
// Opens on top of the ReviewModal when user clicks "Duplicate".
// Each selected date creates an independent reservation.
import { useState, useEffect, useCallback } from 'react';
import useScrollLock from '../../hooks/useScrollLock';
import MultiDatePicker from '../MultiDatePicker';
import './DuplicateDateDialog.css';

export default function DuplicateDateDialog({
  isOpen,
  onClose,
  onSubmit,
  eventTitle = '',
  sourceEventDate = '',
  submitting = false,
}) {
  const [selectedDates, setSelectedDates] = useState([]);
  const [confirming, setConfirming] = useState(false);

  useScrollLock(isOpen);

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (isOpen) {
      setSelectedDates([]);
      setConfirming(false);
    }
  }, [isOpen]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const handleDatesChange = useCallback((dates) => {
    const filtered = sourceEventDate
      ? dates.filter(d => d !== sourceEventDate)
      : dates;
    setSelectedDates(filtered);
    setConfirming(false);
  }, [sourceEventDate]);

  const handleSubmit = useCallback(() => {
    if (selectedDates.length === 0) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onSubmit(selectedDates);
  }, [selectedDates, confirming, onSubmit]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !submitting) onClose();
  };

  if (!isOpen) return null;

  const dateCount = selectedDates.length;

  return (
    <div className="duplicate-date-dialog-overlay" onClick={handleOverlayClick}>
      <div
        className="duplicate-date-dialog"
        role="dialog"
        aria-labelledby="dup-dialog-title"
        aria-describedby="dup-dialog-desc"
      >
        <div className="dup-dialog-header">
          <div className="dup-dialog-header-text">
            <h3 className="dup-dialog-title" id="dup-dialog-title">Duplicate Event</h3>
            <p className="dup-dialog-event-name">{eventTitle}</p>
          </div>
          <button
            type="button"
            className="dup-dialog-close"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="dup-dialog-desc" id="dup-dialog-desc">
          Select dates to create copies of this event. Each date becomes a separate reservation.
        </p>

        <div className="dup-dialog-picker">
          <MultiDatePicker
            selectedDates={selectedDates}
            onDatesChange={handleDatesChange}
            disabled={submitting}
          />
        </div>

        {sourceEventDate && (
          <p className="dup-dialog-source-note">
            Original date ({new Date(sourceEventDate + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric'
            })}) is excluded.
          </p>
        )}

        <div className="dup-dialog-actions">
          <button
            type="button"
            className="dup-dialog-btn dup-dialog-btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`dup-dialog-btn dup-dialog-btn-primary ${confirming ? 'dup-confirming' : ''}`}
            onClick={handleSubmit}
            disabled={submitting || dateCount === 0}
          >
            {submitting
              ? 'Creating...'
              : confirming
                ? `Confirm Create ${dateCount}?`
                : dateCount === 0
                  ? 'Select dates'
                  : `Create ${dateCount} Reservation${dateCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
