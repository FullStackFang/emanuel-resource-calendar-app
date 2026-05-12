/**
 * Graph event payload builders — shared between the publish endpoint, the
 * republish endpoint, and the recover-untethered-publishes.js recovery script.
 *
 * The publish endpoint at api-server.js:21018-21062 originally built these
 * inline. When the republish endpoint and recovery script needed the same
 * logic, duplicating it risked divergence (a recurrence fix in one path
 * wouldn't reach the other). This util centralizes the construction so all
 * three call sites stay in lockstep.
 *
 * Each function here is a pure transform: input is a MongoDB event document
 * (or pieces of one); output is a payload ready for graphApiService.
 */

const { buildGraphRecurrence } = require('./recurrenceGraphMapping');

/**
 * Format the Graph event subject.
 * - Title with times → use title as-is.
 * - Title without times (HOLD case) → prefix with [Hold].
 *
 * This must match the publish endpoint's buildGraphSubject (api-server.js:231)
 * exactly so republish produces the same subject the original publish would have.
 */
function buildGraphSubject(title, startTime, endTime) {
  const base = title || 'Untitled Event';
  return (startTime && endTime) ? base : `[Hold] ${base}`;
}

/**
 * Build a Graph location object for off-site events. Mirrors api-server.js:2127.
 */
function buildOffsiteGraphLocation(offsiteName, offsiteAddress, offsiteLat, offsiteLon) {
  const location = {
    displayName: `${offsiteName} (Offsite) - ${offsiteAddress}`,
    locationType: 'default',
  };
  if (offsiteLat != null && offsiteLon != null) {
    location.coordinates = {
      latitude: parseFloat(offsiteLat),
      longitude: parseFloat(offsiteLon),
    };
  }
  return location;
}

/**
 * Build a full Graph event payload from a MongoDB record's current state.
 * Mirrors the publish endpoint's construction at api-server.js:21018-21062
 * but reads from already-stored calendarData (no request body involved).
 *
 * Use this whenever you need to "recreate" a Graph event that should look
 * identical to what publish would create today — used by recovery script's
 * --relink/--republish mode and the new admin republish endpoint.
 */
function buildGraphEventDataFromRecord(event) {
  const cd = event.calendarData || {};
  const isOffsite = !!cd.isOffsite;
  const rawNames = cd.locationDisplayNames || '';
  const locationDisplayNames = Array.isArray(rawNames) ? rawNames.join('; ') : rawNames;

  let graphLocation = { displayName: locationDisplayNames };
  if (isOffsite && cd.offsiteName && cd.offsiteAddress) {
    graphLocation = buildOffsiteGraphLocation(cd.offsiteName, cd.offsiteAddress, cd.offsiteLat, cd.offsiteLon);
  }

  const eventTimezone = event.graphData?.start?.timeZone || 'America/New_York';
  const graphEventData = {
    subject: buildGraphSubject(cd.eventTitle, cd.startTime, cd.endTime),
    start: { dateTime: cd.startDateTime, timeZone: eventTimezone },
    end: { dateTime: cd.endDateTime, timeZone: eventTimezone },
    location: graphLocation,
    locations: isOffsite
      ? [graphLocation]
      : locationDisplayNames.split('; ').filter(Boolean).map((name) => ({ displayName: name, locationType: 'default' })),
    body: { contentType: 'Text', content: cd.eventDescription || '' },
    categories: cd.categories || [],
    importance: 'normal',
    showAs: 'busy',
  };

  // Recurrence: align start/end date to range.startDate so Graph treats this
  // as the master occurrence (mirrors publish endpoint at api-server.js:21049-21062).
  if (event.recurrence?.pattern && event.recurrence?.range) {
    const graphRecurrence = buildGraphRecurrence(event.recurrence, eventTimezone);
    if (graphRecurrence) {
      graphEventData.recurrence = graphRecurrence;
      const rangeStart = graphRecurrence.range.startDate;
      if (rangeStart) {
        const startTime = graphEventData.start.dateTime.split('T')[1] || '00:00:00';
        const endTime = graphEventData.end.dateTime.split('T')[1] || '23:59:00';
        graphEventData.start.dateTime = `${rangeStart}T${startTime}`;
        graphEventData.end.dateTime = `${rangeStart}T${endTime}`;
      }
    }
  }

  return graphEventData;
}

module.exports = {
  buildGraphSubject,
  buildOffsiteGraphLocation,
  buildGraphEventDataFromRecord,
};
