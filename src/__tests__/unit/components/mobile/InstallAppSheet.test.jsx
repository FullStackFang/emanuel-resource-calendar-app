// src/__tests__/unit/components/mobile/InstallAppSheet.test.jsx
//
// One sheet, four contents. The product requirement is that an iPhone and an
// Android phone look the same, so the chrome — app mark, title, numbered step
// pills, two-button row — is asserted identical across ALL four platforms in
// its own test. That case is what stops a future "just this once" per-platform
// tweak from quietly turning one feature into four unrelated screens.
//
// Only the subtitle, the steps, and the primary label are allowed to vary.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import InstallAppSheet from '../../../../components/mobile/InstallAppSheet';

const PLATFORMS = ['prompt', 'ios-safari', 'ios-other', 'manual'];

function renderSheet(props = {}) {
  const onClose = vi.fn();
  const promptInstall = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <InstallAppSheet
      isOpen
      platform="prompt"
      onClose={onClose}
      promptInstall={promptInstall}
      {...props}
    />
  );
  return { ...utils, onClose, promptInstall };
}

describe('InstallAppSheet — shared chrome', () => {
  it('IAS-1: renders nothing when closed', () => {
    const { container } = render(
      <InstallAppSheet isOpen={false} platform="prompt" onClose={vi.fn()} promptInstall={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each(PLATFORMS)('IAS-2: %s gets the identical title, mark and button row', (platform) => {
    renderSheet({ platform });

    expect(screen.getByText('Install Temple Events')).toBeInTheDocument();
    expect(screen.getByTestId('install-sheet-mark')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /not now/i })).toBeInTheDocument();
    expect(screen.getByTestId('install-sheet-primary')).toBeInTheDocument();

    // Numbered pills, not bullets — the step list is the shared layout.
    const steps = within(screen.getByTestId('install-sheet-steps')).getAllByRole('listitem');
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps[0]).toHaveTextContent('1');
  });

  it.each(PLATFORMS)('IAS-3: %s dismisses through Not now with no side effects', (platform) => {
    const { onClose, promptInstall } = renderSheet({ platform });

    fireEvent.click(screen.getByRole('button', { name: /not now/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(promptInstall).not.toHaveBeenCalled();
  });

  it('IAS-4: the scrim dismisses too', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByTestId('install-sheet-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('InstallAppSheet — per-platform content', () => {
  it('IAS-5: prompt explains two taps and hands off to the browser', async () => {
    const { promptInstall, onClose } = renderSheet({ platform: 'prompt' });

    expect(screen.getByText(/two taps/i)).toBeInTheDocument();
    const steps = within(screen.getByTestId('install-sheet-steps')).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[1]).toHaveTextContent(/confirm in your phone's dialog/i);

    const primary = screen.getByTestId('install-sheet-primary');
    expect(primary).toHaveTextContent('Install');

    fireEvent.click(primary);
    expect(promptInstall).toHaveBeenCalledTimes(1);
    // The OS dialog is the next thing the user sees; our sheet gets out of the
    // way rather than sitting behind it.
    expect(onClose).toHaveBeenCalled();
  });

  it('IAS-6: ios-safari prints the Share -> Add to Home Screen -> Add steps', () => {
    const { promptInstall } = renderSheet({ platform: 'ios-safari' });

    expect(screen.getByText(/three taps in safari/i)).toBeInTheDocument();
    const steps = within(screen.getByTestId('install-sheet-steps')).getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent(/share/i);
    expect(steps[1]).toHaveTextContent(/add to home screen/i);
    expect(steps[2]).toHaveTextContent(/add/i);

    const primary = screen.getByTestId('install-sheet-primary');
    expect(primary).toHaveTextContent('Got it');
    fireEvent.click(primary);
    expect(promptInstall).not.toHaveBeenCalled();
  });

  it('IAS-7: manual falls back to generic browser-menu guidance, never a dead end', () => {
    const { promptInstall } = renderSheet({ platform: 'manual' });

    expect(screen.getByText(/from your browser menu/i)).toBeInTheDocument();
    const steps = within(screen.getByTestId('install-sheet-steps')).getAllByRole('listitem');
    expect(steps).toHaveLength(2);
    expect(steps[1]).toHaveTextContent(/install|add to home screen/i);
    expect(screen.getByTestId('install-sheet-primary')).toHaveTextContent('Got it');

    fireEvent.click(screen.getByTestId('install-sheet-primary'));
    expect(promptInstall).not.toHaveBeenCalled();
  });
});

describe('InstallAppSheet — ios-other copies the link', () => {
  let writeText;
  let originalClipboard;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });
  });

  it('IAS-8: says Safari is required and copies the page URL', async () => {
    const { promptInstall } = renderSheet({ platform: 'ios-other' });

    expect(screen.getByText(/safari required on iphone/i)).toBeInTheDocument();
    const primary = screen.getByTestId('install-sheet-primary');
    expect(primary).toHaveTextContent('Copy link');

    fireEvent.click(primary);

    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(promptInstall).not.toHaveBeenCalled();
    // The remaining steps happen in another app, so the instructions stay up.
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it('IAS-9: a clipboard that rejects leaves the sheet usable', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const { onClose } = renderSheet({ platform: 'ios-other' });

    fireEvent.click(screen.getByTestId('install-sheet-primary'));

    expect(await screen.findByText(/couldn't copy/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
