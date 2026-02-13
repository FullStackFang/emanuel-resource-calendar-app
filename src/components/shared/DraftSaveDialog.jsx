// src/components/shared/DraftSaveDialog.jsx
import React, { useEffect, useCallback } from 'react';
import useScrollLock from '../../hooks/useScrollLock';
import './DraftSaveDialog.css';

/**
 * DraftSaveDialog - Modal dialog shown when closing form with unsaved changes
 *
 * Allows user to:
 * - Save changes as a draft
 * - Discard changes and close
 * - Continue editing
 *
 * @param {boolean} isOpen - Whether the dialog is open
 * @param {Function} onSaveDraft - Called when user wants to save as draft
 * @param {Function} onDiscard - Called when user wants to discard changes
 * @param {Function} onCancel - Called when user wants to continue editing
 * @param {boolean} canSaveDraft - Whether draft can be saved (needs eventTitle)
 * @param {boolean} saving - Whether draft is being saved
 */
export default function DraftSaveDialog({
  isOpen,
  onSaveDraft,
  onDiscard,
  onCancel,
  canSaveDraft = true,
  saving = false
}) {
  // Handle ESC key to continue editing (cancel)
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && isOpen && !saving) {
      onCancel();
    }
  }, [isOpen, onCancel, saving]);

  // Lock body scroll when modal is open (runs before paint to prevent jitter)
  useScrollLock(isOpen);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Handle overlay click to continue editing
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !saving) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="draft-save-overlay" onClick={handleOverlayClick}>
      <div className="draft-save-dialog">
        {/* Header */}
        <div className="draft-save-header">
          <h3 className="draft-save-title">Save as Draft?</h3>
          <button
            className="draft-save-close"
            onClick={onCancel}
            aria-label="Close"
            disabled={saving}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="draft-save-content">
          <div className="draft-save-icon">📝</div>
          <p className="draft-save-message">
            You have unsaved changes. Would you like to save them as a draft?
          </p>
          <p className="draft-save-hint">
            Drafts are automatically deleted after 30 days.
          </p>
        </div>

        {/* Footer */}
        <div className="draft-save-footer">
          <button
            className="draft-save-btn draft-save-btn-discard"
            onClick={onDiscard}
            disabled={saving}
          >
            Discard Changes
          </button>
          <button
            className="draft-save-btn draft-save-btn-cancel"
            onClick={onCancel}
            disabled={saving}
          >
            Continue Editing
          </button>
          <button
            className="draft-save-btn draft-save-btn-save"
            onClick={onSaveDraft}
            disabled={!canSaveDraft || saving}
            title={!canSaveDraft ? 'Event title is required to save as draft' : ''}
          >
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
