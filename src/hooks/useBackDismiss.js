// src/hooks/useBackDismiss.js
import { useEffect, useRef } from 'react';

/**
 * Makes the device Back button dismiss an overlay instead of leaving the app.
 *
 * The mobile shell (MobileApp) is state-driven, not route-driven — App.jsx
 * renders it instead of <Routes>, so opening an event sheet puts nothing on the
 * history stack. Android's hardware back and iOS' edge-swipe therefore navigate
 * out of the app entirely. Worse in the installed PWA (manifest display:
 * 'standalone'), where the device back button is the ONLY back affordance.
 *
 * This hook gives each open overlay one throwaway history entry to consume:
 *
 *   open  -> history.pushState(marker)
 *   back  -> popstate -> dismiss the topmost overlay
 *   close -> history.back() to retire our own marker
 *
 * That last step matters. Without it, every open/close cycle leaves a stale
 * marker behind and the user has to press back once per cycle before anything
 * happens.
 *
 * Overlays unwind strictly LIFO (lightbox before the sheet beneath it), so a
 * module-level stack — mirroring useScrollLock's reference counting — is enough
 * to route each pop to the right overlay.
 */

// Open overlays, deepest first. Only the last entry responds to a pop.
const overlayStack = [];

// popstate events we caused ourselves by retiring a marker in cleanup. Those
// must not dismiss the overlay underneath, so they are counted and swallowed.
let selfInflictedPops = 0;

// One shared listener rather than one per overlay: with several listeners a
// single self-inflicted popstate would be decremented by the first and then
// acted on by the rest, closing every layer at once.
let listening = false;

function handlePopState() {
  if (selfInflictedPops > 0) {
    selfInflictedPops--;
    return;
  }
  const top = overlayStack[overlayStack.length - 1];
  if (!top) return;
  top.dismissedByBack = true;
  top.dismiss();
}

function startListening() {
  if (listening) return;
  window.addEventListener('popstate', handlePopState);
  listening = true;
}

/**
 * @param {boolean} isOpen      whether the overlay is currently showing
 * @param {Function} onDismiss  called when the user presses Back
 */
export default function useBackDismiss(isOpen, onDismiss) {
  // Keep the callback fresh without re-running the history effect — re-running
  // it would push a second marker for the same overlay.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const entry = {
      dismissedByBack: false,
      dismiss: () => onDismissRef.current?.(),
    };
    overlayStack.push(entry);
    startListening();

    // Spread the existing state so react-router's history index (history.state.idx)
    // survives. The URL is deliberately left alone — this marker is not a route.
    window.history.pushState(
      { ...window.history.state, __overlay: overlayStack.length },
      ''
    );

    return () => {
      const index = overlayStack.indexOf(entry);
      if (index !== -1) overlayStack.splice(index, 1);

      // Dismissed by Back? The browser already retired the marker for us.
      // Dismissed any other way (on-screen Back, backdrop tap, Escape, the
      // sheet switching events)? Retire it ourselves so the stack stays level.
      if (!entry.dismissedByBack) {
        selfInflictedPops++;
        window.history.back();
      }
    };
  }, [isOpen]);
}

// Test-only: module-level state outlives a component tree, so suites that
// assert on stack/pop bookkeeping need a clean slate between cases.
export function __resetBackDismissForTests() {
  overlayStack.length = 0;
  selfInflictedPops = 0;
}
