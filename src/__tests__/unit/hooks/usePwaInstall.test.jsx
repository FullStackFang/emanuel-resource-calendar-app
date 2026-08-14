// src/__tests__/unit/hooks/usePwaInstall.test.jsx
//
// The event half of the install affordance. The first case is the one that
// matters most: Chrome dispatches `beforeinstallprompt` during initial page
// load, so a listener registered from a component effect misses it — and
// misses it ONLY in production, because dev hot-reload re-fires listeners after
// mount. That is the single most likely way for this feature to ship broken,
// which is why capture lives at module scope (initInstallCapture, called once
// from main.jsx) and the hook merely reads the slot on mount.
//
// The second load-bearing case is the self-heal: a persisted "installed" flag
// would otherwise rot after an uninstall with no route back. Receiving
// `beforeinstallprompt` IS the browser stating this origin is not currently
// installed, so it clears the flag. No timers, no versioning.

import mainSource from '../../../main.jsx?raw';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePwaInstall } from '../../../hooks/usePwaInstall';
import {
  initInstallCapture,
  readInstalledFlag,
  setInstalledFlag,
  INSTALLED_FLAG_KEY,
  __resetInstallCaptureForTests,
} from '../../../utils/pwaInstall';

/**
 * The BeforeInstallPromptEvent Chrome fires. jsdom has no constructor for it,
 * and the two extra members are the entire API surface we use.
 */
function makeInstallEvent(outcome = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return event;
}

describe('usePwaInstall', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    __resetInstallCaptureForTests();
    initInstallCapture();
  });

  afterEach(() => {
    __resetInstallCaptureForTests();
  });

  it('UPI-0: bootstrap registers the capture at module scope', () => {
    // Read as text (?raw) rather than imported: importing main.jsx boots MSAL,
    // Sentry and the whole app, so there is no way to exercise it here. The
    // behaviour it wires up is covered by UPI-1 below; what this asserts is
    // that the wiring exists at all, because a hook-only listener passes every
    // other test in this file and still misses the event in production.
    //
    // A bare statement at the start of a line: a mention inside a comment or an
    // import must not satisfy this.
    const call = /^initInstallCapture\(\);$/m;
    expect(mainSource).toMatch(call);
    // Before ReactDOM.createRoot — the event lands during initial page load.
    expect(mainSource.search(call)).toBeLessThan(
      mainSource.indexOf('ReactDOM.createRoot')
    );
  });

  it('UPI-1: an event dispatched BEFORE mount is still reported as available (D2)', () => {
    // Bootstrap-time capture. Remove initInstallCapture() from main.jsx, or
    // move the listener into the hook, and this is the case that fails.
    window.dispatchEvent(makeInstallEvent());

    const { result } = renderHook(() => usePwaInstall());

    expect(result.current.canPrompt).toBe(true);
    expect(result.current.platform).toBe('prompt');
    expect(result.current.isAvailable).toBe(true);
  });

  it('UPI-2: an event dispatched AFTER mount is picked up', async () => {
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.canPrompt).toBe(false);

    act(() => {
      window.dispatchEvent(makeInstallEvent());
    });

    await waitFor(() => expect(result.current.canPrompt).toBe(true));
    expect(result.current.platform).toBe('prompt');
  });

  it('UPI-3: appinstalled sets the flag and withdraws the affordance', async () => {
    window.dispatchEvent(makeInstallEvent());
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.isAvailable).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    await waitFor(() => expect(result.current.isAvailable).toBe(false));
    expect(readInstalledFlag()).toBe(true);
  });

  it('UPI-4: beforeinstallprompt clears a stale installed flag (D6 self-heal)', async () => {
    // The user installed, then uninstalled. The browser resumes firing the
    // event for this origin; that is the only signal an uninstall ever gives.
    setInstalledFlag();
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.isAvailable).toBe(false);

    act(() => {
      window.dispatchEvent(makeInstallEvent());
    });

    await waitFor(() => expect(result.current.isAvailable).toBe(true));
    expect(window.localStorage.getItem(INSTALLED_FLAG_KEY)).toBeNull();
  });

  it('UPI-5: the captured event is consumed once', async () => {
    const event = makeInstallEvent();
    window.dispatchEvent(event);
    const { result } = renderHook(() => usePwaInstall());

    await act(async () => {
      await result.current.promptInstall();
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.promptInstall();
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.canPrompt).toBe(false));
  });

  it('UPI-6: prompt() is called synchronously, before any await (D10)', async () => {
    // Browsers require prompt() inside the user-gesture window. An intervening
    // await silently voids the gesture and the dialog never appears — which is
    // invisible in jsdom unless the synchronous call is asserted directly.
    const event = makeInstallEvent();
    window.dispatchEvent(event);
    const { result } = renderHook(() => usePwaInstall());

    let pending;
    act(() => {
      pending = result.current.promptInstall();
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);

    await act(async () => {
      await pending;
    });
  });

  it('UPI-7: a dismissed outcome records nothing, so the entry stays', async () => {
    window.dispatchEvent(makeInstallEvent('dismissed'));
    const { result } = renderHook(() => usePwaInstall());

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(readInstalledFlag()).toBe(false);
    expect(result.current.isAvailable).toBe(true);
  });

  it('UPI-8: a fresh event after a consumed one restores the ability to prompt', async () => {
    const first = makeInstallEvent('dismissed');
    window.dispatchEvent(first);
    const { result } = renderHook(() => usePwaInstall());
    await act(async () => {
      await result.current.promptInstall();
    });
    await waitFor(() => expect(result.current.canPrompt).toBe(false));

    const second = makeInstallEvent();
    act(() => {
      window.dispatchEvent(second);
    });
    await waitFor(() => expect(result.current.canPrompt).toBe(true));

    await act(async () => {
      await result.current.promptInstall();
    });
    expect(second.prompt).toHaveBeenCalledTimes(1);
  });

  it('UPI-9: promptInstall with nothing captured is a no-op, not a crash', async () => {
    const { result } = renderHook(() => usePwaInstall());
    await act(async () => {
      await expect(result.current.promptInstall()).resolves.toBeUndefined();
    });
  });

  it('UPI-10: an already-set installed flag suppresses the affordance on mount', () => {
    setInstalledFlag();
    const { result } = renderHook(() => usePwaInstall());
    expect(result.current.isAvailable).toBe(false);
  });

  it('UPI-11: running standalone suppresses the affordance regardless of flags', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    try {
      const { result } = renderHook(() => usePwaInstall());
      expect(result.current.isAvailable).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it('UPI-12: with no captured event the platform falls back to the UA branch', () => {
    const { result } = renderHook(() => usePwaInstall());
    // jsdom's default UA is neither iOS nor a Chromium that fired the event.
    expect(result.current.platform).toBe('manual');
    expect(result.current.canPrompt).toBe(false);
  });
});
