// src/components/shared/ReviewModal.jsx
import React, { useEffect, useCallback } from 'react';
import './ReviewModal.css';

/**
 * ReviewModal - Reusable modal wrapper for reviewing/editing events and reservations
 *
 * Provides a full-screen modal with:
 * - Sticky action bar at top with approve/reject/save/cancel buttons
 * - Scrollable content area
 * - ESC key and overlay click to close
 * - Feature toggle between legacy and unified forms
 */
export default function ReviewModal({
  isOpen,
  title = 'Review Request',
  onClose,
  onApprove,
  onReject,
  onSave,
  children,
  // State flags
  isPending = true,
  hasChanges = false,
  isSaving = false,
  // Feature flags
  useUnifiedForm = false,
  onToggleForm = null,
  // Additional actions
  showFormToggle = false,
  showActionButtons = true,
  // Styling
  modalClassName = 'review-modal',
  overlayClassName = 'review-modal-overlay'
}) {
  // Close on ESC key
  const handleEscKey = useCallback((e) => {
    if (e.key === 'Escape' && isOpen) {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleEscKey);
      // Prevent body scroll when modal is open
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, handleEscKey]);

  // Close on overlay click
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  // Only apply inline styles for the default review-modal, not for custom modals
  const inlineStyles = modalClassName === 'review-modal'
    ? { maxWidth: '100vw', display: 'flex', flexDirection: 'column', maxHeight: '100vh' }
    : { display: 'flex', flexDirection: 'column' };

  return (
    <div className={overlayClassName} onClick={handleOverlayClick}>
      <div className={modalClassName} style={inlineStyles}>
        {/* Sticky Action Bar */}
        <div className="review-action-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
              {title}
            </h2>

            {/* Feature Flag Toggle */}
            {showFormToggle && onToggleForm && (
              <button
                type="button"
                onClick={onToggleForm}
                style={{
                  padding: '6px 12px',
                  fontSize: '0.75rem',
                  borderRadius: '4px',
                  border: '1px solid #d1d5db',
                  background: useUnifiedForm ? '#0078d4' : '#f3f4f6',
                  color: useUnifiedForm ? 'white' : '#374151',
                  cursor: 'pointer',
                  fontWeight: '500',
                  transition: 'all 0.2s'
                }}
                title={useUnifiedForm ? 'Switch to Legacy Form' : 'Switch to New Unified Form'}
              >
                {useUnifiedForm ? '✨ New Form' : '📋 Legacy Form'}
              </button>
            )}
          </div>

          {/* Action Buttons */}
          {showActionButtons && (
            <div className="review-actions">
              {isPending && onApprove && (
                <button
                  type="button"
                  className="action-btn approve-btn"
                  onClick={onApprove}
                >
                  ✓ Approve
                </button>
              )}

              {isPending && onReject && (
                <button
                  type="button"
                  className="action-btn reject-btn"
                  onClick={onReject}
                >
                  ✗ Reject
                </button>
              )}

              {isPending && onSave && (
                <button
                  type="button"
                  className="action-btn save-btn"
                  onClick={onSave}
                  disabled={!hasChanges || isSaving}
                  title={!hasChanges ? 'No changes to save' : ''}
                >
                  {isSaving ? 'Saving...' : '💾 Save'}
                </button>
              )}

              <button
                type="button"
                className="action-btn cancel-btn"
                onClick={onClose}
              >
                {isPending ? 'Cancel' : 'Close'}
              </button>
            </div>
          )}
        </div>

        {/* Scrollable Content Area */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
