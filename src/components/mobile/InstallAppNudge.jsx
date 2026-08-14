// src/components/mobile/InstallAppNudge.jsx
//
// The one-time banner that points at the permanent menu entry. Eligibility is a
// single pure predicate (shouldShowNudge) with no timers and no scheduling: the
// affordance is available, the user is signed in, this is at least their second
// signed-in session, and no nudge has been retired on this device.
//
// Either button retires it forever. The Install button takes the same path the
// menu entry does — under design D9 there is exactly one action, and MobileApp
// alone decides whether it means the browser's dialog or the instruction sheet.

import React, { useState } from 'react';
import { readNudgeDone, retireNudge, shouldShowNudge } from '../../utils/pwaInstall';
import './InstallAppNudge.css';

/**
 * @param {boolean} isAvailable  From usePwaInstall.
 * @param {boolean} isAuthenticated
 * @param {number}  visitCount   Signed-in sessions so far, counted by the shell.
 * @param {Function} onInstall   Starts the install (MobileApp decides how).
 */
function InstallAppNudge({ isAvailable, isAuthenticated, visitCount, onInstall }) {
  // Read once at mount. An unreadable store reads as already-retired, so a
  // private-browsing user is never nagged every session.
  const [nudgeDone, setNudgeDone] = useState(readNudgeDone);

  if (!shouldShowNudge({ isAvailable, isAuthenticated, visitCount, nudgeDone })) {
    return null;
  }

  const retire = () => {
    retireNudge();
    // Local state as well as the write: if the write threw, the dismissal is
    // still honoured for the rest of this session.
    setNudgeDone(true);
  };

  const handleInstall = () => {
    retire();
    onInstall();
  };

  return (
    <div className="install-nudge" data-testid="install-nudge">
      <div className="install-nudge-top">
        <div className="install-nudge-mark" aria-hidden="true">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </div>
        <div>
          <div className="install-nudge-title">Add to your home screen</div>
          <div className="install-nudge-subtitle">
            Open the calendar in one tap, without hunting for a browser tab.
          </div>
        </div>
      </div>
      <div className="install-nudge-actions">
        <button type="button" className="install-nudge-btn install-nudge-btn-ghost" onClick={retire}>
          Not now
        </button>
        <button type="button" className="install-nudge-btn install-nudge-btn-primary" onClick={handleInstall}>
          Install
        </button>
      </div>
    </div>
  );
}

export default InstallAppNudge;
