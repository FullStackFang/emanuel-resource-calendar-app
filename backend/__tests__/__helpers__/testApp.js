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
    metadata: data.metadata || {},
  };

  await testCollections.auditHistory.insertOne(auditEntry);
  return auditEntry;
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

        // Calendar fields
        eventTitle,
        eventDescription: eventDescription || '',
        startDateTime: new Date(startDateTime),
        endDateTime: new Date(endDateTime),
        locations: locations || [],
        locationDisplayNames: [],
        categories: categories || [],
        services: services || [],

        // Room reservation data
        roomReservationData: {
          requesterName: requesterName || req.user.name || '',
          requesterEmail: requesterEmail || userEmail,
          department: department || '',
          phone: phone || '',
          attendees: attendees || 0,
        },

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
        draft.roomReservationData?.requesterEmail === userEmail;
      const isApproverOrAdmin = hasRole(userDoc, userEmail, 'approver');

      if (!isOwner && !isApproverOrAdmin) {
        return res.status(403).json({ error: 'Permission denied. Only the owner or an approver can edit this draft.' });
      }

      const updateFields = {};
      const allowedFields = [
        'eventTitle',
        'eventDescription',
        'startDateTime',
        'endDateTime',
        'locations',
        'categories',
        'services',
      ];

      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          if (field === 'startDateTime' || field === 'endDateTime') {
            updateFields[field] = new Date(req.body[field]);
          } else {
            updateFields[field] = req.body[field];
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
        draft.roomReservationData?.requesterEmail === userEmail;
      const isApproverOrAdmin = hasRole(userDoc, userEmail, 'approver');

      if (!isOwner && !isApproverOrAdmin) {
        return res.status(403).json({ error: 'Permission denied. Only the owner or an approver can submit this draft.' });
      }

      // Update status to pending
      const now = new Date();
      await testCollections.events.updateOne(query, {
        $set: {
          status: 'pending',
          submittedAt: now,
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
        },
      });

      const submittedEvent = await testCollections.events.findOne(query);

      // Create audit log
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
        draft.roomReservationData?.requesterEmail === userEmail;
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
   * PUT /api/admin/events/:id/approve - Approve a pending event
   */
  app.put('/api/admin/events/:id/approve', verifyToken, async (req, res) => {
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
        return res.status(400).json({ error: `Cannot approve event with status: ${event.status}` });
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
          status: 'approved',
          approvedAt: now,
          approvedBy: userEmail,
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
          graphData: {
            id: graphResult.id,
            webLink: graphResult.webLink,
          },
        },
      });

      const approvedEvent = await testCollections.events.findOne(query);

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: 'approved',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        newState: approvedEvent,
        changes: { status: { from: 'pending', to: 'approved' } },
      });

      res.json({
        success: true,
        event: approvedEvent,
      });
    } catch (error) {
      console.error('Error approving event:', error);
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
   * PUT /api/admin/events/:id/restore - Restore a deleted event
   */
  app.put('/api/admin/events/:id/restore', verifyToken, async (req, res) => {
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

      if (!event.isDeleted) {
        return res.status(400).json({ error: 'Event is not deleted' });
      }

      // Restore to previous status
      const restoredStatus = event.previousStatus || 'draft';
      const now = new Date();
      await testCollections.events.updateOne(query, {
        $set: {
          status: restoredStatus,
          isDeleted: false,
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
        },
        $unset: {
          deletedAt: '',
          deletedBy: '',
          previousStatus: '',
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
        changes: { status: { from: 'deleted', to: restoredStatus } },
      });

      res.json({
        success: true,
        event: restoredEvent,
      });
    } catch (error) {
      console.error('Error restoring event:', error);
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
            { 'roomReservationData.requesterEmail': userEmail },
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
   * POST /api/events/:id/request-edit - Request edit on approved event
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
        event.roomReservationData?.requesterEmail === userEmail;

      if (!isOwner) {
        return res.status(403).json({ error: 'Permission denied. You can only request edits on your own events.' });
      }

      if (event.status !== 'approved') {
        return res.status(400).json({ error: 'Can only request edits on approved events' });
      }

      if (event.pendingEditRequest) {
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
   * PUT /api/admin/events/:id/approve-edit - Approve edit request
   */
  app.put('/api/admin/events/:id/approve-edit', verifyToken, async (req, res) => {
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
