/**
 * Tests for MSAL account bootstrap (src/utils/msalBootstrap.js).
 *
 * The bootstrap fixes the "kept being prompted to log in even though I'm
 * signed in elsewhere" UX by attempting ssoSilent against the user's existing
 * Microsoft 365 browser session before falling through to the sign-in landing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bootstrapMsalAccount } from '../../../utils/msalBootstrap';

// Stub the logger so debug/error calls don't pollute test output
vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function makeMockMsal({ redirectResponse = null, cachedAccounts = [], silentResponse = null, silentThrows = null } = {}) {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    handleRedirectPromise: vi.fn().mockResolvedValue(redirectResponse),
    getAllAccounts: vi.fn().mockReturnValue(cachedAccounts),
    setActiveAccount: vi.fn(),
    ssoSilent: silentThrows
      ? vi.fn().mockRejectedValue(silentThrows)
      : vi.fn().mockResolvedValue(silentResponse),
  };
}

describe('bootstrapMsalAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SSO-1: when redirect returns a response, sets active account and skips ssoSilent', async () => {
    const account = { username: 'returning@example.com' };
    const instance = makeMockMsal({ redirectResponse: { account } });

    await bootstrapMsalAccount(instance);

    expect(instance.handleRedirectPromise).toHaveBeenCalledTimes(1);
    expect(instance.setActiveAccount).toHaveBeenCalledWith(account);
    expect(instance.ssoSilent).not.toHaveBeenCalled();
  });

  it('SSO-2: when accounts are already cached, skips ssoSilent (cross-tab localStorage hit)', async () => {
    const cached = { username: 'cached@example.com' };
    const instance = makeMockMsal({ redirectResponse: null, cachedAccounts: [cached] });

    await bootstrapMsalAccount(instance);

    expect(instance.getAllAccounts).toHaveBeenCalled();
    expect(instance.ssoSilent).not.toHaveBeenCalled();
    // setActiveAccount is not called here — MSAL provider auto-selects from getAllAccounts
    expect(instance.setActiveAccount).not.toHaveBeenCalled();
  });

  it('SSO-3: when no redirect and no cached account, calls ssoSilent({}) and sets active account on success', async () => {
    const silentAccount = { username: 'silent@example.com' };
    const instance = makeMockMsal({
      redirectResponse: null,
      cachedAccounts: [],
      silentResponse: { account: silentAccount },
    });

    await bootstrapMsalAccount(instance);

    expect(instance.ssoSilent).toHaveBeenCalledTimes(1);
    expect(instance.ssoSilent).toHaveBeenCalledWith({});
    expect(instance.setActiveAccount).toHaveBeenCalledWith(silentAccount);
  });

  it('SSO-4: when ssoSilent throws InteractionRequiredAuthError, error is caught and resolves cleanly', async () => {
    const interactionRequired = new Error('interaction_required');
    interactionRequired.errorCode = 'interaction_required';
    const instance = makeMockMsal({
      redirectResponse: null,
      cachedAccounts: [],
      silentThrows: interactionRequired,
    });

    // Must resolve (not throw) — the .finally(renderApp) chain in main.jsx
    // depends on this so the sign-in landing renders for unauthenticated users.
    await expect(bootstrapMsalAccount(instance)).resolves.toBeUndefined();
    expect(instance.ssoSilent).toHaveBeenCalledTimes(1);
    expect(instance.setActiveAccount).not.toHaveBeenCalled();
  });

  it('SSO-5: when ssoSilent succeeds without an account, does not call setActiveAccount', async () => {
    const instance = makeMockMsal({
      redirectResponse: null,
      cachedAccounts: [],
      silentResponse: { account: null },
    });

    await bootstrapMsalAccount(instance);

    expect(instance.ssoSilent).toHaveBeenCalledTimes(1);
    expect(instance.setActiveAccount).not.toHaveBeenCalled();
  });

  it('SSO-6: when initialize throws, error is caught and the promise still resolves', async () => {
    const instance = makeMockMsal();
    instance.initialize = vi.fn().mockRejectedValue(new Error('init failed'));

    await expect(bootstrapMsalAccount(instance)).resolves.toBeUndefined();
    // Nothing downstream should be called
    expect(instance.handleRedirectPromise).not.toHaveBeenCalled();
    expect(instance.ssoSilent).not.toHaveBeenCalled();
    expect(instance.setActiveAccount).not.toHaveBeenCalled();
  });

  it('SSO-7: when handleRedirectPromise throws, error is caught and the promise still resolves', async () => {
    const instance = makeMockMsal();
    instance.handleRedirectPromise = vi.fn().mockRejectedValue(new Error('redirect parse failed'));

    await expect(bootstrapMsalAccount(instance)).resolves.toBeUndefined();
    expect(instance.ssoSilent).not.toHaveBeenCalled();
  });
});
