'use strict';

const { ObjectId } = require('mongodb');
const { calculateLocationDisplayNames } = require('./locationUtils');

/**
 * Canonical list of fields that belong inside calendarData.
 * All write paths and remapToCalendarData use this to decide which
 * keys get nested under calendarData.* vs stored at top level.
 */
const CALENDAR_DATA_FIELDS = [
  'eventTitle', 'eventDescription',
  'startDateTime', 'endDateTime', 'startDate', 'startTime', 'endDate', 'endTime',
  'isAllDayEvent',
  'setupTime', 'teardownTime', 'setupTimeMinutes', 'teardownTimeMinutes',
  'reservationStartTime', 'reservationEndTime', 'reservationStartMinutes', 'reservationEndMinutes',
  'doorOpenTime', 'doorCloseTime',
  'setupNotes', 'doorNotes', 'eventNotes',
  'locations', 'locationDisplayNames', 'location',
  'isOffsite', 'offsiteName', 'offsiteAddress', 'offsiteLat', 'offsiteLon',
  'virtualMeetingUrl', 'virtualPlatform',
  'categories', 'mecCategories', 'services', 'assignedTo',
  'eventSeriesId', 'seriesLength', 'seriesIndex',
  'attendeeCount', 'specialRequirements',
  'contactName', 'contactEmail', 'isOnBehalfOf', 'reviewNotes',
  'organizerName', 'organizerPhone', 'organizerEmail',
  'occurrenceOverrides',
  'requiredFeatures'
];

// O(1) membership test — used by remapToCalendarData
const CALENDAR_DATA_FIELDS_SET = new Set(CALENDAR_DATA_FIELDS);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an array of location IDs to MongoDB ObjectIds.
 * Strings are converted; existing ObjectIds pass through; invalid values kept as-is.
 * @param {Array} ids
 * @returns {Array<ObjectId>}
 */
function normalizeLocationIds(ids) {
  if (!ids || !Array.isArray(ids) || ids.length === 0) return [];
  return ids.map(id => {
    try {
      return typeof id === 'string' ? new ObjectId(id) : id;
    } catch {
      return id;
    }
  });
}


/**
 * Compute startDateTime/endDateTime and their date/time components.
 *
 * Handles three input strategies:
 *   1. Provided ISO datetime (Z-stripped)
 *   2. Constructed from date + time parts
 *   3. null (valid for drafts without dates)
 *
 * Respects [Hold] detection: when eventStartTime/eventEndTime is explicitly
 * provided (even as empty string), that value is used for startTime/endTime.
 * An empty string signals "user did not provide event times" and causes
 * buildGraphSubject to add [Hold] prefix.
 */
function computeDateTimes(body) {
  const result = {};

  // --- startDateTime ---
  if (body.startDateTime) {
    result.startDateTime = String(body.startDateTime).replace(/Z$/, '');
  } else if (body.startDate) {
    const time = body.startTime || body.reservationStartTime || '00:00';
    result.startDateTime = `${body.startDate}T${time}:00`;
  } else {
    result.startDateTime = null;
  }

  // --- endDateTime ---
  if (body.endDateTime) {
    result.endDateTime = String(body.endDateTime).replace(/Z$/, '');
  } else if (body.endDate) {
    const time = body.endTime || body.reservationEndTime || '23:59';
    result.endDateTime = `${body.endDate}T${time}:00`;
  } else {
    result.endDateTime = null;
  }

  // --- startDate ---
  if (body.startDate !== undefined) {
    result.startDate = body.startDate || null;
  } else if (result.startDateTime) {
    result.startDate = result.startDateTime.split('T')[0];
  } else {
    result.startDate = null;
  }

  // --- startTime (with [Hold] detection) ---
  if (body.eventStartTime !== undefined) {
    // Explicit eventStartTime: preserve empty string (signals [Hold])
    result.startTime = body.eventStartTime || '';
  } else if (body.startTime !== undefined) {
    result.startTime = body.startTime || null;
  } else if (result.startDateTime) {
    result.startTime = result.startDateTime.split('T')[1]?.substring(0, 5) || null;
  } else {
    result.startTime = null;
  }

  // --- endDate ---
  if (body.endDate !== undefined) {
    result.endDate = body.endDate || null;
  } else if (result.endDateTime) {
    result.endDate = result.endDateTime.split('T')[0];
  } else {
    result.endDate = null;
  }

  // --- endTime (with [Hold] detection) ---
  if (body.eventEndTime !== undefined) {
    result.endTime = body.eventEndTime || '';
  } else if (body.endTime !== undefined) {
    result.endTime = body.endTime || null;
  } else if (result.endDateTime) {
    result.endTime = result.endDateTime.split('T')[1]?.substring(0, 5) || null;
  } else {
    result.endTime = null;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Primary builder
// ---------------------------------------------------------------------------

/**
 * Build the calendarData fields and top-level fields for an event document.
 *
 * Two modes:
 *   mode='create' — returns a full calendarData object for insertOne()
 *   mode='update' — returns dot-notation $set keys for updateOne()
 *
 * Does NOT handle: validation, status transitions, Graph API, email,
 * conflict detection, OCC, audit logging, eventId generation, _version.
 *
 * @param {Object} body - Raw request body fields
 * @param {import('mongodb').Db} db - MongoDB db instance (for location lookup)
 * @param {Object} [options]
 * @param {'create'|'update'} [options.mode='create']
 * @param {boolean} [options.skipLocationResolution=false] - Skip async location
 *   display name lookup (endpoint 6 defers this to publish time)
 * @returns {Promise<{
 *   calendarDataDoc?: Object,
 *   calendarDataFields?: Object,
 *   topLevelFields: Object
 * }>}
 */
async function buildEventFields(body, db, options = {}) {
  const { mode = 'create', skipLocationResolution = false } = options;

  // --- Location resolution ---
  const rawRooms = body.requestedRooms || body.locations || [];
  const normalizedLocations = normalizeLocationIds(rawRooms);
  const isOffsite = body.isOffsite || false;

  let locationDisplayNames = '';
  let locations = [];

  if (isOffsite && body.offsiteName) {
    locationDisplayNames = body.offsiteAddress
      ? `${body.offsiteName} (Offsite) - ${body.offsiteAddress}`
      : `${body.offsiteName} (Offsite)`;
    locations = [];
  } else if (normalizedLocations.length > 0 && !skipLocationResolution) {
    locationDisplayNames = await calculateLocationDisplayNames(normalizedLocations, db);
    locations = normalizedLocations;
  } else if (normalizedLocations.length > 0) {
    // skipLocationResolution: store room IDs but defer display name computation
    locationDisplayNames = '';
    locations = normalizedLocations;
  } else {
    locationDisplayNames = '';
    locations = [];
  }

  // --- DateTime computation ---
  const dateTimes = computeDateTimes(body);

  // --- Categories (accept either field name) ---
  const categories = body.categories || body.mecCategories || [];

  // --- On-behalf-of ---
  const isOnBehalfOf = body.isOnBehalfOf || false;

  // --- Full calendarData field set ---
  const calendarFields = {
    eventTitle: typeof body.eventTitle === 'string' ? body.eventTitle.trim() : (body.eventTitle || ''),
    eventDescription: body.eventDescription || '',
    startDateTime: dateTimes.startDateTime,
    endDateTime: dateTimes.endDateTime,
    startDate: dateTimes.startDate,
    startTime: dateTimes.startTime,
    endDate: dateTimes.endDate,
    endTime: dateTimes.endTime,
    isAllDayEvent: body.isAllDayEvent || false,
    setupTime: body.setupTime || null,
    teardownTime: body.teardownTime || null,
    doorOpenTime: body.doorOpenTime || null,
    doorCloseTime: body.doorCloseTime || null,
    setupTimeMinutes: parseInt(body.setupTimeMinutes) || 0,
    teardownTimeMinutes: parseInt(body.teardownTimeMinutes) || 0,
    reservationStartTime: body.reservationStartTime || null,
    reservationEndTime: body.reservationEndTime || null,
    reservationStartMinutes: parseInt(body.reservationStartMinutes) || 0,
    reservationEndMinutes: parseInt(body.reservationEndMinutes) || 0,
    setupNotes: body.setupNotes || '',
    doorNotes: body.doorNotes || '',
    eventNotes: body.eventNotes || '',
    locations,
    locationDisplayNames,
    isOffsite,
    offsiteName: isOffsite ? (body.offsiteName || '') : '',
    offsiteAddress: isOffsite ? (body.offsiteAddress || '') : '',
    offsiteLat: isOffsite ? (body.offsiteLat || null) : null,
    offsiteLon: isOffsite ? (body.offsiteLon || null) : null,
    attendeeCount: body.attendeeCount != null ? body.attendeeCount : null,
    specialRequirements: body.specialRequirements || '',
    categories,
    services: body.services || {},
    assignedTo: body.assignedTo || '',
    virtualMeetingUrl: body.virtualMeetingUrl || null,
    virtualPlatform: body.virtualPlatform || null,
    occurrenceOverrides: body.occurrenceOverrides || [],
    requiredFeatures: body.requiredFeatures || [],
    isOnBehalfOf,
    contactName: isOnBehalfOf ? (body.contactName || '') : '',
    contactEmail: isOnBehalfOf ? (body.contactEmail || '') : '',
    organizerName: body.organizerName || '',
    organizerPhone: body.organizerPhone || '',
    organizerEmail: body.organizerEmail || '',
  };

  // --- Top-level fields ---
  const recurrence = body.recurrence || null;
  const topLevelFields = {
    isAllowedConcurrent: body.isAllowedConcurrent || false,
    allowedConcurrentCategories: normalizeLocationIds(
      body.allowedConcurrentCategories
    ),
    eventType: (recurrence?.pattern && recurrence?.range)
      ? 'seriesMaster'
      : 'singleInstance',
    // Top-level recurrence copy (Calendar.jsx reads top-level recurrence for expansion)
    recurrence,
  };

  if (mode === 'create') {
    return { calendarDataDoc: calendarFields, topLevelFields };
  }

  // --- mode='update': convert to dot-notation $set keys ---
  const calendarDataFields = {};
  for (const [key, value] of Object.entries(calendarFields)) {
    calendarDataFields[`calendarData.${key}`] = value;
  }

  return { calendarDataFields, topLevelFields };
}

// ---------------------------------------------------------------------------
// Remap helper for admin save endpoint
// ---------------------------------------------------------------------------

/**
 * Remap flat updateOperations through CALENDAR_DATA_FIELDS into dot-notation
 * calendarData.* keys. Also handles dateTime derivation and location
 * ObjectId normalization — replicating the inline loop logic from the
 * admin save endpoint.
 *
 * Used by PUT /api/admin/events/:id (Phase 7) to replace its inline
 * CALENDAR_DATA_FIELDS remapping loop.
 *
 * @param {Object} updateOperations - Flat field→value map
 * @returns {Object} Remapped operations with calendarData.* keys
 */
function remapToCalendarData(updateOperations) {
  const result = {};

  for (const [field, value] of Object.entries(updateOperations)) {
    // Location fields get special handling — skip the general branch
    if (field === 'locations' || field === 'requestedRooms') {
      const normalizedLocations = normalizeLocationIds(value);
      result['calendarData.locations'] = normalizedLocations;
      result['roomReservationData.requestedRooms'] = normalizedLocations;
    } else if (CALENDAR_DATA_FIELDS_SET.has(field)) {
      result[`calendarData.${field}`] = value;
    } else {
      result[field] = value;
    }

    // Derive startDate/startTime from startDateTime (unless explicitly provided)
    if (field === 'startDateTime' && value) {
      const cleanValue = String(value).replace(/Z$/, '');
      result['calendarData.startDate'] = cleanValue.split('T')[0];
      if (!('startTime' in updateOperations)) {
        result['calendarData.startTime'] = cleanValue.split('T')[1]?.substring(0, 5) || '';
      }
    }
    if (field === 'endDateTime' && value) {
      const cleanValue = String(value).replace(/Z$/, '');
      result['calendarData.endDate'] = cleanValue.split('T')[0];
      if (!('endTime' in updateOperations)) {
        result['calendarData.endTime'] = cleanValue.split('T')[1]?.substring(0, 5) || '';
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Secondary builders
// ---------------------------------------------------------------------------

/**
 * Build the canonical roomReservationData.requestedBy object and contactPerson.
 *
 * @param {Object} body - { phone, isOnBehalfOf, contactName, contactEmail, requesterName }
 * @param {string} userId
 * @param {string} userEmail
 * @param {string} effectiveDepartment
 * @returns {{ requestedBy: Object, contactPerson: Object|null }}
 */
function buildRequestedByObject(body, userId, userEmail, effectiveDepartment) {
  const requestedBy = {
    userId,
    name: body.requesterName || userEmail,
    email: (userEmail || '').toLowerCase(),
    department: effectiveDepartment || '',
    phone: body.phone || '',
  };

  const contactPerson = body.isOnBehalfOf
    ? {
        name: body.contactName || '',
        email: body.contactEmail || '',
        isOnBehalfOf: true,
      }
    : null;

  return { requestedBy, contactPerson };
}

/**
 * Build a single statusHistory entry.
 *
 * @param {string} status - e.g. 'pending', 'draft', 'published'
 * @param {string} userId
 * @param {string} userEmail
 * @param {string} reason - human-readable reason
 * @returns {{ status: string, changedAt: Date, changedBy: string, changedByEmail: string, reason: string }}
 */
function buildStatusHistoryEntry(status, userId, userEmail, reason) {
  return {
    status,
    changedAt: new Date(),
    changedBy: userId,
    changedByEmail: userEmail,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildEventFields,
  buildRequestedByObject,
  buildStatusHistoryEntry,
  CALENDAR_DATA_FIELDS,
  normalizeLocationIds,
  remapToCalendarData,
  // Exported for unit testing only:
  computeDateTimes,
};
