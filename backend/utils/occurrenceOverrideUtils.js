/**
 * Occurrence Override Utilities
 *
 * Shared helpers for building per-occurrence override fields and atomically
 * applying them to the occurrenceOverrides array on a series master document.
 *
 * Used by: draft save, admin save, and publish-edit occurrence branches.
 */

const { ObjectId } = require('mongodb');

/**
 * Build the overrideFields object from a flat dict of changed values.
 *
 * Callers are responsible for resolving locations to ObjectIds and display names
 * before passing them in. This function only maps known fields.
 *
 * @param {string} dateKey - ISO date string (YYYY-MM-DD)
 * @param {Object} changes - Flat dict of changed values (field -> value).
 *   Locations should be passed as `requestedRooms` or `locations` (array of IDs).
 * @param {Object} [options]
 * @param {Array} [options.locationDocs] - Pre-resolved location documents for display name generation
 * @returns {Object} overrideFields object with occurrenceDate set
 */
function buildOccurrenceOverrideFields(dateKey, changes, { locationDocs = [] } = {}) {
  const overrideFields = { occurrenceDate: dateKey };

  // Time fields
  if (changes.startTime !== undefined) {
    overrideFields.startTime = changes.startTime;
    overrideFields.startDateTime = changes.startTime ? `${dateKey}T${changes.startTime}` : null;
  }
  if (changes.endTime !== undefined) {
    overrideFields.endTime = changes.endTime;
    overrideFields.endDateTime = changes.endTime ? `${dateKey}T${changes.endTime}` : null;
  }

  // Text fields
  if (changes.eventTitle !== undefined) overrideFields.eventTitle = changes.eventTitle?.trim();
  if (changes.eventDescription !== undefined) overrideFields.eventDescription = changes.eventDescription;

  // Scheduling fields
  if (changes.setupTime !== undefined) overrideFields.setupTime = changes.setupTime;
  if (changes.teardownTime !== undefined) overrideFields.teardownTime = changes.teardownTime;
  if (changes.reservationStartTime !== undefined) overrideFields.reservationStartTime = changes.reservationStartTime;
  if (changes.reservationEndTime !== undefined) overrideFields.reservationEndTime = changes.reservationEndTime;
  if (changes.doorOpenTime !== undefined) overrideFields.doorOpenTime = changes.doorOpenTime;
  if (changes.doorCloseTime !== undefined) overrideFields.doorCloseTime = changes.doorCloseTime;

  // Category/service fields
  if (changes.categories !== undefined || changes.mecCategories !== undefined) {
    overrideFields.categories = changes.categories || changes.mecCategories;
  }
  if (changes.services !== undefined) overrideFields.services = changes.services;
  if (changes.assignedTo !== undefined) overrideFields.assignedTo = changes.assignedTo;

  // Location fields
  const rawLocations = changes.requestedRooms || changes.locations;
  if (rawLocations !== undefined) {
    if (Array.isArray(rawLocations) && rawLocations.length > 0) {
      const locationIds = rawLocations.map(lid =>
        typeof lid === 'string' && lid.length === 24 ? new ObjectId(lid) : lid
      );
      overrideFields.locations = locationIds;

      if (locationDocs.length > 0) {
        const displayNames = locationDocs
          .map(loc => loc.displayName || loc.name || '')
          .filter(Boolean)
          .join('; ');
        if (displayNames) {
          overrideFields.locationDisplayNames = displayNames;
        }
      }
    } else {
      overrideFields.locations = [];
      overrideFields.locationDisplayNames = '';
    }
  }

  // Offsite fields
  if (changes.isOffsite !== undefined) overrideFields.isOffsite = changes.isOffsite;
  if (changes.offsiteName !== undefined) overrideFields.offsiteName = changes.offsiteName;
  if (changes.offsiteAddress !== undefined) overrideFields.offsiteAddress = changes.offsiteAddress;

  // Additional trackable fields
  if (changes.attendeeCount !== undefined) overrideFields.attendeeCount = changes.attendeeCount;
  if (changes.eventNotes !== undefined) overrideFields.eventNotes = changes.eventNotes;
  if (changes.setupNotes !== undefined) overrideFields.setupNotes = changes.setupNotes;
  if (changes.doorNotes !== undefined) overrideFields.doorNotes = changes.doorNotes;
  if (changes.specialRequirements !== undefined) overrideFields.specialRequirements = changes.specialRequirements;

  return overrideFields;
}

/**
 * Atomically apply an occurrence override to the occurrenceOverrides array.
 *
 * Handles $pull (remove existing), $push (add new), and mirrors into
 * calendarData.occurrenceOverrides. Returns the final document.
 *
 * @param {Collection} collection - MongoDB collection
 * @param {ObjectId} eventId - The event document _id
 * @param {Array|null} existingOverrides - Current occurrenceOverrides value (for null-safety guard)
 * @param {Object} overrideFields - The override object to apply (must include occurrenceDate)
 * @param {Object} [metadata] - Additional $set fields (e.g., lastModifiedDateTime, lastModifiedBy)
 * @returns {Object} The final document after all updates
 */
async function applyOccurrenceOverride(collection, eventId, existingOverrides, overrideFields, metadata = {}) {
  const dateKey = overrideFields.occurrenceDate;

  if (Array.isArray(existingOverrides)) {
    // Compute the post-push array in memory for the calendarData mirror
    // (avoids an extra findOne round-trip)
    const postPushArray = existingOverrides
      .filter(o => o.occurrenceDate !== dateKey)
      .concat(overrideFields);

    // $pull and $push on the same path can't be in one op (MongoDB constraint)
    await collection.updateOne(
      { _id: eventId },
      { $pull: { occurrenceOverrides: { occurrenceDate: dateKey } } }
    );
    await collection.updateOne(
      { _id: eventId },
      {
        $push: { occurrenceOverrides: overrideFields },
        $set: {
          'calendarData.occurrenceOverrides': postPushArray,
          ...metadata
        }
      }
    );
  } else {
    // Initialize as array with the new override (handles null/undefined)
    await collection.updateOne(
      { _id: eventId },
      {
        $set: {
          occurrenceOverrides: [overrideFields],
          'calendarData.occurrenceOverrides': [overrideFields],
          ...metadata
        }
      }
    );
  }

  return collection.findOne({ _id: eventId });
}

/**
 * Validate that a dateKey falls within a series range (or is an addition date).
 *
 * @param {string} dateKey - ISO date string (YYYY-MM-DD)
 * @param {Object} recurrence - The recurrence object from the event
 * @returns {{ valid: boolean, error?: string }}
 */
function validateOccurrenceDateInRange(dateKey, recurrence) {
  const recRange = recurrence?.range;
  const additions = recurrence?.additions || [];
  if (recRange?.endDate && (dateKey < recRange.startDate || dateKey > recRange.endDate) && !additions.includes(dateKey)) {
    return { valid: false, error: 'Occurrence date is outside series range' };
  }
  return { valid: true };
}

module.exports = {
  buildOccurrenceOverrideFields,
  applyOccurrenceOverride,
  validateOccurrenceDateInRange
};
