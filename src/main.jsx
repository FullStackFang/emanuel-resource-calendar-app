import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './config/authConfig';
import ErrorBoundary from './components/shared/ErrorBoundary';
import { initializeGlobalErrorHandlers } from './utils/globalErrorHandlers';
import './index.css'; // optional

const msalInstance = new PublicClientApplication(msalConfig);

// Initialize global error handlers early
// Token getter will be set from App.jsx when available
initializeGlobalErrorHandlers({
  getApiToken: () => window.__apiToken || null,
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
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </ErrorBoundary>
  //</React.StrictMode>
);
