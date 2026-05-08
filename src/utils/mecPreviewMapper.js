/**
 * Map a flat event (post-transformEventToFlatStructure) into the prop shape
 * consumed by MecEventPreview.
 *
 * Fields that don't exist in the app today (featured image, registration URL)
 * are emitted as the NOT_SET sentinel so the render component can show a
 * placeholder instead of a falsy guard. The same sentinel is used for fields
 * that exist but are empty — collectGaps() distinguishes the two via 'no-field'
 * vs 'empty' kinds for the side-rail summary.
 *
 * Tier A scope: read-only mapping; no new content fields, no WP push.
 */

export const NOT_SET = Symbol.for('mec.notSet');

export const isMissing = (value) => value === NOT_SET;

/**
 * Pick the first usable location name from either an array (preferred shape)
 * or a single string (legacy / partial fallback).
 */
function firstLocationName(locationDisplayNames) {
  if (Array.isArray(locationDisplayNames)) {
    const first = locationDisplayNames.find(name => typeof name === 'string' && name.trim());
    return first || null;
  }
  if (typeof locationDisplayNames === 'string' && locationDisplayNames.trim()) {
    return locationDisplayNames;
  }
  return null;
}

/**
 * Convert a flat event into the MEC widget props shape. NOT_SET is used for
 * any field that's missing or has no internal source.
 *
 * @param {object} event - flat event (output of transformEventToFlatStructure)
 * @returns {object} mecProps
 */
export function toMecProps(event = {}) {
  // Web override fields take precedence over inherited internal fields.
  // Empty string = inherit; non-empty = override.
  // Featured image and Register URL have no inherited internal field — only the web override drives them.
  const featuredImageUrl = event.webFeaturedImage ? event.webFeaturedImage : NOT_SET;
  const registerUrl      = event.webRegisterUrl   ? event.webRegisterUrl   : NOT_SET;

  const title       = event.webTitle       || event.eventTitle       || NOT_SET;
  const description = event.webDescription || event.eventDescription || NOT_SET;

  // Display-date semantics differ by event type:
  //   - seriesMaster: prefer recurrence.range.startDate (series span start), since
  //     the master's startDate is the FIRST occurrence's date — not what users
  //     expect to see in a "this is the public listing" preview.
  //   - occurrence / singleInstance: use the event's own startDate.
  const startDate = (() => {
    if (event.eventType === 'seriesMaster' && event.recurrence?.range?.startDate) {
      return event.recurrence.range.startDate;
    }
    return event.startDate ? event.startDate : NOT_SET;
  })();
  const startTime = event.startTime ? event.startTime : NOT_SET;
  // End fields are optional — null when absent (rendered as omitted in the preview).
  const endDate = event.endDate || null;
  const endTime = event.endTime || null;

  // Location: offsite uses the offsite* fields; onsite uses the first location display name.
  let locationName, locationAddress;
  if (event.isOffsite) {
    locationName = event.offsiteName ? event.offsiteName : NOT_SET;
    locationAddress = event.offsiteAddress ? event.offsiteAddress : NOT_SET;
  } else {
    const onsiteName = firstLocationName(event.locationDisplayNames);
    locationName = onsiteName ? onsiteName : NOT_SET;
    // Onsite address is not stored as a per-event field in v1.
    locationAddress = NOT_SET;
  }

  const categoryName = (Array.isArray(event.categories) && event.categories.length > 0)
    ? event.categories[0]
    : NOT_SET;

  return {
    featuredImageUrl,
    title,
    description,
    registerUrl,
    startDate,
    startTime,
    endDate,
    endTime,
    locationName,
    locationAddress,
    categoryName,
    eventType: event.eventType || null,        // singleInstance | seriesMaster | occurrence | null
    recurrence: event.recurrence || null,
  };
}

/**
 * Build the side-rail summary list of "what's missing" for a rendered preview.
 * Each gap is { label, kind } where kind is:
 *   - 'no-field': the app has no field for this concept yet (Tier B work)
 *   - 'empty': the app has the field but the user hasn't filled it in
 *
 * Order: no-field gaps first (Featured image, Register URL), then app-side gaps
 * in the visual order they appear in the rendered preview.
 *
 * @param {object} mecProps - output of toMecProps()
 * @returns {Array<{label: string, kind: 'no-field' | 'empty'}>}
 */
export function collectGaps(mecProps) {
  const gaps = [];

  // Web-tab editable fields — kind='empty' since the user can fill them inline.
  if (isMissing(mecProps.featuredImageUrl)) {
    gaps.push({ label: 'Featured image', kind: 'empty' });
  }
  if (isMissing(mecProps.registerUrl)) {
    gaps.push({ label: 'Register URL', kind: 'empty' });
  }
  if (isMissing(mecProps.title)) {
    gaps.push({ label: 'Title', kind: 'empty' });
  }
  if (isMissing(mecProps.description)) {
    gaps.push({ label: 'Description', kind: 'empty' });
  }

  // Read-only meta fields — kind='empty' for the missing facts.
  if (isMissing(mecProps.startDate)) {
    gaps.push({ label: 'Date', kind: 'empty' });
  }
  if (isMissing(mecProps.startTime)) {
    gaps.push({ label: 'Time', kind: 'empty' });
  }
  if (isMissing(mecProps.locationName)) {
    gaps.push({ label: 'Location', kind: 'empty' });
  } else if (isMissing(mecProps.locationAddress)) {
    // Onsite address has no field in the app — kind='no-field' marks it as a future improvement.
    gaps.push({ label: 'Venue street address', kind: 'no-field' });
  }
  if (isMissing(mecProps.categoryName)) {
    gaps.push({ label: 'Category', kind: 'empty' });
  }

  return gaps;
}
