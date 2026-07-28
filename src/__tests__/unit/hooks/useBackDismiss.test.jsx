// src/__tests__/unit/hooks/useBackDismiss.test.js
//
// Locks the device-Back-dismisses-the-overlay contract for the mobile shell:
//  - an open overlay parks one marker entry on the history stack
//  - a real Back press dismisses the TOPMOST overlay only
//  - closing any other way retires the marker, so back presses never go dead
//  - and that retirement must not cascade into the layer underneath
//
// The last one is the whole reason this hook is not three lines: the
// history.back() we fire on close produces a popstate indistinguishable from a
// user's, and a naive implementation closes the sheet and its lightbox together.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import useBackDismiss, { __resetBackDismissForTests } from '../../../hooks/useBackDismiss';

/** Presses the device Back button. */
function pressBack() {
  window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
}

/** Counts popstate events, including the real async ones jsdom emits for back(). */
function watchPopState() {
  const watcher = { count: 0 };
  watcher.handler = () => { watcher.count += 1; };
  window.addEventListener('popstate', watcher.handler);
  watcher.stop = () => window.removeEventListener('popstate', watcher.handler);
  return watcher;
}

function Overlay({ isOpen, onDismiss }) {
  useBackDismiss(isOpen, onDismiss);
  return null;
}

function TwoLayers({ sheetOpen, lightboxOpen, onSheetDismiss, onLightboxDismiss }) {
  useBackDismiss(sheetOpen, onSheetDismiss);
  useBackDismiss(lightboxOpen, onLightboxDismiss);
  return null;
}

describe('useBackDismiss', () => {
  beforeEach(() => {
    __resetBackDismissForTests();
  });

  // Let any history.back() queued by an unmount flush before the next test, so
  // a stray traversal can't land mid-case and look like a user pressing Back.
  afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('parks a marker on the history stack while open', () => {
    const before = window.history.length;

    render(<Overlay isOpen onDismiss={() => {}} />);

    expect(window.history.length).toBe(before + 1);
    expect(window.history.state.__overlay).toBe(1);
  });

  it('parks nothing while closed', () => {
    const before = window.history.length;

    render(<Overlay isOpen={false} onDismiss={() => {}} />);

    expect(window.history.length).toBe(before);
  });

  it('dismisses the overlay when Back is pressed', () => {
    const onDismiss = vi.fn();

    render(<Overlay isOpen onDismiss={onDismiss} />);
    pressBack();

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses only the topmost overlay, one Back press per layer', () => {
    const onSheetDismiss = vi.fn();
    const onLightboxDismiss = vi.fn();

    const { rerender } = render(
      <TwoLayers
        sheetOpen
        lightboxOpen
        onSheetDismiss={onSheetDismiss}
        onLightboxDismiss={onLightboxDismiss}
      />
    );

    pressBack();
    expect(onLightboxDismiss).toHaveBeenCalledTimes(1);
    expect(onSheetDismiss).not.toHaveBeenCalled();

    // The lightbox reacts to its dismissal by closing.
    rerender(
      <TwoLayers
        sheetOpen
        lightboxOpen={false}
        onSheetDismiss={onSheetDismiss}
        onLightboxDismiss={onLightboxDismiss}
      />
    );

    pressBack();
    expect(onSheetDismiss).toHaveBeenCalledTimes(1);
    expect(onLightboxDismiss).toHaveBeenCalledTimes(1);
  });

  it('retires its own marker when closed by something other than Back', async () => {
    const onDismiss = vi.fn();
    const popstate = watchPopState();

    const { rerender } = render(<Overlay isOpen onDismiss={onDismiss} />);
    rerender(<Overlay isOpen={false} onDismiss={onDismiss} />);

    // Closing must walk the marker back off the stack...
    await waitFor(() => expect(popstate.count).toBe(1));
    // ...without looking like the user asked to dismiss anything.
    expect(onDismiss).not.toHaveBeenCalled();

    popstate.stop();
  });

  it('does not cascade into the layer beneath when the top layer closes itself', async () => {
    const onSheetDismiss = vi.fn();
    const onLightboxDismiss = vi.fn();
    const popstate = watchPopState();

    const { rerender } = render(
      <TwoLayers
        sheetOpen
        lightboxOpen
        onSheetDismiss={onSheetDismiss}
        onLightboxDismiss={onLightboxDismiss}
      />
    );

    // Lightbox closed via its own close button / Escape — not via Back.
    rerender(
      <TwoLayers
        sheetOpen
        lightboxOpen={false}
        onSheetDismiss={onSheetDismiss}
        onLightboxDismiss={onLightboxDismiss}
      />
    );

    await waitFor(() => expect(popstate.count).toBe(1));
    expect(onSheetDismiss).not.toHaveBeenCalled();
    expect(onLightboxDismiss).not.toHaveBeenCalled();

    // The sheet still owns its marker, so Back still works on it afterwards.
    pressBack();
    expect(onSheetDismiss).toHaveBeenCalledTimes(1);

    popstate.stop();
  });

  it('leaves no dead Back presses behind after repeated open/close cycles', async () => {
    const onDismiss = vi.fn();
    const popstate = watchPopState();

    for (let i = 0; i < 3; i += 1) {
      const { rerender, unmount } = render(<Overlay isOpen onDismiss={onDismiss} />);
      rerender(<Overlay isOpen={false} onDismiss={onDismiss} />);
      await waitFor(() => expect(popstate.count).toBe(i + 1));
      unmount();
    }
    expect(onDismiss).not.toHaveBeenCalled();
    popstate.stop();

    // The regression this guards: three unretired markers would mean the user
    // has to press Back four times before a fresh overlay reacts. It must react
    // to the first press.
    render(<Overlay isOpen onDismiss={onDismiss} />);
    pressBack();

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
