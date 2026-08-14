import React, { useState, useRef, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { setLayoutPreference } from '../../utils/layoutPreference';
import { logger } from '../../utils/logger';
import './MobileHeader.css';

/**
 * @param {boolean} [showInstall] The install affordance is available (not
 *   already installed, not running standalone). Owned by MobileApp.
 * @param {Function} [onInstall] Starts the install. Whether that means the
 *   browser's own dialog or our instruction sheet is MobileApp's decision —
 *   this menu never branches on platform.
 */
function MobileHeader({ showInstall = false, onInstall }) {
  const { instance, accounts } = useMsal();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const account = accounts[0];

  const displayName = account?.name || account?.username?.split('@')[0] || '';
  const initials = displayName
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('');

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [menuOpen]);

  const handleSignOut = async () => {
    try {
      await instance.logoutRedirect();
    } catch (error) {
      logger.error('Mobile logout failed:', error);
    }
  };

  return (
    <header className="mobile-header">
      <h1 className="mobile-header-title">Temple Events</h1>
      <div className="mobile-header-avatar-container" ref={menuRef}>
        <button
          className="mobile-header-avatar"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="User menu"
        >
          {initials}
        </button>
        {menuOpen && (
          <div className="mobile-header-menu">
            <div className="mobile-header-menu-user">
              <span className="mobile-header-menu-name">{displayName}</span>
              <span className="mobile-header-menu-email">{account?.username}</span>
            </div>
            <div className="mobile-header-menu-divider" />
            {showInstall && onInstall && (
              <button
                className="mobile-header-menu-item mobile-header-menu-item-highlight"
                onClick={() => {
                  setMenuOpen(false);
                  onInstall();
                }}
              >
                Install App
              </button>
            )}
            <button
              className="mobile-header-menu-item"
              onClick={() => {
                setMenuOpen(false);
                setLayoutPreference('desktop');
              }}
            >
              Switch to Desktop View
            </button>
            <button className="mobile-header-menu-item" onClick={handleSignOut}>
              Sign Out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default MobileHeader;
