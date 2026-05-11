'use strict';

/**
 * Shared Graph /calendarView fetch helpers for CLI scripts.
 *
 * Extracted from backend/audit-rsched-reconcile.js so both that script and
 * backend/retrofit-recurrence-from-graph.js share the same paginated fetch +
 * calendar-fallback logic.
 *
 * NOTE: This module is loaded ONLY by CLI scripts. It is NOT required by
 * api-server.js or anything the running application loads.
 */

const graphApiService = require('../services/graphApiService');

const DEFAULT_CALENDAR_TIMEZONE = 'Eastern Standard Time';

/**
 * Fetch every event from /calendarView in the given window, with pagination
 * and a default-calendar fallback.
 *
 * Stored events' graphData.id often encodes a different mailbox/store prefix
 * than the calendarId in calendar-config.json. Try the user's *default*
 * calendar first; if that returns nothing AND a calendarIdHint was provided,
 * try the explicit calendar id.
 *
 * @param {string} owner - User principal name / mailbox email
 * @param {string|null} calendarIdHint - Optional calendar id to fall back to
 * @param {string} fromIso - ISO start datetime (inclusive)
 * @param {string} toIso - ISO end datetime (inclusive)
 * @param {Object} [opts]
 * @param {string} [opts.timezone='Eastern Standard Time'] - Outlook display TZ
 * @returns {Promise<{events: Array, calendarUsed: string}>}
 */
async function fetchGraphCalendarView(owner, calendarIdHint, fromIso, toIso, opts = {}) {
  const timezone = opts.timezone || DEFAULT_CALENDAR_TIMEZONE;
  const headers = { Prefer: `outlook.timezone="${timezone}"` };
  const basePath = `/users/${encodeURIComponent(owner)}`;
  const params = new URLSearchParams({
    startDateTime: fromIso,
    endDateTime: toIso,
    $top: '250',
    $select:
      'id,subject,start,end,iCalUId,seriesMasterId,type,recurrence,isCancelled',
  });

  const candidates = [
    { label: 'default', path: `${basePath}/calendar/calendarView` },
  ];
  if (calendarIdHint) {
    candidates.push({
      label: 'config-id',
      path: `${basePath}/calendars/${calendarIdHint}/calendarView`,
    });
  }

  let lastErr = null;
  for (const c of candidates) {
    try {
      let nextLink = `${c.path}?${params}`;
      let all = [];
      while (nextLink) {
        const data = await graphApiService.graphRequest(nextLink, { headers });
        all = all.concat(data.value || []);
        nextLink = data['@odata.nextLink'] || null;
      }
      if (all.length > 0 || c.label === 'default') {
        return { events: all, calendarUsed: c.label };
      }
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  return { events: [], calendarUsed: 'none' };
}

/**
 * Return true if the given Graph event is part of a recurring series.
 *
 * Catches all four shapes:
 *   - series master itself
 *   - normal occurrence
 *   - exception (occurrence with overrides)
 *   - any event with a recurrence object (defensive)
 *
 * @param {Object|null} g - Graph event
 * @returns {boolean}
 */
function isGraphEventRecurring(g) {
  if (!g) return false;
  if (g.seriesMasterId) return true;
  if (g.type === 'occurrence') return true;
  if (g.type === 'seriesMaster') return true;
  if (g.type === 'exception') return true;
  if (g.recurrence) return true;
  return false;
}

module.exports = {
  fetchGraphCalendarView,
  isGraphEventRecurring,
  DEFAULT_CALENDAR_TIMEZONE,
};
