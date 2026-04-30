// Default-calendar-selection cascade.
//
// Picks which calendar should be selected on app mount when the user has no
// active selection. The cascade exists to ensure the user lands on a TempleEvents
// shared mailbox calendar — never on their personal Outlook calendar — because the
// reservation data lives only under shared mailboxes. Falling back to a personal
// calendar produces a legitimate-looking 0-event load and a silently blank grid.
//
// Order (top-most match wins):
//   1. saved-pref       — user's previously-saved selectedCalendarOwner
//   2. admin-default    — admin-configured default from allowedConfig.defaultCalendar
//   3. app-config-default — APP_CONFIG.DEFAULT_DISPLAY_CALENDAR
//   4. first-allowed    — first calendar whose owner is in allowedDisplayCalendars
//   5. none             — no allowed calendar matched; caller should hard-fail
//                         (toast + leave selectedCalendarId null), NOT silently
//                         pick a personal calendar.
//
// Returns { calendar, reason }. `calendar` is null when reason is 'none'.

const REASON = Object.freeze({
  SAVED_PREF: 'saved-pref',
  ADMIN_DEFAULT: 'admin-default',
  APP_CONFIG_DEFAULT: 'app-config-default',
  FIRST_ALLOWED: 'first-allowed',
  NONE: 'none',
});

function ownerOf(cal) {
  return cal?.owner?.address?.toLowerCase() || null;
}

export function selectDefaultCalendar({
  calendars,
  allowedConfig,
  savedOwner,
  appConfigDefault,
} = {}) {
  if (!Array.isArray(calendars) || calendars.length === 0) {
    return { calendar: null, reason: REASON.NONE };
  }

  const lc = (s) => (typeof s === 'string' ? s.toLowerCase() : null);

  // 1. Saved preference
  const savedOwnerLc = lc(savedOwner);
  if (savedOwnerLc) {
    const match = calendars.find(c => ownerOf(c) === savedOwnerLc);
    if (match) return { calendar: match, reason: REASON.SAVED_PREF };
  }

  // 2. Admin-configured default
  const adminDefaultLc = lc(allowedConfig?.defaultCalendar);
  if (adminDefaultLc) {
    const match = calendars.find(c => ownerOf(c) === adminDefaultLc);
    if (match) return { calendar: match, reason: REASON.ADMIN_DEFAULT };
  }

  // 3. APP_CONFIG default
  const appConfigDefaultLc = lc(appConfigDefault);
  if (appConfigDefaultLc) {
    const match = calendars.find(c => ownerOf(c) === appConfigDefaultLc);
    if (match) return { calendar: match, reason: REASON.APP_CONFIG_DEFAULT };
  }

  // 4. First whitelisted calendar
  if (Array.isArray(allowedConfig?.allowedDisplayCalendars)) {
    const allowedSet = new Set(
      allowedConfig.allowedDisplayCalendars.map(s => s.toLowerCase())
    );
    if (allowedSet.size > 0) {
      const match = calendars.find(c => allowedSet.has(ownerOf(c)));
      if (match) return { calendar: match, reason: REASON.FIRST_ALLOWED };
    }
  }

  // 5. No allowed match. The caller MUST hard-fail (toast + leave selection null),
  // not silently pick `calendars[0]` or a `cal.isDefaultCalendar` candidate. Those
  // legacy fallbacks would resolve to the user's personal Outlook calendar in the
  // common case, which has no reservations in templeEvents__Events.
  return { calendar: null, reason: REASON.NONE };
}

export const SELECT_DEFAULT_CALENDAR_REASONS = REASON;
