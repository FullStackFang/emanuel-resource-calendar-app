// src/components/shared/RecurrenceWarningDialog.jsx
import React, { useEffect, useCallback } from 'react';
import useScrollLock from '../../hooks/useScrollLock';
import './RecurrenceWarningDialog.css';

/**
 * RecurrenceWarningDialog - Shown when saving a draft with uncommitted recurrence edits.
 *
 * The user has edited recurrence fields but hasn't clicked "Create Recurrence".
 * Options:
 * - Create & Save: create the recurrence pattern, then save the draft
 * - Save Without Recurrence: save without creating the pattern
 * - Keep Editing: dismiss and return to the form
 */
export default function RecurrenceWarningDialog({
  isOpen,
  onCreateAndSave,
  onSaveWithout,
  onCancel,
  saving = false
}) {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && isOpen && !saving) {
      onCancel();
    }
  }, [isOpen, onCancel, saving]);

  useScrollLock(isOpen);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !saving) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="recurrence-warning-overlay" onClick={handleOverlayClick}>
      <div className="recurrence-warning-dialog">
        <div className="recurrence-warning-header">
          <h3 className="recurrence-warning-title">Save recurrence changes?</h3>
          <button
            className="recurrence-warning-close"
            onClick={onCancel}
            aria-label="Close"
            disabled={saving}
          >
            &times;
          </button>
        </div>

        <div className="recurrence-warning-content">
          <div className="recurrence-warning-icon">&#8635;</div>
          <p className="recurrence-warning-message">
            You've edited the recurrence settings but haven't created the pattern yet.
            Would you like to include these recurrence settings in your draft?
          </p>
        </div>

        <div className="recurrence-warning-footer">
          <button
            className="recurrence-warning-btn recurrence-warning-btn-cancel"
            onClick={onCancel}
            disabled={saving}
          >
            Keep Editing
          </button>
          <button
            className="recurrence-warning-btn recurrence-warning-btn-without"
            onClick={onSaveWithout}
            disabled={saving}
          >
            Save Without Recurrence
          </button>
          <button
            className="recurrence-warning-btn recurrence-warning-btn-create"
            onClick={onCreateAndSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Create & Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
