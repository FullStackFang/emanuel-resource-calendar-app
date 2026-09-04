// emailDestination.test.js
//
// The allow-list and the pre-MSAL capture that email CTAs depend on.
//
// Test IDs: EDST-1 to EDST-12. EDST-1 is a ?raw SOURCE assertion on main.jsx:
// that file boots MSAL, Sentry and the whole app on import, so the capture
// cannot be exercised behaviourally in jsdom — the same reason UPI-0 asserts
// initInstallCapture's bootstrap line as source.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import mainSource from '../../../main.jsx?raw';

import {
  EMAIL_DESTINATION_PARAM,
  EMAIL_DESTINATION_STORAGE_KEY,
  resolveEmailDestination,
  captureEmailDestination,
  readStoredEmailDestination,
  clearStoredEmailDestination,
} from '../../../utils/emailDestination';

describe('emailDestination', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  // ── Bootstrap wiring ──────────────────────────────────────────────────────

  // MSAL's redirect flow returns to window.location.origin WITHOUT the query
  // string. A capture registered from a React effect runs after that, so it
  // sees nothing. Matches a bare call statement so a mention in a comment does
  // not satisfy the assertion.
  it('EDST-1: main.jsx captures the destination at module scope', () => {
    expect(mainSource).toMatch(/^\s*captureEmailDestination\(\);\s*$/m);
    expect(mainSource).toContain("from './utils/emailDestination'");
  });

  // ── The allow-list (spec: "Only known destinations are honored") ──────────

  it('EDST-2: resolves the My Assignments destination', () => {
    expect(resolveEmailDestination('my-assignments')).toBe('/my-assignments');
  });

  it('EDST-3: refuses anything not allow-listed', () => {
    for (const value of ['calendar', 'MY-ASSIGNMENTS', '', null, undefined, 42, {}]) {
      expect(resolveEmailDestination(value)).toBeNull();
    }
  });

  // A raw value used as a route would be an arbitrary-navigation primitive:
  // the value arrives from an email and is attacker-controllable.
  it('EDST-4: refuses path-like and absolute-URL values', () => {
    for (const value of [
      '/admin/scheduling-sheets',
      '../admin',
      'https://evil.example/phish',
      '//evil.example',
      'javascript:alert(1)',
    ]) {
      expect(resolveEmailDestination(value)).toBeNull();
    }
  });

  // A bare object literal would resolve inherited keys and hand back something
  // that is not a route; the lookup is a Map for exactly this reason.
  it('EDST-5: refuses inherited Object keys', () => {
    for (const value of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(resolveEmailDestination(value)).toBeNull();
    }
  });

  // ── Capture ───────────────────────────────────────────────────────────────

  it('EDST-6: stores an allow-listed destination from the query string', () => {
    captureEmailDestination(`?${EMAIL_DESTINATION_PARAM}=my-assignments`);

    expect(sessionStorage.getItem(EMAIL_DESTINATION_STORAGE_KEY)).toBe('my-assignments');
  });

  it('EDST-7: stores nothing for an unrecognized destination', () => {
    captureEmailDestination(`?${EMAIL_DESTINATION_PARAM}=/admin/scheduling-sheets`);

    expect(sessionStorage.getItem(EMAIL_DESTINATION_STORAGE_KEY)).toBeNull();
  });

  it('EDST-8: stores nothing when the param is absent', () => {
    captureEmailDestination('?eventId=abc123');

    expect(sessionStorage.getItem(EMAIL_DESTINATION_STORAGE_KEY)).toBeNull();
  });

  it('EDST-9: reads window.location.search when given no argument', () => {
    const spy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      search: `?${EMAIL_DESTINATION_PARAM}=my-assignments`,
    });

    captureEmailDestination();

    expect(sessionStorage.getItem(EMAIL_DESTINATION_STORAGE_KEY)).toBe('my-assignments');
    spy.mockRestore();
  });

  // ── Storage failure is never fatal ────────────────────────────────────────
  // Private mode and blocked site data make these throw. A dead CTA is bad; a
  // white screen on a link people were told to click is worse.

  it('EDST-10: survives a throwing sessionStorage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });

    expect(() => captureEmailDestination('?view=my-assignments')).not.toThrow();
    expect(readStoredEmailDestination()).toBeNull();
    expect(() => clearStoredEmailDestination()).not.toThrow();
  });

  // ── Read / clear round trip ───────────────────────────────────────────────

  it('EDST-11: reads back what was captured', () => {
    captureEmailDestination('?view=my-assignments');

    expect(readStoredEmailDestination()).toBe('my-assignments');
  });

  it('EDST-12: clearing removes the stored destination', () => {
    captureEmailDestination('?view=my-assignments');
    clearStoredEmailDestination();

    expect(readStoredEmailDestination()).toBeNull();
  });
});
