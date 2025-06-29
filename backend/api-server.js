// api-server.js - Express API for MongoDB
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const logger = require('./utils/logger');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const webAppURL = 'https://emanuel-resourcescheduler-d4echehehaf3dxfg.canadacentral-01.azurewebsites.net';

// Use the same App ID for both frontend and backend
const APP_ID = process.env.APP_ID || 'c2187009-796d-4fea-b58c-f83f7a89589e';
const TENANT_ID = process.env.TENANT_ID || 'fcc71126-2b16-4653-b639-0f1ef8332302';

// Middleware
// Updated CORS configuration to allow requests from your deployed app domain
app.use(cors({
  origin: [
    'http://localhost:80', 
    'http://localhost', 
    'http://localhost:3000',
    'http://localhost:5173', // Vite dev server
    'https://localhost:5173', // Vite dev server with HTTPS
    process.env.FRONTEND_URL || webAppURL
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  exposedHeaders: ['Authorization'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));
app.use(express.json());

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(204);
});

// Log all incoming requests for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// MongoDB Connection
const connectionString = process.env.MONGODB_CONNECTION_STRING;
const client = new MongoClient(connectionString, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000,
  maxPoolSize: 10
});
let db;
let usersCollection;
let internalEventsCollection;
let eventCacheCollection;

/**
 * Create indexes for the event cache collection for optimal performance
 */
async function createEventCacheIndexes() {
  try {
    console.log('Creating event cache indexes...');
    
    // Compound index for efficient date range queries
    await eventCacheCollection.createIndex(
      { 
        userId: 1, 
        calendarId: 1, 
        "eventData.start.dateTime": 1 
      },
      { 
        name: "userId_calendarId_startTime",
        background: true 
      }
    );
    
    // Index for ETag-based change detection
    await eventCacheCollection.createIndex(
      { 
        userId: 1, 
        eventId: 1, 
        etag: 1 
      },
      { 
        name: "userId_eventId_etag",
        background: true 
      }
    );
    
    // Index for cache expiration cleanup
    await eventCacheCollection.createIndex(
      { expiresAt: 1 },
      { 
        name: "expiresAt_ttl",
        background: true,
        expireAfterSeconds: 0  // TTL index - documents expire when expiresAt is reached
      }
    );
    
    // Index for LRU eviction
    await eventCacheCollection.createIndex(
      { lastAccessedAt: 1 },
      { 
        name: "lastAccessedAt_lru",
        background: true 
      }
    );
    
    // Unique index to prevent duplicate cache entries
    await eventCacheCollection.createIndex(
      { 
        userId: 1, 
        calendarId: 1, 
        eventId: 1 
      },
      { 
        name: "userId_calendarId_eventId_unique",
        unique: true,
        background: true 
      }
    );
    
    // Index for finding dirty (locally modified) events
    await eventCacheCollection.createIndex(
      { 
        userId: 1, 
        isDirty: 1 
      },
      { 
        name: "userId_isDirty",
        background: true,
        sparse: true  // Only index documents where isDirty is true
      }
    );
    
    console.log('Event cache indexes created successfully');
  } catch (error) {
    console.error('Error creating event cache indexes:', error);
    // Don't throw - let the app continue even if index creation fails
  }
}

// Connect to MongoDB with reconnection logic
async function connectToDatabase() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    db = client.db('emanuelnyc');
    usersCollection = db.collection('templeEvents__Users');
    internalEventsCollection = db.collection('templeEvents__InternalEvents');
    eventCacheCollection = db.collection('templeEvents__EventCache');
    
    // Create indexes for event cache collection
    await createEventCacheIndexes();
    
    console.log('Database and collections initialized');
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    // Try to reconnect after a delay instead of exiting
    console.log('Attempting to reconnect in 5 seconds...');
    setTimeout(connectToDatabase, 5000);
  }
}

// Set up JWKS client for Azure AD
const msalJwksClient = jwksClient({
  jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  requestHeaders: {}, // Add any needed headers
  timeout: 30000 // 30 second timeout
});

// MSAL Authentication Middleware - Simplified for single app registration
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('No token provided or invalid format');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const token = authHeader.split(' ')[1];
    console.log('Token received (first 20 chars):', token.substring(0, 20) + '...');
    
    // Decode token to inspect it (for debugging)
    try {
      const tokenParts = token.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64url').toString());
        console.log('Token audience:', payload.aud);
        console.log('Expected audience:', APP_ID);
      }
    } catch (e) {
      console.error('Error decoding token:', e);
    }
    
    // Get the signing key
    const getKey = (header, callback) => {
      msalJwksClient.getSigningKey(header.kid, (err, key) => {
        if (err) {
          console.error('Error getting signing key:', err);
          return callback(err);
        }
        const signingKey = key.publicKey || key.rsaPublicKey;
        callback(null, signingKey);
      });
    };
  
    // Verify token with multiple acceptable audiences
    jwt.verify(token, getKey, { 
      algorithms: ['RS256'],
      audience: [
        APP_ID,                                 // Our app
        `api://${APP_ID}`,                      // Our app as an API
        `api://${APP_ID}/access_as_user`,       // Our app with scope
        'https://graph.microsoft.com',          // Microsoft Graph
        '00000003-0000-0000-c000-000000000000'  // Microsoft Graph AppID
      ],
      issuer: [
        `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
        `https://login.microsoftonline.com/common/v2.0`,
        `https://sts.windows.net/${TENANT_ID}/`
      ]
    }, (err, decoded) => {
      if (err) {
        console.error('Token verification error:', err);
        return res.status(401).json({ error: 'Invalid token' });
      }
      
      console.log('Token decoded successfully');
      
      // Extract user info from token
      req.user = {
        userId: decoded.oid || decoded.sub, // Object ID or Subject claim
        email: decoded.preferred_username || decoded.email || decoded.upn,
        name: decoded.name
      };
      
      next();
    });
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// ============================================
// ROUTES
// ============================================

// ============================================
// INTERNAL EVENT ROUTES
// ============================================
// Sync events from Microsoft Graph to internal database (Admin only)
// Sync events from Microsoft Graph to internal database (Admin only)
app.post('/api/internal-events/sync', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    const user = await usersCollection.findOne({ userId: req.user.userId });
    if (!user?.preferences?.isAdmin && !user?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { events, calendarId } = req.body;
    
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'Events array is required' });
    }
    
    console.log(`Syncing ${events.length} events for calendar ${calendarId}`);
    
    const syncResults = {
      created: 0,
      updated: 0,
      skipped: 0, // Add skipped counter
      errors: []
    };
    
    // Define how recent is "recently synced" (e.g., 5 minutes)
    const SYNC_THRESHOLD_MINUTES = 5;
    const syncThreshold = new Date(Date.now() - SYNC_THRESHOLD_MINUTES * 60 * 1000);
    
    for (const graphEvent of events) {
      try {
        // Check if internal event already exists
        const existingEvent = await internalEventsCollection.findOne({
          graphEventId: graphEvent.id
        });
        
        const now = new Date();
        
        if (existingEvent) {
          // Check if event was recently synced
          if (existingEvent.lastSyncedAt > syncThreshold) {
            console.log(`Skipping event ${graphEvent.id} - synced ${existingEvent.lastSyncedAt}`);
            syncResults.skipped++;
            continue;
          }
          
          // Check if the event has actually changed
          const graphModifiedTime = new Date(graphEvent.lastModifiedDateTime || 0);
          const lastSyncTime = new Date(existingEvent.lastSyncedAt);
          
          if (graphModifiedTime <= lastSyncTime) {
            console.log(`Skipping event ${graphEvent.id} - no changes since last sync`);
            syncResults.skipped++;
            continue;
          }
          
          // Update only external data, preserve internal fields
          const updateData = {
            calendarId: calendarId || graphEvent.calendarId,
            externalData: {
              subject: graphEvent.subject,
              start: graphEvent.start,
              end: graphEvent.end,
              location: graphEvent.location || { displayName: '' },
              categories: graphEvent.category ? [graphEvent.category] : [],
              lastModifiedDateTime: graphEvent.lastModifiedDateTime || now.toISOString()
            },
            lastSyncedAt: now,
            syncStatus: 'synced',
            updatedAt: now
          };
          
          // If event was marked as deleted, unmark it since it exists in Graph
          if (existingEvent.isDeleted) {
            updateData.isDeleted = false;
          }
          
          await internalEventsCollection.updateOne(
            { graphEventId: graphEvent.id },
            { $set: updateData }
          );
          
          syncResults.updated++;
        } else {
          // Create new internal event with default internal fields
          const newInternalEvent = {
            graphEventId: graphEvent.id,
            calendarId: calendarId || graphEvent.calendarId,
            externalData: {
              subject: graphEvent.subject,
              start: graphEvent.start,
              end: graphEvent.end,
              location: graphEvent.location || { displayName: '' },
              categories: graphEvent.category ? [graphEvent.category] : [],
              lastModifiedDateTime: graphEvent.lastModifiedDateTime || now.toISOString()
            },
            internalData: {
              mecCategories: [],
              setupStartTime: null,
              doorStartTime: null,
              teardownEndTime: null,
              staffAssignments: [],
              internalNotes: '',
              setupStatus: 'pending',
              estimatedCost: null,
              actualCost: null,
              customFields: {}
            },
            isDeleted: false,
            lastSyncedAt: now,
            syncStatus: 'synced',
            createdAt: now,
            updatedAt: now
          };
          
          await internalEventsCollection.insertOne(newInternalEvent);
          syncResults.created++;
        }
      } catch (error) {
        console.error(`Error syncing event ${graphEvent.id}:`, error);
        syncResults.errors.push({
          eventId: graphEvent.id,
          error: error.message
        });
      }
    }
    
    // Mark events as deleted if they weren't in the sync
    const syncedEventIds = events.map(e => e.id);
    await internalEventsCollection.updateMany(
      {
        calendarId: calendarId,
        graphEventId: { $nin: syncedEventIds },
        isDeleted: false
      },
      {
        $set: {
          isDeleted: true,
          updatedAt: new Date()
        }
      }
    );
    
    console.log('Sync completed:', syncResults);
    res.status(200).json({
      message: 'Sync completed',
      results: syncResults
    });
  } catch (error) {
    console.error('Error syncing events:', error);
    res.status(500).json({ error: 'Failed to sync events' });
  }
});

// Get synced events for a calendar
// Update the GET /api/internal-events endpoint in api-server.js
app.get('/api/internal-events', verifyToken, async (req, res) => {
  try {
    const { calendarId, includeDeleted } = req.query;
    
    const query = {};
    if (calendarId) {
      query.calendarId = calendarId;
    }
    
    // By default, exclude deleted events unless specifically requested
    if (includeDeleted !== 'true') {
      query.isDeleted = { $ne: true };
    }
    
    // Remove the sort to avoid index issues with Cosmos DB
    const events = await internalEventsCollection
      .find(query)
      .limit(100)
      .toArray();
    
    // Sort in memory instead
    events.sort((a, b) => {
      const dateA = new Date(a.externalData?.start?.dateTime || 0);
      const dateB = new Date(b.externalData?.start?.dateTime || 0);
      return dateA - dateB;
    });
    
    res.status(200).json(events);
  } catch (error) {
    console.error('Error fetching internal events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get internal data for enrichment
app.post('/api/internal-events/enrich', verifyToken, async (req, res) => {
  try {
    const { eventIds } = req.body;
    
    if (!eventIds || !Array.isArray(eventIds)) {
      return res.status(400).json({ error: 'eventIds array is required' });
    }
    
    // Fetch internal events
    const internalEvents = await internalEventsCollection.find({
      graphEventId: { $in: eventIds },
      isDeleted: false
    }).toArray();
    
    // Create a map for easy lookup
    const enrichmentMap = {};
    
    internalEvents.forEach(event => {
      enrichmentMap[event.graphEventId] = {
        ...event.internalData,
        _lastSyncedAt: event.lastSyncedAt,
        _internalId: event._id
      };
    });
    
    res.status(200).json(enrichmentMap);
  } catch (error) {
    console.error('Error fetching enrichment data:', error);
    res.status(500).json({ error: 'Failed to fetch enrichment data' });
  }
});

// Update internal data fields
app.patch('/api/internal-events/:graphEventId', verifyToken, async (req, res) => {
  try {
    const { graphEventId } = req.params;
    const updates = req.body;
    
    console.log(`Updating internal data for event ${graphEventId}:`, updates);
    
    // Define which fields can be updated
    const allowedFields = [
      'mecCategories',
      'setupStartTime',
      'doorStartTime',
      'teardownEndTime',
      'staffAssignments',
      'internalNotes',
      'setupStatus',
      'estimatedCost',
      'actualCost',
      'customFields'
    ];
    
    // Build update object with only allowed fields
    const updateData = {
      updatedAt: new Date()
    };
    
    allowedFields.forEach(field => {
      if (field in updates) {
        updateData[`internalData.${field}`] = updates[field];
      }
    });
    
    const result = await internalEventsCollection.updateOne(
      { graphEventId: graphEventId },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      // Event doesn't exist in internal DB, create it with minimal data
      const newEvent = {
        graphEventId: graphEventId,
        externalData: {
          subject: 'Unsynced Event',
          start: { dateTime: new Date().toISOString() },
          end: { dateTime: new Date().toISOString() }
        },
        internalData: {
          mecCategories: [],
          setupStartTime: null,
          doorStartTime: null,
          teardownEndTime: null,
          staffAssignments: [],
          internalNotes: '',
          setupStatus: 'pending',
          estimatedCost: null,
          actualCost: null,
          customFields: {},
          ...updates // Apply the updates
        },
        isDeleted: false,
        lastSyncedAt: new Date(),
        syncStatus: 'pending', // Mark as pending since it wasn't synced
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await internalEventsCollection.insertOne(newEvent);
      return res.status(201).json({ message: 'Created new internal event', event: newEvent });
    }
    
    // Return the updated event
    const updatedEvent = await internalEventsCollection.findOne({ graphEventId });
    res.status(200).json(updatedEvent);
  } catch (error) {
    console.error('Error updating internal event:', error);
    res.status(500).json({ error: 'Failed to update internal event' });
  }
});

// Get available MEC categories
app.get('/api/internal-events/mec-categories', verifyToken, async (req, res) => {
  try {
    // Get distinct MEC categories from all events
    const categories = await internalEventsCollection.distinct('internalData.mecCategories');
    
    // Filter out null/empty values and sort
    const cleanCategories = categories
      .filter(cat => cat && cat.trim() !== '')
      .sort();
    
    res.status(200).json(cleanCategories);
  } catch (error) {
    console.error('Error fetching MEC categories:', error);
    res.status(500).json({ error: 'Failed to fetch MEC categories' });
  }
});

// Get sync status (for admin panel)
app.get('/api/internal-events/sync-status', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    const user = await usersCollection.findOne({ userId: req.user.userId });
    if (!user?.preferences?.isAdmin && !user?.isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Check if collection exists, if not return empty stats
    try {
      const totalEvents = await internalEventsCollection.countDocuments({});
      const deletedEvents = await internalEventsCollection.countDocuments({ isDeleted: true });
      const lastSync = await internalEventsCollection.findOne(
        {},
        { sort: { lastSyncedAt: -1 } }
      );
      
      res.status(200).json({
        totalEvents,
        activeEvents: totalEvents - deletedEvents,
        deletedEvents,
        lastSyncedAt: lastSync?.lastSyncedAt || null
      });
    } catch (collectionError) {
      // Collection might not exist yet
      console.log('Internal events collection might not exist yet:', collectionError.message);
      res.status(200).json({
        totalEvents: 0,
        activeEvents: 0,
        deletedEvents: 0,
        lastSyncedAt: null
      });
    }
  } catch (error) {
    console.error('Error getting sync status:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

// ============================================
// EVENT CACHE SERVICE
// ============================================

/**
 * Cache configuration constants
 */
const CACHE_CONFIG = {
  DEFAULT_TTL_HOURS: 24,          // Default cache expiry
  MAX_CACHE_SIZE: 10000,          // Max events to cache per user
  STALE_THRESHOLD_MINUTES: 60,    // When to refresh even if not expired
  BACKGROUND_SYNC_ENABLED: true   // Enable background sync
};

/**
 * Generate cache key for an event
 */
function generateCacheKey(userId, calendarId, eventId) {
  return `${userId}:${calendarId}:${eventId}`;
}

/**
 * Cache an event with metadata
 */
async function cacheEvent(userId, calendarId, eventData, internalData = null) {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (CACHE_CONFIG.DEFAULT_TTL_HOURS * 60 * 60 * 1000));
    
    const cacheEntry = {
      userId: userId,
      calendarId: calendarId,
      eventId: eventData.id,
      etag: eventData['@odata.etag'] || null,
      lastModified: eventData.lastModifiedDateTime ? new Date(eventData.lastModifiedDateTime) : now,
      cachedAt: now,
      expiresAt: expiresAt,
      eventData: eventData,
      internalData: internalData || {},
      version: 1,
      changeKey: eventData.changeKey || null,
      isDirty: false,
      lastAccessedAt: now
    };
    
    // Use upsert to handle updates
    await eventCacheCollection.replaceOne(
      { 
        userId: userId, 
        calendarId: calendarId, 
        eventId: eventData.id 
      },
      cacheEntry,
      { upsert: true }
    );
    
    logger.debug(`Cached event: ${eventData.subject} (${eventData.id})`);
    return cacheEntry;
  } catch (error) {
    logger.error('Error caching event:', error);
    throw error;
  }
}

/**
 * Get cached events for a date range
 */
async function getCachedEvents(userId, calendarId, startDate, endDate) {
  try {
    const now = new Date();
    
    const query = {
      userId: userId,
      calendarId: calendarId,
      "eventData.start.dateTime": {
        $gte: startDate.toISOString(),
        $lte: endDate.toISOString()
      },
      expiresAt: { $gt: now } // Only non-expired events
    };
    
    const cachedEvents = await eventCacheCollection.find(query).toArray();
    
    // Update last accessed time for LRU
    if (cachedEvents.length > 0) {
      const eventIds = cachedEvents.map(e => e.eventId);
      await eventCacheCollection.updateMany(
        { 
          userId: userId, 
          calendarId: calendarId, 
          eventId: { $in: eventIds } 
        },
        { $set: { lastAccessedAt: now } }
      );
    }
    
    logger.debug(`Found ${cachedEvents.length} cached events for date range`);
    return cachedEvents;
  } catch (error) {
    logger.error('Error getting cached events:', error);
    return [];
  }
}

/**
 * Check which events need to be updated from Graph API
 */
async function getStaleEvents(userId, calendarId, eventIds) {
  try {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - (CACHE_CONFIG.STALE_THRESHOLD_MINUTES * 60 * 1000));
    
    const staleQuery = {
      userId: userId,
      calendarId: calendarId,
      eventId: { $in: eventIds },
      $or: [
        { expiresAt: { $lt: now } },           // Expired
        { cachedAt: { $lt: staleThreshold } }, // Stale
        { isDirty: true }                      // Locally modified
      ]
    };
    
    const staleEvents = await eventCacheCollection.find(staleQuery).toArray();
    logger.debug(`Found ${staleEvents.length} stale events out of ${eventIds.length} total`);
    
    return staleEvents.map(e => e.eventId);
  } catch (error) {
    logger.error('Error checking stale events:', error);
    return eventIds; // Fallback to refreshing all events
  }
}

/**
 * Cache-first event loading endpoint
 */
app.get('/api/events/cached', verifyToken, async (req, res) => {
  try {
    const { calendarId, startTime, endTime, forceRefresh } = req.query;
    
    if (!calendarId || !startTime || !endTime) {
      return res.status(400).json({ 
        error: 'calendarId, startTime, and endTime parameters are required' 
      });
    }
    
    const userId = req.user.userId;
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);
    
    logger.log(`Cache-first loading events for ${userId}, calendar ${calendarId}, ${startTime} to ${endTime}`);
    
    let cachedEvents = [];
    let needsGraphApi = false;
    
    if (forceRefresh !== 'true') {
      // Try to get events from cache first
      cachedEvents = await getCachedEvents(userId, calendarId, startDate, endDate);
      
      if (cachedEvents.length === 0) {
        needsGraphApi = true;
        logger.debug('No cached events found, will fetch from Graph API');
      } else {
        // Check if any cached events are stale
        const eventIds = cachedEvents.map(e => e.eventId);
        const staleEventIds = await getStaleEvents(userId, calendarId, eventIds);
        
        if (staleEventIds.length > 0) {
          needsGraphApi = true;
          logger.debug(`${staleEventIds.length} events are stale, will refresh from Graph API`);
        }
      }
    } else {
      needsGraphApi = true;
      logger.debug('Force refresh requested');
    }
    
    // Return cached events if they're fresh enough
    if (!needsGraphApi && cachedEvents.length > 0) {
      const events = cachedEvents.map(cached => ({
        ...cached.eventData,
        ...cached.internalData,
        _cached: true,
        _cachedAt: cached.cachedAt
      }));
      
      return res.status(200).json({
        events: events,
        source: 'cache',
        cachedAt: cachedEvents[0]?.cachedAt,
        count: events.length
      });
    }
    
    // If we reach here, we need to fetch from Graph API
    // This would integrate with your existing Graph API loading logic
    // For now, return a placeholder response indicating cache miss
    return res.status(200).json({
      events: [],
      source: 'cache_miss',
      message: 'Cache miss - integrate with existing Graph API loading',
      needsGraphApi: true
    });
    
  } catch (error) {
    logger.error('Error in cache-first loading:', error);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

/**
 * Cache statistics endpoint
 */
app.get('/api/events/cache-stats', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const totalCached = await eventCacheCollection.countDocuments({ userId: userId });
    const expiredCount = await eventCacheCollection.countDocuments({ 
      userId: userId,
      expiresAt: { $lt: new Date() }
    });
    const dirtyCount = await eventCacheCollection.countDocuments({ 
      userId: userId,
      isDirty: true 
    });
    
    // Get cache size by calendar
    const cacheByCalendar = await eventCacheCollection.aggregate([
      { $match: { userId: userId } },
      { $group: { 
        _id: "$calendarId", 
        count: { $sum: 1 },
        oldestCached: { $min: "$cachedAt" },
        newestCached: { $max: "$cachedAt" }
      }}
    ]).toArray();
    
    res.status(200).json({
      userId: userId,
      totalCached: totalCached,
      expiredCount: expiredCount,
      dirtyCount: dirtyCount,
      activeCount: totalCached - expiredCount,
      cacheByCalendar: cacheByCalendar,
      maxCacheSize: CACHE_CONFIG.MAX_CACHE_SIZE,
      ttlHours: CACHE_CONFIG.DEFAULT_TTL_HOURS
    });
  } catch (error) {
    logger.error('Error getting cache stats:', error);
    res.status(500).json({ error: 'Failed to get cache statistics' });
  }
});

/**
 * Invalidate cache endpoint
 */
app.post('/api/events/cache-invalidate', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { calendarId, eventIds, all } = req.body;
    
    let deleteQuery = { userId: userId };
    
    if (all === true) {
      // Invalidate all cache for user
      logger.log(`Invalidating all cache for user ${userId}`);
    } else if (calendarId) {
      deleteQuery.calendarId = calendarId;
      logger.log(`Invalidating cache for calendar ${calendarId}`);
    } else if (eventIds && Array.isArray(eventIds)) {
      deleteQuery.eventId = { $in: eventIds };
      logger.log(`Invalidating cache for ${eventIds.length} events`);
    } else {
      return res.status(400).json({ 
        error: 'Specify calendarId, eventIds array, or all=true' 
      });
    }
    
    const result = await eventCacheCollection.deleteMany(deleteQuery);
    
    res.status(200).json({
      message: 'Cache invalidated successfully',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    logger.error('Error invalidating cache:', error);
    res.status(500).json({ error: 'Failed to invalidate cache' });
  }
});

/**
 * Clean duplicate cache entries - Admin endpoint
 */
app.post('/api/admin/cache/clean-duplicates', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Find all cache entries for this user
    const allEntries = await eventCacheCollection.find({ userId }).toArray();
    
    // Group by eventId to find duplicates
    const eventGroups = {};
    allEntries.forEach(entry => {
      if (!eventGroups[entry.eventId]) {
        eventGroups[entry.eventId] = [];
      }
      eventGroups[entry.eventId].push(entry);
    });
    
    let duplicatesRemoved = 0;
    const idsToRemove = [];
    
    // For each event with duplicates, keep the one with proper calendarId
    Object.entries(eventGroups).forEach(([eventId, entries]) => {
      if (entries.length > 1) {
        // Sort by preference: 
        // 1. Has proper calendarId (not 'default' or null)
        // 2. Most recently cached
        entries.sort((a, b) => {
          // Prefer entries with real calendar IDs
          const aHasRealId = a.calendarId && a.calendarId !== 'default';
          const bHasRealId = b.calendarId && b.calendarId !== 'default';
          
          if (aHasRealId && !bHasRealId) return -1;
          if (!aHasRealId && bHasRealId) return 1;
          
          // Then by cached time (newer first)
          return new Date(b.cachedAt) - new Date(a.cachedAt);
        });
        
        // Keep the first (best) one, mark others for removal
        for (let i = 1; i < entries.length; i++) {
          idsToRemove.push(entries[i]._id);
          duplicatesRemoved++;
        }
      }
    });
    
    // Remove duplicates
    if (idsToRemove.length > 0) {
      await eventCacheCollection.deleteMany({ _id: { $in: idsToRemove } });
    }
    
    logger.log(`Cleaned ${duplicatesRemoved} duplicate cache entries for user ${userId}`);
    
    res.status(200).json({
      message: 'Duplicate cache entries cleaned',
      duplicatesRemoved: duplicatesRemoved,
      totalEventsChecked: Object.keys(eventGroups).length
    });
  } catch (error) {
    logger.error('Error cleaning duplicate cache entries:', error);
    res.status(500).json({ error: 'Failed to clean duplicates' });
  }
});

/**
 * Cache events endpoint - Store events in cache
 */
app.post('/api/events/cache', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { events, calendarId } = req.body;
    
    if (!events || !Array.isArray(events) || !calendarId) {
      return res.status(400).json({ 
        error: 'events array and calendarId are required' 
      });
    }
    
    logger.log(`Caching ${events.length} events for user ${userId}, calendar ${calendarId}`);
    
    let cachedCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Cache each event
    for (const event of events) {
      try {
        await cacheEvent(userId, calendarId, event);
        cachedCount++;
      } catch (error) {
        errorCount++;
        errors.push({
          eventId: event.id,
          subject: event.subject,
          error: error.message
        });
        logger.error(`Failed to cache event ${event.id}:`, error);
      }
    }
    
    // Cleanup old cache entries if we're approaching the limit
    try {
      const totalCached = await eventCacheCollection.countDocuments({ userId: userId });
      if (totalCached > CACHE_CONFIG.MAX_CACHE_SIZE) {
        const excessCount = totalCached - CACHE_CONFIG.MAX_CACHE_SIZE;
        logger.log(`Cache size (${totalCached}) exceeds limit, removing ${excessCount} oldest entries`);
        
        // Remove oldest entries (LRU eviction)
        const oldestEntries = await eventCacheCollection
          .find({ userId: userId })
          .sort({ lastAccessedAt: 1 })
          .limit(excessCount)
          .toArray();
          
        if (oldestEntries.length > 0) {
          const oldestIds = oldestEntries.map(e => e._id);
          await eventCacheCollection.deleteMany({ _id: { $in: oldestIds } });
          logger.log(`Removed ${oldestIds.length} old cache entries`);
        }
      }
    } catch (cleanupError) {
      logger.warn('Cache cleanup failed:', cleanupError);
    }
    
    res.status(200).json({
      message: 'Events cached successfully',
      cachedCount: cachedCount,
      errorCount: errorCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    logger.error('Error caching events:', error);
    res.status(500).json({ error: 'Failed to cache events' });
  }
});

/**
 * Check which events are missing from cache
 */
app.post('/api/events/cache-missing', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { eventIds, calendarId } = req.body;
    
    if (!eventIds || !Array.isArray(eventIds) || !calendarId) {
      return res.status(400).json({ 
        error: 'eventIds array and calendarId are required' 
      });
    }
    
    logger.debug(`Checking which of ${eventIds.length} events are missing from cache for user ${userId}, calendar ${calendarId}`);
    
    // Find which events are already cached and not expired
    const now = new Date();
    const cachedEventIds = await eventCacheCollection
      .find(
        { 
          userId: userId,
          calendarId: calendarId,
          eventId: { $in: eventIds },
          expiresAt: { $gt: now } // Only consider non-expired cached events
        },
        { projection: { eventId: 1 } }
      )
      .toArray();
    
    const cachedIds = new Set(cachedEventIds.map(e => e.eventId));
    const missingEventIds = eventIds.filter(id => !cachedIds.has(id));
    
    logger.debug(`Found ${cachedEventIds.length} cached events, ${missingEventIds.length} missing from cache`);
    
    res.status(200).json({
      totalChecked: eventIds.length,
      cachedCount: cachedEventIds.length,
      missingCount: missingEventIds.length,
      missingEventIds: missingEventIds
    });
  } catch (error) {
    logger.error('Error checking missing cache entries:', error);
    res.status(500).json({ error: 'Failed to check cache entries' });
  }
});

// ============================================
// ADMIN CACHE MANAGEMENT ENDPOINTS
// ============================================

/**
 * Admin endpoint - Get cache overview and statistics
 */
app.get('/api/admin/cache/overview', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Basic cache statistics
    const totalCached = await eventCacheCollection.countDocuments({ userId: userId });
    const expiredCount = await eventCacheCollection.countDocuments({ 
      userId: userId,
      expiresAt: { $lt: new Date() }
    });
    const dirtyCount = await eventCacheCollection.countDocuments({ 
      userId: userId,
      isDirty: true 
    });
    
    // Cache by calendar breakdown
    const cacheByCalendar = await eventCacheCollection.aggregate([
      { $match: { userId: userId } },
      { $group: { 
        _id: "$calendarId", 
        count: { $sum: 1 },
        oldestCached: { $min: "$cachedAt" },
        newestCached: { $max: "$cachedAt" },
        avgResponseTime: { $avg: "$responseTimeMs" }
      }},
      { $sort: { count: -1 } }
    ]).toArray();
    
    // Recent cache operations (last 24 hours)
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentOperations = await eventCacheCollection.find({
      userId: userId,
      $or: [
        { cachedAt: { $gte: last24Hours } },
        { lastAccessedAt: { $gte: last24Hours } }
      ]
    })
    .sort({ lastAccessedAt: -1 })
    .limit(10)
    .toArray();
    
    // Storage utilization
    const cacheCollectionStats = await db.collection('templeEvents__EventCache').stats();
    
    res.status(200).json({
      userId: userId,
      statistics: {
        totalCached: totalCached,
        expiredCount: expiredCount,
        dirtyCount: dirtyCount,
        activeCount: totalCached - expiredCount,
        hitRatio: totalCached > 0 ? ((totalCached - expiredCount) / totalCached * 100).toFixed(2) : 0
      },
      cacheByCalendar: cacheByCalendar,
      recentOperations: recentOperations.map(op => ({
        eventId: op.eventId,
        calendarId: op.calendarId,
        subject: op.eventData?.subject || 'Unknown',
        cachedAt: op.cachedAt,
        lastAccessedAt: op.lastAccessedAt,
        expiresAt: op.expiresAt,
        isDirty: op.isDirty
      })),
      storage: {
        totalSize: cacheCollectionStats.size,
        indexSize: cacheCollectionStats.totalIndexSize,
        documentCount: cacheCollectionStats.count
      },
      configuration: {
        maxCacheSize: CACHE_CONFIG.MAX_CACHE_SIZE,
        ttlHours: CACHE_CONFIG.DEFAULT_TTL_HOURS,
        staleThresholdMinutes: CACHE_CONFIG.STALE_THRESHOLD_MINUTES
      }
    });
  } catch (error) {
    logger.error('Error getting cache overview:', error);
    res.status(500).json({ error: 'Failed to get cache overview' });
  }
});

/**
 * Admin endpoint - Browse cached events with pagination and filtering
 */
app.get('/api/admin/cache/events', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    logger.debug('Admin cache events request:', { userId, query: req.query });
    
    // Check if we have a valid userId
    if (!userId) {
      logger.error('No userId found in request');
      return res.status(400).json({ error: 'User ID not found' });
    }
    
    // Check if eventCacheCollection is initialized
    if (!eventCacheCollection) {
      logger.error('eventCacheCollection is not initialized');
      return res.status(500).json({ error: 'Cache collection not initialized' });
    }
    
    const { 
      page = 1, 
      limit = 20, 
      calendarId, 
      status, 
      search,
      sortBy = 'cachedAt',
      sortOrder = 'desc'
    } = req.query;
    
    // Parse numeric parameters
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    
    // Build simple query first
    const query = { userId: userId };
    
    // Temporarily simplify to avoid Cosmos DB issues
    logger.debug('Executing simplified query to get all cached events for user');
    const allEvents = await eventCacheCollection.find(query).toArray();
    logger.debug('Found total events for user:', allEvents.length);
    
    // Apply filters in memory
    let filteredEvents = allEvents;
    
    if (calendarId) {
      filteredEvents = filteredEvents.filter(event => event.calendarId === calendarId);
    }
    
    if (status === 'expired') {
      const now = new Date();
      filteredEvents = filteredEvents.filter(event => new Date(event.expiresAt) < now);
    } else if (status === 'active') {
      const now = new Date();
      filteredEvents = filteredEvents.filter(event => new Date(event.expiresAt) >= now);
    } else if (status === 'dirty') {
      filteredEvents = filteredEvents.filter(event => event.isDirty === true);
    }
    
    if (search) {
      const searchLower = search.toLowerCase();
      filteredEvents = filteredEvents.filter(event => 
        (event.eventData?.subject || '').toLowerCase().includes(searchLower) ||
        (event.eventId || '').toLowerCase().includes(searchLower) ||
        (event.eventData?.location?.displayName || '').toLowerCase().includes(searchLower)
      );
    }
    
    // Sort in memory
    filteredEvents.sort((a, b) => {
      if (sortBy === 'cachedAt') {
        const dateA = new Date(a.cachedAt || 0);
        const dateB = new Date(b.cachedAt || 0);
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      } else if (sortBy === 'subject') {
        const subjectA = (a.eventData?.subject || '').toLowerCase();
        const subjectB = (b.eventData?.subject || '').toLowerCase();
        const result = subjectA.localeCompare(subjectB);
        return sortOrder === 'desc' ? -result : result;
      }
      return 0;
    });
    
    // Apply pagination in memory
    const totalCount = filteredEvents.length;
    const startIdx = (pageNum - 1) * limitNum;
    const paginatedEvents = filteredEvents.slice(startIdx, startIdx + limitNum);
    
    res.status(200).json({
      events: paginatedEvents.map(event => ({
        _id: event._id,
        eventId: event.eventId,
        calendarId: event.calendarId,
        subject: event.eventData?.subject || 'Unknown',
        startTime: event.eventData?.start?.dateTime,
        endTime: event.eventData?.end?.dateTime,
        location: event.eventData?.location?.displayName,
        category: event.eventData?.category || 'Uncategorized',
        cachedAt: event.cachedAt,
        lastAccessedAt: event.lastAccessedAt,
        expiresAt: event.expiresAt,
        isDirty: event.isDirty,
        etag: event.etag,
        version: event.version,
        // Enhanced fields from internal data
        hasInternalData: event.eventData?._hasInternalData || false,
        mecCategories: event.eventData?.mecCategories || [],
        setupMinutes: event.eventData?.setupMinutes || 0,
        teardownMinutes: event.eventData?.teardownMinutes || 0,
        registrationNotes: event.eventData?.registrationNotes || '',
        assignedTo: event.eventData?.assignedTo || '',
        hasRegistrationEvent: event.eventData?.hasRegistrationEvent || false,
        linkedEventId: event.eventData?.linkedEventId || null,
        registrationStart: event.eventData?.registrationStart || null,
        registrationEnd: event.eventData?.registrationEnd || null,
        // Extension data (dynamic fields from schema extensions)
        extensions: event.eventData?.extensions || []
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount: totalCount,
        totalPages: Math.ceil(totalCount / limitNum)
      },
      filters: {
        calendarId,
        status,
        search,
        sortBy,
        sortOrder
      }
    });
  } catch (error) {
    logger.error('Error browsing cached events:', error);
    res.status(500).json({ error: 'Failed to browse cached events', details: error.message });
  }
});

/**
 * Admin endpoint - Get detailed cache event data
 */
app.get('/api/admin/cache/events/:eventId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { eventId } = req.params;
    
    const cacheEntry = await eventCacheCollection.findOne({
      userId: userId,
      eventId: eventId
    });
    
    if (!cacheEntry) {
      return res.status(404).json({ error: 'Cached event not found' });
    }
    
    res.status(200).json({
      cacheEntry: cacheEntry,
      metadata: {
        isExpired: cacheEntry.expiresAt < new Date(),
        timeToExpire: Math.max(0, cacheEntry.expiresAt - new Date()),
        lastAccessedAgo: new Date() - cacheEntry.lastAccessedAt,
        cacheAge: new Date() - cacheEntry.cachedAt,
        dataSize: JSON.stringify(cacheEntry.eventData).length
      }
    });
  } catch (error) {
    logger.error('Error getting cached event details:', error);
    res.status(500).json({ error: 'Failed to get cached event details' });
  }
});

/**
 * Admin endpoint - Manually refresh specific cached events
 */
app.post('/api/admin/cache/refresh', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { eventIds, calendarId } = req.body;
    
    if (!eventIds || !Array.isArray(eventIds)) {
      return res.status(400).json({ error: 'eventIds array is required' });
    }
    
    let refreshedCount = 0;
    let errorCount = 0;
    const errors = [];
    
    for (const eventId of eventIds) {
      try {
        // Mark as dirty to force refresh on next access
        const result = await eventCacheCollection.updateOne(
          { userId: userId, eventId: eventId },
          { 
            $set: { 
              isDirty: true,
              lastModified: new Date()
            }
          }
        );
        
        if (result.modifiedCount > 0) {
          refreshedCount++;
        }
      } catch (error) {
        errorCount++;
        errors.push({
          eventId: eventId,
          error: error.message
        });
      }
    }
    
    res.status(200).json({
      message: 'Cache refresh completed',
      refreshedCount: refreshedCount,
      errorCount: errorCount,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    logger.error('Error refreshing cache:', error);
    res.status(500).json({ error: 'Failed to refresh cache' });
  }
});

/**
 * Admin endpoint - Cache performance testing
 */
app.post('/api/admin/cache/test-performance', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { calendarId, testType = 'basic' } = req.body;
    
    const results = {
      testType: testType,
      timestamp: new Date(),
      userId: userId,
      calendarId: calendarId
    };
    
    // Test 1: Cache lookup performance
    const cacheStartTime = Date.now();
    const cachedEventCount = await eventCacheCollection.countDocuments({
      userId: userId,
      calendarId: calendarId,
      expiresAt: { $gte: new Date() }
    });
    const cacheLookupTime = Date.now() - cacheStartTime;
    
    // Test 2: Sample cache queries
    const queryStartTime = Date.now();
    const sampleEvents = await eventCacheCollection
      .find({ 
        userId: userId, 
        calendarId: calendarId,
        expiresAt: { $gte: new Date() }
      })
      .limit(10)
      .toArray();
    const queryTime = Date.now() - queryStartTime;
    
    // Test 3: Cache utilization
    const totalCacheSize = await eventCacheCollection.estimatedDocumentCount();
    const userCacheSize = await eventCacheCollection.countDocuments({ userId: userId });
    
    results.performance = {
      cacheLookupTimeMs: cacheLookupTime,
      queryTimeMs: queryTime,
      cachedEventCount: cachedEventCount,
      sampleEventCount: sampleEvents.length,
      avgEventSizeBytes: sampleEvents.length > 0 ? 
        Math.round(sampleEvents.reduce((sum, event) => sum + JSON.stringify(event).length, 0) / sampleEvents.length) : 0
    };
    
    results.utilization = {
      totalCacheSize: totalCacheSize,
      userCacheSize: userCacheSize,
      userCachePercentage: totalCacheSize > 0 ? (userCacheSize / totalCacheSize * 100).toFixed(2) : 0,
      maxCacheSize: CACHE_CONFIG.MAX_CACHE_SIZE,
      utilizationPercentage: (totalCacheSize / CACHE_CONFIG.MAX_CACHE_SIZE * 100).toFixed(2)
    };
    
    // Test 4: Index performance (if requested)
    if (testType === 'detailed') {
      const indexStartTime = Date.now();
      const indexStats = await eventCacheCollection.aggregate([
        { $indexStats: {} }
      ]).toArray();
      const indexAnalysisTime = Date.now() - indexStartTime;
      
      results.indexes = {
        analysisTimeMs: indexAnalysisTime,
        indexCount: indexStats.length,
        indexes: indexStats.map(idx => ({
          name: idx.name,
          accesses: idx.accesses?.ops || 0
        }))
      };
    }
    
    res.status(200).json(results);
  } catch (error) {
    logger.error('Error running cache performance test:', error);
    res.status(500).json({ error: 'Failed to run cache performance test' });
  }
});

/**
 * Admin endpoint - Cache cleanup operations
 */
app.post('/api/admin/cache/cleanup', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { operation = 'expired', calendarId } = req.body;
    
    let query = { userId: userId };
    let operationDescription = '';
    
    switch (operation) {
      case 'expired':
        query.expiresAt = { $lt: new Date() };
        operationDescription = 'expired cache entries';
        break;
      case 'dirty':
        query.isDirty = true;
        operationDescription = 'dirty cache entries';
        break;
      case 'old':
        // Older than 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        query.cachedAt = { $lt: sevenDaysAgo };
        operationDescription = 'cache entries older than 7 days';
        break;
      case 'calendar':
        if (!calendarId) {
          return res.status(400).json({ error: 'calendarId required for calendar cleanup' });
        }
        query.calendarId = calendarId;
        operationDescription = `cache entries for calendar ${calendarId}`;
        break;
      default:
        return res.status(400).json({ error: 'Invalid cleanup operation' });
    }
    
    const deleteResult = await eventCacheCollection.deleteMany(query);
    
    res.status(200).json({
      message: `Cleanup completed: removed ${deleteResult.deletedCount} ${operationDescription}`,
      operation: operation,
      deletedCount: deleteResult.deletedCount,
      query: query
    });
  } catch (error) {
    logger.error('Error during cache cleanup:', error);
    res.status(500).json({ error: 'Failed to perform cache cleanup' });
  }
});

// ============================================
// PUBLIC ENDPOINTS (No Authentication Required)
// ============================================
app.get('/api/public/internal-events', async (req, res) => {
  try {
    const { calendarId, includeDeleted } = req.query;
    
    const query = {};
    if (calendarId) {
      query.calendarId = calendarId;
    }
    
    // By default, exclude deleted events unless specifically requested
    if (includeDeleted !== 'true') {
      query.isDeleted = { $ne: true };
    }
    
    // Fetch events without sorting to avoid index issues
    const events = await internalEventsCollection
      .find(query)
      .limit(1000) // Increased limit for exports
      .toArray();
    
    // Sort in memory instead
    events.sort((a, b) => {
      const dateA = new Date(a.externalData?.start?.dateTime || 0);
      const dateB = new Date(b.externalData?.start?.dateTime || 0);
      return dateA - dateB;
    });
    
    // Log the export for monitoring purposes
    console.log(`Public export requested: ${events.length} events exported`);
    
    res.status(200).json(events);
  } catch (error) {
    console.error('Error fetching internal events for public export:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Public endpoint to get available MEC categories (for dropdowns)
app.get('/api/public/mec-categories', async (req, res) => {
  try {
    // Get distinct MEC categories from all events
    const categories = await internalEventsCollection.distinct('internalData.mecCategories');
    
    // Filter out null/empty values and sort
    const cleanCategories = categories
      .filter(cat => cat && cat.trim() !== '')
      .sort();
    
    res.status(200).json(cleanCategories);
  } catch (error) {
    console.error('Error fetching MEC categories:', error);
    res.status(500).json({ error: 'Failed to fetch MEC categories' });
  }
});

// Simple test route that doesn't require authentication
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'API is running' });
});

// Get current user (using MSAL token)
app.get('/api/users/current', verifyToken, async (req, res) => {
  try {
    console.log('Getting current user for:', req.user.email);
    
    // First try to find user by userId (MSAL ID)
    let user = await usersCollection.findOne({ userId: req.user.userId });
    
    // If not found, try to find by email
    if (!user) {
      user = await usersCollection.findOne({ email: req.user.email });
    }
    
    if (!user) {
      console.log('User not found, returning 404');
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update lastLogin if you want to track this
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );
    
    console.log('Returning user:', user._id.toString());
    res.status(200).json(user);
  } catch (error) {
    console.error('Error getting current user:', error);
    res.status(500).json({ error: 'Failed to retrieve user' });
  }
});

// Update current user
app.put('/api/users/current', verifyToken, async (req, res) => {
  try {
    const updates = req.body;
    console.log('Updating current user, received data:', updates);
    
    // First try to find user by userId (MSAL ID)
    let user = await usersCollection.findOne({ userId: req.user.userId });
    
    // If not found, try to find by email
    if (!user) {
      user = await usersCollection.findOne({ email: req.user.email });
    }
    
    if (!user) {
      // User doesn't exist, create a new one
      console.log('User not found, creating new user');
      const newUser = {
        userId: req.user.userId,
        email: req.user.email,
        displayName: updates.displayName || req.user.name || req.user.email.split('@')[0],
        preferences: updates.preferences || {
          startOfWeek: 'Sunday',
          createEvents: true,
          editEvents: true,
          deleteEvents: false,
          defaultView: 'week',
          defaultGroupBy: 'categories',
          preferredZoomLevel: 100
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      console.log('Creating new user:', newUser);
      const result = await usersCollection.insertOne(newUser);
      const createdUser = await usersCollection.findOne({ _id: result.insertedId });
      console.log('New user created with ID:', createdUser._id.toString());
      return res.status(201).json(createdUser);
    }
    
    // Update the timestamp
    updates.updatedAt = new Date();
    
    // Handle nested preferences object
    if (updates.preferences) {
      // Preserve existing preferences and merge with updates
      updates.preferences = {
        ...user.preferences,
        ...updates.preferences
      };
    }
    
    console.log('Updating user:', user._id.toString());
    const result = await usersCollection.updateOne(
      { _id: user._id },
      { $set: updates }
    );
    
    // Return the updated user
    const updatedUser = await usersCollection.findOne({ _id: user._id });
    console.log('User updated successfully');
    res.status(200).json(updatedUser);
  } catch (error) {
    console.error('Error updating current user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Update user preferences
app.patch('/api/users/current/preferences', verifyToken, async (req, res) => {
  try {
    const updates = req.body;
    console.log('Updating user preferences, received data:', updates);
    console.log('User from token:', req.user);
    
    if (!req.user || !req.user.userId || !req.user.email) {
      console.error('Invalid user data from token:', req.user);
      return res.status(401).json({ 
        error: 'Invalid user data',
        message: 'The authentication token did not contain valid user information'
      });
    }
    
    // First try to find user by userId (MSAL ID)
    let user = await usersCollection.findOne({ userId: req.user.userId });
    console.log('User found by userId:', user ? 'yes' : 'no');
    
    // If not found, try to find by email
    if (!user) {
      user = await usersCollection.findOne({ email: req.user.email });
      console.log('User found by email:', user ? 'yes' : 'no');
    }
    
    if (!user) {
      console.log('No preferences found, returning default preferences');
      // Return default preferences instead of 404
      const defaultPreferences = {
        startOfWeek: 'Sunday',
        createEvents: true,
        editEvents: true,
        deleteEvents: false,
        defaultView: 'week',
        defaultGroupBy: 'categories',
        preferredZoomLevel: 100,
        ...updates // Merge any provided preferences
      };
      
      return res.status(200).json({
        message: 'Using default preferences',
        preferences: defaultPreferences
      });
    }
    
    // Update the timestamp
    const updateData = {
      updatedAt: new Date(),
      preferences: {
        ...user.preferences,
        ...updates
      }
    };
    
    console.log('Updating user preferences:', user._id.toString());
    const result = await usersCollection.updateOne(
      { _id: user._id },
      { $set: updateData }
    );
    
    // Return the updated user
    const updatedUser = await usersCollection.findOne({ _id: user._id });
    console.log('User preferences updated successfully');
    res.status(200).json(updatedUser);
  } catch (error) {
    console.error('Error updating user preferences:', error);
    res.status(500).json({ 
      error: 'Failed to update preferences',
      message: error.message
    });
  }
});

// Get all users - NOW PROTECTED
app.get('/api/users', verifyToken, async (req, res) => {
  try {
    const users = await usersCollection.find({}).toArray();
    res.status(200).json(users);
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// Get a specific user - NOW PROTECTED
app.get('/api/users/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const user = await usersCollection.findOne({ _id: new ObjectId(id) });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.status(200).json(user);
  } catch (error) {
    console.error('Error getting user:', error);
    res.status(500).json({ error: 'Failed to retrieve user' });
  }
});

// Get user by email - NOW PROTECTED
app.get('/api/users/email/:email', verifyToken, async (req, res) => {
  try {
    const email = req.params.email;
    const user = await usersCollection.findOne({ email: email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.status(200).json(user);
  } catch (error) {
    console.error('Error getting user by email:', error);
    res.status(500).json({ error: 'Failed to retrieve user' });
  }
});

// Create a new user - NOW PROTECTED
app.post('/api/users', verifyToken, async (req, res) => {
  try {
    const userData = req.body;
    
    // Check if user with this email already exists
    const existingUser = await usersCollection.findOne({ email: userData.email });
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    
    // Add timestamps
    userData.createdAt = new Date();
    userData.updatedAt = new Date();
    
    const result = await usersCollection.insertOne(userData);
    
    // Return the created user with the generated ID
    const createdUser = await usersCollection.findOne({ _id: result.insertedId });
    res.status(201).json(createdUser);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update a user - NOW PROTECTED
app.put('/api/users/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const updates = req.body;
    
    // Update the timestamp
    updates.updatedAt = new Date();
    
    const result = await usersCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updates }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Return the updated user
    const updatedUser = await usersCollection.findOne({ _id: new ObjectId(id) });
    res.status(200).json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete a user - NOW PROTECTED
app.delete('/api/users/:id', verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await client.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  await client.close();
  process.exit(0);
});

// Start the server
async function startServer() {
  await connectToDatabase();
  
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Using App ID: ${APP_ID}`);
    console.log(`Tenant ID: ${TENANT_ID}`);
  });
}

startServer();