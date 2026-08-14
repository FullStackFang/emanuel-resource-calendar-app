// src/__tests__/unit/components/mobile/InstallAppNudge.test.jsx
//
// The secondary half of the feature, and the expendable one. The permanent
// menu entry is what users are meant to find; this banner exists only to point
// at it once. So its rule is deliberately absolute — one showing, on the second
// signed-in session, retired forever by either button. No snooze window, no
// dismissal counter, and (crucially) nothing that could make it reappear.
//
// The storage-failure case is the one worth staring at: when persisted state
// cannot be read we cannot prove the banner has NOT already been seen, so it
// stays hidden. The menu entry degrades the other way. That asymmetry is the
// whole of design D7.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import InstallAppNudge from '../../../../components/mobile/InstallAppNudge';
import { NUDGE_DONE_KEY } from '../../../../utils/pwaInstall';

function renderNudge(props = {}) {
  const onInstall = vi.fn();
  const utils = render(
    <InstallAppNudge
      isAvailable
      isAuthenticated
      visitCount={2}
      onInstall={onInstall}
      {...props}
    />
  );
  return { ...utils, onInstall };
}

const nudge = () => screen.queryByTestId('install-nudge');

describe('InstallAppNudge', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('IAN-1: not shown during the first signed-in session', () => {
    renderNudge({ visitCount: 1 });
    expect(nudge()).not.toBeInTheDocument();
  });

  it('IAN-2: shown on the second session when nothing has been retired', () => {
    renderNudge({ visitCount: 2 });
    expect(nudge()).toBeInTheDocument();
    expect(screen.getByText(/add to your home screen/i)).toBeInTheDocument();
  });

  it('IAN-3: never shown to an unauthenticated visitor', () => {
    renderNudge({ isAuthenticated: false });
    expect(nudge()).not.toBeInTheDocument();
  });

  it('IAN-4: not shown when the affordance is unavailable (installed / standalone)', () => {
    renderNudge({ isAvailable: false });
    expect(nudge()).not.toBeInTheDocument();
  });

  it('IAN-5: not shown once it has already been retired', () => {
    window.localStorage.setItem(NUDGE_DONE_KEY, 'true');
    renderNudge();
    expect(nudge()).not.toBeInTheDocument();
  });

  it('IAN-6: Not now retires it permanently', () => {
    const { unmount } = renderNudge();

    fireEvent.click(screen.getByRole('button', { name: /not now/i }));

    expect(nudge()).not.toBeInTheDocument();
    expect(window.localStorage.getItem(NUDGE_DONE_KEY)).toBe('true');

    // A later session: same props, nothing rendered.
    unmount();
    renderNudge({ visitCount: 3 });
    expect(nudge()).not.toBeInTheDocument();
  });

  it('IAN-7: Install opens the sheet and also retires it permanently', () => {
    const { onInstall, unmount } = renderNudge();

    fireEvent.click(screen.getByRole('button', { name: /^install$/i }));

    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(NUDGE_DONE_KEY)).toBe('true');
    expect(nudge()).not.toBeInTheDocument();

    unmount();
    renderNudge({ visitCount: 4 });
    expect(nudge()).not.toBeInTheDocument();
  });

  describe('storage failure', () => {
    let getItem;

    beforeEach(() => {
      getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
    });

    afterEach(() => {
      getItem.mockRestore();
    });

    it('IAN-8: hidden when persisted state cannot be read', () => {
      renderNudge({ visitCount: 5 });
      expect(nudge()).not.toBeInTheDocument();
    });
  });

  it('IAN-9: dismissing survives an unwritable storage for the rest of the session', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });

    try {
      renderNudge();
      fireEvent.click(screen.getByRole('button', { name: /not now/i }));
      expect(nudge()).not.toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
  });
});
