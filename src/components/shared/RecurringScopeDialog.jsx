// src/components/shared/RecurringScopeDialog.jsx
import React, { useState, useEffect, useCallback } from 'react';
import './RecurringScopeDialog.css';

/**
 * RecurringScopeDialog - Modal dialog for selecting edit scope on recurring events
 *
 * Shows before opening the edit modal, allowing user to choose:
 * - "This event only" - Edit just this occurrence
 * - "All events in the series" - Edit the entire recurring series
 *
 * @param {boolean} isOpen - Whether the dialog is open
 * @param {Function} onClose - Called when dialog is closed/cancelled
 * @param {Function} onSelectScope - Called with scope ('thisEvent' | 'allEvents')
 * @param {string} eventSubject - The event title to display
 * @param {string} eventDate - The occurrence date to display
 */
export default function RecurringScopeDialog({
  isOpen,
  onClose,
  onSelectScope,
  eventSubject = 'Recurring Event',
  eventDate = ''
}) {
  const [selectedScope, setSelectedScope] = useState('thisEvent');

  // Reset selection when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedScope('thisEvent');
    }
  }, [isOpen]);

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

  // Handle continue button
  const handleContinue = () => {
    onSelectScope(selectedScope);
  };

  if (!isOpen) return null;

  return (
    <div className="recurring-scope-overlay" onClick={handleOverlayClick}>
      <div className="recurring-scope-dialog">
        {/* Header */}
        <div className="recurring-scope-header">
          <h3 className="recurring-scope-title">{eventSubject}</h3>
          <button
            className="recurring-scope-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="recurring-scope-content">
          {eventDate && (
            <p className="recurring-scope-date">{eventDate}</p>
          )}
          <p className="recurring-scope-prompt">
            This event is part of a series. What would you like to edit?
          </p>

          {/* Options */}
          <div className="recurring-scope-options">
            <label
              className={`recurring-scope-option ${selectedScope === 'thisEvent' ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="editScope"
                value="thisEvent"
                checked={selectedScope === 'thisEvent'}
                onChange={() => setSelectedScope('thisEvent')}
              />
              <div className="recurring-scope-option-content">
                <span className="recurring-scope-option-title">This event only</span>
                <span className="recurring-scope-option-desc">
                  Edit just this occurrence
                </span>
              </div>
            </label>

            <label
              className={`recurring-scope-option ${selectedScope === 'allEvents' ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name="editScope"
                value="allEvents"
                checked={selectedScope === 'allEvents'}
                onChange={() => setSelectedScope('allEvents')}
              />
              <div className="recurring-scope-option-content">
                <span className="recurring-scope-option-title">All events in the series</span>
                <span className="recurring-scope-option-desc">
                  Edit the entire recurring event including recurrence pattern
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="recurring-scope-footer">
          <button
            className="recurring-scope-btn recurring-scope-btn-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="recurring-scope-btn recurring-scope-btn-continue"
            onClick={handleContinue}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
