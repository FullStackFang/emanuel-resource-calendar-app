// src/__tests__/unit/components/mobile/MobileHeader.test.jsx
//
// Locks the escape hatch out of the mobile layout: a user whose desktop
// browser misclassifies as a phone (zoom, narrow PWA window) must be able to
// reach 'Switch to Desktop View' from the avatar menu, and tapping it must
// persist the per-device 'desktop' layout preference.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileHeader from '../../../../components/mobile/MobileHeader';
import { LAYOUT_PREFERENCE_KEY } from '../../../../utils/layoutPreference';

const logoutRedirect = vi.fn();

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: { logoutRedirect },
    accounts: [{ name: 'Rodney Rogers', username: 'RRogers@emanuelnyc.org' }],
  }),
}));

describe('MobileHeader', () => {
  beforeEach(() => {
    window.localStorage.clear();
    logoutRedirect.mockClear();
  });

  function openMenu() {
    fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
  }

  it('MH-1: offers Switch to Desktop View in the avatar menu', () => {
    render(<MobileHeader />);
    openMenu();
    expect(
      screen.getByRole('button', { name: /switch to desktop view/i })
    ).toBeInTheDocument();
  });

  it('MH-2: tapping it persists the desktop layout preference for this device', () => {
    render(<MobileHeader />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /switch to desktop view/i }));

    expect(window.localStorage.getItem(LAYOUT_PREFERENCE_KEY)).toBe('desktop');
  });

  it('MH-3: sign out is untouched by the new menu item', () => {
    render(<MobileHeader />);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));

    expect(logoutRedirect).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LAYOUT_PREFERENCE_KEY)).toBeNull();
  });
});
