import { useState, useEffect } from 'react';

const PHONE_QUERY = '(max-width: 480px)';
const TABLET_QUERY = '(min-width: 481px) and (max-width: 1024px)';

/**
 * Returns the current device type based on viewport width.
 * Reactively updates on resize and orientation change via matchMedia listeners.
 *
 * @returns {'phone' | 'tablet' | 'desktop'}
 */
export function useDeviceType() {
  const [deviceType, setDeviceType] = useState(() => {
    if (typeof window === 'undefined') return 'desktop';
    if (window.matchMedia(PHONE_QUERY).matches) return 'phone';
    if (window.matchMedia(TABLET_QUERY).matches) return 'tablet';
    return 'desktop';
  });

  useEffect(() => {
    const phoneMedia = window.matchMedia(PHONE_QUERY);
    const tabletMedia = window.matchMedia(TABLET_QUERY);

    const update = () => {
      if (phoneMedia.matches) setDeviceType('phone');
      else if (tabletMedia.matches) setDeviceType('tablet');
      else setDeviceType('desktop');
    };

    phoneMedia.addEventListener('change', update);
    tabletMedia.addEventListener('change', update);

    return () => {
      phoneMedia.removeEventListener('change', update);
      tabletMedia.removeEventListener('change', update);
    };
  }, []);

  return deviceType;
}
