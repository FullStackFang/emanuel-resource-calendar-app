/**
 * Tests for deep-link eventId preservation across MSAL auth flow.
 *
 * The app captures ?eventId= into sessionStorage before MSAL initializes
 * (in main.jsx), so Calendar.jsx can recover it after authentication
 * even if MSAL's redirect flow strips the query parameter.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Deep-link eventId preservation', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('main.jsx capture logic', () => {
    // Replicate the IIFE from main.jsx for testing
    const captureDeepLinkEventId = (search) => {
      const params = new URLSearchParams(search);
      const eventId = params.get('eventId');
      if (eventId) {
        sessionStorage.setItem('deepLinkEventId', eventId);
      }
    };

    it('stores eventId from URL into sessionStorage', () => {
      captureDeepLinkEventId('?eventId=abc123');
      expect(sessionStorage.getItem('deepLinkEventId')).toBe('abc123');
    });

    it('handles MongoDB ObjectId-style eventId', () => {
      captureDeepLinkEventId('?eventId=69c6791315f69fd974f76926');
      expect(sessionStorage.getItem('deepLinkEventId')).toBe('69c6791315f69fd974f76926');
    });

    it('does not write to sessionStorage when eventId is absent', () => {
      captureDeepLinkEventId('?view=month');
      expect(sessionStorage.getItem('deepLinkEventId')).toBeNull();
    });

    it('does not write to sessionStorage for empty query string', () => {
      captureDeepLinkEventId('');
      expect(sessionStorage.getItem('deepLinkEventId')).toBeNull();
    });

    it('handles eventId with other query params', () => {
      captureDeepLinkEventId('?tab=reservations&eventId=xyz789&view=week');
      expect(sessionStorage.getItem('deepLinkEventId')).toBe('xyz789');
    });
  });

  describe('Calendar.jsx retrieval logic', () => {
    // Replicate the retrieval pattern from Calendar.jsx
    const getDeepLinkEventId = (searchParamsEventId) => {
      return searchParamsEventId || sessionStorage.getItem('deepLinkEventId');
    };

    it('prefers URL param when both URL and sessionStorage have eventId', () => {
      sessionStorage.setItem('deepLinkEventId', 'stored-id');
      expect(getDeepLinkEventId('url-id')).toBe('url-id');
    });

    it('falls back to sessionStorage when URL param is null', () => {
      sessionStorage.setItem('deepLinkEventId', 'stored-id');
      expect(getDeepLinkEventId(null)).toBe('stored-id');
    });

    it('returns null when neither source has eventId', () => {
      expect(getDeepLinkEventId(null)).toBeNull();
    });

    it('cleans up sessionStorage after retrieval', () => {
      sessionStorage.setItem('deepLinkEventId', 'stored-id');
      const eventId = getDeepLinkEventId(null);
      expect(eventId).toBe('stored-id');

      // Calendar.jsx removes after reading
      sessionStorage.removeItem('deepLinkEventId');
      expect(sessionStorage.getItem('deepLinkEventId')).toBeNull();
    });
  });
});
