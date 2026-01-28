import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './config/authConfig';
import ErrorBoundary from './components/shared/ErrorBoundary';
import { NotificationProvider, useNotification } from './context/NotificationContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import ToastNotification from './components/shared/ToastNotification';
import ErrorReportModal from './components/shared/ErrorReportModal';
import { initializeGlobalErrorHandlers } from './utils/globalErrorHandlers';
import './index.css'; // optional

// Initialize Sentry FIRST (before any error handlers)
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development',
    release: import.meta.env.VITE_SENTRY_RELEASE || '1.0.0',
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false
      }),
    ],
    // Performance monitoring
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0, // 10% in prod, 100% in dev
    // Session replay
    replaysSessionSampleRate: 0.1, // 10% of sessions
    replaysOnErrorSampleRate: 1.0, // 100% when error occurs
    // Don't send errors in development unless DSN is explicitly set
    enabled: import.meta.env.PROD || !!import.meta.env.VITE_SENTRY_DSN,
  });
}

/**
 * CriticalErrorHandler - Manages ErrorReportModal for critical errors
 * Registers callback with NotificationContext to receive critical errors
 */
function CriticalErrorHandler() {
  const { setCriticalErrorCallback } = useNotification();
  const { apiToken } = useAuth();
  const [criticalError, setCriticalError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    // Register callback to receive critical errors
    setCriticalErrorCallback((errorInfo) => {
      setCriticalError(errorInfo);
      setIsModalOpen(true);
    });

    // Cleanup on unmount
    return () => {
      setCriticalErrorCallback(null);
    };
  }, [setCriticalErrorCallback]);

  const handleClose = () => {
    setIsModalOpen(false);
    setCriticalError(null);
  };

  return (
    <ErrorReportModal
      isOpen={isModalOpen}
      onClose={handleClose}
      error={criticalError}
      apiToken={apiToken}
    />
  );
}

const msalInstance = new PublicClientApplication(msalConfig);

// Initialize global error handlers early
// Uses window.__showErrorModal callback set by App.jsx
initializeGlobalErrorHandlers({
  onError: (errorInfo) => {
    // Trigger the global error modal setter if available
    if (window.__showErrorModal) {
      window.__showErrorModal(errorInfo);
    }
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  // Uncomment Strictmode for Production
  //<React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <NotificationProvider>
          <MsalProvider instance={msalInstance}>
            <App />
          </MsalProvider>
          <ToastNotification />
          <CriticalErrorHandler />
        </NotificationProvider>
      </AuthProvider>
    </ErrorBoundary>
  //</React.StrictMode>
);
