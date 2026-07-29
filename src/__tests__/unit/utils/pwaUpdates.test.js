// src/__tests__/unit/utils/pwaUpdates.test.js
//
// Locks the foreground update-check contract for the installed PWA.
//
// Background: the app shipped a service worker but never asked it to look for
// a new one. Browsers only run an update check on a *navigation*, and an
// installed standalone PWA (manifest display: 'standalone') resumes its
// existing page from the app switcher instead of navigating — there is no URL
// bar and no reload button to force one. Users therefore sat on the bundle
// they first installed, indefinitely, no matter how many times we deployed.
//
// registerSW() from 'virtual:pwa-register' supplies the other half (with
// registerType: 'autoUpdate' it reloads the page once a new worker activates).
// This module supplies the trigger: check on return to the foreground.
//
// The wiring in main.jsx cannot be tested here — vitest.config.js loads only
// the react() plugin, so the 'virtual:pwa-register' module has no resolver.
// Keeping the logic in a plain util is what makes any of this reachable.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  watchForServiceWorkerUpdates,
  FOREGROUND_UPDATE_THROTTLE_MS,
} from '../../../utils/pwaUpdates';

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

function foreground() {
  setVisibility('visible');
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('watchForServiceWorkerUpdates', () => {
  let registration;

  beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
    registration = { update: vi.fn().mockResolvedValue(undefined) };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks for a new worker when the app returns to the foreground', () => {
    const stop = watchForServiceWorkerUpdates(registration);
    vi.advanceTimersByTime(FOREGROUND_UPDATE_THROTTLE_MS + 1);

    foreground();

    expect(registration.update).toHaveBeenCalledTimes(1);
    stop();
  });

  it('skips a foreground that lands right after registration', () => {
    // registerSW's own register() has just performed an update check, so
    // checking again on the same breath is a wasted request.
    const stop = watchForServiceWorkerUpdates(registration);

    foreground();

    expect(registration.update).not.toHaveBeenCalled();
    stop();
  });

  it('ignores the transition to hidden', () => {
    const stop = watchForServiceWorkerUpdates(registration);
    vi.advanceTimersByTime(FOREGROUND_UPDATE_THROTTLE_MS + 1);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(registration.update).not.toHaveBeenCalled();
    stop();
  });

  it('throttles repeated foregrounds inside the window', () => {
    // Phones foreground an app dozens of times a day; one sw.js fetch per
    // glance is needless traffic on a metered connection.
    const stop = watchForServiceWorkerUpdates(registration);
    vi.advanceTimersByTime(FOREGROUND_UPDATE_THROTTLE_MS + 1);

    foreground();
    vi.advanceTimersByTime(1000);
    foreground();

    expect(registration.update).toHaveBeenCalledTimes(1);
    stop();
  });

  it('checks again once the throttle window has elapsed', () => {
    const stop = watchForServiceWorkerUpdates(registration);
    vi.advanceTimersByTime(FOREGROUND_UPDATE_THROTTLE_MS + 1);
    foreground();

    vi.advanceTimersByTime(FOREGROUND_UPDATE_THROTTLE_MS + 1);
    foreground();

    expect(registration.update).toHaveBeenCalledTimes(2);
    stop();
  });

  it('stops checking after cleanup', () => {
    const stop = watchForServiceWorkerUpdates(registration);
    stop();

    vi.advanceTimersByTime(FOREGROUND_UPDATE_THROTTLE_MS + 1);
    foreground();

    expect(registration.update).not.toHaveBeenCalled();
  });

  it('is inert without a registration', () => {
    // onRegisteredSW can hand back undefined when registration failed.
    const stop = watchForServiceWorkerUpdates(undefined);

    vi.advanceTimersByTime(FOREGROUND_UPDATE_THROTTLE_MS + 1);

    expect(() => foreground()).not.toThrow();
    expect(() => stop()).not.toThrow();
  });

  it('survives a failed check and retries at the next window', async () => {
    // A resume is exactly when the network is least likely to be back yet.
    // The rejection must not escape — vitest fails the file on an unhandled
    // one, which is what holds the implementation's .catch() in place — and
    // it must not poison the watcher for later foregrounds.
    registration.update
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);

    const stop = watchForServiceWorkerUpdates(registration);
    vi.advanceTimersByTime(FOREGROUND_UPDATE_THROTTLE_MS + 1);
    foreground();
    await Promise.resolve();

    vi.advanceTimersByTime(FOREGROUND_UPDATE_THROTTLE_MS + 1);
    foreground();

    expect(registration.update).toHaveBeenCalledTimes(2);
    stop();
  });
});
