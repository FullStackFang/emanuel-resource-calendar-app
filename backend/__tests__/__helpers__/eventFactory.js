/**
 * Event factory for creating test events in different states
 *
 * Creates event objects matching the unified event schema in templeEvents__Events.
 */

const { ObjectId } = require('mongodb');
const { STATUS, COLLECTIONS, TEST_CALENDAR_OWNER, TEST_CALENDAR_ID } = require('./testConstants');

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
    locations: options.locations || [],
    locationDisplayNames: options.locationDisplayNames || [],
    categories: options.categories || [],
    services: options.services || [],
    assignedTo: options.assignedTo || [],

    // Timing fields
    setupTime: options.setupTime || null,
    teardownTime: options.teardownTime || null,
    doorOpenTime: options.doorOpenTime || null,
    doorCloseTime: options.doorCloseTime || null,

    // Recurring event fields
    eventType: options.eventType || 'singleInstance',
    seriesMasterId: options.seriesMasterId || null,
    recurrence: options.recurrence || null,

    // Room reservation data (for reservation workflow)
    roomReservationData: options.roomReservationData || {
      requesterName: options.requesterName || 'Test Requester',
      requesterEmail: options.requesterEmail || 'requester@external.com',
      department: options.department || 'General',
      phone: options.phone || '555-1234',
      attendees: options.attendees || 10,
      eventSetup: options.eventSetup || 'standard',
      notes: options.notes || '',
    },

    // Optimistic concurrency control
    _version: options._version || 1,

    // Metadata
    createdAt: options.createdAt || now,
    createdBy: options.createdBy || options.userId || 'test-user',
    lastModifiedDateTime: options.lastModifiedDateTime || now,
    lastModifiedBy: options.lastModifiedBy || options.userId || 'test-user',

    // Optional nested structures
    graphData: options.graphData || null,
    internalData: options.internalData || null,

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
 * Create an approved event (published)
 * @param {Object} options - Event options
 * @returns {Object} Approved event
 */
function createApprovedEvent(options = {}) {
  return createBaseEvent({
    status: STATUS.APPROVED,
    approvedAt: options.approvedAt || new Date(),
    approvedBy: options.approvedBy || 'approver@emanuelnyc.org',
    ...options,
  });
}

/**
 * Create an approved event with pending edit request (PUBLISHED_EDIT state)
 * @param {Object} options - Event options
 * @returns {Object} Approved event with pending edit
 */
function createApprovedEventWithEditRequest(options = {}) {
  const event = createApprovedEvent(options);
  event.pendingEditRequest = options.pendingEditRequest || {
    requestedAt: new Date(),
    requestedBy: options.requesterEmail || 'requester@external.com',
    requestedChanges: options.requestedChanges || {
      eventTitle: 'Updated Title',
      eventDescription: 'Updated description',
    },
    reason: options.editReason || 'Need to update event details',
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
  const previousStatus = options.previousStatus || STATUS.APPROVED;
  return createBaseEvent({
    status: STATUS.DELETED,
    isDeleted: true,
    deletedAt: options.deletedAt || new Date(),
    deletedBy: options.deletedBy || 'admin@emanuelnyc.org',
    previousStatus, // Store for restore functionality
    ...options,
  });
}

/**
 * Create a published event synced to Outlook (has graphData.id)
 * @param {Object} options - Event options
 * @returns {Object} Published event with Graph sync
 */
function createPublishedEvent(options = {}) {
  const graphId = options.graphId || `AAMkAGraph${generateEventId()}`;
  return createApprovedEvent({
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
  const approved = createApprovedEvent({ ...baseOptions, eventTitle: 'Approved Event' });
  const approvedWithEdit = createApprovedEventWithEditRequest({
    ...baseOptions,
    eventTitle: 'Approved With Edit',
  });
  const rejected = createRejectedEvent({ ...baseOptions, eventTitle: 'Rejected Event' });
  const deleted = createDeletedEvent({ ...baseOptions, eventTitle: 'Deleted Event' });

  const events = await insertEvents(db, [
    draft,
    pending,
    approved,
    approvedWithEdit,
    rejected,
    deleted,
  ]);

  return {
    draft: events[0],
    pending: events[1],
    approved: events[2],
    approvedWithEdit: events[3],
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

module.exports = {
  createBaseEvent,
  createDraftEvent,
  createPendingEvent,
  createApprovedEvent,
  createApprovedEventWithEditRequest,
  createRejectedEvent,
  createDeletedEvent,
  createPublishedEvent,
  insertEvent,
  insertEvents,
  createEventSetForUser,
  findEvent,
  updateEvent,
  generateEventId,
  resetEventIdCounter,
};
