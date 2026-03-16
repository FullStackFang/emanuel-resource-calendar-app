/**
 * Test Application Factory
 *
 * Creates a configured Express app for integration testing.
 * Provides database injection and JWT verification bypass for testing.
 */

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId, GridFSBucket } = require('mongodb');
const { getPermissions, isAdmin, canViewAllReservations, hasRole, getEffectiveRole } = require('../../utils/authUtils');
const { detectEventChanges, formatChangesForEmail } = require('../../utils/changeDetection');
const { expandRecurringOccurrencesInWindow, expandAllOccurrences } = require('../../utils/recurrenceExpansion');
const { getAllowedKeys: getAllowedNotifKeys } = require('../../utils/notificationPreferenceKeys');
const { initTestKeys, createMockToken, getTestJwks } = require('./authHelpers');
const { COLLECTIONS, TEST_CALENDAR_OWNER } = require('./testConstants');
const graphApiMock = require('./graphApiMock');

// Store test database reference
let testDb = null;
let testCollections = {};

// Track sent email notifications for test assertions
let sentEmailNotifications = [];

/**
 * Get all sent email notifications (for test assertions)
 * @returns {Array} Array of sent notification records
 */
function getSentEmailNotifications() {
  return sentEmailNotifications;
}

/**
 * Clear sent email notifications (call in beforeEach)
 */
function clearSentEmailNotifications() {
  sentEmailNotifications = [];
}

/**
 * Get reviewer emails (approvers + admins) from test database,
 * respecting per-user notification opt-out preferences.
 * Mirrors emailService.getReviewerEmails().
 * @param {string} preferenceKey - Preference key to check for opt-out (default: 'emailOnNewRequests')
 * @returns {Promise<string[]>} Array of reviewer email addresses
 */
async function getTestReviewerEmails(preferenceKey = 'emailOnNewRequests') {
  if (!testCollections.users) return [];
  const reviewers = await testCollections.users.find({
    $or: [
      { role: 'approver' },
      { role: 'admin' },
      { isAdmin: true }
    ]
  }).toArray();

  const emails = reviewers
    .filter(user => {
      const prefs = user.notificationPreferences;
      if (prefs && prefs[preferenceKey] === false) return false;
      return true;
    })
    .map(user => user.email || user.odataId)
    .filter(email => email && email.includes('@'));

  return [...new Set(emails)];
}

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
    departments: db.collection(COLLECTIONS.DEPARTMENTS),
    categories: db.collection(COLLECTIONS.CATEGORIES),
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
/**
 * Build effective rooms/times for an event with a pending edit request.
 * Merges proposedChanges (delta) with calendarData.
 */
function buildEffectiveEditData(event) {
  const cd = event.calendarData || {};
  const proposed = event.pendingEditRequest?.proposedChanges || {};
  return {
    locations: proposed.locations || proposed.requestedRooms || cd.locations || [],
    startDateTime: proposed.startDateTime || cd.startDateTime,
    endDateTime: proposed.endDateTime || cd.endDateTime,
    setupTimeMinutes: proposed.setupTimeMinutes ?? cd.setupTimeMinutes ?? 0,
    teardownTimeMinutes: proposed.teardownTimeMinutes ?? cd.teardownTimeMinutes ?? 0,
    eventTitle: proposed.eventTitle || cd.eventTitle,
  };
}

async function checkTestConflicts(event, excludeId, eventsCollection, categoriesCollection = null) {
  const roomIds = event.calendarData?.locations || event.locations || [];
  if (roomIds.length === 0) return { hardConflicts: [], softConflicts: [], allConflicts: [] };

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

  const publishedConflicts = await eventsCollection.find(query).toArray();

  // --- Recurring series master expansion ---
  try {
    const recurringQuery = {
      status: 'published',
      eventType: 'seriesMaster',
      $or: [
        { 'calendarData.locations': { $in: roomIds } },
        { locations: { $in: roomIds } },
      ],
      _id: { $ne: excludeId },
    };
    // Exclude already-found conflicts
    const foundIds = publishedConflicts.map(c => c._id);
    if (foundIds.length > 0) {
      recurringQuery._id = { $ne: excludeId, $nin: foundIds };
    }
    const seriesMasters = await eventsCollection.find(recurringQuery).toArray();
    for (const master of seriesMasters) {
      const occurrences = expandRecurringOccurrencesInWindow(master, startTime, endTime);
      for (const occ of occurrences) {
        if (occ.startDateTime < endTimeStr && occ.endDateTime > startTimeStr) {
          publishedConflicts.push(master);
          break;
        }
      }
    }
  } catch (e) {
    // Non-fatal: skip recurring check
  }

  // --- Pending edit request conflicts ---
  const pendingEditQuery = {
    status: 'published',
    'pendingEditRequest.status': 'pending',
    _id: { $ne: excludeId },
    $or: [
      { 'pendingEditRequest.proposedChanges.locations': { $exists: true } },
      { 'pendingEditRequest.proposedChanges.requestedRooms': { $exists: true } },
      { 'pendingEditRequest.proposedChanges.startDateTime': { $exists: true } },
      { 'pendingEditRequest.proposedChanges.endDateTime': { $exists: true } },
    ],
  };

  const pendingEditEvents = await eventsCollection.find(pendingEditQuery).toArray();
  const pendingEditConflicts = [];

  const candidateRoomStrings = roomIds.map(id => id.toString());

  for (const peEvent of pendingEditEvents) {
    const effective = buildEffectiveEditData(peEvent);
    const effectiveLocations = (effective.locations || []).map(id => id.toString());

    // Check room overlap
    const hasRoomOverlap = effectiveLocations.some(loc => candidateRoomStrings.includes(loc));
    if (!hasRoomOverlap) continue;

    // Check time overlap
    const peStart = new Date(effective.startDateTime);
    const peEnd = new Date(effective.endDateTime);
    const peStartStr = toLocalISOString(peStart);
    const peEndStr = toLocalISOString(peEnd);

    const timeOverlap =
      (peStartStr < endTimeStr && peEndStr > startTimeStr);
    if (!timeOverlap) continue;

    pendingEditConflicts.push({
      id: peEvent._id.toString(),
      eventTitle: effective.eventTitle || peEvent.eventTitle,
      startDateTime: effective.startDateTime,
      endDateTime: effective.endDateTime,
      rooms: effective.locations,
      status: peEvent.status,
      isPendingEdit: true,
    });
  }

  // Apply category-level concurrent rules filtering
  let filteredConflicts = publishedConflicts;
  if (categoriesCollection) {
    const requestCategories = event.categories || [];
    let requestCategoryIds = [];
    let requestCategoryAllowedIds = [];
    if (requestCategories.length > 0) {
      const categoryDocs = await categoriesCollection.find({ name: { $in: requestCategories } }).toArray();
      requestCategoryIds = categoryDocs.map(cat => cat._id.toString());
      for (const doc of categoryDocs) {
        for (const allowedId of (doc.allowedConcurrentCategories || [])) {
          const idStr = allowedId.toString();
          if (!requestCategoryAllowedIds.includes(idStr)) requestCategoryAllowedIds.push(idStr);
        }
      }
    }

    // Batch-fetch conflict category docs
    const allConflictCatNames = new Set();
    for (const c of filteredConflicts) {
      for (const n of (c.calendarData?.categories || c.categories || [])) allConflictCatNames.add(n);
    }
    const conflictCatMap = {};
    if (allConflictCatNames.size > 0) {
      const docs = await categoriesCollection.find({ name: { $in: [...allConflictCatNames] } }).toArray();
      for (const doc of docs) conflictCatMap[doc.name] = doc;
    }

    filteredConflicts = filteredConflicts.filter(conflict => {
      const conflictCategories = conflict.calendarData?.categories || conflict.categories || [];
      const conflictCatIds = conflictCategories
        .map(name => conflictCatMap[name]?._id?.toString())
        .filter(Boolean);

      // Request's category rules grant the conflict
      if (conflictCatIds.some(id => requestCategoryAllowedIds.includes(id))) return false;

      // Conflict's category rules grant the request
      const conflictAllowedIds = [];
      for (const catName of conflictCategories) {
        const doc = conflictCatMap[catName];
        for (const allowedId of (doc?.allowedConcurrentCategories || [])) {
          conflictAllowedIds.push(allowedId.toString());
        }
      }
      if (requestCategoryIds.some(id => conflictAllowedIds.includes(id))) return false;

      // Per-event fallback
      const requestAllows = event.isAllowedConcurrent ?? false;
      const conflictAllows = conflict.isAllowedConcurrent ?? false;
      if (!requestAllows && !conflictAllows) return true; // IS a conflict
      if (conflictAllows || requestAllows) return false; // NOT a conflict
      return true;
    });
  }

  const hardConflicts = filteredConflicts.map(c => ({
    id: c._id.toString(),
    eventTitle: c.calendarData?.eventTitle || c.eventTitle,
    startDateTime: c.calendarData?.startDateTime || c.startDateTime,
    endDateTime: c.calendarData?.endDateTime || c.endDateTime,
    rooms: c.calendarData?.locations || c.locations || [],
    status: c.status,
  }));

  return {
    hardConflicts,
    softConflicts: pendingEditConflicts,
    allConflicts: [...hardConflicts, ...pendingEditConflicts]
  };
}

/**
 * Check recurring room conflicts for all occurrences (mirrors checkRecurringRoomConflicts in api-server.js)
 */
async function checkTestRecurringConflicts(params, eventsCollection) {
  const {
    startDateTime, endDateTime, recurrence, roomIds,
    setupTimeMinutes = 0, teardownTimeMinutes = 0,
    excludeEventId = null, isAllowedConcurrent = false,
  } = params;

  if (!roomIds || roomIds.length === 0 || !recurrence?.pattern || !recurrence?.range) {
    return { totalOccurrences: 0, conflictingOccurrences: 0, cleanOccurrences: 0, conflicts: [] };
  }

  const allOccurrences = expandAllOccurrences(recurrence, startDateTime, endDateTime);
  if (allOccurrences.length === 0) {
    return { totalOccurrences: 0, conflictingOccurrences: 0, cleanOccurrences: 0, conflicts: [] };
  }

  const pad = (n) => String(n).padStart(2, '0');
  const toLocalISOString = (d) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  const occurrenceWindows = allOccurrences.map(occ => {
    const start = new Date(occ.startDateTime);
    const end = new Date(occ.endDateTime);
    const effStart = new Date(start.getTime() - (setupTimeMinutes * 60 * 1000));
    const effEnd = new Date(end.getTime() + (teardownTimeMinutes * 60 * 1000));
    return { ...occ, effectiveStart: toLocalISOString(effStart), effectiveEnd: toLocalISOString(effEnd) };
  });

  // Query published non-series events sharing rooms (single span query to avoid N*3 $or branches)
  const excludeIdObj = excludeEventId ? new ObjectId(excludeEventId) : null;
  const spanEffectiveStart = occurrenceWindows[0].effectiveStart;
  const spanEffectiveEnd = occurrenceWindows[occurrenceWindows.length - 1].effectiveEnd;

  const query = {
    status: 'published',
    eventType: { $ne: 'seriesMaster' },
    $or: [
      { 'calendarData.locations': { $in: roomIds } },
      { locations: { $in: roomIds } },
    ],
    'calendarData.startDateTime': { $lt: spanEffectiveEnd },
    'calendarData.endDateTime': { $gt: spanEffectiveStart },
  };
  if (excludeIdObj) query._id = { $ne: excludeIdObj };

  const potentialConflicts = await eventsCollection.find(query).toArray();

  // Find published series masters sharing rooms
  const recurringQuery = {
    status: 'published',
    eventType: 'seriesMaster',
    $or: [
      { 'calendarData.locations': { $in: roomIds } },
      { locations: { $in: roomIds } },
    ],
  };
  if (excludeIdObj) recurringQuery._id = { $ne: excludeIdObj };
  const existingMasters = await eventsCollection.find(recurringQuery).toArray();

  // Map conflicts to occurrences
  const conflictsByDate = {};
  for (const window of occurrenceWindows) {
    const dateConflicts = [];

    for (const conflict of potentialConflicts) {
      const cStart = conflict.calendarData?.startDateTime || conflict.startDateTime || '';
      const cEnd = conflict.calendarData?.endDateTime || conflict.endDateTime || '';
      if (cStart < window.effectiveEnd && cEnd > window.effectiveStart) {
        dateConflicts.push({
          id: conflict._id.toString(),
          eventTitle: conflict.eventTitle || conflict.calendarData?.eventTitle,
          startDateTime: cStart,
          endDateTime: cEnd,
          roomNames: conflict.calendarData?.locationDisplayNames || [],
          status: conflict.status,
        });
      }
    }

    for (const master of existingMasters) {
      const effStartDate = new Date(window.effectiveStart);
      const effEndDate = new Date(window.effectiveEnd);
      const masterOccs = expandRecurringOccurrencesInWindow(master, effStartDate, effEndDate);
      for (const mOcc of masterOccs) {
        if (mOcc.startDateTime < window.effectiveEnd && mOcc.endDateTime > window.effectiveStart) {
          dateConflicts.push({
            id: master._id.toString(),
            eventTitle: master.eventTitle || master.calendarData?.eventTitle,
            startDateTime: mOcc.startDateTime,
            endDateTime: mOcc.endDateTime,
            roomNames: master.calendarData?.locationDisplayNames || [],
            status: master.status,
          });
          break;
        }
      }
    }

    if (dateConflicts.length > 0) {
      conflictsByDate[window.occurrenceDate] = {
        occurrenceDate: window.occurrenceDate,
        occurrenceStart: window.startDateTime,
        occurrenceEnd: window.endDateTime,
        hardConflicts: dateConflicts,
        softConflicts: [],
      };
    }
  }

  const conflicts = Object.values(conflictsByDate).sort((a, b) => a.occurrenceDate.localeCompare(b.occurrenceDate));
  return {
    totalOccurrences: allOccurrences.length,
    conflictingOccurrences: conflicts.length,
    cleanOccurrences: allOccurrences.length - conflicts.length,
    conflicts,
  };
}

/**
 * Extract time portion (HH:MM:SS) from a value that may be a Date, string, or null.
 */
function extractTimePart(val, fallback) {
  if (!val) return fallback;
  if (val instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(val.getHours())}:${pad(val.getMinutes())}:${pad(val.getSeconds())}`;
  }
  if (typeof val === 'string' && val.includes('T')) return val.split('T')[1].replace(/Z$/, '') || fallback;
  return fallback;
}

/**
 * Build Graph API compatible recurrence object from internal format.
 * Mirrors buildGraphRecurrence() in api-server.js.
 */
function buildGraphRecurrence(recurrence) {
  if (!recurrence?.pattern || !recurrence?.range) return null;

  const graphTypeMap = { 'monthly': 'absoluteMonthly', 'yearly': 'absoluteYearly' };
  const rawType = recurrence.pattern.type || 'weekly';

  const pattern = {
    type: graphTypeMap[rawType] || rawType,
    interval: recurrence.pattern.interval || 1,
  };
  if (recurrence.pattern.daysOfWeek) pattern.daysOfWeek = recurrence.pattern.daysOfWeek;
  if (recurrence.pattern.dayOfMonth) pattern.dayOfMonth = recurrence.pattern.dayOfMonth;
  if (recurrence.pattern.month) pattern.month = recurrence.pattern.month;
  if (recurrence.pattern.index) pattern.index = recurrence.pattern.index;
  if (recurrence.pattern.firstDayOfWeek && rawType === 'weekly') {
    pattern.firstDayOfWeek = recurrence.pattern.firstDayOfWeek;
  }

  const range = {
    type: recurrence.range.type || 'noEnd',
    startDate: recurrence.range.startDate,
    recurrenceTimeZone: recurrence.range.recurrenceTimeZone || 'Eastern Standard Time',
  };
  if (recurrence.range.type === 'endDate' && recurrence.range.endDate) range.endDate = recurrence.range.endDate;
  if (recurrence.range.type === 'numbered' && recurrence.range.numberOfOccurrences) {
    range.numberOfOccurrences = recurrence.range.numberOfOccurrences;
  }
  return { pattern, range };
}

/**
 * Sync recurrence exclusions/additions to Graph after series creation.
 * Mirrors syncRecurrenceExceptionsToGraph() in api-server.js.
 */
async function syncRecurrenceExceptionsToGraph(calendarOwner, calendarId, seriesId, recurrence, eventData, occurrenceOverrides = []) {
  const results = { cancelledOccurrences: [], additionEventIds: [] };

  if (recurrence.exclusions?.length) {
    for (const exclusionDate of recurrence.exclusions) {
      try {
        const dayStart = `${exclusionDate}T00:00:00`;
        const dayEnd = `${exclusionDate}T23:59:59`;
        const instances = await graphApiMock.getRecurringEventInstances(
          calendarOwner, calendarId, seriesId, dayStart, dayEnd
        );
        const instanceList = Array.isArray(instances) ? instances : (instances?.value || []);
        const match = instanceList.find(inst => inst.start?.dateTime?.startsWith(exclusionDate));
        if (match) {
          await graphApiMock.deleteCalendarEvent(calendarOwner, calendarId, match.id);
          results.cancelledOccurrences.push({ date: exclusionDate, graphId: match.id });
        }
      } catch (err) { /* ignore per-exclusion errors in tests */ }
    }
  }

  if (recurrence.additions?.length) {
    const timePart = eventData.start?.dateTime?.split('T')[1] || eventData.startDateTime?.split('T')[1] || '09:00:00';
    const endTimePart = eventData.end?.dateTime?.split('T')[1] || eventData.endDateTime?.split('T')[1] || '10:00:00';
    for (const additionDate of recurrence.additions) {
      try {
        const additionEvent = {
          subject: eventData.subject || eventData.eventTitle,
          start: { dateTime: `${additionDate}T${timePart}`, timeZone: 'America/New_York' },
          end: { dateTime: `${additionDate}T${endTimePart}`, timeZone: 'America/New_York' },
          body: eventData.body,
          categories: eventData.categories,
        };
        // Apply occurrence override data if present
        const override = occurrenceOverrides.find(o => o.occurrenceDate === additionDate);
        if (override) {
          if (override.categories !== undefined) additionEvent.categories = override.categories;
          if (override.locationDisplayNames !== undefined) {
            const locDispName = override.locationDisplayNames || '';
            additionEvent.location = { displayName: locDispName, locationType: 'default' };
            additionEvent.locations = locDispName.split('; ').filter(Boolean).map(n => ({ displayName: n, locationType: 'default' }));
          }
        }
        const created = await graphApiMock.createCalendarEvent(calendarOwner, calendarId, additionEvent);
        results.additionEventIds.push({ date: additionDate, graphId: created.id });
      } catch (err) { /* ignore per-addition errors in tests */ }
    }
  }

  return results;
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

      const { editScope, occurrenceDate, clearOccurrenceOverrides } = req.body;

      // --- thisEvent scope: write per-occurrence override and return early ---
      if (editScope === 'thisEvent' && occurrenceDate) {
        const dateKey = occurrenceDate.split('T')[0];

        // Validate dateKey falls within series range (additions are valid even outside range)
        const recurrence = draft.calendarData?.recurrence;
        const recRange = recurrence?.range;
        const additions = recurrence?.additions || [];
        if (recRange?.endDate && (dateKey < recRange.startDate || dateKey > recRange.endDate) && !additions.includes(dateKey)) {
          return res.status(400).json({ error: 'Occurrence date is outside series range' });
        }

        // Build override from changed fields
        const overrideFields = { occurrenceDate: dateKey };
        if (req.body.startTime !== undefined) overrideFields.startTime = req.body.startTime;
        if (req.body.endTime !== undefined) overrideFields.endTime = req.body.endTime;
        if (req.body.eventTitle !== undefined) overrideFields.eventTitle = req.body.eventTitle?.trim();
        if (req.body.eventDescription !== undefined) overrideFields.eventDescription = req.body.eventDescription;
        if (req.body.startTime) overrideFields.startDateTime = `${dateKey}T${req.body.startTime}`;
        if (req.body.endTime) overrideFields.endDateTime = `${dateKey}T${req.body.endTime}`;
        if (req.body.setupTime !== undefined) overrideFields.setupTime = req.body.setupTime;
        if (req.body.teardownTime !== undefined) overrideFields.teardownTime = req.body.teardownTime;
        if (req.body.doorOpenTime !== undefined) overrideFields.doorOpenTime = req.body.doorOpenTime;
        if (req.body.doorCloseTime !== undefined) overrideFields.doorCloseTime = req.body.doorCloseTime;
        if (req.body.categories !== undefined || req.body.mecCategories !== undefined) overrideFields.categories = req.body.categories || req.body.mecCategories;
        if (req.body.services !== undefined) overrideFields.services = req.body.services;
        if (req.body.isOffsite !== undefined) overrideFields.isOffsite = req.body.isOffsite;
        if (req.body.offsiteName !== undefined) overrideFields.offsiteName = req.body.offsiteName;
        if (req.body.offsiteAddress !== undefined) overrideFields.offsiteAddress = req.body.offsiteAddress;

        // Handle locations
        const rawLocations = req.body.requestedRooms || req.body.locations;
        if (rawLocations !== undefined) {
          if (Array.isArray(rawLocations) && rawLocations.length > 0) {
            try {
              const locationIds = rawLocations.map(lid =>
                typeof lid === 'string' ? new ObjectId(lid) : lid
              );
              overrideFields.locations = locationIds;

              const locationDocs = await testCollections.locations.find({
                _id: { $in: locationIds }
              }).toArray();
              const displayNames = locationDocs
                .map(loc => loc.displayName || loc.name || '')
                .filter(Boolean)
                .join('; ');
              if (displayNames) {
                overrideFields.locationDisplayNames = displayNames;
              }
            } catch (locErr) {
              overrideFields.locations = rawLocations;
            }
          } else {
            overrideFields.locations = [];
            overrideFields.locationDisplayNames = '';
          }
        }

        // Remove existing override for this date, then add new one
        await testCollections.events.updateOne(
          query,
          { $pull: { occurrenceOverrides: { occurrenceDate: dateKey } } }
        );
        await testCollections.events.updateOne(
          query,
          {
            $push: { occurrenceOverrides: overrideFields },
            $set: { lastDraftSaved: new Date(), lastModified: new Date() }
          }
        );

        const updatedDraft = await testCollections.events.findOne(query);
        return res.json(updatedDraft);
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
        'recurrence',
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

      // Set eventType based on recurrence
      if (req.body.recurrence?.pattern && req.body.recurrence?.range) {
        updateFields.eventType = 'seriesMaster';
      } else if (req.body.recurrence !== undefined) {
        updateFields.eventType = 'singleInstance';
      }

      // Clear per-occurrence overrides only when explicitly requested (recurrence pattern changed)
      if (clearOccurrenceOverrides) {
        updateFields.occurrenceOverrides = [];
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

      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: 'Draft is incomplete and cannot be submitted',
          validationErrors
        });
      }

      // Check for scheduling conflicts
      // For recurring events: non-blocking (conflicts reported in response)
      // For non-recurring events: blocking (409 on hard conflicts)
      let draftRecurringConflicts = null;
      const draftSubmitRecurrence = draft.recurrence || cd.recurrence;
      const isDraftRecurringSubmit = draftSubmitRecurrence?.pattern && draftSubmitRecurrence?.range;

      const roomIds = cd.locations || [];
      if (roomIds.length > 0) {
        if (isDraftRecurringSubmit) {
          try {
            draftRecurringConflicts = await checkTestRecurringConflicts({
              startDateTime: cd.startDateTime,
              endDateTime: cd.endDateTime,
              recurrence: draftSubmitRecurrence,
              roomIds,
              setupTimeMinutes: cd.setupTimeMinutes || 0,
              teardownTimeMinutes: cd.teardownTimeMinutes || 0,
              excludeEventId: draft._id.toString(),
            }, testCollections.events);
          } catch (err) {
            // Non-fatal
          }
        } else {
          const conflictEvent = {
            ...draft,
            startDateTime: cd.startDateTime,
            endDateTime: cd.endDateTime,
            calendarData: { ...cd, locations: roomIds },
          };
          const { hardConflicts, softConflicts, allConflicts } = await checkTestConflicts(conflictEvent, draft._id, testCollections.events, testCollections.categories);
          if (hardConflicts.length > 0) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              conflictTier: 'hard',
              message: `Cannot submit: ${hardConflicts.length} scheduling conflict(s) with published events`,
              hardConflicts,
              softConflicts,
              conflicts: allConflicts,
              canForce: false,
            });
          }
          if (softConflicts.length > 0 && !req.body.acknowledgeSoftConflicts) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              conflictTier: 'soft',
              message: `${softConflicts.length} pending edit request(s) may conflict with this time`,
              hardConflicts: [],
              softConflicts,
              conflicts: softConflicts,
            });
          }
        }
      }

      const now = new Date();
      let canAutoPublish = isApproverOrAdmin;

      // Respect role simulation: if simulating a non-approver role, skip auto-publish
      const simulatedRole = req.headers['x-simulated-role'];
      if (simulatedRole && !['approver', 'admin'].includes(simulatedRole)) {
        canAutoPublish = false;
      }

      // Downgrade approver auto-publish to pending when recurring hard conflicts exist
      // Only admins can auto-publish recurring events with conflicts
      let conflictDowngradedToPending = false;
      if (canAutoPublish && isDraftRecurringSubmit &&
          draftRecurringConflicts?.conflictingOccurrences > 0 &&
          !isAdmin(userDoc, userEmail)) {
        canAutoPublish = false;
        conflictDowngradedToPending = true;
      }

      if (canAutoPublish) {
        // Auto-publish path for admins/approvers
        const draftLocDisplayNames = cd.locationDisplayNames || draft.graphData?.location?.displayName || '';
        const draftLocDisplayNamesStr = Array.isArray(draftLocDisplayNames)
          ? draftLocDisplayNames.join('; ')
          : (draftLocDisplayNames || '');
        const draftGraphData = {
          subject: cd.eventTitle,
          startDateTime: cd.startDateTime,
          endDateTime: cd.endDateTime,
          eventDescription: cd.eventDescription,
          categories: cd.categories || [],
          location: { displayName: draftLocDisplayNamesStr },
          locations: draftLocDisplayNamesStr
            .split('; ')
            .filter(Boolean)
            .map(name => ({ displayName: name, locationType: 'default' })),
        };
        // Include recurrence if draft has recurring pattern
        const draftRecurrence = draft.recurrence || cd.recurrence;
        if (draftRecurrence?.pattern && draftRecurrence?.range) {
          const graphRecurrence = buildGraphRecurrence(draftRecurrence);
          if (graphRecurrence) {
            draftGraphData.recurrence = graphRecurrence;
            // Align start/end dates with range.startDate
            const rangeStart = graphRecurrence.range.startDate;
            if (rangeStart) {
              const startTime = extractTimePart(draftGraphData.startDateTime, '00:00:00');
              const endTime = extractTimePart(draftGraphData.endDateTime, '23:59:00');
              draftGraphData.start = { dateTime: `${rangeStart}T${startTime}`, timeZone: 'America/New_York' };
              draftGraphData.end = { dateTime: `${rangeStart}T${endTime}`, timeZone: 'America/New_York' };
            }
          }
        }
        const graphResult = await graphApiMock.createCalendarEvent(
          TEST_CALENDAR_OWNER,
          null,
          draftGraphData
        );

        // Sync exclusions/additions to Graph after series creation
        const draftOccOverrides = draft.occurrenceOverrides || cd.occurrenceOverrides;
        let draftSyncResults = null;
        if (draftRecurrence && (draftRecurrence.exclusions?.length || draftRecurrence.additions?.length)) {
          try {
            draftSyncResults = await syncRecurrenceExceptionsToGraph(
              TEST_CALENDAR_OWNER, null, graphResult.id, draftRecurrence, draftGraphData, draftOccOverrides || []
            );
          } catch (syncError) { /* ignore in tests */ }
        }

        // Sync occurrence-level overrides to Graph
        if (draftOccOverrides?.length) {
          const draftAdditionIds = draftSyncResults?.additionEventIds || [];
          for (const override of draftOccOverrides) {
            const hasCats = override.categories !== undefined;
            const hasLocs = override.locationDisplayNames !== undefined;
            if (!hasCats && !hasLocs) continue;
            try {
              // Fast-path: addition events are standalone, PATCH directly
              const additionEntry = draftAdditionIds.find(e => e.date === override.occurrenceDate);
              if (additionEntry) {
                const patch = {};
                if (hasCats) patch.categories = override.categories;
                if (hasLocs) {
                  const ldn = override.locationDisplayNames || '';
                  patch.location = { displayName: ldn, locationType: 'default' };
                  patch.locations = ldn.split('; ').filter(Boolean).map(n => ({ displayName: n, locationType: 'default' }));
                }
                await graphApiMock.updateCalendarEvent(TEST_CALENDAR_OWNER, null, additionEntry.graphId, patch);
                continue;
              }

              const dayStart = `${override.occurrenceDate}T00:00:00`;
              const dayEnd = `${override.occurrenceDate}T23:59:59`;
              const instances = await graphApiMock.getRecurringEventInstances(
                TEST_CALENDAR_OWNER, null, graphResult.id, dayStart, dayEnd
              );
              const instanceList = Array.isArray(instances) ? instances : [];
              const match = instanceList.find(inst =>
                inst.start?.dateTime?.startsWith(override.occurrenceDate)
              );
              if (match) {
                const patch = {};
                if (hasCats) patch.categories = override.categories;
                if (hasLocs) {
                  const ldn = override.locationDisplayNames || '';
                  patch.location = { displayName: ldn, locationType: 'default' };
                  patch.locations = ldn.split('; ').filter(Boolean).map(n => ({ displayName: n, locationType: 'default' }));
                }
                await graphApiMock.updateCalendarEvent(TEST_CALENDAR_OWNER, null, match.id, patch);
              }
            } catch (e) { /* ignore */ }
          }
        }

        const draftPublishSet = {
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
        };
        // Set eventType for recurring events
        if (draftRecurrence?.pattern && draftRecurrence?.range) {
          draftPublishSet.eventType = 'seriesMaster';
        }
        // Persist recurrence exception sync results
        if (draftSyncResults?.cancelledOccurrences?.length) {
          draftPublishSet.graphData.cancelledOccurrences = draftSyncResults.cancelledOccurrences;
        }
        if (draftSyncResults?.additionEventIds?.length) {
          draftPublishSet.exceptionEventIds = draftSyncResults.additionEventIds;
        }
        await testCollections.events.updateOne(query, {
          $set: draftPublishSet,
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

        // Track reviewer notification
        const reviewerEmails = await getTestReviewerEmails();
        if (reviewerEmails.length > 0) {
          sentEmailNotifications.push({
            type: 'new_request_alert',
            to: reviewerEmails,
            eventTitle: cd.eventTitle,
            eventId: draft.eventId,
          });
        }

        const pendingResponse = {
          success: true,
          event: submittedEvent,
        };
        if (conflictDowngradedToPending) {
          pendingResponse.conflictDowngradedToPending = true;
          pendingResponse.recurringConflicts = draftRecurringConflicts;
        }
        res.json(pendingResponse);
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
      // Recurring events: non-blocking (conflicts in response, not 409)
      // Non-recurring events: blocking (409 on hard conflicts)
      const { forcePublish, acknowledgeSoftConflicts } = req.body;
      let recurringConflicts = null;
      const testPublishRecurrence = event.recurrence || event.calendarData?.recurrence;
      const isTestRecurringPublish = testPublishRecurrence?.pattern && testPublishRecurrence?.range;

      if (!forcePublish) {
        const roomIds = event.calendarData?.locations || event.locations || [];
        if (roomIds.length > 0) {
          if (isTestRecurringPublish) {
            // Non-blocking recurring conflict check
            try {
              recurringConflicts = await checkTestRecurringConflicts({
                startDateTime: event.calendarData?.startDateTime || event.startDateTime,
                endDateTime: event.calendarData?.endDateTime || event.endDateTime,
                recurrence: testPublishRecurrence,
                roomIds,
                setupTimeMinutes: event.calendarData?.setupTimeMinutes || 0,
                teardownTimeMinutes: event.calendarData?.teardownTimeMinutes || 0,
                excludeEventId: event._id.toString(),
              }, testCollections.events);
            } catch (err) {
              // Non-fatal
            }
          } else {
            const { hardConflicts, softConflicts, allConflicts } = await checkTestConflicts(event, event._id, testCollections.events, testCollections.categories);
            if (hardConflicts.length > 0) {
              return res.status(409).json({
                error: 'SchedulingConflict',
                conflictTier: 'hard',
                message: `Cannot publish: ${hardConflicts.length} scheduling conflict(s) with published events`,
                hardConflicts,
                softConflicts,
                conflicts: allConflicts,
                canForce: true,
                forceField: 'forcePublish',
                _version: event._version,
              });
            }
            if (softConflicts.length > 0 && !acknowledgeSoftConflicts) {
              return res.status(409).json({
                error: 'SchedulingConflict',
                conflictTier: 'soft',
                message: `${softConflicts.length} pending edit request(s) may conflict with this time`,
                hardConflicts: [],
                softConflicts,
                conflicts: softConflicts,
                _version: event._version,
              });
            }
          }
        }
      }

      // Build Graph event data
      const rawLocDisplayNames = event.calendarData?.locationDisplayNames || event.graphData?.location?.displayName || '';
      const locDisplayNamesStr = Array.isArray(rawLocDisplayNames)
        ? rawLocDisplayNames.join('; ')
        : (rawLocDisplayNames || '');
      const graphEventData = {
        subject: event.eventTitle,
        startDateTime: event.startDateTime,
        endDateTime: event.endDateTime,
        eventDescription: event.eventDescription,
        categories: event.calendarData?.categories || event.categories || [],
        location: { displayName: locDisplayNamesStr },
        locations: locDisplayNamesStr
          .split('; ')
          .filter(Boolean)
          .map(name => ({ displayName: name, locationType: 'default' })),
      };

      // Include recurrence if event has a recurring pattern
      const publishRecurrence = event.recurrence || event.calendarData?.recurrence;
      if (publishRecurrence?.pattern && publishRecurrence?.range) {
        const graphRecurrence = buildGraphRecurrence(publishRecurrence);
        if (graphRecurrence) {
          graphEventData.recurrence = graphRecurrence;
          // Align start/end dates with range.startDate
          const rangeStart = graphRecurrence.range.startDate;
          if (rangeStart) {
            const startTime = extractTimePart(graphEventData.startDateTime, '00:00:00');
            const endTime = extractTimePart(graphEventData.endDateTime, '23:59:00');
            graphEventData.start = { dateTime: `${rangeStart}T${startTime}`, timeZone: 'America/New_York' };
            graphEventData.end = { dateTime: `${rangeStart}T${endTime}`, timeZone: 'America/New_York' };
          }
        }
      }

      // Mock Graph API call
      const graphResult = await graphApiMock.createCalendarEvent(
        TEST_CALENDAR_OWNER,
        null,
        graphEventData
      );

      // Sync exclusions/additions to Graph after series creation
      const eventOccOverrides = event.occurrenceOverrides || event.calendarData?.occurrenceOverrides;
      let publishSyncResults = null;
      if (publishRecurrence && (publishRecurrence.exclusions?.length || publishRecurrence.additions?.length)) {
        try {
          publishSyncResults = await syncRecurrenceExceptionsToGraph(
            TEST_CALENDAR_OWNER, null, graphResult.id, publishRecurrence, graphEventData, eventOccOverrides || []
          );
        } catch (syncError) { /* ignore in tests */ }
      }

      // Sync occurrence-level overrides to Graph
      if (eventOccOverrides?.length) {
        const publishAdditionIds = publishSyncResults?.additionEventIds || [];
        for (const override of eventOccOverrides) {
          const hasCats = override.categories !== undefined;
          const hasLocs = override.locationDisplayNames !== undefined;
          if (!hasCats && !hasLocs) continue;
          try {
            // Fast-path: addition events are standalone, PATCH directly
            const additionEntry = publishAdditionIds.find(e => e.date === override.occurrenceDate);
            if (additionEntry) {
              const patch = {};
              if (hasCats) patch.categories = override.categories;
              if (hasLocs) {
                const ldn = override.locationDisplayNames || '';
                patch.location = { displayName: ldn, locationType: 'default' };
                patch.locations = ldn.split('; ').filter(Boolean).map(n => ({ displayName: n, locationType: 'default' }));
              }
              await graphApiMock.updateCalendarEvent(TEST_CALENDAR_OWNER, null, additionEntry.graphId, patch);
              continue;
            }

            const dayStart = `${override.occurrenceDate}T00:00:00`;
            const dayEnd = `${override.occurrenceDate}T23:59:59`;
            const instances = await graphApiMock.getRecurringEventInstances(
              TEST_CALENDAR_OWNER, null, graphResult.id, dayStart, dayEnd
            );
            const instanceList = Array.isArray(instances) ? instances : [];
            const match = instanceList.find(inst =>
              inst.start?.dateTime?.startsWith(override.occurrenceDate)
            );
            if (match) {
              const patch = {};
              if (hasCats) patch.categories = override.categories;
              if (hasLocs) {
                const ldn = override.locationDisplayNames || '';
                patch.location = { displayName: ldn, locationType: 'default' };
                patch.locations = ldn.split('; ').filter(Boolean).map(n => ({ displayName: n, locationType: 'default' }));
              }
              await graphApiMock.updateCalendarEvent(TEST_CALENDAR_OWNER, null, match.id, patch);
            }
          } catch (e) { /* ignore */ }
        }
      }

      // Update event status
      const now = new Date();
      const publishSet = {
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
      };
      // Set eventType for recurring events
      if (publishRecurrence?.pattern && publishRecurrence?.range) {
        publishSet.eventType = 'seriesMaster';
      }
      // Persist recurrence exception sync results
      if (publishSyncResults?.cancelledOccurrences?.length) {
        publishSet.graphData.cancelledOccurrences = publishSyncResults.cancelledOccurrences;
      }
      if (publishSyncResults?.additionEventIds?.length) {
        publishSet.exceptionEventIds = publishSyncResults.additionEventIds;
      }
      // Store recurring conflict snapshot
      if (recurringConflicts && recurringConflicts.totalOccurrences > 0) {
        publishSet.recurringConflictSnapshot = {
          checkedAt: now,
          conflictCount: recurringConflicts.conflictingOccurrences,
          totalOccurrences: recurringConflicts.totalOccurrences,
        };
      }
      await testCollections.events.updateOne(query, {
        $set: publishSet,
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

      const publishResponse = {
        success: true,
        event: publishedEvent,
        reviewChanges: reviewChanges.length > 0 ? reviewChanges : undefined,
      };
      if (recurringConflicts && recurringConflicts.conflictingOccurrences > 0) {
        publishResponse.recurringConflicts = recurringConflicts;
      }
      res.json(publishResponse);
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

      const { editScope, occurrenceDate, _version } = req.body;

      // Handle single occurrence deletion for recurring events
      if (editScope === 'thisEvent') {
        // Resolve recurrence from top-level or calendarData (production stores in calendarData)
        const recurrence = event.recurrence || event.calendarData?.recurrence;
        const recurrencePath = event.recurrence ? 'recurrence' : 'calendarData.recurrence';

        // Validate series master
        if (event.eventType !== 'seriesMaster' || !recurrence) {
          return res.status(400).json({
            error: 'InvalidEventType',
            message: 'Cannot delete single occurrence: event is not a recurring series master'
          });
        }

        const dateKey = occurrenceDate ? occurrenceDate.split('T')[0] : null;
        if (!dateKey) {
          return res.status(400).json({
            error: 'MissingOccurrenceDate',
            message: 'occurrenceDate is required for single occurrence deletion'
          });
        }

        // OCC version check
        if (_version != null && event._version != null && event._version !== _version) {
          return res.status(409).json({
            error: 'VERSION_CONFLICT',
            details: {
              code: 'VERSION_CONFLICT',
              expectedVersion: _version,
              currentVersion: event._version
            }
          });
        }

        const now = new Date();

        // Add to exclusions and push statusHistory
        await testCollections.events.updateOne(query, {
          $addToSet: { [recurrencePath + '.exclusions']: dateKey },
          $push: {
            statusHistory: {
              status: event.status,
              changedAt: now,
              changedBy: userId,
              changedByEmail: userEmail,
              reason: `Occurrence ${dateKey} excluded (deleted)`
            }
          },
          $set: {
            lastModifiedDateTime: now,
            lastModifiedBy: userId,
            _version: (event._version || 0) + 1
          }
        });

        // Clean up overrides and additions
        const cleanupOps = {};
        if (event.occurrenceOverrides && event.occurrenceOverrides.some(o => o.occurrenceDate === dateKey)) {
          cleanupOps.$pull = { occurrenceOverrides: { occurrenceDate: dateKey } };
        }
        if (recurrence.additions && recurrence.additions.includes(dateKey)) {
          if (!cleanupOps.$pull) cleanupOps.$pull = {};
          cleanupOps.$pull[recurrencePath + '.additions'] = dateKey;
        }
        if (Object.keys(cleanupOps).length > 0) {
          await testCollections.events.updateOne(query, cleanupOps);
        }

        // Check remaining occurrences
        const masterStart = event.calendarData?.startDateTime || event.startDateTime;
        const masterEnd = event.calendarData?.endDateTime || event.endDateTime;
        const updatedExclusions = [...new Set([...(recurrence.exclusions || []), dateKey])];
        const updatedAdditions = (recurrence.additions || []).filter(a => a !== dateKey);
        const updatedRecurrence = {
          ...recurrence,
          exclusions: updatedExclusions,
          additions: updatedAdditions
        };
        const remaining = expandAllOccurrences(updatedRecurrence, masterStart, masterEnd);
        let autoDeleted = false;

        if (remaining.length === 0) {
          await testCollections.events.updateOne(query, {
            $set: {
              status: 'deleted',
              isDeleted: true,
              deletedAt: now,
              deletedBy: userId
            },
            $push: {
              statusHistory: {
                status: 'deleted',
                changedAt: now,
                changedBy: userId,
                changedByEmail: userEmail,
                reason: 'Auto-deleted: all occurrences excluded'
              }
            }
          });
          autoDeleted = true;
        }

        return res.json({
          success: true,
          occurrenceExcluded: true,
          excludedDate: dateKey,
          remainingOccurrences: remaining.length,
          autoDeleted,
          _version: (event._version || 0) + 1
        });
      }

      // Soft delete (allEvents scope or non-recurring)
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

      // Track deletion notification (only for previously-published events)
      if (event.status === 'published') {
        const cd = event.calendarData || {};
        const requestedBy = event.roomReservationData?.requestedBy || {};
        req.app.locals.lastDeletionEmail = {
          recipientEmail: requestedBy.email || null,
          eventTitle: cd.eventTitle || event.eventTitle,
          startDateTime: cd.startDateTime || event.startDateTime,
          endDateTime: cd.endDateTime || event.endDateTime,
          locationDisplayNames: cd.locationDisplayNames || [],
          requesterName: requestedBy.name || null,
          sentAt: new Date(),
        };
      } else {
        req.app.locals.lastDeletionEmail = null;
      }

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
          const { hardConflicts, softConflicts, allConflicts } = await checkTestConflicts(event, event._id, testCollections.events, testCollections.categories);
          if (hardConflicts.length > 0) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              conflictTier: 'hard',
              message: `Cannot restore: ${hardConflicts.length} scheduling conflict(s) with published events`,
              hardConflicts,
              softConflicts,
              conflicts: allConflicts,
              canForce: true,
              forceField: 'forceRestore',
              previousStatus,
              _version: event._version,
            });
          }
          if (softConflicts.length > 0 && !req.body.acknowledgeSoftConflicts) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              conflictTier: 'soft',
              message: `${softConflicts.length} pending edit request(s) may conflict with this time`,
              hardConflicts: [],
              softConflicts,
              conflicts: softConflicts,
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
          const graphEventData = {
            subject: event.eventTitle,
            start: { dateTime: event.startDateTime, timeZone: 'America/New_York' },
            end: { dateTime: event.endDateTime, timeZone: 'America/New_York' },
            body: { contentType: 'Text', content: event.eventDescription || '' },
          };

          // Add recurrence if event has a recurring pattern
          const adminRestoreRecurrence = event.recurrence || event.calendarData?.recurrence;
          if (adminRestoreRecurrence?.pattern && adminRestoreRecurrence?.range) {
            const graphRecurrence = buildGraphRecurrence(adminRestoreRecurrence);
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

          const graphResult = await graphApiMock.createCalendarEvent(
            TEST_CALENDAR_OWNER, null, graphEventData
          );

          const graphUpdate = {
            'graphData.id': graphResult.id,
            'graphData.iCalUId': graphResult.iCalUId,
            'graphData.webLink': graphResult.webLink,
          };

          // Sync exclusions/additions to Graph after series creation
          const adminRestoreOverrides = event.occurrenceOverrides || event.calendarData?.occurrenceOverrides;
          let adminRestoreSyncResults = null;
          if (adminRestoreRecurrence && (adminRestoreRecurrence.exclusions?.length || adminRestoreRecurrence.additions?.length)) {
            try {
              adminRestoreSyncResults = await syncRecurrenceExceptionsToGraph(
                TEST_CALENDAR_OWNER, null, graphResult.id, adminRestoreRecurrence, graphEventData, adminRestoreOverrides || []
              );
              if (adminRestoreSyncResults.cancelledOccurrences.length) {
                graphUpdate['graphData.cancelledOccurrences'] = adminRestoreSyncResults.cancelledOccurrences;
              }
              if (adminRestoreSyncResults.additionEventIds.length) {
                graphUpdate.exceptionEventIds = adminRestoreSyncResults.additionEventIds;
              }
            } catch (syncError) { /* ignore */ }
          }

          // Sync occurrence-level overrides to Graph
          if (adminRestoreOverrides?.length) {
            const adminAdditionIds = adminRestoreSyncResults?.additionEventIds || [];
            for (const override of adminRestoreOverrides) {
              const hasCats = override.categories !== undefined;
              const hasLocs = override.locationDisplayNames !== undefined;
              if (!hasCats && !hasLocs) continue;
              try {
                const additionEntry = adminAdditionIds.find(e => e.date === override.occurrenceDate);
                if (additionEntry) {
                  const patch = {};
                  if (hasCats) patch.categories = override.categories;
                  if (hasLocs) {
                    const ldn = override.locationDisplayNames || '';
                    patch.location = { displayName: ldn, locationType: 'default' };
                    patch.locations = ldn.split('; ').filter(Boolean).map(n => ({ displayName: n, locationType: 'default' }));
                  }
                  await graphApiMock.updateCalendarEvent(TEST_CALENDAR_OWNER, null, additionEntry.graphId, patch);
                  continue;
                }
                const dayStart = `${override.occurrenceDate}T00:00:00`;
                const dayEnd = `${override.occurrenceDate}T23:59:59`;
                const instances = await graphApiMock.getRecurringEventInstances(
                  TEST_CALENDAR_OWNER, null, graphResult.id, dayStart, dayEnd
                );
                const instanceList = Array.isArray(instances) ? instances : [];
                const match = instanceList.find(inst => inst.start?.dateTime?.startsWith(override.occurrenceDate));
                if (match) {
                  const patch = {};
                  if (hasCats) patch.categories = override.categories;
                  if (hasLocs) {
                    const ldn = override.locationDisplayNames || '';
                    patch.location = { displayName: ldn, locationType: 'default' };
                    patch.locations = ldn.split('; ').filter(Boolean).map(n => ({ displayName: n, locationType: 'default' }));
                  }
                  await graphApiMock.updateCalendarEvent(TEST_CALENDAR_OWNER, null, match.id, patch);
                }
              } catch (e) { /* ignore */ }
            }
          }

          await testCollections.events.updateOne(query, { $set: graphUpdate });
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
          const { hardConflicts, softConflicts, allConflicts } = await checkTestConflicts(event, event._id, testCollections.events, testCollections.categories);
          if (hardConflicts.length > 0) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              conflictTier: 'hard',
              message: `Cannot restore: ${hardConflicts.length} scheduling conflict(s) with published events. Please submit a new reservation with different times or contact an admin.`,
              hardConflicts,
              softConflicts,
              conflicts: allConflicts,
              canForce: false,
              previousStatus,
              _version: event._version,
            });
          }
          if (softConflicts.length > 0 && !req.body.acknowledgeSoftConflicts) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              conflictTier: 'soft',
              message: `${softConflicts.length} pending edit request(s) may conflict with this time`,
              hardConflicts: [],
              softConflicts,
              conflicts: softConflicts,
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
          const graphEventData = {
            subject: event.eventTitle,
            start: { dateTime: event.startDateTime, timeZone: 'America/New_York' },
            end: { dateTime: event.endDateTime, timeZone: 'America/New_York' },
            body: { contentType: 'Text', content: event.eventDescription || '' },
          };

          // Add recurrence if reservation has a recurring pattern
          const ownerRestoreRecurrence = event.recurrence || event.calendarData?.recurrence;
          if (ownerRestoreRecurrence?.pattern && ownerRestoreRecurrence?.range) {
            const graphRecurrence = buildGraphRecurrence(ownerRestoreRecurrence);
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

          const graphResult = await graphApiMock.createCalendarEvent(
            TEST_CALENDAR_OWNER, null, graphEventData
          );

          const graphUpdate = {
            'graphData.id': graphResult.id,
            'graphData.iCalUId': graphResult.iCalUId,
            'graphData.webLink': graphResult.webLink,
          };

          // Sync exclusions/additions to Graph after series creation
          const ownerRestoreOverrides = event.occurrenceOverrides || event.calendarData?.occurrenceOverrides;
          let ownerRestoreSyncResults = null;
          if (ownerRestoreRecurrence && (ownerRestoreRecurrence.exclusions?.length || ownerRestoreRecurrence.additions?.length)) {
            try {
              ownerRestoreSyncResults = await syncRecurrenceExceptionsToGraph(
                TEST_CALENDAR_OWNER, null, graphResult.id, ownerRestoreRecurrence, graphEventData, ownerRestoreOverrides || []
              );
              if (ownerRestoreSyncResults.cancelledOccurrences.length) {
                graphUpdate['graphData.cancelledOccurrences'] = ownerRestoreSyncResults.cancelledOccurrences;
              }
              if (ownerRestoreSyncResults.additionEventIds.length) {
                graphUpdate.exceptionEventIds = ownerRestoreSyncResults.additionEventIds;
              }
            } catch (syncError) { /* ignore */ }
          }

          // Sync occurrence-level overrides to Graph
          if (ownerRestoreOverrides?.length) {
            const ownerAdditionIds = ownerRestoreSyncResults?.additionEventIds || [];
            for (const override of ownerRestoreOverrides) {
              const hasCats = override.categories !== undefined;
              const hasLocs = override.locationDisplayNames !== undefined;
              if (!hasCats && !hasLocs) continue;
              try {
                const additionEntry = ownerAdditionIds.find(e => e.date === override.occurrenceDate);
                if (additionEntry) {
                  const patch = {};
                  if (hasCats) patch.categories = override.categories;
                  if (hasLocs) {
                    const ldn = override.locationDisplayNames || '';
                    patch.location = { displayName: ldn, locationType: 'default' };
                    patch.locations = ldn.split('; ').filter(Boolean).map(n => ({ displayName: n, locationType: 'default' }));
                  }
                  await graphApiMock.updateCalendarEvent(TEST_CALENDAR_OWNER, null, additionEntry.graphId, patch);
                  continue;
                }
                const dayStart = `${override.occurrenceDate}T00:00:00`;
                const dayEnd = `${override.occurrenceDate}T23:59:59`;
                const instances = await graphApiMock.getRecurringEventInstances(
                  TEST_CALENDAR_OWNER, null, graphResult.id, dayStart, dayEnd
                );
                const instanceList = Array.isArray(instances) ? instances : [];
                const match = instanceList.find(inst => inst.start?.dateTime?.startsWith(override.occurrenceDate));
                if (match) {
                  const patch = {};
                  if (hasCats) patch.categories = override.categories;
                  if (hasLocs) {
                    const ldn = override.locationDisplayNames || '';
                    patch.location = { displayName: ldn, locationType: 'default' };
                    patch.locations = ldn.split('; ').filter(Boolean).map(n => ({ displayName: n, locationType: 'default' }));
                  }
                  await graphApiMock.updateCalendarEvent(TEST_CALENDAR_OWNER, null, match.id, patch);
                }
              } catch (e) { /* ignore */ }
            }
          }

          await testCollections.events.updateOne(query, { $set: graphUpdate });
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

      // Track reviewer notification
      const reviewerEmails = await getTestReviewerEmails();
      if (reviewerEmails.length > 0) {
        const cd = updatedEvent.calendarData || {};
        sentEmailNotifications.push({
          type: 'new_request_alert',
          to: reviewerEmails,
          eventTitle: cd.eventTitle || 'Untitled Event',
          eventId: event.eventId,
        });
      }

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
        const { hardConflicts, softConflicts, allConflicts } = await checkTestConflicts(conflictEvent, event._id, testCollections.events, testCollections.categories);
        if (hardConflicts.length > 0) {
          return res.status(409).json({
            error: 'SchedulingConflict',
            conflictTier: 'hard',
            message: `Cannot save: ${hardConflicts.length} scheduling conflict(s) with published events`,
            hardConflicts,
            softConflicts,
            conflicts: allConflicts,
            canForce: false,
            _version: event._version,
          });
        }
        if (softConflicts.length > 0 && !req.body.acknowledgeSoftConflicts) {
          return res.status(409).json({
            error: 'SchedulingConflict',
            conflictTier: 'soft',
            message: `${softConflicts.length} pending edit request(s) may conflict with this time`,
            hardConflicts: [],
            softConflicts,
            conflicts: softConflicts,
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

      // Track reviewer notification for resubmit edits
      if (isResubmitEdit) {
        const reviewerEmails = await getTestReviewerEmails();
        if (reviewerEmails.length > 0) {
          const cd = updatedEvent.calendarData || {};
          sentEmailNotifications.push({
            type: 'new_request_alert',
            to: reviewerEmails,
            eventTitle: cd.eventTitle || 'Untitled Event',
            eventId: event.eventId,
          });
        }
      }

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
      const { proposedChanges, changeReason } = req.body;

      if (!proposedChanges || !changeReason) {
        return res.status(400).json({ error: 'proposedChanges and changeReason are required' });
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

      // Build structured requestedBy (matches production data model)
      const requesterName = event.roomReservationData?.requestedBy?.name || userEmail;
      const editRequestId = `edit-req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create the edit request (matches production pendingEditRequest structure)
      const now = new Date();
      const pendingEditRequest = {
        id: editRequestId,
        status: 'pending',
        requestedBy: {
          userId,
          email: userEmail,
          name: requesterName,
          department: event.roomReservationData?.requestedBy?.department || '',
          phone: event.roomReservationData?.requestedBy?.phone || '',
          requestedAt: now,
        },
        changeReason: changeReason?.trim() || '',
        proposedChanges,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: '',
      };

      await testCollections.events.updateOne(query, {
        $set: {
          pendingEditRequest,
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
        changes: { pendingEditRequest: proposedChanges, changeReason },
      });

      // Send edit request alert to reviewers (approvers + admins)
      const reviewerEmails = await getTestReviewerEmails('emailOnEditRequests');
      if (reviewerEmails.length > 0) {
        sentEmailNotifications.push({
          type: 'edit_request_alert',
          to: reviewerEmails,
          eventId: event.eventId || String(event._id),
        });
      }

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

      // Apply the requested changes, merging with any approver overrides
      const { approverChanges, notes, forcePublishEdit, acknowledgeSoftConflicts } = req.body;

      // Only admins can force-override scheduling conflicts
      if (forcePublishEdit && !isAdmin(userDoc, userEmail)) {
        return res.status(403).json({ error: 'Only admins can force-override scheduling conflicts' });
      }
      const proposedChanges = event.pendingEditRequest.proposedChanges;
      const finalChanges = approverChanges
        ? { ...proposedChanges, ...approverChanges }
        : proposedChanges;
      const now = new Date();

      // Scheduling conflict check on publish-edit
      const hasTimeOrRoomChange = finalChanges.startDateTime || finalChanges.endDateTime ||
        finalChanges.locations || finalChanges.requestedRooms;

      if (hasTimeOrRoomChange && !forcePublishEdit) {
        const effective = buildEffectiveEditData({ ...event, pendingEditRequest: { ...event.pendingEditRequest, proposedChanges: finalChanges } });
        const conflictEvent = {
          startDateTime: effective.startDateTime,
          endDateTime: effective.endDateTime,
          calendarData: {
            locations: effective.locations,
            startDateTime: effective.startDateTime,
            endDateTime: effective.endDateTime,
          },
        };
        const { hardConflicts, softConflicts, allConflicts } = await checkTestConflicts(conflictEvent, event._id, testCollections.events, testCollections.categories);
        if (hardConflicts.length > 0) {
          return res.status(409).json({
            error: 'SchedulingConflict',
            conflictTier: 'hard',
            message: 'The proposed edit changes conflict with published events',
            hardConflicts,
            softConflicts,
            conflicts: allConflicts,
            canForce: isAdmin(userDoc, userEmail),
            forceField: 'forcePublishEdit',
          });
        }
        if (softConflicts.length > 0 && !acknowledgeSoftConflicts) {
          return res.status(409).json({
            error: 'SchedulingConflict',
            conflictTier: 'soft',
            message: `${softConflicts.length} pending edit request(s) may conflict with this time`,
            hardConflicts: [],
            softConflicts,
            conflicts: softConflicts,
          });
        }
      }

      // Detect key field changes before applying (compare original event vs final changes)
      let editRequestChanges = null;
      try {
        const KEY_FIELDS = ['eventTitle', 'startDateTime', 'endDateTime', 'locations', 'locationDisplayNames'];
        const detected = detectEventChanges(event, finalChanges, { includeFields: KEY_FIELDS });
        if (detected.length > 0) {
          editRequestChanges = formatChangesForEmail(detected);
        }
      } catch (changeErr) {
        // Non-blocking
      }

      // Graph sync via graphApiService (app-only auth)
      const cd = event.calendarData || {};
      const graphEventId = event.graphData?.id;
      let graphSyncResult = null;
      if (graphEventId && event.calendarOwner) {
        try {
          // Pre-process locations: resolve ObjectIds to display names
          let processedLocationsArray = [];
          const effectiveLocationIds = finalChanges.locations || finalChanges.requestedRooms || cd.locations;
          if (!finalChanges.isOffsite && effectiveLocationIds && Array.isArray(effectiveLocationIds) && effectiveLocationIds.length > 0) {
            try {
              const locationIds = effectiveLocationIds.map(id =>
                typeof id === 'string' ? new ObjectId(id) : id
              );
              const locationDocs = await testCollections.locations.find({
                _id: { $in: locationIds }
              }).toArray();
              processedLocationsArray = locationDocs
                .map(loc => ({
                  displayName: loc.displayName || loc.name || '',
                  locationType: 'default'
                }))
                .filter(loc => loc.displayName);
            } catch (locError) {
              // Non-blocking
            }
          }

          // Always send subject, start, end with fallback chain
          const graphUpdate = {
            subject: finalChanges.eventTitle || cd.eventTitle || event.graphData?.subject,
            startDateTime: (finalChanges.startDateTime || cd.startDateTime || event.graphData?.start?.dateTime || '').replace(/Z$/, ''),
            endDateTime: (finalChanges.endDateTime || cd.endDateTime || event.graphData?.end?.dateTime || '').replace(/Z$/, ''),
          };

          // Description (only if changed)
          if (finalChanges.eventDescription) {
            graphUpdate.body = { contentType: 'HTML', content: finalChanges.eventDescription };
          }

          // Categories with fallback
          if (finalChanges.categories) {
            graphUpdate.categories = finalChanges.categories;
          } else if (cd.categories) {
            graphUpdate.categories = cd.categories;
          }

          // Location processing
          if (finalChanges.isOffsite) {
            graphUpdate.location = {
              displayName: `${finalChanges.offsiteName} (Offsite) - ${finalChanges.offsiteAddress}`,
              locationType: 'default'
            };
            graphUpdate.locations = [graphUpdate.location];
          } else if (processedLocationsArray.length > 0) {
            const joinedName = processedLocationsArray.map(loc => loc.displayName).join('; ');
            graphUpdate.location = { displayName: joinedName, locationType: 'default' };
            graphUpdate.locations = processedLocationsArray;
          } else if (
            (Array.isArray(finalChanges.locations) && finalChanges.locations.length === 0) ||
            (Array.isArray(finalChanges.requestedRooms) && finalChanges.requestedRooms.length === 0)
          ) {
            graphUpdate.location = { displayName: 'Unspecified', locationType: 'default' };
            graphUpdate.locations = [];
          } else if (event.graphData?.location?.displayName) {
            graphUpdate.location = event.graphData.location;
            if (event.graphData?.locations && Array.isArray(event.graphData.locations)) {
              graphUpdate.locations = event.graphData.locations;
            }
          }

          graphSyncResult = await graphApiMock.updateCalendarEvent(
            event.calendarOwner,
            event.calendarId,
            graphEventId,
            graphUpdate
          );
        } catch (graphError) {
          console.error('Graph sync failed (non-blocking):', graphError.message);
        }
      }

      // Build update: write changes to calendarData.* fields (matching production)
      const mongoUpdate = {
        lastModifiedDateTime: now,
        lastModifiedBy: userId,
      };

      // Apply finalChanges to both top-level and calendarData (matching production behavior)
      for (const [field, value] of Object.entries(finalChanges)) {
        mongoUpdate[field] = value;
        mongoUpdate[`calendarData.${field}`] = value;
      }

      // Update pendingEditRequest status (not $unset — matches production)
      mongoUpdate['pendingEditRequest.status'] = 'approved';
      mongoUpdate['pendingEditRequest.reviewedAt'] = now;
      mongoUpdate['pendingEditRequest.reviewedBy'] = {
        userId,
        name: userEmail,
        email: userEmail,
      };
      mongoUpdate['pendingEditRequest.reviewNotes'] = notes || '';

      // Merge Graph response back to graphData
      if (graphSyncResult) {
        mongoUpdate.graphData = { ...(event.graphData || {}), ...graphSyncResult };
      }

      await testCollections.events.updateOne(query, {
        $set: mongoUpdate,
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
        changes: finalChanges,
        ...(approverChanges && {
          metadata: {
            approverChanges,
            originalProposedChanges: proposedChanges,
          },
        }),
      });

      // Track edit request approved email notification
      const requestedByEmail = event.pendingEditRequest.requestedBy?.email
        || event.pendingEditRequest.requestedBy
        || event.roomReservationData?.requestedBy?.email;
      if (requestedByEmail) {
        const cd = event.calendarData || {};
        sentEmailNotifications.push({
          type: 'edit_request_approved',
          to: requestedByEmail,
          eventTitle: finalChanges.eventTitle || cd.eventTitle || event.eventTitle,
          changes: editRequestChanges || [],
          eventId: String(event._id),
        });
      }

      res.json({
        success: true,
        event: updatedEvent,
        graphSynced: !!graphSyncResult,
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

      // Set edit request status to rejected (not $unset — matches production)
      const now = new Date();
      await testCollections.events.updateOne(query, {
        $set: {
          'pendingEditRequest.status': 'rejected',
          'pendingEditRequest.reviewedAt': now,
          'pendingEditRequest.reviewedBy': {
            userId,
            name: userEmail,
            email: userEmail,
          },
          'pendingEditRequest.reviewNotes': reason,
          lastModifiedDateTime: now,
          lastModifiedBy: userId,
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
   * PUT /api/events/edit-requests/:id/cancel - Cancel own edit request
   * Matches production: ownership check, status guard, sets status to 'cancelled'
   */
  app.put('/api/events/edit-requests/:id/cancel', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;
      const eventId = req.params.id;

      const query = ObjectId.isValid(eventId)
        ? { _id: new ObjectId(eventId) }
        : { eventId };

      const event = await testCollections.events.findOne(query);

      if (!event) {
        return res.status(404).json({ error: 'Event not found' });
      }

      if (!event.pendingEditRequest) {
        return res.status(400).json({ error: 'No pending edit request found for this event' });
      }

      if (event.pendingEditRequest.status !== 'pending') {
        return res.status(400).json({
          error: 'Edit request is not pending',
          currentStatus: event.pendingEditRequest.status,
        });
      }

      // Verify the user is the owner of the edit request
      const pendingEditRequest = event.pendingEditRequest;
      const isOwner = pendingEditRequest.requestedBy?.userId === userId ||
                      pendingEditRequest.requestedBy?.email === userEmail;

      if (!isOwner) {
        return res.status(403).json({ error: 'Only the requester can cancel their edit request' });
      }

      const now = new Date();
      await testCollections.events.updateOne(query, {
        $set: {
          'pendingEditRequest.status': 'cancelled',
          'pendingEditRequest.reviewNotes': 'Cancelled by requester',
          lastModifiedDateTime: now,
        },
      });

      // Create audit log
      await createAuditLog({
        eventId: event.eventId,
        action: 'edit-request-cancelled',
        performedBy: userId,
        performedByEmail: userEmail,
        previousState: event,
        changes: [],
        metadata: {
          editRequestId: pendingEditRequest.id,
        },
      });

      res.json({
        success: true,
        message: 'Edit request cancelled',
        eventId: event.eventId,
      });
    } catch (error) {
      console.error('Error cancelling edit request:', error);
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

      // --- thisEvent scope: write per-occurrence override and return early ---
      const editScope = updates.editScope;
      const occurrenceDate = updates.occurrenceDate;
      if (editScope === 'thisEvent' && occurrenceDate) {
        const dateKey = occurrenceDate.split('T')[0];

        // Validate dateKey falls within series range (additions are valid even outside range)
        const recurrence = event.calendarData?.recurrence || event.recurrence;
        const recRange = recurrence?.range;
        const additions = recurrence?.additions || [];
        if (recRange?.endDate && (dateKey < recRange.startDate || dateKey > recRange.endDate) && !additions.includes(dateKey)) {
          return res.status(400).json({ error: 'Occurrence date is outside series range' });
        }

        // Build override from changed fields
        const overrideFields = { occurrenceDate: dateKey };
        if (updates.startTime !== undefined) overrideFields.startTime = updates.startTime;
        if (updates.endTime !== undefined) overrideFields.endTime = updates.endTime;
        if (updates.eventTitle !== undefined) overrideFields.eventTitle = updates.eventTitle?.trim();
        if (updates.eventDescription !== undefined) overrideFields.eventDescription = updates.eventDescription;
        if (updates.startTime) overrideFields.startDateTime = `${dateKey}T${updates.startTime}`;
        if (updates.endTime) overrideFields.endDateTime = `${dateKey}T${updates.endTime}`;
        if (updates.setupTime !== undefined) overrideFields.setupTime = updates.setupTime;
        if (updates.teardownTime !== undefined) overrideFields.teardownTime = updates.teardownTime;
        if (updates.doorOpenTime !== undefined) overrideFields.doorOpenTime = updates.doorOpenTime;
        if (updates.doorCloseTime !== undefined) overrideFields.doorCloseTime = updates.doorCloseTime;
        if (updates.categories !== undefined) overrideFields.categories = updates.categories;
        if (updates.services !== undefined) overrideFields.services = updates.services;
        if (updates.assignedTo !== undefined) overrideFields.assignedTo = updates.assignedTo;

        // Handle locations
        const rawLocations = updates.requestedRooms || updates.locations;
        if (rawLocations !== undefined) {
          if (Array.isArray(rawLocations) && rawLocations.length > 0) {
            try {
              const locationIds = rawLocations.map(lid =>
                typeof lid === 'string' ? new ObjectId(lid) : lid
              );
              overrideFields.locations = locationIds;

              const locationDocs = await testCollections.locations.find({
                _id: { $in: locationIds }
              }).toArray();
              const displayNames = locationDocs
                .map(loc => loc.displayName || loc.name || '')
                .filter(Boolean)
                .join('; ');
              if (displayNames) {
                overrideFields.locationDisplayNames = displayNames;
              }
            } catch (locErr) {
              overrideFields.locations = rawLocations;
            }
          } else {
            overrideFields.locations = [];
            overrideFields.locationDisplayNames = '';
          }
        }

        // Remove existing override for this date, then add new one
        await testCollections.events.updateOne(
          query,
          { $pull: { occurrenceOverrides: { occurrenceDate: dateKey } } }
        );
        await testCollections.events.updateOne(
          query,
          {
            $push: { occurrenceOverrides: overrideFields },
            $set: { lastModifiedDateTime: new Date() }
          }
        );

        // Graph sync: if published, update the specific occurrence in Graph
        const storedGraphId = event.graphData?.id;
        if (storedGraphId && event.calendarOwner) {
          try {
            const dayStart = `${dateKey}T00:00:00`;
            const dayEnd = `${dateKey}T23:59:59`;
            const seriesMasterId = updates.seriesMasterId;
            const instances = await graphApiMock.getRecurringEventInstances(
              event.calendarOwner, event.calendarId, seriesMasterId || storedGraphId,
              dayStart, dayEnd
            );
            const match = (instances || []).find(occ =>
              occ.start?.dateTime?.startsWith(dateKey)
            );
            if (match) {
              const graphUpdate = {};
              if (overrideFields.eventTitle) graphUpdate.subject = overrideFields.eventTitle;
              if (overrideFields.startDateTime) {
                graphUpdate.start = {
                  dateTime: overrideFields.startDateTime + ':00',
                  timeZone: event.graphData?.start?.timeZone || 'America/New_York'
                };
              }
              if (overrideFields.endDateTime) {
                graphUpdate.end = {
                  dateTime: overrideFields.endDateTime + ':00',
                  timeZone: event.graphData?.end?.timeZone || 'America/New_York'
                };
              }
              if (overrideFields.categories !== undefined) {
                graphUpdate.categories = overrideFields.categories;
              }
              if (overrideFields.locationDisplayNames !== undefined) {
                const locDispName = overrideFields.locationDisplayNames || '';
                graphUpdate.location = { displayName: locDispName, locationType: 'default' };
                graphUpdate.locations = locDispName
                  .split('; ')
                  .filter(Boolean)
                  .map(name => ({ displayName: name, locationType: 'default' }));
              }
              if (Object.keys(graphUpdate).length > 0) {
                await graphApiMock.updateCalendarEvent(
                  event.calendarOwner, event.calendarId, match.id, graphUpdate
                );
              }
            }
          } catch (graphErr) { /* non-fatal */ }
        }

        // Mirror to calendarData.occurrenceOverrides
        const updatedDoc = await testCollections.events.findOne(query);
        if (updatedDoc) {
          await testCollections.events.updateOne(
            query,
            { $set: { 'calendarData.occurrenceOverrides': updatedDoc.occurrenceOverrides || [] } }
          );
        }

        const finalDoc = await testCollections.events.findOne(query);
        return res.json({ success: true, event: finalDoc, graphSynced: false });
      }

      // Determine if Graph-syncable fields changed
      const storedGraphEventId = event.graphData?.id;
      const hasGraphSyncableChanges = !!(
        updates.eventTitle !== undefined ||
        updates.locations !== undefined ||
        updates.requestedRooms !== undefined ||
        updates.startDateTime !== undefined ||
        updates.endDateTime !== undefined ||
        updates.startDate !== undefined ||
        updates.startTime !== undefined ||
        updates.endDate !== undefined ||
        updates.endTime !== undefined ||
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
          const { hardConflicts, softConflicts, allConflicts } = await checkTestConflicts(conflictEvent, event._id, testCollections.events, testCollections.categories);
          if (hardConflicts.length > 0) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              conflictTier: 'hard',
              message: `Cannot save: ${hardConflicts.length} scheduling conflict(s) with published events`,
              hardConflicts,
              softConflicts,
              conflicts: allConflicts,
              canForce: true,
              forceField: 'forceUpdate',
              _version: event._version,
            });
          }
          if (softConflicts.length > 0 && !updates.acknowledgeSoftConflicts) {
            return res.status(409).json({
              error: 'SchedulingConflict',
              conflictTier: 'soft',
              message: `${softConflicts.length} pending edit request(s) may conflict with this time`,
              hardConflicts: [],
              softConflicts,
              conflicts: softConflicts,
              _version: event._version,
            });
          }
        }
      }

      // Pre-compute combined datetimes from separate date/time fields (frontend sends them separately)
      const cd = event.calendarData || {};
      const resolvedStartDateTime = updates.startDateTime
        || (updates.startDate && updates.startTime ? `${updates.startDate}T${updates.startTime}:00` : null)
        || cd.startDateTime || event.startDateTime;
      const resolvedEndDateTime = updates.endDateTime
        || (updates.endDate && updates.endTime ? `${updates.endDate}T${updates.endTime}:00` : null)
        || cd.endDateTime || event.endDateTime;

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
              subject: updates.eventTitle || cd.eventTitle || event.eventTitle,
              startDateTime: resolvedStartDateTime,
              endDateTime: resolvedEndDateTime,
              eventDescription: updates.eventDescription || cd.eventDescription || event.eventDescription,
            }
          );
          graphSynced = true;

          // CASCADE: When editing a series master, also update addition events
          if (event.eventType === 'seriesMaster') {
            const additionEventIds = event.exceptionEventIds || [];
            for (const addition of additionEventIds) {
              try {
                const additionPatch = {
                  subject: updates.eventTitle || cd.eventTitle || event.eventTitle,
                };
                if (resolvedStartDateTime && resolvedEndDateTime) {
                  const startTimePart = resolvedStartDateTime.split('T')[1] || '09:00:00';
                  const endTimePart = resolvedEndDateTime.split('T')[1] || '10:00:00';
                  additionPatch.startDateTime = `${addition.date}T${startTimePart}`;
                  additionPatch.endDateTime = `${addition.date}T${endTimePart}`;
                }
                await graphApiMock.updateCalendarEvent(event.calendarOwner, event.calendarId, addition.graphId, additionPatch);
              } catch (addErr) { /* non-fatal */ }
            }
          }
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

      // Calendar data fields that also get synced to calendarData.*
      const calendarDataFields = [
        ...fieldsToSync,
        'recurrence',
      ];

      for (const field of calendarDataFields) {
        if (updates[field] !== undefined) {
          mongoUpdate[field] = updates[field];
          // Sync to calendarData nested structure
          mongoUpdate[`calendarData.${field}`] = updates[field];
        }
      }

      // PROTECT eventType: use the DB value, never trust the frontend
      if (event.eventType === 'seriesMaster') {
        const incomingRecurrence = updates.recurrence;
        if (incomingRecurrence && !incomingRecurrence.pattern && !incomingRecurrence.range) {
          mongoUpdate.eventType = 'singleInstance';
        } else {
          mongoUpdate.eventType = 'seriesMaster';
        }
      }
      // Do NOT let frontend set eventType, occurrenceOverrides, or exceptionEventIds
      delete mongoUpdate.occurrenceOverrides;
      delete mongoUpdate.exceptionEventIds;

      // CASCADE: When editing a series master, propagate changed fields into occurrenceOverrides
      if (event.eventType === 'seriesMaster') {
        const existingOverrides = event.occurrenceOverrides || [];
        if (existingOverrides.length > 0) {
          const updatedOverrides = existingOverrides.map(override => {
            const updated = { ...override };
            if (updates.eventTitle !== undefined) updated.eventTitle = updates.eventTitle;
            if (updates.startTime !== undefined) {
              updated.startTime = updates.startTime;
              updated.startDateTime = `${override.occurrenceDate}T${updates.startTime}`;
            }
            if (updates.endTime !== undefined) {
              updated.endTime = updates.endTime;
              updated.endDateTime = `${override.occurrenceDate}T${updates.endTime}`;
            }
            if (updates.locations !== undefined) {
              updated.locations = updates.locations;
            }
            if (updates.locationDisplayNames !== undefined) {
              updated.locationDisplayNames = updates.locationDisplayNames;
            }
            if (updates.categories !== undefined) updated.categories = updates.categories;
            if (updates.eventDescription !== undefined) updated.eventDescription = updates.eventDescription;
            return updated;
          });
          mongoUpdate.occurrenceOverrides = updatedOverrides;
          mongoUpdate['calendarData.occurrenceOverrides'] = updatedOverrides;
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

      // Detect key field changes on published events for requester notification
      let publishedEventChanges = null;
      if (event.status === 'published') {
        try {
          const KEY_FIELDS = ['eventTitle', 'startDateTime', 'endDateTime', 'locations', 'locationDisplayNames'];
          const changes = detectEventChanges(event, mongoUpdate, { includeFields: KEY_FIELDS });
          if (changes.length > 0) {
            publishedEventChanges = formatChangesForEmail(changes);
          }
        } catch (changeErr) {
          // Non-blocking
        }
      }

      // Merge approver edits into pending edit request's proposedChanges
      if (event.status === 'published' && event.pendingEditRequest?.proposedChanges) {
        const currentProposed = { ...(event.pendingEditRequest.proposedChanges || {}) };
        const originalCount = Object.keys(currentProposed).length;

        const approverModifiedLocations = mongoUpdate.locations !== undefined
          || updates.requestedRooms !== undefined;

        for (const field of Object.keys(currentProposed)) {
          const approverTouched = mongoUpdate[field] !== undefined;
          const isLocationField = ['locations', 'requestedRooms', 'locationDisplayNames'].includes(field);
          if (approverTouched || (isLocationField && approverModifiedLocations)) {
            delete currentProposed[field];
          }
        }

        if (Object.keys(currentProposed).length < originalCount) {
          mongoUpdate['pendingEditRequest.proposedChanges'] = currentProposed;
        }
      }

      await testCollections.events.updateOne(query, { $set: mongoUpdate });

      const updatedEvent = await testCollections.events.findOne(query);

      // Send event updated notification for published events (track for test assertions)
      if (publishedEventChanges && publishedEventChanges.length > 0) {
        const requestedBy = event.roomReservationData?.requestedBy || {};
        const recipientEmail = requestedBy.email;
        if (recipientEmail) {
          const cd = event.calendarData || {};
          sentEmailNotifications.push({
            type: 'event_updated',
            to: recipientEmail,
            eventTitle: mongoUpdate.eventTitle || cd.eventTitle || event.eventTitle,
            changes: publishedEventChanges,
            eventId: String(event._id),
          });
        }
      }

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
  // EVENT REQUEST ENDPOINT
  // ============================================

  /**
   * POST /api/events/request - Create a new event request (authenticated, requester+)
   */
  app.post('/api/events/request', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;

      // Permission check: requester role or higher required
      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });
      if (!hasRole(userDoc, userEmail, 'requester')) {
        return res.status(403).json({ error: 'Permission denied. Requester role required.' });
      }

      const {
        eventTitle,
        eventDescription,
        startDateTime,
        endDateTime,
        locations,
        calendarOwner,
        calendarId,
        categories,
        services,
        requesterName,
        requesterEmail,
        department,
        phone,
        setupTime,
        doorOpenTime,
      } = req.body;

      // Validate required fields
      if (!eventTitle || !startDateTime || !endDateTime) {
        return res.status(400).json({ error: 'Missing required fields: eventTitle, startDateTime, endDateTime' });
      }

      const now = new Date();
      const eventId = `request-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const event = {
        _id: new ObjectId(),
        eventId,
        userId,
        calendarOwner: (calendarOwner || TEST_CALENDAR_OWNER).toLowerCase(),
        calendarId: calendarId || null,
        status: 'pending',
        isDeleted: false,
        eventTitle,
        eventDescription: eventDescription || '',
        startDateTime: new Date(startDateTime),
        endDateTime: new Date(endDateTime),
        locations: (locations || []).map(id => {
          try { return new ObjectId(id); } catch { return id; }
        }),
        locationDisplayNames: [],
        categories: categories || [],
        services: services || [],
        calendarData: {
          eventTitle,
          eventDescription: eventDescription || '',
          startDateTime: new Date(startDateTime),
          endDateTime: new Date(endDateTime),
          locations: (locations || []).map(id => {
            try { return new ObjectId(id); } catch { return id; }
          }),
          categories: categories || [],
          services: services || [],
          setupTime: setupTime || null,
          doorOpenTime: doorOpenTime || null,
        },
        roomReservationData: {
          requestedBy: {
            name: requesterName || userDoc?.name || userDoc?.displayName || 'Unknown',
            email: requesterEmail || userEmail,
            department: department || userDoc?.department || '',
            phone: phone || '',
            userId,
          },
        },
        graphData: null,
        statusHistory: [{ status: 'pending', changedAt: now, changedBy: userEmail }],
        _version: 1,
        createdAt: now,
        createdBy: userEmail,
        lastModifiedDateTime: now,
      };

      await testCollections.events.insertOne(event);

      // Track email notification
      const reviewerEmails = await getTestReviewerEmails('emailOnNewRequests');
      if (reviewerEmails.length > 0) {
        sentEmailNotifications.push({
          type: 'new_request',
          to: reviewerEmails,
          eventTitle,
          requesterEmail: requesterEmail || userEmail,
          sentAt: now,
        });
      }

      res.status(201).json(event);
    } catch (error) {
      console.error('Error in POST /api/events/request:', error);
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
        // Promote recurrence and occurrenceOverrides for frontend expansion
        if (!event.recurrence && event.calendarData?.recurrence) {
          event.recurrence = event.calendarData.recurrence;
        }
        if (!event.occurrenceOverrides && event.calendarData?.occurrenceOverrides) {
          event.occurrenceOverrides = event.calendarData.occurrenceOverrides;
        }
        return event;
      });

      res.json({ events: normalizedEvents, role });
    } catch (error) {
      console.error('Error loading calendar events:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================
  // NOTIFICATION PREFERENCE ENDPOINTS
  // ============================================

  /**
   * PATCH /api/users/current/notification-preferences - Update notification prefs (requester+ role-based)
   */
  app.patch('/api/users/current/notification-preferences', verifyToken, async (req, res) => {
    try {
      const userId = req.user.userId;
      const userEmail = req.user.email;

      const userDoc = await testCollections.users.findOne({
        $or: [{ odataId: userId }, { email: userEmail }],
      });

      if (!userDoc) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Role-gate: at least requester role required (block viewers)
      if (!hasRole(userDoc, userEmail, 'requester')) {
        return res.status(403).json({ error: 'Insufficient permissions to manage notification preferences' });
      }

      // Determine allowed keys based on user's role
      const effectiveRole = getEffectiveRole(userDoc, userEmail);
      const allowedKeys = getAllowedNotifKeys(effectiveRole);

      const updates = req.body;
      const invalidKeys = Object.keys(updates).filter(k => !allowedKeys.includes(k));
      if (invalidKeys.length > 0) {
        return res.status(400).json({ error: `Invalid preference keys: ${invalidKeys.join(', ')}` });
      }

      const setFields = {};
      for (const key of allowedKeys) {
        if (updates[key] !== undefined) {
          setFields[`notificationPreferences.${key}`] = updates[key];
        }
      }

      if (Object.keys(setFields).length === 0) {
        return res.status(400).json({ error: 'No valid preferences to update' });
      }

      await testCollections.users.updateOne(
        { _id: userDoc._id },
        { $set: { ...setFields, updatedAt: new Date() } }
      );

      const updatedUser = await testCollections.users.findOne({ _id: userDoc._id });
      res.json(updatedUser);
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/rooms/availability - Room availability with pending edit support
   */
  app.get('/api/rooms/availability', async (req, res) => {
    try {
      const { startDateTime, endDateTime, roomIds } = req.query;

      if (!startDateTime || !endDateTime) {
        return res.status(400).json({ error: 'startDateTime and endDateTime are required' });
      }

      // Parse room IDs
      const requestedRoomIds = roomIds ? roomIds.split(',').map(id => id.trim()) : [];
      const roomObjectIds = requestedRoomIds.map(id => {
        try { return new ObjectId(id); } catch { return null; }
      }).filter(Boolean);

      if (roomObjectIds.length === 0) {
        return res.json([]);
      }

      // Fetch rooms from locations collection
      const rooms = await testCollections.locations.find({
        _id: { $in: roomObjectIds },
        isReservable: true,
        active: true,
      }).toArray();

      const roomIdStrings = roomObjectIds.map(id => id.toString());
      const start = new Date(startDateTime).toISOString();
      const end = new Date(endDateTime).toISOString();

      // Get published events in these rooms
      const allEvents = await testCollections.events.find({
        isDeleted: { $ne: true },
        status: { $nin: ['draft', 'pending', 'rejected', 'cancelled', 'deleted'] },
        'calendarData.startDateTime': { $lt: end },
        'calendarData.endDateTime': { $gt: start },
        $or: [
          { 'calendarData.locations': { $in: roomObjectIds } },
          { 'calendarData.locations': { $in: roomIdStrings } },
        ],
      }).toArray();

      const allReservations = allEvents.filter(e => e.status === 'published');
      const allCalendarEvents = allEvents.filter(e => !e.status);

      // Get pending edit events
      const pendingEditEvents = await testCollections.events.find({
        status: 'published',
        'pendingEditRequest.status': 'pending',
        $or: [
          { 'pendingEditRequest.proposedChanges.locations': { $in: [...roomObjectIds, ...roomIdStrings] } },
          { 'pendingEditRequest.proposedChanges.requestedRooms': { $in: [...roomObjectIds, ...roomIdStrings] } },
          {
            'calendarData.locations': { $in: [...roomObjectIds, ...roomIdStrings] },
            $or: [
              { 'pendingEditRequest.proposedChanges.startDateTime': { $exists: true } },
              { 'pendingEditRequest.proposedChanges.endDateTime': { $exists: true } },
            ],
          },
        ],
      }).toArray();

      const availability = rooms.map(room => {
        const roomIdString = room._id.toString();

        const roomReservations = allReservations.filter(r =>
          r.calendarData?.locations?.some(loc => loc.toString() === roomIdString)
        );
        const roomEvents = allCalendarEvents.filter(e =>
          e.calendarData?.locations?.some(loc => loc.toString() === roomIdString)
        );

        const detailedReservations = roomReservations.map(r => ({
          id: r._id,
          eventTitle: r.calendarData?.eventTitle,
          status: r.status,
          originalStart: r.calendarData?.startDateTime,
          originalEnd: r.calendarData?.endDateTime,
          effectiveStart: r.calendarData?.startDateTime,
          effectiveEnd: r.calendarData?.endDateTime,
          isAllowedConcurrent: r.isAllowedConcurrent ?? false,
        }));

        const detailedEvents = roomEvents.map(e => ({
          id: e._id,
          subject: e.calendarData?.eventTitle || e.graphData?.subject,
          start: e.calendarData?.startDateTime,
          end: e.calendarData?.endDateTime,
          effectiveStart: e.calendarData?.startDateTime,
          effectiveEnd: e.calendarData?.endDateTime,
          isAllowedConcurrent: e.isAllowedConcurrent ?? false,
        }));

        // Pending edits for this room
        const detailedPendingEdits = pendingEditEvents
          .filter(pe => {
            const effective = buildEffectiveEditData(pe);
            const effectiveLocs = (effective.locations || []).map(id => id.toString());
            return effectiveLocs.includes(roomIdString);
          })
          .map(pe => {
            const effective = buildEffectiveEditData(pe);
            const cd = pe.calendarData || {};
            return {
              id: pe._id,
              eventTitle: effective.eventTitle || cd.eventTitle,
              status: 'pending-edit',
              originalStart: effective.startDateTime,
              originalEnd: effective.endDateTime,
              effectiveStart: effective.startDateTime,
              effectiveEnd: effective.endDateTime,
              isAllowedConcurrent: pe.isAllowedConcurrent ?? false,
              isPendingEdit: true,
              currentRoomIds: (cd.locations || []).map(id => id.toString()),
              originalLocations: cd.locationDisplayNames,
              changeReason: pe.pendingEditRequest?.changeReason || '',
            };
          });

        return {
          room,
          conflicts: {
            reservations: detailedReservations,
            events: detailedEvents,
            pendingEdits: detailedPendingEdits,
            totalConflicts: detailedReservations.length + detailedEvents.length,
          },
        };
      });

      res.json(availability);
    } catch (error) {
      console.error('Error checking room availability:', error);
      res.status(500).json({ error: 'Failed to check room availability' });
    }
  });

  /**
   * POST /api/rooms/recurring-conflicts - Batch recurring conflict check
   */
  app.post('/api/rooms/recurring-conflicts', verifyToken, async (req, res) => {
    try {
      const {
        startDateTime, endDateTime, recurrence, roomIds,
        setupTimeMinutes = 0, teardownTimeMinutes = 0,
        excludeEventId = null, isAllowedConcurrent = false, categories = [],
      } = req.body;

      if (!startDateTime || !endDateTime) {
        return res.status(400).json({ error: 'startDateTime and endDateTime are required' });
      }
      if (!recurrence?.pattern || !recurrence?.range) {
        return res.status(400).json({ error: 'recurrence with pattern and range is required' });
      }
      if (!roomIds || roomIds.length === 0) {
        return res.json({ totalOccurrences: 0, conflictingOccurrences: 0, cleanOccurrences: 0, conflicts: [] });
      }

      const roomObjectIds = roomIds.map(id => {
        try { return new ObjectId(id); } catch { return id; }
      });

      const result = await checkTestRecurringConflicts({
        startDateTime, endDateTime, recurrence, roomIds: roomObjectIds,
        setupTimeMinutes: parseInt(setupTimeMinutes) || 0,
        teardownTimeMinutes: parseInt(teardownTimeMinutes) || 0,
        excludeEventId, isAllowedConcurrent, categories,
      }, testCollections.events);

      res.json(result);
    } catch (error) {
      console.error('Error checking recurring room conflicts:', error);
      res.status(500).json({ error: 'Failed to check recurring conflicts' });
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
  getSentEmailNotifications,
  clearSentEmailNotifications,
  getTestReviewerEmails,
};
