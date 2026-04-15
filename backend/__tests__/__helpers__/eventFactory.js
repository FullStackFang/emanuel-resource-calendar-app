/**
 * Event factory for creating test events in different states
 *
 * Creates event objects matching the unified event schema in templeEvents__Events.
 */

const { ObjectId } = require('mongodb');
const { STATUS, COLLECTIONS, TEST_CALENDAR_OWNER, TEST_CALENDAR_ID } = require('./testConstants');
const { mergeDefaultsWithOverrides, EVENT_TYPE } = require('../../utils/exceptionDocumentService');

// Format a Date as local-time ISO string matching production storage format (no ms, no Z)
const pad = (n) => String(n).padStart(2, '0');
function toLocalISOString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Counter for generating unique IDs
let eventIdCounter = 1;

/**
 * Generate a unique event ID
 * @returns {string} Unique event ID
 */
function generateEventId() {
  return `test-event-${eventIdCounter++}-${Date.now()}`;
}

/**
 * Reset the event ID counter (call in beforeEach)
 */
function resetEventIdCounter() {
  eventIdCounter = 1;
}

/**
 * Create a base event object with common fields
 * @param {Object} options - Event options
 * @returns {Object} Base event object
 */
function createBaseEvent(options = {}) {
  const eventId = options.eventId || generateEventId();
  const now = new Date();
  const startDateTime = options.startDateTime || new Date(now.getTime() + 24 * 60 * 60 * 1000); // Tomorrow
  const endDateTime = options.endDateTime || new Date(startDateTime.getTime() + 60 * 60 * 1000); // 1 hour later

  return {
    _id: new ObjectId(),
    eventId,
    userId: options.userId || 'test-user',
    calendarOwner: options.calendarOwner || TEST_CALENDAR_OWNER,
    calendarId: options.calendarId || TEST_CALENDAR_ID,
    status: options.status || STATUS.DRAFT,
    isDeleted: options.isDeleted || false,

    // Top-level calendar fields
    eventTitle: options.eventTitle || `Test Event ${eventId}`,
    eventDescription: options.eventDescription || 'Test event description',
    startDateTime,
    endDateTime,
    startDate: startDateTime.toISOString().split('T')[0],
    startTime: startDateTime.toTimeString().slice(0, 5),
    endDate: endDateTime.toISOString().split('T')[0],
    endTime: endDateTime.toTimeString().slice(0, 5),
    locations: options.locations || [{ displayName: 'Room A' }],
    locationDisplayNames: options.locationDisplayNames || ['Room A'],
    categories: options.categories || ['Meeting'],
    services: options.services || [],
    assignedTo: options.assignedTo || [],

    // Timing fields (use undefined check to allow explicit null)
    setupTime: options.setupTime !== undefined ? options.setupTime : '15 minutes',
    teardownTime: options.teardownTime || null,
    reservationStartTime: options.reservationStartTime !== undefined ? options.reservationStartTime : '',
    reservationEndTime: options.reservationEndTime !== undefined ? options.reservationEndTime : '',
    doorOpenTime: options.doorOpenTime !== undefined ? options.doorOpenTime : '09:00',
    doorCloseTime: options.doorCloseTime || null,

    // Recurring event fields
    eventType: options.eventType || 'singleInstance',
    seriesMasterId: options.seriesMasterId || null,
    recurrence: options.recurrence || null,

    // Room reservation data (for reservation workflow) — use !== undefined to allow explicit null
    roomReservationData: options.roomReservationData !== undefined ? options.roomReservationData : {
      requestedBy: {
        userId: options.userId || 'test-user',
        name: options.requesterName || 'Test Requester',
        email: options.requesterEmail || 'requester@external.com',
        department: options.department || 'General',
        phone: options.phone || '555-1234',
      },
      attendees: options.attendees || 10,
      eventSetup: options.eventSetup || 'standard',
      notes: options.notes || '',
      submittedAt: options.createdAt || now,
      currentRevision: 1,
    },

    // Status history for tracking transitions
    statusHistory: options.statusHistory || [{
      status: options.status || STATUS.DRAFT,
      changedAt: options.createdAt || now,
      changedBy: options.createdBy || options.userId || 'test-user',
      changedByEmail: options.requesterEmail || 'requester@external.com',
      reason: `Event created with status: ${options.status || STATUS.DRAFT}`
    }],

    // Optimistic concurrency control
    _version: options._version || 1,

    // Metadata
    createdAt: options.createdAt || now,
    createdBy: options.createdBy || options.userId || 'test-user',
    createdByEmail: options.createdByEmail || options.requesterEmail || 'requester@external.com',
    lastModifiedDateTime: options.lastModifiedDateTime || now,
    lastModifiedBy: options.lastModifiedBy || options.userId || 'test-user',

    // calendarData structure matching production storage format
    // Production stores startDateTime/endDateTime as local-time ISO strings (no ms, no Z)
    // Must use local-time getters to avoid UTC shift on non-UTC machines
    calendarData: options.calendarData || {
      eventTitle: options.eventTitle || `Test Event ${eventId}`,
      eventDescription: options.eventDescription || 'Test event description',
      startDateTime: toLocalISOString(startDateTime),
      endDateTime: toLocalISOString(endDateTime),
      startDate: startDateTime.toISOString().split('T')[0],
      startTime: startDateTime.toTimeString().slice(0, 5),
      endDate: endDateTime.toISOString().split('T')[0],
      endTime: endDateTime.toTimeString().slice(0, 5),
      locations: options.locations || [{ displayName: 'Room A' }],
      locationDisplayNames: options.locationDisplayNames || ['Room A'],
      categories: options.categories || ['Meeting'],
      setupTime: options.setupTime !== undefined ? options.setupTime : '15 minutes',
      teardownTime: options.teardownTime || null,
      reservationStartTime: options.reservationStartTime !== undefined ? options.reservationStartTime : '',
      reservationEndTime: options.reservationEndTime !== undefined ? options.reservationEndTime : '',
      doorOpenTime: options.doorOpenTime !== undefined ? options.doorOpenTime : '09:00',
      doorCloseTime: options.doorCloseTime || null,
      attendeeCount: options.attendeeCount !== undefined ? options.attendeeCount : 10,
      setupTimeMinutes: options.setupTimeMinutes || 0,
      teardownTimeMinutes: options.teardownTimeMinutes || 0,
      reservationStartMinutes: options.reservationStartMinutes || 0,
      reservationEndMinutes: options.reservationEndMinutes || 0,
    },

    // Optional nested structures
    graphData: options.graphData || null,

    ...options,
  };
}

/**
 * Create a draft event
 * @param {Object} options - Event options
 * @returns {Object} Draft event
 */
function createDraftEvent(options = {}) {
  return createBaseEvent({
    status: STATUS.DRAFT,
    ...options,
  });
}

/**
 * Create a pending reservation event
 * @param {Object} options - Event options
 * @returns {Object} Pending event
 */
function createPendingEvent(options = {}) {
  return createBaseEvent({
    status: STATUS.PENDING,
    submittedAt: options.submittedAt || new Date(),
    ...options,
  });
}

/**
 * Create a published event
 * @param {Object} options - Event options
 * @returns {Object} Published event
 */
function createPublishedEvent(options = {}) {
  return createBaseEvent({
    status: STATUS.PUBLISHED,
    publishedAt: options.publishedAt || new Date(),
    publishedBy: options.publishedBy || 'approver@emanuelnyc.org',
    ...options,
  });
}

/**
 * Create a published event with pending edit request (PUBLISHED_EDIT state)
 * @param {Object} options - Event options
 * @returns {Object} Published event with pending edit
 */
function createPublishedEventWithEditRequest(options = {}) {
  const event = createPublishedEvent(options);
  const requesterEmail = options.requesterEmail || 'requester@external.com';
  event.pendingEditRequest = options.pendingEditRequest || {
    id: `edit-req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    status: 'pending',
    requestedBy: {
      userId: options.userId || event.userId,
      email: requesterEmail,
      name: requesterEmail,
      department: '',
      phone: '',
      requestedAt: new Date(),
    },
    proposedChanges: options.proposedChanges || options.requestedChanges || {
      eventTitle: 'Updated Title',
      eventDescription: 'Updated description',
    },
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: '',
  };
  return event;
}

/**
 * Create a rejected event
 * @param {Object} options - Event options
 * @returns {Object} Rejected event
 */
function createRejectedEvent(options = {}) {
  return createBaseEvent({
    status: STATUS.REJECTED,
    rejectedAt: options.rejectedAt || new Date(),
    rejectedBy: options.rejectedBy || 'approver@emanuelnyc.org',
    rejectionReason: options.rejectionReason || 'Test rejection reason',
    ...options,
  });
}

/**
 * Create a deleted event (soft delete)
 * @param {Object} options - Event options
 * @returns {Object} Deleted event
 */
function createDeletedEvent(options = {}) {
  // Store the previous status before deletion
  const previousStatus = options.previousStatus || STATUS.PUBLISHED;
  const now = new Date();
  // Generate realistic 2-entry statusHistory (previousStatus + deleted) unless explicitly provided
  const defaultStatusHistory = [
    {
      status: previousStatus,
      changedAt: new Date(now.getTime() - 60000), // 1 minute before deletion
      changedBy: options.createdBy || options.userId || 'test-user',
      changedByEmail: options.requesterEmail || 'requester@external.com',
      reason: `Event created with status: ${previousStatus}`
    },
    {
      status: STATUS.DELETED,
      changedAt: options.deletedAt || now,
      changedBy: options.deletedBy || 'admin@emanuelnyc.org',
      changedByEmail: options.deletedBy || 'admin@emanuelnyc.org',
      reason: 'Deleted by admin'
    }
  ];
  return createBaseEvent({
    status: STATUS.DELETED,
    isDeleted: true,
    deletedAt: options.deletedAt || now,
    deletedBy: options.deletedBy || 'admin@emanuelnyc.org',
    previousStatus, // Store for restore functionality
    statusHistory: options.statusHistory !== undefined ? options.statusHistory : defaultStatusHistory,
    ...options,
  });
}

/**
 * Create a published event synced to Outlook (has graphData.id)
 * @param {Object} options - Event options
 * @returns {Object} Published event with Graph sync
 */
function createPublishedEventWithGraph(options = {}) {
  const graphId = options.graphId || `AAMkAGraph${generateEventId()}`;
  return createPublishedEvent({
    graphData: {
      id: graphId,
      iCalUId: options.iCalUId || `ical-${graphId}`,
      webLink: options.webLink || `https://outlook.office365.com/calendar/item/${graphId}`,
      changeKey: options.changeKey || 'test-change-key',
      ...options.graphData,
    },
    ...options,
  });
}

/**
 * Insert an event into the database
 * @param {Db} db - MongoDB database instance
 * @param {Object} event - Event object to insert
 * @returns {Object} Inserted event with _id
 */
async function insertEvent(db, event) {
  const result = await db.collection(COLLECTIONS.EVENTS).insertOne(event);
  return { ...event, _id: result.insertedId };
}

/**
 * Insert multiple events into the database
 * @param {Db} db - MongoDB database instance
 * @param {Array} events - Array of event objects
 * @returns {Array} Inserted events with _ids
 */
async function insertEvents(db, events) {
  if (events.length === 0) return [];
  const result = await db.collection(COLLECTIONS.EVENTS).insertMany(events);
  return events.map((event, index) => ({
    ...event,
    _id: result.insertedIds[index],
  }));
}

/**
 * Create a set of events in various states for a user
 * @param {Db} db - MongoDB database instance
 * @param {Object} user - User object (for ownership)
 * @returns {Object} Object with events in each state
 */
async function createEventSetForUser(db, user) {
  const baseOptions = {
    userId: user.odataId || user.email,
    requesterEmail: user.email,
    requesterName: user.displayName,
    createdBy: user.odataId || user.email,
  };

  const draft = createDraftEvent({ ...baseOptions, eventTitle: 'Draft Event' });
  const pending = createPendingEvent({ ...baseOptions, eventTitle: 'Pending Event' });
  const published = createPublishedEvent({ ...baseOptions, eventTitle: 'Published Event' });
  const publishedWithEdit = createPublishedEventWithEditRequest({
    ...baseOptions,
    eventTitle: 'Published With Edit',
  });
  const rejected = createRejectedEvent({ ...baseOptions, eventTitle: 'Rejected Event' });
  const deleted = createDeletedEvent({ ...baseOptions, eventTitle: 'Deleted Event' });

  const events = await insertEvents(db, [
    draft,
    pending,
    published,
    publishedWithEdit,
    rejected,
    deleted,
  ]);

  return {
    draft: events[0],
    pending: events[1],
    published: events[2],
    publishedWithEdit: events[3],
    rejected: events[4],
    deleted: events[5],
  };
}

/**
 * Find an event by ID
 * @param {Db} db - MongoDB database instance
 * @param {string|ObjectId} eventId - Event ID or _id
 * @returns {Object|null} Event document or null
 */
async function findEvent(db, eventId) {
  const query = ObjectId.isValid(eventId) && eventId.toString().length === 24
    ? { _id: new ObjectId(eventId) }
    : { eventId };
  return db.collection(COLLECTIONS.EVENTS).findOne(query);
}

/**
 * Update an event in the database
 * @param {Db} db - MongoDB database instance
 * @param {string|ObjectId} eventId - Event ID or _id
 * @param {Object} update - Update operations
 * @returns {Object} Updated event
 */
async function updateEvent(db, eventId, update) {
  const query = ObjectId.isValid(eventId) && eventId.toString().length === 24
    ? { _id: new ObjectId(eventId) }
    : { eventId };
  await db.collection(COLLECTIONS.EVENTS).updateOne(query, { $set: update });
  return findEvent(db, eventId);
}

/**
 * Create a recurring series master event
 * @param {Object} options - Event options (must include recurrence)
 * @returns {Object} Series master event
 */
function createRecurringSeriesMaster(options = {}) {
  const defaultRecurrence = {
    pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'sunday' },
    range: { type: 'endDate', startDate: '2026-03-10', endDate: '2026-06-30' },
    additions: [],
    exclusions: [],
  };
  return createBaseEvent({
    eventType: 'seriesMaster',
    recurrence: options.recurrence || defaultRecurrence,
    ...options,
  });
}

/**
 * Shared builder for exception and addition test documents.
 * Uses mergeDefaultsWithOverrides from the service to ensure test docs
 * match production field inheritance and fallback behavior.
 * @private
 */
function _buildOccurrenceTestDoc(masterEvent, occurrenceDate, data, eventType, eventIdSuffix, options = {}) {
  const masterEventId = masterEvent.eventId;
  const eventId = options.eventId || `${masterEventId}${eventIdSuffix}${occurrenceDate}`;
  const now = new Date();

  const { effectiveFields, effectiveCalendarData } = mergeDefaultsWithOverrides(masterEvent, data, occurrenceDate);

  return {
    _id: new ObjectId(),
    eventId,
    eventType,
    seriesMasterEventId: masterEventId,
    occurrenceDate,
    overrides: { ...data },

    ...effectiveFields,
    calendarData: effectiveCalendarData,

    userId: masterEvent.userId,
    calendarOwner: masterEvent.calendarOwner || TEST_CALENDAR_OWNER,
    calendarId: masterEvent.calendarId || TEST_CALENDAR_ID,
    status: options.status || masterEvent.status,
    isDeleted: options.isDeleted || false,
    roomReservationData: masterEvent.roomReservationData || null,
    graphEventId: options.graphEventId || null,
    graphData: options.graphData || null,
    _version: options._version || 1,
    statusHistory: options.statusHistory || [{
      status: options.status || masterEvent.status,
      changedAt: now,
      changedBy: masterEvent.createdBy || 'test-user',
      reason: `${eventType === EVENT_TYPE.EXCEPTION ? 'Exception' : 'Addition'} created`,
    }],
    createdAt: options.createdAt || now,
    createdBy: options.createdBy || masterEvent.createdBy || 'test-user',
    createdByEmail: options.createdByEmail || masterEvent.createdByEmail || 'requester@external.com',
    lastModifiedDateTime: options.lastModifiedDateTime || now,
    lastModifiedBy: options.lastModifiedBy || masterEvent.lastModifiedBy || 'test-user',
    ...options,
  };
}

/**
 * Create an exception document (modified single occurrence of a recurring series)
 * @param {Object} masterEvent - The series master event (from createRecurringSeriesMaster)
 * @param {string} occurrenceDate - YYYY-MM-DD date for this occurrence
 * @param {Object} overrides - Fields that differ from the master (e.g., { startTime: '14:00' })
 * @param {Object} [options] - Additional options
 * @returns {Object} Exception document
 */
function createExceptionDocument(masterEvent, occurrenceDate, overrides = {}, options = {}) {
  return _buildOccurrenceTestDoc(masterEvent, occurrenceDate, overrides, EVENT_TYPE.EXCEPTION, '-', options);
}

/**
 * Create an addition document (ad-hoc date outside the recurrence pattern)
 * @param {Object} masterEvent - The series master event
 * @param {string} occurrenceDate - YYYY-MM-DD date for this addition
 * @param {Object} [fields] - Event field values (defaults inherited from master)
 * @param {Object} [options] - Additional options
 * @returns {Object} Addition document
 */
function createAdditionDocument(masterEvent, occurrenceDate, fields = {}, options = {}) {
  return _buildOccurrenceTestDoc(masterEvent, occurrenceDate, fields, EVENT_TYPE.ADDITION, '-add-', options);
}

/**
 * Create a published event with NO owner (simulates Graph-synced or rsSched-imported events)
 * These events have no roomReservationData.requestedBy, only createdBy/createdByEmail metadata.
 * @param {Object} options - Event options
 * @returns {Object} Ownerless published event
 */
function createOwnerlessPublishedEvent(options = {}) {
  const event = createPublishedEvent({
    roomReservationData: null,
    createdByEmail: options.createdByEmail || 'system@graph-sync',
    createdBy: options.createdBy || 'graph-sync-system',
    ...options,
  });
  return event;
}

module.exports = {
  createBaseEvent,
  createDraftEvent,
  createPendingEvent,
  createPublishedEvent,
  createPublishedEventWithEditRequest,
  createPublishedEventWithGraph,
  createRejectedEvent,
  createDeletedEvent,
  createRecurringSeriesMaster,
  createExceptionDocument,
  createAdditionDocument,
  createOwnerlessPublishedEvent,
  insertEvent,
  insertEvents,
  createEventSetForUser,
  findEvent,
  updateEvent,
  generateEventId,
  resetEventIdCounter,
};
