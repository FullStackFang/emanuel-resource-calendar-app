// src/components/shared/ReviewModal.jsx
import React, { useEffect, useCallback, useState } from 'react';
import './ReviewModal.css';

/**
 * ReviewModal - Reusable modal wrapper for reviewing/editing events and reservations
 *
 * Provides a full-screen modal with:
 * - Sticky action bar at top with approve/reject/save/cancel buttons
 * - Tabbed interface for organizing content
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
  // Tab configuration
  showTabs = true,
  attachmentCount = 0,
  historyCount = 0,
  // Styling
  modalClassName = 'review-modal',
  overlayClassName = 'review-modal-overlay',
  // Button text customization
  saveButtonText = null
}) {
  // Tab state
  const [activeTab, setActiveTab] = useState('details');
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
                  {isSaving ? 'Saving...' : (saveButtonText || '💾 Save')}
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

        {/* Tab Navigation */}
        {showTabs && (
          <div className="event-type-tabs">
            <div
              className={`event-type-tab ${activeTab === 'details' ? 'active' : ''}`}
              onClick={() => setActiveTab('details')}
            >
              Event Details
            </div>
            <div
              className={`event-type-tab ${activeTab === 'additional' ? 'active' : ''}`}
              onClick={() => setActiveTab('additional')}
            >
              Additional Info
            </div>
            <div
              className={`event-type-tab ${activeTab === 'attachments' ? 'active' : ''}`}
              onClick={() => setActiveTab('attachments')}
            >
              {attachmentCount > 0 ? `Attachments (${attachmentCount})` : 'Attachments'}
            </div>
            <div
              className={`event-type-tab ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => setActiveTab('history')}
            >
              {historyCount > 0 ? `History (${historyCount})` : 'History'}
            </div>
          </div>
        )}

        {/* Content Area */}
        <div style={{ flex: 1 }}>
          {React.isValidElement(children)
            ? React.cloneElement(children, { activeTab })
            : children}
        </div>
      </div>
    </div>
  );
}
