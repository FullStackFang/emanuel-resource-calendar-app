import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { msalConfig } from './config/authConfig';
import './index.css'; // optional

const msalInstance = new PublicClientApplication(msalConfig);

ReactDOM.createRoot(document.getElementById('root')).render(
  // Uncomment Strictmode for Production
  //<React.StrictMode>
    <MsalProvider instance={msalInstance}>
      <App />
    </MsalProvider>
  //</React.StrictMode>
);
