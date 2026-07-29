import { useState, useEffect } from 'react';
import {
  getLayoutPreference,
  LAYOUT_PREFERENCE_KEY,
  LAYOUT_PREFERENCE_EVENT,
} from '../utils/layoutPreference';

const PHONE_QUERY = '(max-width: 480px)';
const TABLET_QUERY = '(min-width: 481px) and (max-width: 1024px)';

/**
 * Returns the current device type based on viewport width, unless the user
 * has pinned a layout via the per-device preference ('desktop' | 'mobile').
 * Reactively updates on resize/orientation change via matchMedia listeners,
 * and on preference changes from this tab or another.
 *
 * @returns {'phone' | 'tablet' | 'desktop'}
 */
export function useDeviceType() {
  const [detected, setDetected] = useState(() => {
    if (typeof window === 'undefined') return 'desktop';
    if (window.matchMedia(PHONE_QUERY).matches) return 'phone';
    if (window.matchMedia(TABLET_QUERY).matches) return 'tablet';
    return 'desktop';
  });
  const [preference, setPreference] = useState(getLayoutPreference);

  useEffect(() => {
    const phoneMedia = window.matchMedia(PHONE_QUERY);
    const tabletMedia = window.matchMedia(TABLET_QUERY);

    const update = () => {
      if (phoneMedia.matches) setDetected('phone');
      else if (tabletMedia.matches) setDetected('tablet');
      else setDetected('desktop');
    };

    phoneMedia.addEventListener('change', update);
    tabletMedia.addEventListener('change', update);

    return () => {
      phoneMedia.removeEventListener('change', update);
      tabletMedia.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    const sync = () => setPreference(getLayoutPreference());
    const syncFromOtherTab = (event) => {
      if (event.key === LAYOUT_PREFERENCE_KEY) sync();
    };

    window.addEventListener(LAYOUT_PREFERENCE_EVENT, sync);
    window.addEventListener('storage', syncFromOtherTab);

    return () => {
      window.removeEventListener(LAYOUT_PREFERENCE_EVENT, sync);
      window.removeEventListener('storage', syncFromOtherTab);
    };
  }, []);

  if (preference === 'desktop') return 'desktop';
  if (preference === 'mobile') return 'phone';
  return detected;
}
