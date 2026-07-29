// src/__tests__/unit/hooks/useDeviceType.test.jsx
//
// Locks the layout-preference override contract:
//  - 'auto' (the default) preserves the original width-only detection
//  - 'desktop' wins over a phone-width viewport (the "stuck in mobile" fix:
//    browser zoom, a narrow PWA window, or display scaling can all shrink the
//    CSS viewport under 480px on a real desktop)
//  - 'mobile' wins over a desktop-width viewport
//  - setLayoutPreference() flips a mounted hook in the same tab, no reload
//  - a storage event from another tab flips it too
//  - garbage in localStorage falls back to 'auto'

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDeviceType } from '../../../hooks/useDeviceType';
import {
  getLayoutPreference,
  setLayoutPreference,
  LAYOUT_PREFERENCE_KEY,
} from '../../../utils/layoutPreference';

const PHONE_QUERY = '(max-width: 480px)';
const TABLET_QUERY = '(min-width: 481px) and (max-width: 1024px)';

/**
 * Replaces the global never-matching matchMedia stub with one whose
 * matching query can be swapped mid-test (listeners are re-notified).
 */
function installMatchMedia(initialMatching) {
  let matching = initialMatching; // 'phone' | 'tablet' | 'desktop'
  const listeners = new Map(); // query -> Set<fn>

  const matchesFor = (query) => {
    if (query === PHONE_QUERY) return matching === 'phone';
    if (query === TABLET_QUERY) return matching === 'tablet';
    return false;
  };

  window.matchMedia = (query) => {
    if (!listeners.has(query)) listeners.set(query, new Set());
    return {
      get matches() {
        return matchesFor(query);
      },
      media: query,
      addEventListener: (_type, fn) => listeners.get(query).add(fn),
      removeEventListener: (_type, fn) => listeners.get(query).delete(fn),
    };
  };

  return {
    setMatching(next) {
      matching = next;
      for (const [query, fns] of listeners) {
        for (const fn of fns) fn({ matches: matchesFor(query), media: query });
      }
    },
  };
}

describe('layoutPreference', () => {
  beforeEach(() => window.localStorage.clear());

  it('defaults to auto when nothing is stored', () => {
    expect(getLayoutPreference()).toBe('auto');
  });

  it('round-trips a valid preference through localStorage', () => {
    setLayoutPreference('desktop');
    expect(window.localStorage.getItem(LAYOUT_PREFERENCE_KEY)).toBe('desktop');
    expect(getLayoutPreference()).toBe('desktop');
  });

  it('treats garbage in storage as auto', () => {
    window.localStorage.setItem(LAYOUT_PREFERENCE_KEY, 'blimp');
    expect(getLayoutPreference()).toBe('auto');
  });

  it('rejects invalid values instead of persisting them', () => {
    setLayoutPreference('desktop');
    setLayoutPreference('blimp');
    expect(getLayoutPreference()).toBe('desktop');
  });
});

describe('useDeviceType', () => {
  let media;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
    media = installMatchMedia('desktop');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('detects phone / tablet / desktop from the viewport when preference is auto', () => {
    media.setMatching('phone');
    const { result, unmount } = renderHook(() => useDeviceType());
    expect(result.current).toBe('phone');

    act(() => media.setMatching('tablet'));
    expect(result.current).toBe('tablet');

    act(() => media.setMatching('desktop'));
    expect(result.current).toBe('desktop');
    unmount();
  });

  it('forces desktop on a phone-width viewport when preference is desktop', () => {
    // Rodney's case: viewport measures <= 480 CSS px on a real computer.
    window.localStorage.setItem(LAYOUT_PREFERENCE_KEY, 'desktop');
    media.setMatching('phone');

    const { result, unmount } = renderHook(() => useDeviceType());
    expect(result.current).toBe('desktop');

    // Still pinned after a viewport change.
    act(() => media.setMatching('tablet'));
    expect(result.current).toBe('desktop');
    unmount();
  });

  it('forces phone on a desktop-width viewport when preference is mobile', () => {
    window.localStorage.setItem(LAYOUT_PREFERENCE_KEY, 'mobile');
    media.setMatching('desktop');

    const { result, unmount } = renderHook(() => useDeviceType());
    expect(result.current).toBe('phone');
    unmount();
  });

  it('flips a mounted hook when setLayoutPreference runs in the same tab', () => {
    media.setMatching('phone');
    const { result, unmount } = renderHook(() => useDeviceType());
    expect(result.current).toBe('phone');

    act(() => setLayoutPreference('desktop'));
    expect(result.current).toBe('desktop');

    act(() => setLayoutPreference('auto'));
    expect(result.current).toBe('phone');
    unmount();
  });

  it('follows a storage event from another tab', () => {
    media.setMatching('phone');
    const { result, unmount } = renderHook(() => useDeviceType());
    expect(result.current).toBe('phone');

    act(() => {
      window.localStorage.setItem(LAYOUT_PREFERENCE_KEY, 'desktop');
      window.dispatchEvent(
        new StorageEvent('storage', { key: LAYOUT_PREFERENCE_KEY, newValue: 'desktop' })
      );
    });
    expect(result.current).toBe('desktop');
    unmount();
  });
});
