/**
 * ErrorBoundary Component
 * Catches React component errors and provides a fallback UI
 * Uses Sentry for automatic error capture
 */

import React, { Component } from 'react';
import * as Sentry from '@sentry/react';
import { normalizeError } from '../../services/errorReportingService';
import { logger } from '../../utils/logger';
import './ErrorBoundary.css';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      eventId: null, // Sentry event ID instead of correlationId
      reportSent: false
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so next render shows fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.error('ErrorBoundary caught an error:', error);
    logger.error('Component stack:', errorInfo.componentStack);

    this.setState({ errorInfo });

    // Capture error with Sentry (Sentry auto-captures, but we add component context)
    const eventId = Sentry.captureException(error, {
      extra: {
        componentStack: errorInfo.componentStack
      },
      tags: {
        errorType: 'react_error',
        boundary: 'ErrorBoundary'
      }
    });

    this.setState({ eventId, reportSent: true });

    // Trigger error modal callback if provided
    const { onError } = this.props;
    if (onError) {
      const errorData = normalizeError(error, {
        componentStack: errorInfo?.componentStack,
        errorType: 'react_error',
        severity: 'critical'
      });
      onError({
        ...errorData,
        eventId
      });
    }
  }

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      eventId: null,
      reportSent: false
    });
  };

  handleReportIssue = () => {
    const { onShowReportModal } = this.props;
    if (onShowReportModal) {
      onShowReportModal({
        error: this.state.error,
        componentStack: this.state.errorInfo?.componentStack,
        eventId: this.state.eventId
      });
    }
  };

  render() {
    const { hasError, error, errorInfo, eventId, reportSent } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      // Custom fallback if provided
      if (fallback) {
        return fallback({
          error,
          errorInfo,
          eventId,
          onRetry: this.handleRetry,
          onReportIssue: this.handleReportIssue
        });
      }

      // Default fallback UI
      return (
        <div className="error-boundary-container">
          <div className="error-boundary-content">
            <div className="error-boundary-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <h2>Something went wrong</h2>

            <p className="error-boundary-message">
              We encountered an unexpected error while displaying this page.
              {reportSent && ' The error has been automatically reported to our team.'}
            </p>

            {eventId && (
              <p className="error-boundary-correlation">
                Reference: <code>{eventId}</code>
              </p>
            )}

            <div className="error-boundary-actions">
              <button
                className="error-boundary-btn primary"
                onClick={this.handleRetry}
              >
                Try Again
              </button>

              <button
                className="error-boundary-btn secondary"
                onClick={() => window.location.reload()}
              >
                Refresh Page
              </button>

              <button
                className="error-boundary-btn tertiary"
                onClick={this.handleReportIssue}
              >
                Report Issue
              </button>
            </div>

            {/* Show error details in development */}
            {import.meta.env.DEV && error && (
              <details className="error-boundary-details">
                <summary>Error Details (Development Only)</summary>
                <pre className="error-boundary-stack">
                  {error.toString()}
                  {errorInfo?.componentStack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return children;
  }
}

export default ErrorBoundary;
