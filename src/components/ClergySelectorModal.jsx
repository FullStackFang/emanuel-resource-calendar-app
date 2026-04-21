// src/components/ClergySelectorModal.jsx
import React, { useState, useEffect, useCallback } from 'react';
import useClergyUsers from '../hooks/useClergyUsers';
import useScrollLock from '../hooks/useScrollLock';
import LoadingSpinner from './shared/LoadingSpinner';
import './ClergySelectorModal.css';

/**
 * ClergySelectorModal - Modal for assigning Rabbi and Cantor to an event.
 *
 * Follows the CategorySelectorModal pattern:
 * - Overlay + centered modal with header/content/footer
 * - Two sections (Rabbi, Cantor) with single-select items
 * - Clear All quick action + selection count
 * - ESC key and overlay click to close
 * - Cancel / Save footer
 *
 * @param {boolean}  isOpen          - Whether the modal is open
 * @param {Function} onClose         - Called when modal is closed/cancelled
 * @param {Function} onSave          - Called with { assignedRabbi, assignedCantor } when saved
 * @param {Object|null} initialRabbi  - Currently assigned rabbi { userId, displayName }
 * @param {Object|null} initialCantor - Currently assigned cantor { userId, displayName }
 * @param {string}   apiToken        - Auth token for fetching clergy users
 */
export default function ClergySelectorModal({
  isOpen,
  onClose,
  onSave,
  initialRabbi = null,
  initialCantor = null,
  apiToken = null,
}) {
  const [selectedRabbi, setSelectedRabbi] = useState(initialRabbi);
  const [selectedCantor, setSelectedCantor] = useState(initialCantor);
  const { rabbis, cantors, loading, error } = useClergyUsers(apiToken);

  // Reset selection when modal opens with new initial values
  useEffect(() => {
    if (isOpen) {
      setSelectedRabbi(initialRabbi);
      setSelectedCantor(initialCantor);
    }
  }, [isOpen, initialRabbi, initialCantor]);

  // Lock body scroll when modal is open
  useScrollLock(isOpen);

  // Handle ESC key to close
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape' && isOpen) {
      onClose();
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  // Handle overlay click to close
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Toggle rabbi selection (click again to deselect)
  const toggleRabbi = (user) => {
    setSelectedRabbi(prev =>
      prev && prev.userId === String(user._id)
        ? null
        : { userId: String(user._id), displayName: user.displayName }
    );
  };

  // Toggle cantor selection (click again to deselect)
  const toggleCantor = (user) => {
    setSelectedCantor(prev =>
      prev && prev.userId === String(user._id)
        ? null
        : { userId: String(user._id), displayName: user.displayName }
    );
  };

  const handleSave = () => {
    onSave({ assignedRabbi: selectedRabbi, assignedCantor: selectedCantor });
    onClose();
  };

  const handleClearAll = () => {
    setSelectedRabbi(null);
    setSelectedCantor(null);
  };

  const selectionCount = (selectedRabbi ? 1 : 0) + (selectedCantor ? 1 : 0);

  if (!isOpen) return null;

  return (
    <div className="category-modal-overlay" onClick={handleOverlayClick}>
      <div className="category-modal clergy-modal">
        {/* Header */}
        <div className="category-modal-header">
          <h3 className="category-modal-title">Clergy Assignments</h3>
          <button
            className="category-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Content */}
        <div className="category-modal-content">
          {loading ? (
            <LoadingSpinner minHeight={150} size={40} />
          ) : error ? (
            <div className="category-error">
              <p>Failed to load clergy users. Please try again.</p>
            </div>
          ) : (rabbis.length === 0 && cantors.length === 0) ? (
            <div className="category-empty">
              No clergy users found. Assign users the Rabbi or Cantor role type in User Management.
            </div>
          ) : (
            <>
              {/* Quick actions */}
              <div className="category-quick-actions">
                <button
                  type="button"
                  className="category-quick-btn"
                  onClick={handleClearAll}
                >
                  Clear All
                </button>
                <span className="category-count">
                  {selectionCount} of 2 assigned
                </span>
              </div>

              {/* Rabbi section */}
              {rabbis.length > 0 && (
                <div className="clergy-section">
                  <h4 className="clergy-section-title">Rabbi</h4>
                  <div className="clergy-grid">
                    {rabbis.map(user => (
                      <div
                        key={String(user._id)}
                        className={`category-item ${selectedRabbi?.userId === String(user._id) ? 'selected' : ''}`}
                        onClick={() => toggleRabbi(user)}
                        style={{ '--category-color': '#7c3aed' }}
                      >
                        <div className="category-checkbox">
                          {selectedRabbi?.userId === String(user._id) && (
                            <span className="category-check">{'\u2713'}</span>
                          )}
                        </div>
                        <div className="category-info">
                          <span className="category-name">{user.displayName}</span>
                          {user.title && (
                            <span className="category-description">{user.title}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cantor section */}
              {cantors.length > 0 && (
                <div className="clergy-section">
                  <h4 className="clergy-section-title">Cantor</h4>
                  <div className="clergy-grid">
                    {cantors.map(user => (
                      <div
                        key={String(user._id)}
                        className={`category-item ${selectedCantor?.userId === String(user._id) ? 'selected' : ''}`}
                        onClick={() => toggleCantor(user)}
                        style={{ '--category-color': '#0891b2' }}
                      >
                        <div className="category-checkbox">
                          {selectedCantor?.userId === String(user._id) && (
                            <span className="category-check">{'\u2713'}</span>
                          )}
                        </div>
                        <div className="category-info">
                          <span className="category-name">{user.displayName}</span>
                          {user.title && (
                            <span className="category-description">{user.title}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="category-modal-footer">
          <button
            type="button"
            className="category-btn category-btn-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="category-btn category-btn-save"
            onClick={handleSave}
            disabled={loading}
          >
            Save {selectionCount > 0 && `(${selectionCount})`}
          </button>
        </div>
      </div>
    </div>
  );
}
