/**
 * ErrorReportModal Component
 * Auto-popup modal for error reporting with optional user context
 */

import React, { useState, useEffect } from 'react';
import { submitUserReport } from '../../services/errorReportingService';
import { logger } from '../../utils/logger';
import './ErrorReportModal.css';

// Error category options
const ERROR_CATEGORIES = [
  { value: 'general', label: 'General Issue' },
  { value: 'calendar', label: 'Calendar / Events' },
  { value: 'reservation', label: 'Room Reservations' },
  { value: 'login', label: 'Login / Authentication' },
  { value: 'display', label: 'Display / UI Issue' },
  { value: 'performance', label: 'Slow / Unresponsive' },
  { value: 'data', label: 'Missing / Wrong Data' },
  { value: 'other', label: 'Other' }
];

function ErrorReportModal({
  isOpen,
  onClose,
  error = null,
  apiToken = null
}) {
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);

  // Auto-detect category based on URL
  useEffect(() => {
    if (isOpen) {
      const path = window.location.pathname;
      if (path.includes('reservation') || path.includes('booking')) {
        setCategory('reservation');
      } else if (path.includes('admin')) {
        setCategory('general');
      } else if (path === '/' || path.includes('calendar')) {
        setCategory('calendar');
      }
    }
  }, [isOpen]);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setDescription('');
      setSubmitResult(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!apiToken) {
      setSubmitResult({ success: false, error: 'Please sign in to submit a report' });
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      const result = await submitUserReport({
        description: description.trim() || 'User reported an issue (no description provided)',
        category
      }, apiToken);

      if (result.success) {
        setSubmitResult({
          success: true,
          correlationId: result.correlationId,
          message: 'Thank you! Your report has been submitted.'
        });

        // Auto-close after success
        setTimeout(() => {
          onClose();
        }, 3000);
      } else {
        setSubmitResult({
          success: false,
          error: result.error || 'Failed to submit report'
        });
      }
    } catch (submitError) {
      logger.error('Error submitting report:', submitError);
      setSubmitResult({
        success: false,
        error: 'An unexpected error occurred'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismiss = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="error-report-modal-overlay" onClick={handleDismiss}>
      <div className="error-report-modal" onClick={e => e.stopPropagation()}>
        <button className="error-report-modal-close" onClick={handleDismiss}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="error-report-modal-header">
          <div className="error-report-modal-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h2>Something went wrong</h2>
          <p>Would you like to help us fix this issue?</p>
        </div>

        {submitResult?.success ? (
          <div className="error-report-modal-success">
            <div className="error-report-success-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <p>{submitResult.message}</p>
            {submitResult.correlationId && (
              <p className="error-report-correlation">
                Reference: <code>{submitResult.correlationId}</code>
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="error-report-modal-body">
              {error?.correlationId && (
                <div className="error-report-auto-reported">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  Error automatically reported (Ref: {error.correlationId})
                </div>
              )}

              <div className="error-report-form-group">
                <label htmlFor="error-category">What were you trying to do?</label>
                <select
                  id="error-category"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  disabled={isSubmitting}
                >
                  {ERROR_CATEGORIES.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="error-report-form-group">
                <label htmlFor="error-description">
                  Additional details (optional)
                </label>
                <textarea
                  id="error-description"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Describe what you were doing when the error occurred..."
                  rows={4}
                  disabled={isSubmitting}
                  maxLength={2000}
                />
                <span className="error-report-char-count">
                  {description.length}/2000
                </span>
              </div>

              {submitResult?.error && (
                <div className="error-report-error">
                  {submitResult.error}
                </div>
              )}

              {!apiToken && (
                <div className="error-report-warning">
                  Please sign in to submit an issue report.
                </div>
              )}
            </div>

            <div className="error-report-modal-footer">
              <button
                type="button"
                className="error-report-btn secondary"
                onClick={handleDismiss}
                disabled={isSubmitting}
              >
                Dismiss
              </button>
              <button
                type="submit"
                className="error-report-btn primary"
                disabled={isSubmitting || !apiToken}
              >
                {isSubmitting ? 'Sending...' : 'Send Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ErrorReportModal;
