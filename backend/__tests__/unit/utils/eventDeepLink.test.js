/**
 * eventDeepLink URL builders (EDL-1 to EDL-9)
 *
 * The load-bearing fact these tests protect: FRONTEND_URL is a vanity 301
 * REDIRECT, not a sub-path mount. It preserves the query string and 404s on any
 * deeper path (measured 2026-09-03 — see the comment at the top of
 * eventDeepLink.js). A builder that appends a path therefore produces a link
 * that dies at the vanity domain before the app is ever reached, which is
 * exactly what shipped a dead CTA in every schedule email.
 *
 * EDL-4 is the guard: it asserts the pathname is UNCHANGED, so appending a
 * segment fails the suite rather than waiting for a recipient to report a 404.
 */

const {
  buildEventDeepLinkUrl,
  buildMyAssignmentsUrl,
  DEFAULT_FRONTEND_URL,
  MY_ASSIGNMENTS_VIEW
} = require('../../../utils/eventDeepLink');

describe('eventDeepLink URL builders (EDL-1 to EDL-9)', () => {
  const ORIGINAL = process.env.FRONTEND_URL;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = ORIGINAL;
  });

  describe('buildMyAssignmentsUrl', () => {
    test('EDL-1 targets the My Assignments view as a query param on FRONTEND_URL', () => {
      process.env.FRONTEND_URL = 'https://emanuelnyc.org/scheduler';

      expect(buildMyAssignmentsUrl()).toBe('https://emanuelnyc.org/scheduler?view=my-assignments');
    });

    test('EDL-2 uses the documented view token', () => {
      process.env.FRONTEND_URL = 'https://emanuelnyc.org/scheduler';

      const view = new URL(buildMyAssignmentsUrl()).searchParams.get('view');
      expect(view).toBe(MY_ASSIGNMENTS_VIEW);
      expect(view).toBe('my-assignments');
    });

    // Spec: "A sub-path base is not extended".
    test('EDL-3 leaves a sub-path base with a trailing slash unextended', () => {
      process.env.FRONTEND_URL = 'https://example.org/app/';

      const url = new URL(buildMyAssignmentsUrl());
      expect(url.pathname).toBe('/app/');
      expect(url.searchParams.get('view')).toBe('my-assignments');
    });

    // ── THE GUARD ────────────────────────────────────────────────────────────
    // Restore the old `url.pathname = pathname + '/my-assignments'` and this
    // fails. Do not "fix" it by updating the expectation: a path segment here
    // means the link 404s at emanuelnyc.org. See the header comment.
    test('EDL-4 GUARD: adds no path segment to FRONTEND_URL, whatever its shape', () => {
      for (const base of [
        'https://emanuelnyc.org/scheduler',
        'https://emanuelnyc.org/scheduler/',
        'https://localhost:5173',
        'https://localhost:5173/',
        'https://example.org/deeply/nested/base'
      ]) {
        process.env.FRONTEND_URL = base;

        expect(new URL(buildMyAssignmentsUrl()).pathname).toBe(new URL(base).pathname);
      }
    });

    // Spec: "A malformed base falls back safely".
    test('EDL-5 falls back to the default URL when FRONTEND_URL is unparseable', () => {
      process.env.FRONTEND_URL = 'not a url';

      const url = buildMyAssignmentsUrl();
      expect(url).toBe(`${DEFAULT_FRONTEND_URL}?view=my-assignments`);
      expect(new URL(url).pathname).toBe(new URL(DEFAULT_FRONTEND_URL).pathname);
    });

    test('EDL-6 falls back to the default URL when FRONTEND_URL is unset', () => {
      delete process.env.FRONTEND_URL;

      expect(buildMyAssignmentsUrl()).toBe(`${DEFAULT_FRONTEND_URL}?view=my-assignments`);
    });
  });

  // buildEventDeepLinkUrl already appended only a query param and is untouched
  // by this change. These lock that, so the fix to its sibling cannot drift it.
  describe('buildEventDeepLinkUrl (regression guards)', () => {
    test('EDL-7 appends eventId as a query param and no path', () => {
      process.env.FRONTEND_URL = 'https://emanuelnyc.org/scheduler';

      const url = buildEventDeepLinkUrl('abc123');
      expect(url).toBe('https://emanuelnyc.org/scheduler?eventId=abc123');
      expect(new URL(url).pathname).toBe('/scheduler');
    });

    test('EDL-8 returns an empty string with no event id', () => {
      expect(buildEventDeepLinkUrl('')).toBe('');
      expect(buildEventDeepLinkUrl(null)).toBe('');
      expect(buildEventDeepLinkUrl(undefined)).toBe('');
    });

    test('EDL-9 falls back to the default URL when FRONTEND_URL is unparseable', () => {
      process.env.FRONTEND_URL = 'not a url';

      expect(buildEventDeepLinkUrl('abc123')).toBe(`${DEFAULT_FRONTEND_URL}?eventId=abc123`);
    });
  });
});
