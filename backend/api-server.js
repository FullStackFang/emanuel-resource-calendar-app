// api-server.js - Express API for MongoDB
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

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


// Connect to MongoDB with reconnection logic
async function connectToDatabase() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    db = client.db('emanuelnyc');
    usersCollection = db.collection('templeEvents__Users');
    internalEventsCollection = db.collection('templeEvents__InternalEvents');
    
    console.log('Database and collection initialized');
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