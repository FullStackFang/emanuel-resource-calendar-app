import React from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../../config/authConfig';
import './MobileLayout.css';

function MobileLayout() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = accounts.length > 0;
  const account = accounts[0];

  const handleSignIn = async () => {
    try {
      await instance.loginRedirect(loginRequest);
    } catch (error) {
      console.error('Mobile login failed:', error);
    }
  };

  const handleSignOut = async () => {
    try {
      await instance.logoutRedirect();
    } catch (error) {
      console.error('Mobile logout failed:', error);
    }
  };

  // Extract display name and initials from account
  const displayName = account?.name || account?.username?.split('@')[0] || '';
  const initials = displayName
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('');

  return (
    <div className="mobile-layout">
      {/* Hero — branded header zone */}
      <div className="mobile-hero">
        <div className="mobile-hero-bg" />
        <div className="mobile-hero-content">
          <div className="mobile-hero-logo-ring">
            <img
              src="/emanuel_logo.png?v=4"
              alt="Temple Emanu-El"
              className="mobile-hero-logo"
            />
          </div>
          <h1 className="mobile-hero-title">Temple Events</h1>
          <span className="mobile-hero-subtitle">SCHEDULER</span>
        </div>
      </div>

      {/* Body */}
      <div className="mobile-body">
        {isAuthenticated ? (
          <>
            {/* User card */}
            <div className="mobile-user-card">
              <div className="mobile-user-avatar">{initials}</div>
              <div className="mobile-user-info">
                <span className="mobile-user-name">{displayName}</span>
                <span className="mobile-user-email">{account?.username}</span>
              </div>
            </div>

            {/* Feature preview */}
            <div className="mobile-features">
              <div className="mobile-feature-item">
                <div className="mobile-feature-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
                <span className="mobile-feature-label">Calendar</span>
              </div>
              <div className="mobile-feature-item">
                <div className="mobile-feature-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <span className="mobile-feature-label">Events</span>
              </div>
              <div className="mobile-feature-item">
                <div className="mobile-feature-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <span className="mobile-feature-label">Assistant</span>
              </div>
            </div>

            {/* Status badge */}
            <div className="mobile-status">
              <span className="mobile-status-icon">&#10022;</span>
              <div className="mobile-status-text">
                <span className="mobile-status-title">In Development</span>
                <span className="mobile-status-desc">
                  The mobile experience is being built. For now, use a desktop or tablet browser for the full app.
                </span>
              </div>
            </div>

            {/* Sign out */}
            <button onClick={handleSignOut} className="mobile-signout">
              Sign Out
            </button>
          </>
        ) : (
          <>
            {/* Unauthenticated state */}
            <div className="mobile-welcome">
              <h2 className="mobile-welcome-title">Welcome</h2>
              <p className="mobile-welcome-desc">
                Sign in with your Temple Emanu-El account to view events and manage reservations.
              </p>
            </div>
            <button onClick={handleSignIn} className="mobile-signin">
              Sign in with Microsoft
            </button>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="mobile-footer">
        <span className="mobile-footer-text">TEMPLE EMANU-EL</span>
      </div>
    </div>
  );
}

export default MobileLayout;
