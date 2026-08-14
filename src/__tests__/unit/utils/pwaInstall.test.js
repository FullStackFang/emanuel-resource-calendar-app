// src/__tests__/unit/utils/pwaInstall.test.js
//
// The pure half of the install affordance: standalone detection, the platform
// resolution table, the nudge predicate, and the storage wrappers.
//
// Two behaviours here are load-bearing and easy to regress:
//
//   * Capability outranks the user agent (D5). detectPlatform checks for a
//     captured install event BEFORE it looks at the UA string, so a browser
//     that can genuinely install always gets the real dialog no matter what it
//     claims to be. UA sniffing only picks which instructions to print.
//   * Storage failure degrades ASYMMETRICALLY (D7). A throwing localStorage
//     must leave the permanent menu entry visible (readInstalledFlag -> false)
//     and the one-time nudge suppressed (readNudgeDone -> true). Failing the
//     other way either removes the only route to installing or turns a
//     once-ever banner into a nag that returns every session.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isRunningStandalone,
  detectPlatform,
  shouldShowNudge,
  recordVisit,
  readVisitCount,
  retireNudge,
  readNudgeDone,
  readInstalledFlag,
  setInstalledFlag,
  clearInstalledFlag,
  INSTALLED_FLAG_KEY,
  NUDGE_DONE_KEY,
  VISIT_COUNT_KEY,
  VISIT_SESSION_KEY,
} from '../../../utils/pwaInstall';

const UA_IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
const UA_ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';

/** matchMedia stub whose only truth is the query string it is told to match. */
function stubMatchMedia(matchingQuery) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query === matchingQuery,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('pwaInstall — standalone detection', () => {
  let originalMatchMedia;
  let originalStandalone;

  beforeEach(() => {
    originalMatchMedia = window.matchMedia;
    originalStandalone = window.navigator.standalone;
    stubMatchMedia(null);
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    if (originalStandalone === undefined) {
      delete window.navigator.standalone;
    } else {
      Object.defineProperty(window.navigator, 'standalone', {
        value: originalStandalone,
        configurable: true,
      });
    }
  });

  it('PWA-1: display-mode: standalone means installed', () => {
    stubMatchMedia('(display-mode: standalone)');
    expect(isRunningStandalone()).toBe(true);
  });

  it('PWA-2: legacy navigator.standalone means installed (iOS before 16.4)', () => {
    Object.defineProperty(window.navigator, 'standalone', {
      value: true,
      configurable: true,
    });
    expect(isRunningStandalone()).toBe(true);
  });

  it('PWA-3: a plain browser tab is not standalone', () => {
    expect(isRunningStandalone()).toBe(false);
  });

  it('PWA-4: a matchMedia that throws does not take the app down', () => {
    window.matchMedia = () => {
      throw new Error('nope');
    };
    expect(isRunningStandalone()).toBe(false);
  });
});

describe('pwaInstall — platform resolution', () => {
  it('PWA-5: a captured install event resolves to prompt', () => {
    expect(
      detectPlatform({ hasDeferredPrompt: true, userAgent: UA_ANDROID_CHROME })
    ).toBe('prompt');
  });

  it('PWA-6: iOS with no third-party marker resolves to ios-safari', () => {
    expect(
      detectPlatform({ hasDeferredPrompt: false, userAgent: UA_IPHONE_SAFARI })
    ).toBe('ios-safari');
  });

  it.each(['CriOS/126.0', 'FxiOS/126.0', 'EdgiOS/126.0', 'OPiOS/126.0'])(
    'PWA-7: iOS carrying %s resolves to ios-other',
    (marker) => {
      const ua = UA_IPHONE_SAFARI.replace('Version/17.5', marker);
      expect(detectPlatform({ hasDeferredPrompt: false, userAgent: ua })).toBe(
        'ios-other'
      );
    }
  );

  it('PWA-8: anything else falls back to manual', () => {
    expect(
      detectPlatform({ hasDeferredPrompt: false, userAgent: UA_ANDROID_CHROME })
    ).toBe('manual');
  });

  it('PWA-9: iPadOS 13+ reports as a Mac and still counts as iOS', () => {
    // Safari on iPad has claimed to be a desktop Mac since iPadOS 13. The touch
    // point count is the only thing that separates it from a real MacBook.
    expect(
      detectPlatform({
        hasDeferredPrompt: false,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      })
    ).toBe('ios-safari');
  });

  it('PWA-10: a real Mac (no touch points) is not iOS', () => {
    expect(
      detectPlatform({
        hasDeferredPrompt: false,
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      })
    ).toBe('manual');
  });

  it('PWA-11: capability outranks the user agent — a captured event beats an iOS third-party marker', () => {
    // The exact case D5 orders the checks for: iOS 17.4+ in the EU permits
    // alternative engines, so a CriOS build could really install. If it fires
    // the event, it must get the real dialog rather than "open in Safari".
    expect(
      detectPlatform({ hasDeferredPrompt: true, userAgent: UA_IPHONE_CHROME })
    ).toBe('prompt');
  });
});

describe('pwaInstall — nudge predicate', () => {
  const eligible = {
    isAvailable: true,
    isAuthenticated: true,
    visitCount: 2,
    nudgeDone: false,
  };

  it('PWA-12: all four conditions met shows the nudge', () => {
    expect(shouldShowNudge(eligible)).toBe(true);
  });

  it('PWA-13: the first session is too early', () => {
    expect(shouldShowNudge({ ...eligible, visitCount: 1 })).toBe(false);
  });

  it('PWA-14: later sessions still qualify while it has not been retired', () => {
    expect(shouldShowNudge({ ...eligible, visitCount: 9 })).toBe(true);
  });

  it('PWA-15: a retired nudge never returns', () => {
    expect(shouldShowNudge({ ...eligible, nudgeDone: true })).toBe(false);
  });

  it('PWA-16: an unauthenticated visitor never sees it', () => {
    expect(shouldShowNudge({ ...eligible, isAuthenticated: false })).toBe(false);
  });

  it('PWA-17: an unavailable affordance (installed / standalone) shows nothing', () => {
    expect(shouldShowNudge({ ...eligible, isAvailable: false })).toBe(false);
  });
});

describe('pwaInstall — persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('PWA-18: the installed flag round-trips and clears', () => {
    expect(readInstalledFlag()).toBe(false);
    setInstalledFlag();
    expect(window.localStorage.getItem(INSTALLED_FLAG_KEY)).toBe('true');
    expect(readInstalledFlag()).toBe(true);
    clearInstalledFlag();
    expect(readInstalledFlag()).toBe(false);
  });

  it('PWA-19: retiring the nudge persists', () => {
    expect(readNudgeDone()).toBe(false);
    retireNudge();
    expect(window.localStorage.getItem(NUDGE_DONE_KEY)).toBe('true');
    expect(readNudgeDone()).toBe(true);
  });

  it('PWA-20: recordVisit increments once and only once per browsing session', () => {
    expect(recordVisit()).toBe(1);
    // A page refresh inside the same session re-runs this and must not advance.
    expect(recordVisit()).toBe(1);
    expect(readVisitCount()).toBe(1);
    expect(window.sessionStorage.getItem(VISIT_SESSION_KEY)).toBe('true');
  });

  it('PWA-21: a new browsing session advances the count', () => {
    recordVisit();
    window.sessionStorage.clear(); // what closing and reopening the tab does
    expect(recordVisit()).toBe(2);
    expect(window.localStorage.getItem(VISIT_COUNT_KEY)).toBe('2');
  });

  it('PWA-22: a junk stored count reads as zero rather than NaN', () => {
    window.localStorage.setItem(VISIT_COUNT_KEY, 'not-a-number');
    expect(readVisitCount()).toBe(0);
  });
});

describe('pwaInstall — storage failure degrades toward the permanent entry (D7)', () => {
  let getItem;
  let setItem;

  beforeEach(() => {
    getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });
    setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });
  });

  afterEach(() => {
    getItem.mockRestore();
    setItem.mockRestore();
  });

  it('PWA-23: an unreadable installed flag reads as NOT installed, so the entry is shown', () => {
    expect(readInstalledFlag()).toBe(false);
  });

  it('PWA-24: an unreadable nudge flag reads as ALREADY retired, so the nudge stays hidden', () => {
    // The opposite default would resurrect the one-time banner every session
    // for every private-browsing user.
    expect(readNudgeDone()).toBe(true);
    expect(
      shouldShowNudge({
        isAvailable: true,
        isAuthenticated: true,
        visitCount: 5,
        nudgeDone: readNudgeDone(),
      })
    ).toBe(false);
  });

  it('PWA-25: an unreadable visit count reads as zero', () => {
    expect(readVisitCount()).toBe(0);
  });

  it('PWA-26: writes that throw surface no error to the caller', () => {
    expect(() => setInstalledFlag()).not.toThrow();
    expect(() => clearInstalledFlag()).not.toThrow();
    expect(() => retireNudge()).not.toThrow();
    expect(() => recordVisit()).not.toThrow();
  });
});
