/**
 * Conflict Snapshot Field Mapping
 *
 * Defines which fields to include in a 409 conflict response snapshot.
 * Used by conditionalUpdate() to extract current document values so the
 * frontend can show a field-level diff of what changed.
 *
 * - key: flat field name matching the frontend form state
 * - path: dot-path into the MongoDB document
 * - label: human-readable label for display
 */

const CONFLICT_SNAPSHOT_FIELDS = [
  { key: 'eventTitle', path: 'calendarData.eventTitle', label: 'Event Title' },
  { key: 'eventDescription', path: 'calendarData.eventDescription', label: 'Description' },
  { key: 'startDate', path: 'calendarData.startDate', label: 'Start Date' },
  { key: 'startTime', path: 'calendarData.startTime', label: 'Start Time' },
  { key: 'endDate', path: 'calendarData.endDate', label: 'End Date' },
  { key: 'endTime', path: 'calendarData.endTime', label: 'End Time' },
  { key: 'setupTime', path: 'calendarData.setupTime', label: 'Setup Time' },
  { key: 'teardownTime', path: 'calendarData.teardownTime', label: 'Teardown Time' },
  { key: 'doorOpenTime', path: 'calendarData.doorOpenTime', label: 'Door Open' },
  { key: 'doorCloseTime', path: 'calendarData.doorCloseTime', label: 'Door Close' },
  { key: 'locationDisplayNames', path: 'calendarData.locationDisplayNames', label: 'Location' },
  { key: 'attendeeCount', path: 'calendarData.attendeeCount', label: 'Attendees' },
  { key: 'categories', path: 'calendarData.categories', label: 'Categories' },
  { key: 'specialRequirements', path: 'calendarData.specialRequirements', label: 'Special Requirements' },
  { key: 'status', path: 'status', label: 'Status' },
];

module.exports = { CONFLICT_SNAPSHOT_FIELDS };
