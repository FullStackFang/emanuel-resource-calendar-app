// src/components/shared/DiscardChangesDialog.jsx
import React, { useEffect, useCallback } from 'react';
import useScrollLock from '../../hooks/useScrollLock';
import './DiscardChangesDialog.css';

/**
 * DiscardChangesDialog - Confirmation dialog for discarding unsaved changes
 *
 * Renders as a centered overlay above the parent modal. Used when closing
 * a pending-edit form that has unsaved modifications.
 *
 * @param {boolean} isOpen - Whether the dialog is visible
 * @param {Function} onDiscard - Called when user confirms discard
 * @param {Function} onKeepEditing - Called when user wants to continue editing
 */
export default function DiscardChangesDialog({ isOpen, onDiscard, onKeepEditing }) {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && isOpen) {
      onKeepEditing();
    }
  }, [isOpen, onKeepEditing]);

  // Lock body scroll when dialog is open (ref-counted for nested modals)
  useScrollLock(isOpen);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleKeyDown]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onKeepEditing();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="discard-dialog-overlay" onClick={handleOverlayClick}>
      <div className="discard-dialog" role="alertdialog" aria-labelledby="discard-title" aria-describedby="discard-desc">
        <div className="discard-dialog-icon-row">
          <div className="discard-dialog-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
        </div>
        <h3 className="discard-dialog-title" id="discard-title">Discard unsaved changes?</h3>
        <p className="discard-dialog-message" id="discard-desc">
          Your edits haven't been saved. This action cannot be undone.
        </p>
        <div className="discard-dialog-actions">
          <button
            type="button"
            className="discard-dialog-btn discard-dialog-btn-secondary"
            onClick={onKeepEditing}
          >
            Keep Editing
          </button>
          <button
            type="button"
            className="discard-dialog-btn discard-dialog-btn-danger"
            onClick={onDiscard}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
