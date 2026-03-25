import { useRef, useEffect, useCallback } from 'react';
import './ReasonPanel.css';

/**
 * Slide-down panel for actions that require a typed reason (reject, withdraw, etc.).
 * Replaces the old inline-reason-input pattern which was too cramped and had a
 * 3-second auto-reset timer that destroyed typed text.
 *
 * Renders between the action bar and the tab/body area — completely outside the
 * button flex container, so it causes zero layout jitter in the action bar.
 */
export default function ReasonPanel({
  isOpen,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  isSubmitting,
  placeholder = 'Reason (required)',
  confirmLabel = 'Confirm',
  submittingLabel,
  variant = 'error',
}) {
  const textareaRef = useRef(null);

  // Focus textarea when panel opens — requestAnimationFrame waits for CSS transition to start
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    }
  }, [isOpen]);

  // ESC inside textarea cancels the panel without closing the parent modal
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  }, [onCancel]);

  const bgClass = variant === 'error' ? 'reason-panel-error' : 'reason-panel-warning';
  const btnClass = variant === 'error' ? 'reject-btn' : 'delete-btn';
  const resolvedSubmittingLabel = submittingLabel || `${confirmLabel}ing...`;

  return (
    <div className={`reason-panel ${bgClass} ${isOpen ? 'open' : ''}`}>
      <div className="reason-panel-inner">
        <textarea
          ref={textareaRef}
          className={`reason-panel-textarea ${bgClass}`}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isSubmitting}
          rows={2}
        />
        <div className="reason-panel-actions">
          <button
            type="button"
            className="action-btn cancel-btn reason-panel-cancel"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`action-btn ${btnClass} reason-panel-confirm`}
            onClick={onConfirm}
            disabled={isSubmitting || !reason?.trim()}
          >
            {isSubmitting ? resolvedSubmittingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
