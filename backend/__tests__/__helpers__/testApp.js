/**
 * Test Application Factory
 *
 * Creates a configured Express app for integration testing.
 * Provides database injection and JWT verification bypass for testing.
 */

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId, GridFSBucket } = require('mongodb');
const { getPermissions, isAdmin, canViewAllReservations, hasRole } = require('../../utils/authUtils');
const { detectEventChanges, formatChangesForEmail } = require('../../utils/changeDetection');
const { initTestKeys, createMockToken, getTestJwks } = require('./authHelpers');
const { COLLECTIONS, TEST_CALENDAR_OWNER } = require('./testConstants');
const graphApiMock = require('./graphApiMock');

// Store test database reference
let testDb = null;
let testCollections = {};

/**
 * Set the test database reference
 * @param {Db} db - MongoDB database instance from test setup
 */
function setTestDatabase(db) {
  testDb = db;
  // Initialize collection references
  testCollections = {
    users: db.collection(COLLECTIONS.USERS),
    events: db.collection(COLLECTIONS.EVENTS),
    locations: db.collection(COLLECTIONS.LOCATIONS),
    calendarDeltas: db.collection(COLLECTIONS.CALENDAR_DELTAS),
    reservationTokens: db.collection(COLLECTIONS.RESERVATION_TOKENS),
    auditHistory: db.collection(COLLECTIONS.AUDIT_HISTORY),
  };
}

/**
 * Get the test database reference
 * @returns {Db} MongoDB database instance
 */
function getTestDatabase() {
  return testDb;
}

/**
 * Get test collections
 * @returns {Object} Collection references
 */
function getTestCollections() {
  return testCollections;
}

/**
 * Create a test authentication middleware
 * Verifies test tokens or bypasses auth for testing
 * @param {Object} options - Middleware options
 * @returns {Function} Express middleware
 */
function createTestAuthMiddleware(options = {}) {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const token = authHeader.split(' ')[1];

      // For test tokens, decode without verification (trust test tokens)
      // In a real test, you'd use jose to verify with the test public key
      const jose = require('jose');
      const payload = jose.decodeJwt(token);

      // Extract user info from token
      req.user = {
        userId: payload.oid || payload.sub,
        email: payload.preferred_username || payload.email,
        name: payload.name,
      };

      next();
    } catch (error) {
      res.status(401).json({ error: 'Invalid token' });
    }
  };
}

/**
 * Create audit log entry
 * @param {Object} data - Audit data
 */
async function createAuditLog(data) {
  if (!testCollections.auditHistory) return;

  const auditEntry = {
    _id: new ObjectId(),
    eventId: data.eventId,
    action: data.action,
    performedBy: data.performedBy,
    performedByEmail: data.performedByEmail || data.performedBy,
    timestamp: new Date(),
    previousState: data.previousState || null,
    newState: data.newState || null,
    changes: data.changes || {},
    reviewChanges: data.reviewChanges || null,
    metadata: data.metadata || {},
  };

  await testCollections.auditHistory.insertOne(auditEntry);
  return auditEntry;
}

/**
 * Check for scheduling conflicts in test DB (simplified version of checkRoomConflicts)
 * @param {Object} event - The event being restored
 * @param {ObjectId} excludeId - Event ID to exclude from conflict check
 * @param {Collection} eventsCollection - MongoDB collection
 * @returns {Array} Array of conflicting events
 */
async function checkTestConflicts(event, excludeId, eventsCollection) {
  const roomIds = event.calendarData?.locations || event.locations || [];
  if (roomIds.length === 0) return [];

  const startTime = new Date(event.startDateTime || event.calendarData?.startDateTime);
  const endTime = new Date(event.endDateTime || event.calendarData?.endDateTime);

  // Convert to string format matching stored calendarData values (ISO local time, no Z)
  // Production stores calendarData.startDateTime as local-time strings
  // Must use local-time getters to avoid UTC shift on non-UTC machines
  const pad = (n) => String(n).padStart(2, '0');
  const toLocalISOString = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const startTimeStr = toLocalISOString(startTime);
  const endTimeStr = toLocalISOString(endTime);

  // Find overlapping published events in the same rooms
  const query = {
    status: 'published',
    _id: { $ne: excludeId },
    $or: [
      { 'calendarData.locations': { $in: roomIds } },
      { locations: { $in: roomIds } },
    ],
    $and: [
      {
        $or: [
          // Check calendarData string fields (production format)
          { 'calendarData.startDateTime': { $gte: startTimeStr, $lt: endTimeStr } },
          { 'calendarData.endDateTime': { $gt: startTimeStr, $lte: endTimeStr } },
          { 'calendarData.startDateTime': { $lte: startTimeStr }, 'calendarData.endDateTime': { $gte: endTimeStr } },
        ],
      },
    ],
  };

  const conflicts = await eventsCollection.find(query).toArray();
  return conflicts.map(c => ({
    id: c._id.toString(),
    eventTitle: c.calendarData?.eventTitle || c.eventTitle,
    startDateTime: c.calendarData?.startDateTime || c.startDateTime,
    endDateTime: c.calendarData?.endDateTime || c.endDateTime,
    rooms: c.calendarData?.locations || c.locations || [],
    status: c.status,
  }));
}

/**
 * Create the test Express application
 * @param {Object} options - App configuration options
 * @returns {Express} Configured Express app
 */
function createTestApp(options = {}) {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Add request ID
  app.use((req, res, next) => {
    req.requestId = `test-${Date.now()}`;
    next();
  });

  // Create auth middleware
  const verifyToken = createTestAuthMiddleware(options);

  // ============================================
  // DRAFT ENDPOINTS
  // ============================================

  /**
   * POST /api/room-reservations/draft - Create a new draft
   */
  app.post('/api/room-reservations/draft', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check permission (requester or higher)
      if (!hasRole(userDoc, userEmail, 'requester')) {
        return res.status(403).json({ error: 'Permission denied. Requester role required.' });
      }

      const {
        eventTitle,
        eventDescription,
        startDateTime,
        endDateTime,
        locations,
        requesterName,
        requesterEmail,
        department,
        phone,
        attendees,
        categories,
        services,
        setupTime,
        doorOpenTime,
      } = req.body;

      // Validate required fields
      if (!eventTitle || !startDateTime || !endDateTime) {
        return res.status(400).json({ error: 'Missing required fields: eventTitle, startDateTime, endDateTime' });
      }

      const now = new Date();
      const eventId = `draft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const draft = {
        _id: new ObjectId(),
        eventId,
        userId,
        calendarOwner: TEST_CALENDAR_OWNER,
        status: 'draft',
        isDeleted: false,

        // Calendar fields (top-level for backward compat)
        eventTitle,
        eventDescription: eventDescription || '',
        startDateTime: new Date(startDateTime),
        endDateTime: new Date(endDateTime),
        locations: locations || [],
        locationDisplayNames: [],
        categories: categories || [],
        services: services || [],
        setupTime: setupTime || null,
        doorOpenTime: doorOpenTime || null,

        // calendarData (nested structure matching production)
        calendarData: {
          eventTitle,
          eventDescription: eventDescription || '',
          startDateTime: new Date(startDateTime),
          endDateTime: new Date(endDateTime),
          locations: locations || [],
          locationDisplayNames: [],
          categories: categories || [],
          setupTime: setupTime || null,
          doorOpenTime: doorOpenTime || null,
        },

        // Room reservation data
        roomReservationData: {
          requesterName: requesterName || req.user.name || '',
          requesterEmail: requesterEmail || userEmail,
          department: department || '',
          phone: phone || '',
          attendees: attendees || 0,
        },

        // Status history
        statusHistory: [{
          status: 'draft',
          changedAt: now,
          changedBy: userId,
          changedByEmail: userEmail,
          reason: 'Draft created'
        }],

        // Metadata
        createdAt: now,
        createdBy: userId,
        lastModifiedDateTime: now,
        lastModifiedBy: userId,
      };

      await testCollections.events.insertOne(draft);

      // Create audit log
      await createAuditLog({
        eventId: draft.eventId,
        action: 'created',
        performedBy: userId,
        performedByEmail: userEmail,
        newState: draft,
      });

      res.status(201).json({
        success: true,
        draft,
      });
    } catch (error) {
      console.error('Error creating draft:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/room-reservations/draft/:id - Update a draft
   */
  app.put('/api/room-reservations/draft/:id', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const draftId = req.params.id;

      // Find the draft
      const query = ObjectId.isValid(draftId)
        ? { _id: new ObjectId(draftId) }
        : { eventId: draftId };

      const draft = await testCollections.events.findOne({
        ...query,
        status: 'draft',
        isDeleted: { $ne: true },
      });

      if (!draft) {
        return res.status(404).json({ error: 'Draft not found' });
      }

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check ownership or admin permission
      const isOwner =
        draft.userId === userId ||
        draft.roomReservationData?.requestedBy?.email === userEmail;
      const isApproverOrAdmin = hasRole(userDoc, userEmail, 'approver');

      if (!isOwner && !isApproverOrAdmin) {
        return res.status(403).json({ error: 'Permission denied. Only the owner or an approver can edit this draft.' });
      }

      const updateFields = {};
      // All calendar fields go inside calendarData (source of truth)
      const calendarDataFields = [
        'eventTitle',
        'eventDescription',
        'startDateTime',
        'endDateTime',
        'startDate',
        'startTime',
        'endDate',
        'endTime',
        'locations',
        'categories',
        'services',
      ];

      for (const field of calendarDataFields) {
        if (req.body[field] !== undefined) {
          if (field === 'startDateTime' || field === 'endDateTime') {
            // Store as local-time strings (strip Z suffix), not BSON Dates
            const val = req.body[field];
            updateFields[`calendarData.${field}`] = typeof val === 'string' ? val.replace(/Z$/, '') : val;
          } else {
            updateFields[`calendarData.${field}`] = req.body[field];
          }
        }
      }

      // Update roomReservationData fields
      const reservationFields = ['requesterName', 'requesterEmail', 'department', 'phone', 'attendees'];
      for (const field of reservationFields) {
        if (req.body[field] !== undefined) {
          updateFields[`roomReservationData.${field}`] = req.body[field];
        }
      }

      updateFields.lastModifiedDateTime = new Date();
      updateFields.lastModifiedBy = userId;

      await testCollections.events.updateOne(query, { $set: updateFields });

      const updatedDraft = await testCollections.events.findOne(query);

      // Create audit log
      await createAuditLog({
        eventId: draft.eventId,
        action: 'updated',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: draft,
        newState: updatedDraft,
        changes: updateFields,
      });

      res.json({
        success: true,
        draft: updatedDraft,
      });
    } catch (error) {
      console.error('Error updating draft:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/room-reservations/draft/:id/submit - Submit a draft
   */
  app.post('/api/room-reservations/draft/:id/submit', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const draftId = req.params.id;

      // Find the draft
      const query = ObjectId.isValid(draftId)
        ? { _id: new ObjectId(draftId) }
        : { eventId: draftId };

      const draft = await testCollections.events.findOne({
        ...query,
        status: 'draft',
        isDeleted: { $ne: true },
      });

      if (!draft) {
        return res.status(404).json({ error: 'Draft not found' });
      }

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check ownership or admin permission
      const isOwner =
        draft.userId === userId ||
        draft.roomReservationData?.requestedBy?.email === userEmail;
      const isApproverOrAdmin = hasRole(userDoc, userEmail, 'approver');

      if (!isOwner && !isApproverOrAdmin) {
        return res.status(403).json({ error: 'Permission denied. Only the owner or an approver can submit this draft.' });
      }

      // Calendar data is stored inside calendarData, not at top level
      const cd = draft.calendarData || {};

      // Validate required fields for submission
      const validationErrors = [];
      if (!cd.eventTitle || !cd.eventTitle.trim()) validationErrors.push('Event title is required');
      if (!cd.startDateTime) validationErrors.push('Start date and time are required');
      if (!cd.endDateTime) validationErrors.push('End date and time are required');
      if (!cd.locations || cd.locations.length === 0) validationErrors.push('At least one room must be selected');
      if (!cd.categories || cd.categories.length === 0) validationErrors.push('At least one category must be selected');
      if (!cd.setupTime) validationErrors.push('Setup time is required');
      if (!cd.doorOpenTime) validationErrors.push('Door open time is required');

      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: 'Draft is incomplete and cannot be submitted',
          validationErrors
        });
      }

      const now = new Date();
      let canAutoPublish = isApproverOrAdmin;

      // Respect role simulation: if simulating a non-approver role, skip auto-publish
      const simulatedRole = req.headers['x-simulated-role'];
      if (simulatedRole && !['approver', 'admin'].includes(simulatedRole)) {
        canAutoPublish = false;
      }

      if (canAutoPublish) {
        // Auto-publish path for admins/approvers
        const graphResult = await graphApiMock.createCalendarEvent(
          TEST_CALENDAR_OWNER,
          null,
          {
            subject: cd.eventTitle,
            startDateTime: cd.startDateTime,
            endDateTime: cd.endDateTime,
            eventDescription: cd.eventDescription,
          }
        );

        await testCollections.events.updateOne(query, {
          $set: {
            status: 'published',
            publishedAt: now,
            publishedBy: userEmail,
            reviewedAt: now,
            reviewedBy: userEmail,
            submittedAt: now,
            lastModifiedDateTime: now,
            lastModifiedBy: userId,
            graphData: {
              id: graphResult.id,
              iCalUId: graphResult.iCalUId,
              webLink: graphResult.webLink,
            },
          },
          $unset: { draftCreatedAt: "" },
          $push: {
            statusHistory: {
              status: 'published',
              changedAt: now,
              changedBy: userId,
              changedByEmail: userEmail,
              reason: 'Auto-published on creation',
            },
          },
        });

        const publishedEvent = await testCollections.events.findOne(query);

        await createAuditLog({
          eventId: draft.eventId,
          action: 'auto-published',
          performedBy: userId,
          performedByEmail: userEmail,
          previousState: draft,
          newState: publishedEvent,
          changes: { status: { from: 'draft', to: 'published' } },
        });

        res.json({
          success: true,
          event: publishedEvent,
          autoPublished: true,
          graphEventId: graphResult.id,
        });
      } else {
        // Standard requester path: draft → pending
        await testCollections.events.updateOne(query, {
          $set: {
            status: 'pending',
            submittedAt: now,
            lastModifiedDateTime: now,
            lastModifiedBy: userId,
          },
          $unset: { draftCreatedAt: "" },
          $push: {
            statusHistory: {
              status: 'pending',
              changedAt: now,
              changedBy: userId,
              changedByEmail: userEmail,
              reason: 'Submitted for review'
            }
          }
        });

        const submittedEvent = await testCollections.events.findOne(query);

        await createAuditLog({
          eventId: draft.eventId,
          action: 'submitted',
          performedBy: userId,
          performedByEmail: userEmail,
          previousState: draft,
          newState: submittedEvent,
          changes: { status: { from: 'draft', to: 'pending' } },
        });

        res.json({
          success: true,
          event: submittedEvent,
        });
      }
    } catch (error) {
      console.error('Error submitting draft:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/room-reservations/draft/:id - Delete a draft
   */
  app.delete('/api/room-reservations/draft/:id', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const draftId = req.params.id;

      // Find the draft
      const query = ObjectId.isValid(draftId)
        ? { _id: new ObjectId(draftId) }
        : { eventId: draftId };

      const draft = await testCollections.events.findOne({
        ...query,
        status: 'draft',
        isDeleted: { $ne: true },
      });

      if (!draft) {
        return res.status(404).json({ error: 'Draft not found' });
      }

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check ownership or admin permission
      const isOwner =
        draft.userId === userId ||
        draft.roomReservationData?.requestedBy?.email === userEmail;
      const isApproverOrAdmin = hasRole(userDoc, userEmail, 'approver');

      if (!isOwner && !isApproverOrAdmin) {
        return res.status(403).json({ error: 'Permission denied. Only the owner or an approver can delete this draft.' });
      }

      // Soft delete the draft
      const now = new Date();
      await testCollections.events.updateOne(query, {
        $set: {
          status: 'deleted',
          isDeleted: true,
          deletedAt: now,
          deletedBy: userId,
          previousStatus: 'draft',
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
        },
      });

      // Create audit log
      await createAuditLog({
        eventId: draft.eventId,
        action: 'deleted',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: draft,
        changes: { status: { from: 'draft', to: 'deleted' } },
      });

      res.json({
        success: true,
        message: 'Draft deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting draft:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // ADMIN EVENT ENDPOINTS
  // ============================================

  /**
   * GET /api/admin/events - Get all events (admin)
   */
  app.get('/api/admin/events', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check approver permission
      if (!hasRole(userDoc, userEmail, 'approver')) {
        return res.status(403).json({ error: 'Permission denied. Approver role required.' });
      }

      const { status, isDeleted } = req.query;

      const query = {};
      if (status) query.status = status;
      if (isDeleted === 'true') query.isDeleted = true;
      else if (isDeleted === 'false') query.isDeleted = { $ne: true };

      const events = await testCollections.events.find(query).toArray();

      res.json({ events });
    } catch (error) {
      console.error('Error fetching events:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/admin/events/:id - Get single event
   */
  app.get('/api/admin/events/:id', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const eventId = req.params.id;

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check approver permission for admin endpoint
      if (!hasRole(userDoc, userEmail, 'approver')) {
        return res.status(403).json({ error: 'Permission denied. Approver role required.' });
      }

      const query = ObjectId.isValid(eventId)
        ? { _id: new ObjectId(eventId) }
        : { eventId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      res.json({ event });
    } catch (error) {
      console.error('Error fetching event:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/admin/events/:id/publish - Publish a pending event
   */
  app.put('/api/admin/events/:id/publish', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const eventId = req.params.id;

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check approver permission
      if (!hasRole(userDoc, userEmail, 'approver')) {
        return res.status(403).json({ error: 'Permission denied. Approver role required.' });
      }

      const query = ObjectId.isValid(eventId)
        ? { _id: new ObjectId(eventId) }
        : { eventId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      if (event.status !== 'pending') {
        return res.status(400).json({ error: `Cannot publish event with status: ${event.status}` });
      }

      // Check for scheduling conflicts (unless forcePublish)
      const { forcePublish } = req.body;
      if (!forcePublish) {
        const roomIds = event.calendarData?.locations || event.locations || [];
        if (roomIds.length > 0) {
          const conflicts = await checkTestConflicts(event, event._id, testCollections.events);
          if (conflicts.length > 0) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              message: `Cannot publish: ${conflicts.length} scheduling conflict(s) detected`,
              conflicts,
              _version: event._version,
            });
          }
        }
      }

      // Mock Graph API call
      const graphResult = await graphApiMock.createCalendarEvent(
        TEST_CALENDAR_OWNER,
        null,
        {
          subject: event.eventTitle,
          startDateTime: event.startDateTime,
          endDateTime: event.endDateTime,
          eventDescription: event.eventDescription,
        }
      );

      // Update event status
      const now = new Date();
      await testCollections.events.updateOne(query, {
        $set: {
          status: 'published',
          publishedAt: now,
          publishedBy: userEmail,
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
          graphData: {
            id: graphResult.id,
            iCalUId: graphResult.iCalUId,
            webLink: graphResult.webLink,
          },
        },
        $push: {
          statusHistory: {
            status: 'published',
            changedAt: now,
            changedBy: userId,
            changedByEmail: userEmail,
            reason: 'Published by admin',
          },
        },
      });

      const publishedEvent = await testCollections.events.findOne(query);

      // Read any approver modifications captured during the save step
      const reviewChanges = event.roomReservationData?.reviewChanges || [];

      // Clear reviewChanges from the document (one-time use)
      if (reviewChanges.length > 0) {
        await testCollections.events.updateOne(query, {
          $unset: { 'roomReservationData.reviewChanges': '' },
        });
      }

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: 'published',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        newState: publishedEvent,
        changes: { status: { from: 'pending', to: 'published' } },
        reviewChanges: reviewChanges.length > 0 ? reviewChanges : null,
      });

      res.json({
        success: true,
        event: publishedEvent,
        reviewChanges: reviewChanges.length > 0 ? reviewChanges : undefined,
      });
    } catch (error) {
      console.error('Error publishing event:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/admin/events/:id/reject - Reject a pending event
   */
  app.put('/api/admin/events/:id/reject', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const eventId = req.params.id;
      const { reason } = req.body;

      // Require rejection reason
      if (!reason) {
        return res.status(400).json({ error: 'Rejection reason is required' });
      }

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check approver permission
      if (!hasRole(userDoc, userEmail, 'approver')) {
        return res.status(403).json({ error: 'Permission denied. Approver role required.' });
      }

      const query = ObjectId.isValid(eventId)
        ? { _id: new ObjectId(eventId) }
        : { eventId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      if (event.status !== 'pending') {
        return res.status(400).json({ error: `Cannot reject event with status: ${event.status}` });
      }

      // Update event status
      const now = new Date();
      await testCollections.events.updateOne(query, {
        $set: {
          status: 'rejected',
          rejectedAt: now,
          rejectedBy: userEmail,
          rejectionReason: reason,
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
        },
        $push: {
          statusHistory: {
            status: 'rejected',
            changedAt: now,
            changedBy: userId,
            changedByEmail: userEmail,
            reason: reason,
          },
        },
      });

      const rejectedEvent = await testCollections.events.findOne(query);

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: 'rejected',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        newState: rejectedEvent,
        changes: { status: { from: 'pending', to: 'rejected' }, reason },
      });

      res.json({
        success: true,
        event: rejectedEvent,
      });
    } catch (error) {
      console.error('Error rejecting event:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/admin/events/:id - Delete an event (soft delete)
   */
  app.delete('/api/admin/events/:id', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const eventId = req.params.id;

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check approver permission
      if (!hasRole(userDoc, userEmail, 'approver')) {
        return res.status(403).json({ error: 'Permission denied. Approver role required.' });
      }

      const query = ObjectId.isValid(eventId)
        ? { _id: new ObjectId(eventId) }
        : { eventId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // If already deleted, return early
      if (event.isDeleted) {
        return res.json({
          success: true,
          message: 'Event already deleted',
        });
      }

      // Soft delete
      const now = new Date();
      await testCollections.events.updateOne(query, {
        $set: {
          status: 'deleted',
          isDeleted: true,
          deletedAt: now,
          deletedBy: userId,
          previousStatus: event.status,
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
        },
        $push: {
          statusHistory: {
            status: 'deleted',
            changedAt: now,
            changedBy: userId,
            changedByEmail: userEmail,
            reason: 'Deleted by admin'
          }
        }
      });

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: 'deleted',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        changes: { status: { from: event.status, to: 'deleted' } },
      });

      res.json({
        success: true,
        message: 'Event deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting event:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/admin/events/:id/restore - Restore a deleted event (Admin only)
   */
  app.put('/api/admin/events/:id/restore', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const eventId = req.params.id;
      const { _version, forceRestore } = req.body || {};

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check admin permission
      if (!hasRole(userDoc, userEmail, 'admin')) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const query = ObjectId.isValid(eventId)
        ? { _id: new ObjectId(eventId) }
        : { eventId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Deleted event not found' });
      }

      if (event.status !== 'deleted') {
        return res.status(404).json({ error: 'Deleted event not found' });
      }

      // Version conflict check
      if (_version && event._version && _version !== event._version) {
        return res.status(409).json({
          error: 'VERSION_CONFLICT',
          message: 'This event has been modified by another user',
          conflictType: 'data_changed',
          currentVersion: event._version,
        });
      }

      // Find previous status from statusHistory
      const statusHistory = event.statusHistory || [];
      let previousStatus = 'draft';
      for (let i = statusHistory.length - 1; i >= 0; i--) {
        if (statusHistory[i].status !== 'deleted') {
          previousStatus = statusHistory[i].status;
          break;
        }
      }
      // Fallback to previousStatus field for backward compat
      if (previousStatus === 'draft' && event.previousStatus) {
        previousStatus = event.previousStatus;
      }

      // Check for scheduling conflicts before restoring
      if (!forceRestore && ['pending', 'published'].includes(previousStatus)) {
        const roomIds = event.calendarData?.locations || event.locations || [];
        if (roomIds.length > 0) {
          const conflicts = await checkTestConflicts(event, event._id, testCollections.events);
          if (conflicts.length > 0) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              message: `Cannot restore: ${conflicts.length} scheduling conflict(s) detected`,
              conflicts,
              previousStatus,
              _version: event._version,
            });
          }
        }
      }

      const now = new Date();
      const newVersion = (event._version || 0) + 1;
      await testCollections.events.updateOne(query, {
        $set: {
          status: previousStatus,
          isDeleted: false,
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
          _version: newVersion,
        },
        $unset: {
          deletedAt: '',
          deletedBy: '',
          deletedByEmail: '',
          previousStatus: '',
        },
        $push: {
          statusHistory: {
            status: previousStatus,
            changedAt: now,
            changedBy: userId,
            changedByEmail: userEmail,
            reason: 'Restored by admin',
          },
        },
      });

      const restoredEvent = await testCollections.events.findOne(query);

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: 'restored',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        newState: restoredEvent,
        changes: { status: { from: 'deleted', to: previousStatus } },
      });

      // Republish to Graph if event previously had a Graph/Outlook event
      let graphPublished = false;
      const hadGraphEvent = !!(event.graphData?.id);
      if (hadGraphEvent && event.calendarOwner) {
        try {
          const graphResult = await graphApiMock.createCalendarEvent(
            TEST_CALENDAR_OWNER, null,
            {
              subject: event.eventTitle,
              start: { dateTime: event.startDateTime, timeZone: 'America/New_York' },
              end: { dateTime: event.endDateTime, timeZone: 'America/New_York' },
              body: { contentType: 'Text', content: event.eventDescription || '' },
            }
          );

          await testCollections.events.updateOne(query, {
            $set: {
              'graphData.id': graphResult.id,
              'graphData.iCalUId': graphResult.iCalUId,
              'graphData.webLink': graphResult.webLink,
            }
          });
          graphPublished = true;
        } catch (graphError) {
          // Don't fail restore if Graph fails
          graphPublished = false;
        }
      }

      res.json({
        success: true,
        message: 'Event restored successfully',
        status: previousStatus,
        graphPublished,
        _version: newVersion,
      });
    } catch (error) {
      console.error('Error restoring event:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/room-reservations/:id/restore - Restore a deleted/cancelled reservation (Owner only)
   */
  app.put('/api/room-reservations/:id/restore', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const reservationId = req.params.id;
      const { _version } = req.body || {};

      const query = ObjectId.isValid(reservationId)
        ? { _id: new ObjectId(reservationId) }
        : { eventId: reservationId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Deleted or cancelled reservation not found' });
      }

      if (event.status !== 'deleted' && event.status !== 'cancelled') {
        return res.status(404).json({ error: 'Deleted or cancelled reservation not found' });
      }

      // Ownership check
      const isOwner =
        event.userId === userId ||
        event.roomReservationData?.requestedBy?.email === userEmail;

      if (!isOwner) {
        return res.status(403).json({ error: 'You can only restore your own reservations' });
      }

      // Version conflict check
      if (_version && event._version && _version !== event._version) {
        return res.status(409).json({
          error: 'VERSION_CONFLICT',
          message: 'This event has been modified by another user',
          conflictType: 'data_changed',
          currentVersion: event._version,
        });
      }

      const currentStatus = event.status;

      // Find previous status from statusHistory
      const statusHistory = event.statusHistory || [];
      let previousStatus = 'draft';
      for (let i = statusHistory.length - 1; i >= 0; i--) {
        if (statusHistory[i].status !== currentStatus) {
          previousStatus = statusHistory[i].status;
          break;
        }
      }

      // Check for scheduling conflicts before restoring (no forceRestore for owners)
      if (['pending', 'published'].includes(previousStatus)) {
        const roomIds = event.calendarData?.locations || event.locations || [];
        if (roomIds.length > 0) {
          const conflicts = await checkTestConflicts(event, event._id, testCollections.events);
          if (conflicts.length > 0) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              message: `Cannot restore: ${conflicts.length} scheduling conflict(s) detected. Please submit a new reservation with different times or contact an admin.`,
              conflicts,
              previousStatus,
              _version: event._version,
            });
          }
        }
      }

      const now = new Date();
      const newVersion = (event._version || 0) + 1;

      const updateOp = {
        $set: {
          status: previousStatus,
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
          _version: newVersion,
        },
        $push: {
          statusHistory: {
            status: previousStatus,
            changedAt: now,
            changedBy: userId,
            changedByEmail: userEmail,
            reason: `Restored from ${currentStatus} by owner`,
          },
        },
      };

      // Only clean up deletion fields if restoring from deleted
      if (currentStatus === 'deleted') {
        updateOp.$set.isDeleted = false;
        updateOp.$unset = {
          deletedAt: '',
          deletedBy: '',
          deletedByEmail: '',
          previousStatus: '',
        };
      }

      await testCollections.events.updateOne(query, updateOp);

      // Republish to Graph if event previously had a Graph/Outlook event
      let graphPublished = false;
      const hadGraphEvent = !!(event.graphData?.id);
      if (hadGraphEvent && event.calendarOwner) {
        try {
          const graphResult = await graphApiMock.createCalendarEvent(
            TEST_CALENDAR_OWNER, null,
            {
              subject: event.eventTitle,
              start: { dateTime: event.startDateTime, timeZone: 'America/New_York' },
              end: { dateTime: event.endDateTime, timeZone: 'America/New_York' },
              body: { contentType: 'Text', content: event.eventDescription || '' },
            }
          );

          await testCollections.events.updateOne(query, {
            $set: {
              'graphData.id': graphResult.id,
              'graphData.iCalUId': graphResult.iCalUId,
              'graphData.webLink': graphResult.webLink,
            }
          });
          graphPublished = true;
        } catch (graphError) {
          // Don't fail restore if Graph fails
          graphPublished = false;
        }
      }

      res.json({
        success: true,
        message: 'Reservation restored successfully',
        status: previousStatus,
        graphPublished,
        _version: newVersion,
      });
    } catch (error) {
      console.error('Error restoring reservation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/room-reservations/:id/resubmit - Resubmit a rejected reservation
   */
  app.put('/api/room-reservations/:id/resubmit', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const reservationId = req.params.id;
      const { _version } = req.body || {};

      const query = ObjectId.isValid(reservationId)
        ? { _id: new ObjectId(reservationId) }
        : { eventId: reservationId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      // Ownership check
      const isOwner =
        event.userId === userId ||
        event.roomReservationData?.requestedBy?.userId === userId ||
        event.roomReservationData?.requestedBy?.email === userEmail;

      if (!isOwner) {
        return res.status(403).json({ error: 'You can only resubmit your own reservation requests' });
      }

      // Status guard
      if (event.status !== 'rejected') {
        return res.status(400).json({ error: 'Only rejected reservations can be resubmitted' });
      }

      // Resubmission allowed check
      if (event.roomReservationData?.resubmissionAllowed === false) {
        return res.status(400).json({ error: 'Resubmission has been disabled for this reservation' });
      }

      // Version conflict check
      if (_version && event._version && _version !== event._version) {
        return res.status(409).json({
          error: 'VERSION_CONFLICT',
          message: 'This event has been modified by another user',
          conflictType: 'data_changed',
          currentVersion: event._version,
        });
      }

      const now = new Date();
      const newVersion = (event._version || 0) + 1;

      await testCollections.events.updateOne(query, {
        $set: {
          status: 'pending',
          'roomReservationData.reviewedAt': null,
          'roomReservationData.reviewedBy': null,
          lastModified: now,
          lastModifiedBy: userEmail,
          _version: newVersion,
        },
        $push: {
          statusHistory: {
            status: 'pending',
            changedAt: now,
            changedBy: userId,
            changedByEmail: userEmail,
            reason: 'Resubmitted after rejection',
          },
        },
      });

      const updatedEvent = await testCollections.events.findOne(query);

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: 'resubmitted',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        newState: updatedEvent,
        changes: { status: { from: 'rejected', to: 'pending' } },
      });

      res.json({
        message: 'Reservation resubmitted successfully',
        reservation: updatedEvent,
        _version: newVersion,
      });
    } catch (error) {
      console.error('Error resubmitting reservation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/room-reservations/:id/edit - Edit a pending reservation (owner only)
   */
  app.put('/api/room-reservations/:id/edit', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const reservationId = req.params.id;

      const query = ObjectId.isValid(reservationId)
        ? { _id: new ObjectId(reservationId) }
        : { eventId: reservationId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Reservation not found' });
      }

      // Ownership + department check
      const isOwner =
        event.userId === userId ||
        event.roomReservationData?.requestedBy?.userId === userId ||
        event.roomReservationData?.requestedBy?.email === userEmail;

      if (!isOwner) {
        // Check if same department
        const currentUserRecord = await testCollections.users.findOne({
          $or: [{ userId }, { email: userEmail }]
        });
        const eventDepartment = (
          event.roomReservationData?.requestedBy?.department
          || event.calendarData?.department
          || ''
        ).toLowerCase().trim();
        const userDepartment = (currentUserRecord?.department || '').toLowerCase().trim();
        const isSameDepartment = eventDepartment && userDepartment && eventDepartment === userDepartment;

        if (!isSameDepartment) {
          return res.status(403).json({ error: 'You can only edit reservations from your own department' });
        }
      }

      // Status guard: only pending and rejected events can be edited
      if (!['pending', 'rejected'].includes(event.status)) {
        return res.status(400).json({ error: 'Only pending or rejected reservations can be edited' });
      }

      // For rejected events, check if resubmission is allowed
      if (event.status === 'rejected' && event.roomReservationData?.resubmissionAllowed === false) {
        return res.status(400).json({ error: 'Resubmission has been disabled for this reservation' });
      }

      const isResubmitEdit = event.status === 'rejected';

      const { _version, eventTitle, startDate, startTime, endDate, endTime } = req.body;

      // Validation
      if (!eventTitle || !eventTitle.trim()) {
        return res.status(400).json({ error: 'Event title is required' });
      }
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Start date and end date are required' });
      }
      if (!startTime || !endTime) {
        return res.status(400).json({ error: 'Start time and end time are required' });
      }

      // Version conflict check
      if (_version && event._version && _version !== event._version) {
        return res.status(409).json({
          error: 'VERSION_CONFLICT',
          message: 'This event has been modified by another user',
          conflictType: 'data_changed',
          currentVersion: event._version,
        });
      }

      const now = new Date();
      const newVersion = (event._version || 0) + 1;

      // Build update fields from calendarData
      const updateFields = {};
      const calendarDataFields = [
        'eventTitle', 'eventDescription',
        'startDate', 'startTime', 'endDate', 'endTime',
        'attendeeCount', 'specialRequirements',
        'categories', 'services',
      ];

      for (const field of calendarDataFields) {
        if (req.body[field] !== undefined) {
          updateFields[`calendarData.${field}`] = req.body[field];
        }
      }

      // Handle datetime computation
      const computedStartDateTime = req.body.startDateTime
        ? req.body.startDateTime.replace(/Z$/, '')
        : `${startDate}T${startTime}:00`;
      const computedEndDateTime = req.body.endDateTime
        ? req.body.endDateTime.replace(/Z$/, '')
        : `${endDate}T${endTime}:00`;

      // Check for scheduling conflicts (owners cannot force override)
      const rawEditedRoomIds = req.body.requestedRooms || event.calendarData?.locations || [];
      // Ensure room IDs are ObjectIds (request body sends strings via JSON)
      const editedRoomIds = rawEditedRoomIds.map(r => (r instanceof ObjectId ? r : (ObjectId.isValid(r) ? new ObjectId(r) : r)));
      if (editedRoomIds.length > 0) {
        const conflictEvent = {
          ...event,
          startDateTime: computedStartDateTime,
          endDateTime: computedEndDateTime,
          calendarData: {
            ...event.calendarData,
            startDateTime: computedStartDateTime,
            endDateTime: computedEndDateTime,
            locations: editedRoomIds,
          },
        };
        const conflicts = await checkTestConflicts(conflictEvent, event._id, testCollections.events);
        if (conflicts.length > 0) {
          return res.status(409).json({
            error: 'SchedulingConflict',
            message: `Cannot save: ${conflicts.length} scheduling conflict(s) detected`,
            conflicts,
            _version: event._version,
          });
        }
      }

      updateFields['calendarData.startDateTime'] = computedStartDateTime;
      updateFields['calendarData.endDateTime'] = computedEndDateTime;

      // Handle rooms
      if (req.body.requestedRooms !== undefined) {
        updateFields['calendarData.locations'] = req.body.requestedRooms;
      }

      // roomReservationData fields
      if (req.body.department !== undefined) {
        updateFields['roomReservationData.department'] = req.body.department;
      }
      if (req.body.phone !== undefined) {
        updateFields['roomReservationData.phone'] = req.body.phone;
      }

      updateFields.lastModified = now;
      updateFields.lastModifiedBy = userEmail;
      updateFields._version = newVersion;

      // Resubmit-specific fields (transition rejected → pending)
      if (isResubmitEdit) {
        updateFields.status = 'pending';
        updateFields.reviewedAt = null;
        updateFields.reviewedBy = null;
      }

      await testCollections.events.updateOne(query, {
        $set: updateFields,
        $push: {
          statusHistory: {
            status: 'pending',
            changedAt: now,
            changedBy: userId,
            changedByEmail: userEmail,
            reason: isResubmitEdit ? 'Resubmitted with edits after rejection' : 'Edited by requester',
          },
        },
      });

      const updatedEvent = await testCollections.events.findOne(query);

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: isResubmitEdit ? 'resubmit_with_edits' : 'edited',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        newState: updatedEvent,
        changes: updateFields,
      });

      res.json({
        message: 'Reservation updated successfully',
        reservation: updatedEvent,
        _version: newVersion,
      });
    } catch (error) {
      console.error('Error editing reservation:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // USER RESERVATION ENDPOINTS
  // ============================================

  /**
   * GET /api/reservations/my - Get user's own reservations
   */
  app.get('/api/reservations/my', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;

      const events = await testCollections.events
        .find({
          $or: [
            { userId },
            { 'roomReservationData.requestedBy.email': userEmail },
          ],
          isDeleted: { $ne: true },
        })
        .toArray();

      res.json({ reservations: events });
    } catch (error) {
      console.error('Error fetching reservations:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/users/me/permissions - Get user's permissions
   */
  app.get('/api/users/me/permissions', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      const permissions = getPermissions(userDoc, userEmail);

      res.json(permissions);
    } catch (error) {
      console.error('Error fetching permissions:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/room-reservations/generate-token - Generate reservation token
   */
  app.post('/api/room-reservations/generate-token', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check approver permission
      if (!hasRole(userDoc, userEmail, 'approver')) {
        return res.status(403).json({ error: 'Permission denied. Approver role required.' });
      }

      // Generate token
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');

      const tokenDoc = {
        _id: new ObjectId(),
        token,
        createdBy: userId,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        usageCount: 0,
        isActive: true,
      };

      await testCollections.reservationTokens.insertOne(tokenDoc);

      res.json({
        success: true,
        token: tokenDoc.token,
        expiresAt: tokenDoc.expiresAt,
      });
    } catch (error) {
      console.error('Error generating token:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // EDIT REQUEST ENDPOINTS
  // ============================================

  /**
   * POST /api/events/:id/request-edit - Request edit on published event
   */
  app.post('/api/events/:id/request-edit', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const eventId = req.params.id;
      const { requestedChanges, reason } = req.body;

      if (!requestedChanges || !reason) {
        return res.status(400).json({ error: 'requestedChanges and reason are required' });
      }

      const query = ObjectId.isValid(eventId)
        ? { _id: new ObjectId(eventId) }
        : { eventId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Check if user owns this event
      const isOwner =
        event.userId === userId ||
        event.roomReservationData?.requestedBy?.email === userEmail;

      if (!isOwner) {
        return res.status(403).json({ error: 'Permission denied. You can only request edits on your own events.' });
      }

      if (event.status !== 'published') {
        return res.status(400).json({ error: 'Can only request edits on published events' });
      }

      if (event.pendingEditRequest && (!event.pendingEditRequest.status || event.pendingEditRequest.status === 'pending')) {
        return res.status(400).json({ error: 'An edit request already exists for this event' });
      }

      // Create the edit request
      const now = new Date();
      await testCollections.events.updateOne(query, {
        $set: {
          pendingEditRequest: {
            requestedAt: now,
            requestedBy: userEmail,
            requestedChanges,
            reason,
          },
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
        },
      });

      const updatedEvent = await testCollections.events.findOne(query);

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: 'edit_requested',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        newState: updatedEvent,
        changes: { pendingEditRequest: requestedChanges, reason },
      });

      res.json({
        success: true,
        event: updatedEvent,
      });
    } catch (error) {
      console.error('Error requesting edit:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/admin/events/:id/publish-edit - Approve edit request
   */
  app.put('/api/admin/events/:id/publish-edit', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const eventId = req.params.id;

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check approver permission
      if (!hasRole(userDoc, userEmail, 'approver')) {
        return res.status(403).json({ error: 'Permission denied. Approver role required.' });
      }

      const query = ObjectId.isValid(eventId)
        ? { _id: new ObjectId(eventId) }
        : { eventId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      if (!event.pendingEditRequest) {
        return res.status(400).json({ error: 'No pending edit request for this event' });
      }

      // Apply the requested changes
      const changes = event.pendingEditRequest.requestedChanges;
      const now = new Date();

      await testCollections.events.updateOne(query, {
        $set: {
          ...changes,
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
        },
        $unset: {
          pendingEditRequest: '',
        },
      });

      const updatedEvent = await testCollections.events.findOne(query);

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: 'edit_approved',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        newState: updatedEvent,
        changes,
      });

      res.json({
        success: true,
        event: updatedEvent,
      });
    } catch (error) {
      console.error('Error approving edit:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/admin/events/:id/reject-edit - Reject edit request
   */
  app.put('/api/admin/events/:id/reject-edit', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const eventId = req.params.id;
      const { reason } = req.body;

      if (!reason) {
        return res.status(400).json({ error: 'Rejection reason is required' });
      }

      // Get user from database
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      // Check approver permission
      if (!hasRole(userDoc, userEmail, 'approver')) {
        return res.status(403).json({ error: 'Permission denied. Approver role required.' });
      }

      const query = ObjectId.isValid(eventId)
        ? { _id: new ObjectId(eventId) }
        : { eventId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      if (!event.pendingEditRequest) {
        return res.status(400).json({ error: 'No pending edit request for this event' });
      }

      // Remove the edit request
      const now = new Date();
      await testCollections.events.updateOne(query, {
        $set: {
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
        },
        $unset: {
          pendingEditRequest: '',
        },
      });

      const updatedEvent = await testCollections.events.findOne(query);

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: 'edit_rejected',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        newState: updatedEvent,
        changes: { rejectionReason: reason },
      });

      res.json({
        success: true,
        event: updatedEvent,
      });
    } catch (error) {
      console.error('Error rejecting edit:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PUT /api/admin/events/:id - Update an event (admin only)
   * Simplified test version focusing on Graph sync gate logic
   */
  app.put('/api/admin/events/:id', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;

      // Check admin permissions
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });
      if (!isAdmin(userDoc, userEmail)) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const id = req.params.id;
      const updates = req.body;
      const graphToken = updates.graphToken;

      // Get event
      let query;
      try {
        query = { _id: new ObjectId(id) };
      } catch {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      const event = await testCollections.events.findOne(query);
      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      // Determine if Graph-syncable fields changed
      const storedGraphEventId = event.graphData?.id;
      const hasGraphSyncableChanges = !!(
        updates.eventTitle !== undefined ||
        updates.locations !== undefined ||
        updates.requestedRooms !== undefined ||
        updates.startDateTime !== undefined ||
        updates.endDateTime !== undefined ||
        updates.categories !== undefined ||
        updates.eventDescription !== undefined
      );

      // Check for scheduling conflicts when time/room fields change on active events
      const timeOrRoomChanged = updates.startDateTime !== undefined ||
        updates.endDateTime !== undefined ||
        updates.locations !== undefined ||
        updates.requestedRooms !== undefined;
      const activeStatuses = ['pending', 'published'];
      if (timeOrRoomChanged && activeStatuses.includes(event.status) && !updates.forceUpdate) {
        const cd = event.calendarData || {};
        const rawRoomIds = updates.locations || updates.requestedRooms || cd.locations || [];
        // Ensure room IDs are ObjectIds (request body sends strings via JSON)
        const roomIds = rawRoomIds.map(r => (r instanceof ObjectId ? r : (ObjectId.isValid(r) ? new ObjectId(r) : r)));
        if (roomIds.length > 0) {
          const newStart = updates.startDateTime || cd.startDateTime;
          const newEnd = updates.endDateTime || cd.endDateTime;
          const conflictEvent = {
            ...event,
            startDateTime: newStart,
            endDateTime: newEnd,
            calendarData: {
              ...cd,
              startDateTime: newStart,
              endDateTime: newEnd,
              locations: roomIds,
            },
          };
          const conflicts = await checkTestConflicts(conflictEvent, event._id, testCollections.events);
          if (conflicts.length > 0) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              message: `Cannot save: ${conflicts.length} scheduling conflict(s) detected`,
              conflicts,
              _version: event._version,
            });
          }
        }
      }

      // Graph sync gate - uses graphData.id + calendarOwner (app-only auth via graphApiService)
      let graphSynced = false;
      let graphSyncResult = null;
      if (storedGraphEventId && hasGraphSyncableChanges && event.calendarOwner) {
        try {
          graphSyncResult = await graphApiMock.updateCalendarEvent(
            event.calendarOwner,
            event.calendarId,
            storedGraphEventId,
            {
              subject: updates.eventTitle || event.eventTitle,
              startDateTime: updates.startDateTime || event.startDateTime,
              endDateTime: updates.endDateTime || event.endDateTime,
              eventDescription: updates.eventDescription || event.eventDescription,
            }
          );
          graphSynced = true;
        } catch (graphError) {
          console.error('Graph sync failed:', graphError.message);
          // Continue with MongoDB update even if Graph sync fails
        }
      }

      // Build MongoDB update
      const mongoUpdate = {};
      const fieldsToSync = [
        'eventTitle', 'eventDescription', 'startDateTime', 'endDateTime',
        'startDate', 'startTime', 'endDate', 'endTime',
        'locations', 'locationDisplayNames', 'categories',
        'setupTime', 'teardownTime', 'doorOpenTime', 'doorCloseTime',
        'services', 'assignedTo',
      ];

      for (const field of fieldsToSync) {
        if (updates[field] !== undefined) {
          mongoUpdate[field] = updates[field];
        }
      }

      // Handle requestedRooms → locations mapping
      if (updates.requestedRooms !== undefined) {
        mongoUpdate.locations = updates.requestedRooms;
      }

      // Sync full Graph response to graphData (matches production behavior)
      if (graphSyncResult) {
        mongoUpdate.graphData = { ...(event.graphData || {}), ...graphSyncResult };
      }

      mongoUpdate.lastModifiedDateTime = new Date();
      mongoUpdate.lastModifiedBy = userId;

      // Track approver modifications on pending events for publish notification emails
      if (event.status === 'pending') {
        try {
          const reviewChanges = detectEventChanges(event, mongoUpdate);
          if (reviewChanges.length > 0) {
            mongoUpdate['roomReservationData.reviewChanges'] = formatChangesForEmail(reviewChanges);
          }
        } catch (changeErr) {
          // Non-blocking
        }
      }

      await testCollections.events.updateOne(query, { $set: mongoUpdate });

      const updatedEvent = await testCollections.events.findOne(query);

      res.json({
        success: true,
        event: updatedEvent,
        graphSynced,
      });
    } catch (error) {
      console.error('Error updating event:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // LIST EVENTS ENDPOINTS (my-events view)
  // ============================================

  /**
   * GET /api/events/list - List events with view-based filtering
   * Mirrors the production endpoint in api-server.js
   * For view=my-events: always scopes to logged-in user's own events
   */
  app.get('/api/events/list', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const { view = 'my-events', status, page = '1', limit = '20', includeDeleted } = req.query;

      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      const canViewAll = canViewAllReservations(userDoc, userEmail);
      const adminUser = isAdmin(userDoc, userEmail);

      if (view === 'approval-queue' && !canViewAll) {
        return res.status(403).json({ error: 'Approver or Admin access required' });
      }
      if (view === 'admin-browse' && !adminUser) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const pageNum = Math.max(1, parseInt(page) || 1);
      const limitNum = limit === '0' || limit === 0 ? 0 : Math.min(100, Math.max(1, parseInt(limit) || 20));
      const skip = limitNum > 0 ? (pageNum - 1) * limitNum : 0;
      const shouldIncludeDeleted = includeDeleted === 'true';

      let query = {};

      if (view === 'my-events') {
        query.roomReservationData = { $exists: true, $ne: null };
        // Always scope to user's own events - admins use admin-browse for all events
        query['roomReservationData.requestedBy.email'] = userEmail;

        if (status === 'deleted') {
          query.$or = [{ status: 'deleted' }, { isDeleted: true }];
        } else if (status === 'draft') {
          query.status = 'draft';
        } else if (status === 'pending') {
          query.status = { $in: ['pending', 'room-reservation-request'] };
        } else if (status === 'published') {
          query.status = 'published';
        } else if (status && status !== 'all') {
          query.status = status;
        } else {
          if (!shouldIncludeDeleted) {
            query.status = { $nin: ['deleted'] };
          }
        }
      } else if (view === 'approval-queue') {
        // Approval queue only shows statuses relevant to approver workflow
        query.isDeleted = { $ne: true };
        query.roomReservationData = { $exists: true, $ne: null };
        if (status === 'pending') {
          query.status = { $in: ['pending', 'room-reservation-request'] };
        } else if (status === 'published' || status === 'rejected') {
          query.status = status;
        } else {
          query.status = { $in: ['pending', 'room-reservation-request', 'published', 'rejected'] };
        }
      }

      let cursor = testCollections.events.find(query).sort({ lastModifiedDateTime: -1 });
      const total = await testCollections.events.countDocuments(query);

      if (limitNum > 0) {
        cursor = cursor.skip(skip).limit(limitNum);
      }

      const events = await cursor.toArray();

      res.json({ events, total, page: pageNum, limit: limitNum });
    } catch (error) {
      console.error('Error in GET /api/events/list:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/events/list/counts - Get event counts with view-based filtering
   * Mirrors the production endpoint in api-server.js
   * For view=my-events: always scopes to logged-in user's own events
   */
  app.get('/api/events/list/counts', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const { view = 'my-events' } = req.query;

      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      const canViewAll = canViewAllReservations(userDoc, userEmail);
      const adminUser = isAdmin(userDoc, userEmail);

      if (view === 'approval-queue' && !canViewAll) {
        return res.status(403).json({ error: 'Approver or Admin access required' });
      }
      if (view === 'admin-browse' && !adminUser) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      if (view === 'my-events') {
        // Always scoped to logged-in user
        const baseQuery = {
          roomReservationData: { $exists: true, $ne: null },
          'roomReservationData.requestedBy.email': userEmail,
        };

        const [all, pending, published, rejected, cancelled, draft, deleted] = await Promise.all([
          testCollections.events.countDocuments({ ...baseQuery, status: { $nin: ['deleted'] } }),
          testCollections.events.countDocuments({ ...baseQuery, status: { $in: ['pending', 'room-reservation-request'] } }),
          testCollections.events.countDocuments({ ...baseQuery, status: 'published' }),
          testCollections.events.countDocuments({ ...baseQuery, status: 'rejected' }),
          testCollections.events.countDocuments({ ...baseQuery, status: 'cancelled' }),
          testCollections.events.countDocuments({ ...baseQuery, status: 'draft' }),
          testCollections.events.countDocuments({
            'roomReservationData.requestedBy.email': userEmail,
            roomReservationData: { $exists: true, $ne: null },
            $or: [{ status: 'deleted' }, { isDeleted: true }],
          }),
        ]);

        res.json({ all, pending, published, rejected, cancelled, draft, deleted });
      } else if (view === 'approval-queue') {
        const baseQuery = {
          isDeleted: { $ne: true },
          roomReservationData: { $exists: true, $ne: null },
          status: { $in: ['pending', 'room-reservation-request', 'published', 'rejected'] },
        };

        const [all, pending, published, rejected] = await Promise.all([
          testCollections.events.countDocuments(baseQuery),
          testCollections.events.countDocuments({ ...baseQuery, status: { $in: ['pending', 'room-reservation-request'] } }),
          testCollections.events.countDocuments({ ...baseQuery, status: 'published' }),
          testCollections.events.countDocuments({ ...baseQuery, status: 'rejected' }),
        ]);

        res.json({ all, pending, published, rejected });
      }
    } catch (error) {
      console.error('Error in GET /api/events/list/counts:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // CALENDAR LOAD ENDPOINT (simplified getUnifiedEvents for testing)
  // ============================================

  /**
   * POST /api/events/calendar-load - Load events for calendar view with role-based filtering
   * Mirrors the getUnifiedEvents() logic in api-server.js
   */
  app.post('/api/events/calendar-load', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;

      const { calendarOwner, startDate, endDate } = req.body;

      // Get user role
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      const permissions = getPermissions(userDoc, userEmail);
      const role = permissions.role || 'viewer';

      // Build query matching getUnifiedEvents() logic
      const query = {
        isDeleted: { $ne: true },
        calendarOwner: (calendarOwner || TEST_CALENDAR_OWNER).toLowerCase()
      };

      // Email-match conditions for ownership checks
      const ownerEmailConditions = userEmail ? [
        { createdByEmail: userEmail },
        { 'roomReservationData.requestedBy.email': userEmail }
      ] : [];

      if (role === 'approver' || role === 'admin') {
        query.$or = [
          { status: { $nin: ['cancelled', 'rejected', 'deleted', 'draft'] } },
          ...(ownerEmailConditions.length > 0 ? [{
            status: 'draft',
            $or: ownerEmailConditions
          }] : [])
        ];
      } else if (role === 'requester' && userEmail) {
        query.$or = [
          { status: { $nin: ['cancelled', 'rejected', 'pending', 'deleted', 'draft', 'room-reservation-request'] } },
          {
            status: { $in: ['pending', 'room-reservation-request'] },
            $or: ownerEmailConditions
          },
          {
            status: 'draft',
            $or: ownerEmailConditions
          }
        ];
      } else {
        query.$or = [
          { status: { $nin: ['cancelled', 'rejected', 'pending', 'deleted', 'draft', 'room-reservation-request'] } },
          ...(ownerEmailConditions.length > 0 ? [{
            status: 'draft',
            $or: ownerEmailConditions
          }] : [])
        ];
      }

      // Date range filter
      if (startDate && endDate) {
        query['calendarData.startDateTime'] = { $lt: endDate };
        query['calendarData.endDateTime'] = { $gt: startDate };
      }

      const events = (await testCollections.events.find(query).toArray())
        .filter(event => {
          // Exclude incomplete drafts (no dates)
          if (event.status === 'draft' && (!event.calendarData?.startDateTime || !event.calendarData?.endDateTime)) {
            return false;
          }
          return true;
        });

      // Normalize events (populate start/end from calendarData for frontend compatibility)
      const normalizedEvents = events.map(event => {
        if (!event.start?.dateTime && event.calendarData?.startDateTime) {
          event.start = { dateTime: event.calendarData.startDateTime, timeZone: 'America/New_York' };
        }
        if (!event.end?.dateTime && event.calendarData?.endDateTime) {
          event.end = { dateTime: event.calendarData.endDateTime, timeZone: 'America/New_York' };
        }
        if (!event.subject && event.calendarData?.eventTitle) {
          event.subject = event.calendarData.eventTitle;
        }
        return event;
      });

      res.json({ events: normalizedEvents, role });
    } catch (error) {
      console.error('Error loading calendar events:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
    console.error('Test app error:', err);
    res.status(500).json({ error: err.message });
  });

  return app;
}

module.exports = {
  createTestApp,
  setTestDatabase,
  getTestDatabase,
  getTestCollections,
  createTestAuthMiddleware,
  createAuditLog,
};
