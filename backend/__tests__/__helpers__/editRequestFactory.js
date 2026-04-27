/**
 * Edit Request factory for creating test documents in the
 * templeEvents__EditRequests collection.
 *
 * Each request is a first-class change-request entity with its own lifecycle,
 * linked to an event by FK (eventId / eventObjectId). The shape mirrors the
 * Phase 1 schema in docs (see plan: Edit-Request Layer Refactor).
 */

const { ObjectId } = require('mongodb');
const { COLLECTIONS } = require('./testConstants');

const EDIT_REQUEST_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
  SUPERSEDED: 'superseded',
});

let editRequestIdCounter = 1;

function generateEditRequestId() {
  return `test-edit-req-${editRequestIdCounter++}-${Date.now()}`;
}

function resetEditRequestIdCounter() {
  editRequestIdCounter = 1;
}

/**
 * Build the shared base for any edit request document. Status-specific factories
 * call this and overlay their own fields.
 */
function createBaseEditRequest(options = {}) {
  const now = options.now || new Date();
  const editRequestId = options.editRequestId || generateEditRequestId();
  const eventId = options.eventId || `test-event-${editRequestIdCounter}`;
  const eventObjectId = options.eventObjectId || new ObjectId();

  const requesterUserId = options.userId || options.requestedBy?.userId || 'test-user';
  const requesterEmail = options.requestedBy?.email || 'requester@external.com';
  const requesterName = options.requestedBy?.name || requesterEmail;
  const requesterDepartment = options.requestedBy?.department || '';
  const requesterPhone = options.requestedBy?.phone || '';

  // Default baseline snapshot — advisory data captured at submit time.
  // Tests that exercise stale-baseline behavior should override this.
  const baselineSnapshot = options.baselineSnapshot !== undefined
    ? options.baselineSnapshot
    : {
        _version: options.baselineEventVersion || 1,
        eventTitle: options.baselineTitle || 'Original Title',
        startDateTime: options.baselineStart || null,
        endDateTime: options.baselineEnd || null,
        locations: options.baselineLocations || [],
        recurrence: options.baselineRecurrence || null,
      };

  return {
    _id: new ObjectId(),
    _version: options._version || 1,

    editRequestId,
    eventId,
    eventObjectId,

    editScope: options.editScope || null,
    occurrenceDate: options.occurrenceDate || null,
    seriesMasterId: options.seriesMasterId || null,

    status: EDIT_REQUEST_STATUS.PENDING,
    statusHistory: options.statusHistory || [
      {
        status: EDIT_REQUEST_STATUS.PENDING,
        changedAt: now,
        changedBy: requesterUserId,
      },
    ],

    requestedBy: {
      userId: requesterUserId,
      email: requesterEmail,
      name: requesterName,
      department: requesterDepartment,
      phone: requesterPhone,
    },
    requestedAt: options.requestedAt || now,

    proposedChanges: options.proposedChanges || {
      eventTitle: 'Updated Title',
      eventDescription: 'Updated description',
    },

    baselineSnapshot,

    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: '',

    createdAt: options.createdAt || now,
    lastModifiedDateTime: options.lastModifiedDateTime || now,
    lastModifiedBy: options.lastModifiedBy || requesterUserId,
  };
}

function createPendingEditRequest(options = {}) {
  return createBaseEditRequest(options);
}

function createApprovedEditRequest(options = {}) {
  const now = options.now || new Date();
  const base = createBaseEditRequest(options);
  const reviewer = options.reviewedBy || {
    userId: 'approver-user',
    email: 'approver@emanuelnyc.org',
    name: 'Test Approver',
  };
  return {
    ...base,
    status: EDIT_REQUEST_STATUS.APPROVED,
    statusHistory: [
      ...base.statusHistory,
      {
        status: EDIT_REQUEST_STATUS.APPROVED,
        changedAt: options.reviewedAt || now,
        changedBy: reviewer.userId,
      },
    ],
    reviewedBy: reviewer,
    reviewedAt: options.reviewedAt || now,
    reviewNotes: options.reviewNotes || '',
  };
}

function createRejectedEditRequest(options = {}) {
  const now = options.now || new Date();
  const base = createBaseEditRequest(options);
  const reviewer = options.reviewedBy || {
    userId: 'approver-user',
    email: 'approver@emanuelnyc.org',
    name: 'Test Approver',
  };
  return {
    ...base,
    status: EDIT_REQUEST_STATUS.REJECTED,
    statusHistory: [
      ...base.statusHistory,
      {
        status: EDIT_REQUEST_STATUS.REJECTED,
        changedAt: options.reviewedAt || now,
        changedBy: reviewer.userId,
      },
    ],
    reviewedBy: reviewer,
    reviewedAt: options.reviewedAt || now,
    reviewNotes: options.reviewNotes || 'Test rejection reason',
  };
}

function createWithdrawnEditRequest(options = {}) {
  const now = options.now || new Date();
  const base = createBaseEditRequest(options);
  return {
    ...base,
    status: EDIT_REQUEST_STATUS.WITHDRAWN,
    statusHistory: [
      ...base.statusHistory,
      {
        status: EDIT_REQUEST_STATUS.WITHDRAWN,
        changedAt: options.withdrawnAt || now,
        changedBy: base.requestedBy.userId,
      },
    ],
    lastModifiedDateTime: options.withdrawnAt || now,
    lastModifiedBy: base.requestedBy.userId,
  };
}

function createSupersededEditRequest(options = {}) {
  const now = options.now || new Date();
  const base = createBaseEditRequest(options);
  return {
    ...base,
    status: EDIT_REQUEST_STATUS.SUPERSEDED,
    statusHistory: [
      ...base.statusHistory,
      {
        status: EDIT_REQUEST_STATUS.SUPERSEDED,
        changedAt: options.supersededAt || now,
        changedBy: 'system',
      },
    ],
    lastModifiedDateTime: options.supersededAt || now,
    lastModifiedBy: 'system',
  };
}

async function insertEditRequest(db, editRequest) {
  const result = await db.collection(COLLECTIONS.EDIT_REQUESTS).insertOne(editRequest);
  return { ...editRequest, _id: result.insertedId };
}

async function insertEditRequests(db, editRequests) {
  if (editRequests.length === 0) return [];
  const result = await db.collection(COLLECTIONS.EDIT_REQUESTS).insertMany(editRequests);
  return editRequests.map((editRequest, index) => ({
    ...editRequest,
    _id: result.insertedIds[index],
  }));
}

module.exports = {
  EDIT_REQUEST_STATUS,
  generateEditRequestId,
  resetEditRequestIdCounter,
  createBaseEditRequest,
  createPendingEditRequest,
  createApprovedEditRequest,
  createRejectedEditRequest,
  createWithdrawnEditRequest,
  createSupersededEditRequest,
  insertEditRequest,
  insertEditRequests,
};
