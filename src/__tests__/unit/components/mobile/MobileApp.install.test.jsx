// src/__tests__/unit/components/mobile/MobileApp.install.test.jsx
//
// MobileApp is the single owner of the install affordance (design D9): two
// triggers — the header menu entry and the one-time nudge — resolve to ONE
// action. This suite locks what that action resolves to.
//
// The original D3 sent every platform through InstallAppSheet, including
// Android, buying a flow that read identically on both platforms at the cost of
// an extra tap. That trade is now reversed: where the browser can really
// install, tapping Install App fires the browser's own dialog immediately and
// our sheet never appears. The sheet survives for the platforms that have
// nothing to fire — iOS, and any browser that withheld beforeinstallprompt.
//
// The branch is on `canPrompt`, NOT on a user-agent test. A browser that can
// install gets the dialog whatever its UA claims; that is what keeps this out
// of the business of tracking browsers.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileApp from '../../../../components/mobile/MobileApp';
import { NUDGE_DONE_KEY, VISIT_COUNT_KEY } from '../../../../utils/pwaInstall';

const promptInstall = vi.fn();
let installState;

vi.mock('../../../../hooks/usePwaInstall', () => ({
  usePwaInstall: () => ({ ...installState, promptInstall }),
}));

vi.mock('../../../../hooks/usePermissions', () => ({
  usePermissions: () => ({ canApproveReservations: false }),
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ apiToken: 'test-token' }),
}));

vi.mock('@azure/msal-react', () => ({
  useMsal: () => ({
    instance: { logoutRedirect: vi.fn() },
    accounts: [{ name: 'Rodney Rogers', username: 'RRogers@emanuelnyc.org' }],
  }),
}));

// The tab views pull in React Query, contexts and the whole event pipeline.
// Nothing in this suite touches them.
vi.mock('../../../../components/mobile/MobileCalendarTab', () => ({
  default: () => <div data-testid="calendar-tab" />,
}));
vi.mock('../../../../components/mobile/MobileRequests', () => ({
  default: () => <div data-testid="requests-tab" />,
}));

const sheet = () => screen.queryByRole('dialog', { name: /install temple events/i });
const menuEntry = () => screen.queryByRole('button', { name: /install app/i });

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /user menu/i }));
}

describe('MobileApp install action', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    promptInstall.mockClear();
    installState = { isAvailable: true, canPrompt: true, platform: 'prompt' };
  });

  /** Makes this render count as the second signed-in session, so the nudge shows. */
  function seedSecondVisit() {
    window.localStorage.setItem(VISIT_COUNT_KEY, '1');
  }

  it('MAI-1: menu entry installs directly when the browser can prompt', () => {
    render(<MobileApp />);
    openMenu();

    fireEvent.click(menuEntry());

    expect(promptInstall).toHaveBeenCalledTimes(1);
    // The browser's own dialog is the next thing on screen. Ours must not be.
    expect(sheet()).not.toBeInTheDocument();
  });

  it('MAI-2: menu entry opens the instruction sheet when there is nothing to fire', () => {
    installState = { isAvailable: true, canPrompt: false, platform: 'ios-safari' };
    render(<MobileApp />);
    openMenu();

    fireEvent.click(menuEntry());

    expect(promptInstall).not.toHaveBeenCalled();
    expect(sheet()).toBeInTheDocument();
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
  });

  it('MAI-3: the nudge takes the same direct path', () => {
    seedSecondVisit();
    render(<MobileApp />);

    fireEvent.click(
      screen.getByRole('button', { name: /^install$/i })
    );

    expect(promptInstall).toHaveBeenCalledTimes(1);
    expect(sheet()).not.toBeInTheDocument();
  });

  it('MAI-4: the nudge falls back to the sheet on a platform that cannot prompt', () => {
    installState = { isAvailable: true, canPrompt: false, platform: 'ios-safari' };
    seedSecondVisit();
    render(<MobileApp />);

    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    expect(promptInstall).not.toHaveBeenCalled();
    expect(sheet()).toBeInTheDocument();
  });

  it('MAI-5: a dismissed dialog leaves the entry reachable, now via the sheet', () => {
    // consumeDeferredPrompt is single-use: after a dismissal canPrompt flips
    // false and detectPlatform reports 'manual'. The entry must still work.
    const { rerender } = render(<MobileApp />);
    openMenu();
    fireEvent.click(menuEntry());
    expect(promptInstall).toHaveBeenCalledTimes(1);

    installState = { isAvailable: true, canPrompt: false, platform: 'manual' };
    rerender(<MobileApp />);
    openMenu();
    fireEvent.click(menuEntry());

    expect(promptInstall).toHaveBeenCalledTimes(1);
    expect(sheet()).toBeInTheDocument();
    expect(screen.getByText(/from your browser menu/i)).toBeInTheDocument();
  });

  it('MAI-6: nothing is offered once the app is installed or running standalone', () => {
    installState = { isAvailable: false, canPrompt: false, platform: 'manual' };
    seedSecondVisit();
    render(<MobileApp />);
    openMenu();

    expect(menuEntry()).not.toBeInTheDocument();
    expect(screen.queryByTestId('install-nudge')).not.toBeInTheDocument();
  });

  it('MAI-7: a retired nudge does not reappear, and the menu entry is unaffected', () => {
    window.localStorage.setItem(NUDGE_DONE_KEY, 'true');
    seedSecondVisit();
    render(<MobileApp />);

    expect(screen.queryByTestId('install-nudge')).not.toBeInTheDocument();
    openMenu();
    expect(menuEntry()).toBeInTheDocument();
  });
});
