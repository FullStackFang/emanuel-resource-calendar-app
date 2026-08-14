// src/components/mobile/InstallAppSheet.jsx
//
// The install sheet: one layout, shared by every platform it is shown on.
// Chrome is identical everywhere — app mark, title, numbered step pills,
// two-button row — and only the subtitle, the steps and the primary label
// change.
//
// This is the INSTRUCTIONS half of the affordance, reached when the browser has
// no install dialog of its own to offer: iOS at all times, and anywhere
// beforeinstallprompt was withheld or has already been spent. Where a real
// dialog IS available, MobileApp fires it straight from the menu and this sheet
// never appears — design D3 originally routed Android through here too, for a
// flow that read the same on both platforms, and that extra tap was judged not
// worth its cost.
//
// The 'prompt' case below is therefore not on MobileApp's path. It stays
// because this component's contract is "given a platform, render the right
// way in" for all four values, and a caller in that state deserves a correct
// render rather than a fallthrough to the manual instructions.

import React, { useState } from 'react';
import useScrollLock from '../../hooks/useScrollLock';
import useBackDismiss from '../../hooks/useBackDismiss';
import './InstallAppSheet.css';

/** The app mark, at whatever size the caller sizes the box. */
function AppMark() {
  return (
    <div className="install-sheet-mark" data-testid="install-sheet-mark" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    </div>
  );
}

/**
 * Safari's Share glyph, rendered inline in step 1 so users can match it against
 * the toolbar icon they are hunting for. "in the bar below" is accurate because
 * this sheet only ever mounts on phones — tablets render the desktop UI.
 */
function ShareGlyph() {
  return (
    <span className="install-sheet-glyph" aria-hidden="true">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary-600)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 15V3" />
        <path d="m8 7 4-4 4 4" />
        <path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      </svg>
    </span>
  );
}

function contentFor(platform) {
  switch (platform) {
    case 'prompt':
      return {
        subtitle: 'Two taps',
        primaryLabel: 'Install',
        steps: [
          <>Tap <b>Install</b> below</>,
          <>Confirm in your phone&apos;s dialog</>,
        ],
      };
    case 'ios-safari':
      return {
        subtitle: 'Three taps in Safari',
        primaryLabel: 'Got it',
        steps: [
          <>Tap <ShareGlyph /> <b>Share</b> in the bar below</>,
          <>Scroll down, tap <b>Add to Home Screen</b></>,
          <>Tap <b>Add</b>, top right</>,
        ],
      };
    case 'ios-other':
      return {
        subtitle: 'Safari required on iPhone',
        primaryLabel: 'Copy link',
        steps: [
          <>Tap <b>Copy link</b> below</>,
          <>Open <b>Safari</b> and paste it</>,
          <>Tap <b>Share</b> &rarr; <b>Add to Home Screen</b></>,
        ],
      };
    default:
      return {
        subtitle: 'From your browser menu',
        primaryLabel: 'Got it',
        steps: [
          <>Open your browser&apos;s <b>&#8942; menu</b></>,
          <>Choose <b>Install</b> or <b>Add to Home screen</b></>,
        ],
      };
  }
}

/**
 * @param {boolean} isOpen
 * @param {'prompt'|'ios-safari'|'ios-other'|'manual'} platform
 * @param {Function} onClose
 * @param {Function} promptInstall From usePwaInstall. Only called on 'prompt'.
 */
function InstallAppSheet({ isOpen, platform, onClose, promptInstall }) {
  const [copyState, setCopyState] = useState('idle');

  useScrollLock(isOpen);
  useBackDismiss(isOpen, onClose);

  if (!isOpen) return null;

  const { subtitle, primaryLabel, steps } = contentFor(platform);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState('copied');
    } catch {
      // Clipboard permission denied, or an insecure context. The address bar
      // is still right there, so say so rather than failing silently.
      setCopyState('failed');
    }
  };

  const handlePrimary = () => {
    if (platform === 'prompt') {
      // promptInstall fires prompt() synchronously inside this gesture; the
      // browser's dialog is the next thing on screen, so the sheet steps aside.
      promptInstall();
      onClose();
      return;
    }
    if (platform === 'ios-other') {
      handleCopyLink();
      return;
    }
    onClose();
  };

  return (
    <div className="install-sheet-root">
      <div
        className="install-sheet-scrim"
        data-testid="install-sheet-scrim"
        onClick={onClose}
      />
      <div className="install-sheet" role="dialog" aria-modal="true" aria-label="Install Temple Events">
        <div className="install-sheet-grabber" />
        <div className="install-sheet-head">
          <AppMark />
          <div>
            <div className="install-sheet-title">Install Temple Events</div>
            <div className="install-sheet-subtitle">{subtitle}</div>
          </div>
        </div>
        <ol className="install-sheet-steps" data-testid="install-sheet-steps">
          {steps.map((step, index) => (
            <li key={index}>
              <span className="install-sheet-step-num">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {copyState !== 'idle' && (
          <div className="install-sheet-copy-status" role="status">
            {copyState === 'copied'
              ? 'Copied - now paste it into Safari'
              : "Couldn't copy - use the address bar instead"}
          </div>
        )}
        <div className="install-sheet-actions">
          <button type="button" className="install-sheet-btn install-sheet-btn-ghost" onClick={onClose}>
            Not now
          </button>
          <button
            type="button"
            className="install-sheet-btn install-sheet-btn-primary"
            data-testid="install-sheet-primary"
            onClick={handlePrimary}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InstallAppSheet;
