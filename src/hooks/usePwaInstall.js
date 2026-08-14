// src/hooks/usePwaInstall.js
//
// React's view of the install affordance. All platform knowledge and the event
// slot live in utils/pwaInstall — this hook only turns them into state and
// re-reads them when the browser says something new.
//
// Returns { isAvailable, canPrompt, platform, promptInstall }:
//   isAvailable  — show the affordance at all (not standalone, not installed)
//   canPrompt    — a real install dialog is available right now
//   platform     — which set of instructions the sheet should print
//   promptInstall— fires the captured event; a no-op when there isn't one

import { useCallback, useEffect, useState } from 'react';
import {
  consumeDeferredPrompt,
  detectPlatform,
  getDeferredPrompt,
  isRunningStandalone,
  readInstalledFlag,
  subscribeToInstallState,
} from '../utils/pwaInstall';

function readInstallState() {
  const hasDeferredPrompt = Boolean(getDeferredPrompt());
  return {
    canPrompt: hasDeferredPrompt,
    platform: detectPlatform({ hasDeferredPrompt }),
    isAvailable: !isRunningStandalone() && !readInstalledFlag(),
  };
}

export function usePwaInstall() {
  const [state, setState] = useState(readInstallState);

  useEffect(() => {
    // Re-read on mount as well as subscribe: in production the event has
    // usually already landed in the slot by the time this lazily-imported tree
    // mounts, and only the module-scope listener saw it.
    setState(readInstallState());
    return subscribeToInstallState(() => setState(readInstallState()));
  }, []);

  const promptInstall = useCallback(async () => {
    const event = consumeDeferredPrompt();
    if (!event) return;

    // No await may precede this call: browsers require prompt() inside the
    // user-gesture window, and an intervening await voids the gesture silently
    // — the dialog simply never appears (D10).
    event.prompt();

    try {
      await event.userChoice;
    } catch {
      // A rejected userChoice tells us nothing actionable. An accepted install
      // is recorded by the browser's own `appinstalled` event, and a dismissal
      // deliberately records nothing so the entry stays available.
    }
  }, []);

  return { ...state, promptInstall };
}

export default usePwaInstall;
