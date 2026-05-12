import { logger } from './logger';

// Bootstrap MSAL account selection: handles a returning redirect response,
// checks for cached accounts, and falls back to silent SSO when no cached
// account exists. Returns a promise that resolves once the active account has
// been set (or it's clear none can be discovered without user interaction).
//
// Critical for email-deep-link UX: users already signed into Microsoft 365
// elsewhere in their browser (Outlook, Teams) are picked up without a sign-in
// prompt. Without ssoSilent, clicking an email link in a fresh tab would
// always render the sign-in landing — even when the user has an active M365
// session in the same browser.
export async function bootstrapMsalAccount(msalInstance) {
  try {
    await msalInstance.initialize();
    const response = await msalInstance.handleRedirectPromise();
    if (response) {
      msalInstance.setActiveAccount(response.account);
      return;
    }
    if (msalInstance.getAllAccounts().length > 0) {
      return;
    }
    try {
      const silent = await msalInstance.ssoSilent({});
      if (silent?.account) {
        msalInstance.setActiveAccount(silent.account);
      }
    } catch (err) {
      // InteractionRequiredAuthError or BrowserAuthError — no M365 session
      // reachable from this tab. User will see the sign-in landing.
      logger.debug('ssoSilent: no existing session, falling through', err?.errorCode);
    }
  } catch (error) {
    logger.error('MSAL initialization/redirect error:', error);
  }
}
