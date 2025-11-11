// api-server.js - Express API for MongoDB
console.log('🚀 API SERVER FILE LOADED - CODE VERSION 2.0');
const express = require('express');
const { MongoClient, ObjectId, GridFSBucket } = require('mongodb');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const logger = require('./utils/logger');
const csvUtils = require('./utils/csvUtils');
const { initializeLocationFields, parseLocationString, normalizeLocationString, calculateLocationDisplayNames, isVirtualLocation, getVirtualPlatform } = require('./utils/locationUtils');
const crypto = require('crypto');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const webAppURL = 'https://emanuel-resourcescheduler-d4echehehaf3dxfg.canadacentral-01.azurewebsites.net';

// Use the same App ID for both frontend and backend
const APP_ID = process.env.APP_ID || 'c2187009-796d-4fea-b58c-f83f7a89589e';
const TENANT_ID = process.env.TENANT_ID || 'fcc71126-2b16-4653-b639-0f1ef8332302';

// Calendar configuration for room reservations
const CALENDAR_CONFIG = {
  SANDBOX_CALENDAR: 'templesandbox@emanuelnyc.org',
  PRODUCTION_CALENDAR: 'temple@emanuelnyc.org',
  DEFAULT_MODE: process.env.CALENDAR_MODE || 'sandbox' // Default to sandbox for safety
};


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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Graph-Token', 'If-Match'],
  credentials: true,
  exposedHeaders: ['Authorization', 'ETag'],
  preflightContinue: false,
  optionsSuccessStatus: 204
}));
app.use(express.json());

// Configure multer for file uploads (memory storage for CSV files)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept CSV files and plain text files
    if (file.mimetype === 'text/csv' || 
        file.mimetype === 'application/csv' ||
        file.mimetype === 'text/plain' ||
        file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  }
});

// Configure multer for event attachments (multiple file types)
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB limit for attachments
  },
  fileFilter: (req, file, cb) => {
    // Accept common file types for event attachments
    const allowedTypes = [
      'image/png', 'image/jpeg', 'image/gif', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'text/plain',
      'text/markdown'
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed. Supported types: PNG, JPG, GIF, PDF, DOC, DOCX, XLS, XLSX, TXT, MD`), false);
    }
  }
});

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Graph-Token, If-Match');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Expose-Headers', 'Authorization, ETag');
  res.sendStatus(204);
});

// Log all incoming requests for debugging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  
  // Special detailed logging for delta sync requests
  if (req.url.includes('/events/sync-delta')) {
    logger.debug('Incoming delta sync request details:', {
      method: req.method,
      url: req.url,
      headers: {
        'authorization': req.headers.authorization ? 'Bearer [PRESENT]' : 'MISSING',
        'x-graph-token': req.headers['x-graph-token'] ? '[PRESENT]' : 'MISSING',
        'content-type': req.headers['content-type']
      },
      bodyPreview: req.method === 'POST' ? 'Will be logged in handler' : 'N/A'
    });
  }
  
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
// internalEventsCollection removed - using unifiedEventsCollection instead
// eventCacheCollection removed - using unifiedEventsCollection instead
let unifiedEventsCollection; // New unified collection
let calendarDeltasCollection; // Delta token storage
// roomsCollection removed - DEPRECATED, using locationsCollection instead
let locationsCollection; // Unified locations from events (includes reservable rooms)
let roomReservationsCollection; // Room reservation requests
let reservationTokensCollection; // Guest access tokens
let roomCapabilityTypesCollection; // Configurable room capability definitions

// In-memory progress tracking for location deletion operations
const locationDeletionProgress = new Map();

// Helper function to track deletion progress
function setDeletionProgress(locationId, progress) {
  locationDeletionProgress.set(locationId, {
    ...progress,
    lastUpdated: new Date()
  });

  // Auto-cleanup: remove completed progress after 5 minutes
  if (progress.status === 'completed' || progress.status === 'error') {
    setTimeout(() => {
      locationDeletionProgress.delete(locationId);
    }, 5 * 60 * 1000);
  }
}
let eventServiceTypesCollection; // Configurable event service definitions
let featureCategoriesCollection; // Feature groupings for UI organization
let categoriesCollection; // Event categories (base + dynamic)
let eventAuditHistoryCollection; // Audit trail for event changes
let reservationAuditHistoryCollection; // Audit trail for room reservation changes
let filesBucket; // GridFS bucket for file storage
let eventAttachmentsCollection; // Event-file relationship tracking
let reservationAttachmentsCollection; // Reservation-file relationship tracking
let systemSettingsCollection; // System-wide settings (calendar config, etc)

/**
 * Create indexes for the event cache collection for optimal performance
 */
async function createEventCacheIndexes() {
  try {
    console.log('Creating event cache indexes...');
    
    // Event cache indexes removed - using unifiedEventsCollection instead
  } catch (error) {
    console.error('Error creating event cache indexes:', error);
    // Don't throw - let the app continue even if index creation fails
  }
}

/**
 * Create indexes for the unified events collection for optimal performance
 */
async function createUnifiedEventIndexes() {
  try {
    console.log('Creating unified event indexes...');
    
    // Unique index to prevent duplicate events (by internal eventId)
    await unifiedEventsCollection.createIndex(
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

    // Unique index to prevent duplicate Graph events (by Graph's event ID)
    await unifiedEventsCollection.createIndex(
      {
        userId: 1,
        'graphData.id': 1
      },
      {
        name: "userId_graphId_unique",
        unique: true,
        background: true
      }
    );

    // Index for efficient date range queries
    await unifiedEventsCollection.createIndex(
      { 
        userId: 1, 
        calendarId: 1, 
        "graphData.start.dateTime": 1 
      },
      { 
        name: "userId_calendarId_startTime",
        background: true 
      }
    );
    
    // Index for ETag-based change detection
    await unifiedEventsCollection.createIndex(
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
    
    // Index for finding deleted events
    await unifiedEventsCollection.createIndex(
      { 
        userId: 1, 
        isDeleted: 1 
      },
      { 
        name: "userId_isDeleted",
        background: true,
        sparse: true
      }
    );
    
    // Index for multi-calendar source tracking
    await unifiedEventsCollection.createIndex(
      { 
        userId: 1, 
        "sourceCalendars.calendarId": 1 
      },
      { 
        name: "userId_sourceCalendars",
        background: true 
      }
    );
    
    console.log('Unified event indexes created successfully');
  } catch (error) {
    // Azure Cosmos DB limitation: Cannot modify unique indexes on non-empty collections
    // Code 67 = CannotCreateIndex - This is expected if indexes already exist or collection has data
    // The indexes are already present from previous deployments, so this error is safe to suppress
    if (error.code === 67 || error.codeName === 'CannotCreateIndex') {
      console.log('Unified event indexes already exist (expected behavior on Azure Cosmos DB)');
    } else {
      console.error('Error creating unified event indexes:', error);
    }
  }
}

/**
 * Create indexes for the calendar deltas collection
 */
async function createCalendarDeltaIndexes() {
  try {
    console.log('Creating calendar delta indexes...');
    
    // Unique index for delta tokens
    await calendarDeltasCollection.createIndex(
      { 
        userId: 1, 
        calendarId: 1 
      },
      { 
        name: "userId_calendarId_unique",
        unique: true,
        background: true 
      }
    );
    
    // Index for finding stale delta tokens
    await calendarDeltasCollection.createIndex(
      { 
        userId: 1, 
        lastDeltaSync: 1 
      },
      { 
        name: "userId_lastDeltaSync",
        background: true 
      }
    );
    
    console.log('Calendar delta indexes created successfully');
  } catch (error) {
    console.error('Error creating calendar delta indexes:', error);
  }
}

/**
 * Create indexes for locations collection
 */
async function createLocationIndexes() {
  try {
    console.log('Creating location indexes...');
    
    // Index for location name (unique)
    await locationsCollection.createIndex(
      { name: 1 },
      { name: "location_name", unique: true, background: true }
    );
    
    // Index for aliases
    await locationsCollection.createIndex(
      { aliases: 1 },
      { name: "location_aliases", background: true }
    );
    
    // Index for active locations
    await locationsCollection.createIndex(
      { active: 1, usageCount: -1 },
      { name: "active_usage", background: true }
    );
    
    // Index for location code
    await locationsCollection.createIndex(
      { locationCode: 1 },
      { name: "location_code", background: true, sparse: true }
    );
    
    console.log('Location indexes created successfully');
  } catch (error) {
    logger.error('Error creating location indexes:', error);
  }
}

/**
 * Create indexes for the room reservations collection
 */
async function createRoomReservationIndexes() {
  try {
    console.log('Creating room reservation indexes...');
    
    // Index for finding reservations by requester
    await roomReservationsCollection.createIndex(
      { requesterId: 1, submittedAt: -1 },
      { name: "requester_submissions", background: true }
    );
    
    // Index for finding reservations by status
    await roomReservationsCollection.createIndex(
      { status: 1, submittedAt: -1 },
      { name: "status_date", background: true }
    );
    
    // Index for finding reservations by date range
    await roomReservationsCollection.createIndex(
      { startDateTime: 1, endDateTime: 1 },
      { name: "datetime_range", background: true }
    );
    
    // Index for finding reservations by room
    await roomReservationsCollection.createIndex(
      { requestedRooms: 1, startDateTime: 1 },
      { name: "rooms_datetime", background: true }
    );
    
    console.log('Room reservation indexes created successfully');
  } catch (error) {
    console.error('Error creating room reservation indexes:', error);
  }
}

/**
 * Create indexes for the reservation tokens collection
 */
async function createReservationTokenIndexes() {
  try {
    console.log('Creating reservation token indexes...');
    
    // Unique index for tokens
    await reservationTokensCollection.createIndex(
      { token: 1 },
      { name: "unique_token", unique: true, background: true }
    );
    
    // Index for finding tokens by creator
    await reservationTokensCollection.createIndex(
      { createdBy: 1, createdAt: -1 },
      { name: "creator_date", background: true }
    );
    
    // Index for automatic cleanup of expired tokens
    await reservationTokensCollection.createIndex(
      { expiresAt: 1 },
      { name: "expiry_cleanup", background: true, expireAfterSeconds: 0 }
    );
    
    console.log('Reservation token indexes created successfully');
  } catch (error) {
    console.error('Error creating reservation token indexes:', error);
  }
}

/**
 * Create indexes for room capability types collection
 */
async function createRoomCapabilityTypesIndexes() {
  try {
    console.log('Creating room capability types indexes...');
    
    // Unique index for capability keys
    await roomCapabilityTypesCollection.createIndex(
      { key: 1 },
      { name: "unique_capability_key", unique: true, background: true }
    );
    
    // Index for category grouping
    await roomCapabilityTypesCollection.createIndex(
      { category: 1, displayOrder: 1 },
      { name: "category_order", background: true }
    );
    
    // Index for active capabilities
    await roomCapabilityTypesCollection.createIndex(
      { active: 1, displayOrder: 1 },
      { name: "active_capabilities", background: true }
    );
    
    console.log('Room capability types indexes created successfully');
  } catch (error) {
    console.error('Error creating room capability types indexes:', error);
  }
}

/**
 * Create indexes for event service types collection
 */
async function createEventServiceTypesIndexes() {
  try {
    console.log('Creating event service types indexes...');
    
    // Unique index for service keys
    await eventServiceTypesCollection.createIndex(
      { key: 1 },
      { name: "unique_service_key", unique: true, background: true }
    );
    
    // Index for category grouping
    await eventServiceTypesCollection.createIndex(
      { category: 1, displayOrder: 1 },
      { name: "service_category_order", background: true }
    );
    
    // Index for active services
    await eventServiceTypesCollection.createIndex(
      { active: 1, displayOrder: 1 },
      { name: "active_services", background: true }
    );
    
    console.log('Event service types indexes created successfully');
  } catch (error) {
    console.error('Error creating event service types indexes:', error);
  }
}

/**
 * Create indexes for feature categories collection
 */
async function createFeatureCategoriesIndexes() {
  try {
    console.log('Creating feature categories indexes...');

    // Unique index for category keys
    await featureCategoriesCollection.createIndex(
      { key: 1 },
      { name: "unique_category_key", unique: true, background: true }
    );

    // Index for display order
    await featureCategoriesCollection.createIndex(
      { displayOrder: 1, active: 1 },
      { name: "category_display_order", background: true }
    );

    console.log('Feature categories indexes created successfully');
  } catch (error) {
    console.error('Error creating feature categories indexes:', error);
  }
}

/**
 * Create indexes for categories collection
 */
async function createCategoriesIndexes() {
  try {
    console.log('Creating categories indexes...');

    // Unique index for category names
    await categoriesCollection.createIndex(
      { name: 1 },
      { name: "unique_category_name", unique: true, background: true }
    );

    // Index for display order
    await categoriesCollection.createIndex(
      { displayOrder: 1, active: 1 },
      { name: "category_display_order", background: true }
    );

    // Index for type (base vs dynamic)
    await categoriesCollection.createIndex(
      { type: 1, active: 1 },
      { name: "category_type", background: true }
    );

    console.log('Categories indexes created successfully');
  } catch (error) {
    console.error('Error creating categories indexes:', error);
  }
}

/**
 * Create indexes for the event attachments collection
 */
async function createEventAttachmentsIndexes() {
  try {
    console.log('Creating event attachments indexes...');

    // Index for finding attachments by eventId
    await eventAttachmentsCollection.createIndex(
      { eventId: 1 },
      { name: "attachments_by_event", background: true }
    );

    // Index for file metadata queries
    await eventAttachmentsCollection.createIndex(
      { gridfsFileId: 1 },
      { name: "attachments_by_file_id", unique: true, background: true }
    );

    // Index for uploaded date and user queries
    await eventAttachmentsCollection.createIndex(
      { uploadedAt: -1, uploadedBy: 1 },
      { name: "attachments_by_date_user", background: true }
    );

    console.log('Event attachments indexes created successfully');
  } catch (error) {
    console.error('Error creating event attachments indexes:', error);
  }
}

/**
 * Create indexes for the event audit history collection
 */
async function createEventAuditHistoryIndexes() {
  try {
    console.log('Creating event audit history indexes...');

    // Index for finding audit history by event
    await eventAuditHistoryCollection.createIndex(
      { eventId: 1, timestamp: -1 },
      { name: "event_audit_history", background: true }
    );

    // Index for finding audit history by user
    await eventAuditHistoryCollection.createIndex(
      { userId: 1, timestamp: -1 },
      { name: "user_audit_history", background: true }
    );

    // Index for finding audit history by import session
    await eventAuditHistoryCollection.createIndex(
      { "metadata.importSessionId": 1, timestamp: -1 },
      { name: "import_session_audit", background: true, sparse: true }
    );

    // Index for finding recent changes
    await eventAuditHistoryCollection.createIndex(
      { timestamp: -1 },
      { name: "recent_changes", background: true }
    );

    // Index for finding changes by type
    await eventAuditHistoryCollection.createIndex(
      { changeType: 1, timestamp: -1 },
      { name: "change_type_history", background: true }
    );

    console.log('Event audit history indexes created successfully');
  } catch (error) {
    console.error('Error creating event audit history indexes:', error);
  }
}

/**
 * Create indexes for the reservation audit history collection
 */
async function createReservationAuditHistoryIndexes() {
  try {
    console.log('Creating reservation audit history indexes...');

    // Index for finding audit history by reservation
    await reservationAuditHistoryCollection.createIndex(
      { reservationId: 1, timestamp: -1 },
      { name: "reservation_audit_history", background: true }
    );

    // Index for finding audit history by user
    await reservationAuditHistoryCollection.createIndex(
      { userId: 1, timestamp: -1 },
      { name: "user_reservation_history", background: true }
    );

    // Index for finding recent changes
    await reservationAuditHistoryCollection.createIndex(
      { timestamp: -1 },
      { name: "recent_reservation_changes", background: true }
    );

    // Index for finding changes by type
    await reservationAuditHistoryCollection.createIndex(
      { changeType: 1, timestamp: -1 },
      { name: "reservation_change_type", background: true }
    );

    console.log('Reservation audit history indexes created successfully');
  } catch (error) {
    console.error('Error creating reservation audit history indexes:', error);
  }
}

// seedInitialRooms() function REMOVED - deprecated, rooms now stored in templeEvents__Locations

/**
 * Seed initial feature categories if the collection is empty
 */
async function seedInitialFeatureCategories() {
  try {
    const categoryCount = await featureCategoriesCollection.countDocuments();
    if (categoryCount === 0) {
      console.log('Seeding initial feature categories...');
      
      const initialCategories = [
        {
          key: "infrastructure",
          name: "Infrastructure & Equipment",
          description: "Physical features and built-in equipment",
          displayOrder: 1,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "policies",
          name: "Policies & Permissions", 
          description: "What activities and services are allowed",
          displayOrder: 2,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "accessibility",
          name: "Accessibility",
          description: "Accessibility and accommodation features",
          displayOrder: 3,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "catering",
          name: "Catering & Food Service",
          description: "Food and beverage related services",
          displayOrder: 4,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "setup",
          name: "Setup & Decorations",
          description: "Room setup and decoration services",
          displayOrder: 5,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "technology",
          name: "Technology & AV",
          description: "Audio/visual and technology services",
          displayOrder: 6,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      
      await featureCategoriesCollection.insertMany(initialCategories);
      console.log(`Seeded ${initialCategories.length} initial feature categories`);
    }
  } catch (error) {
    console.error('Error seeding initial feature categories:', error);
  }
}

/**
 * Seed initial event categories if the collection is empty
 */
async function seedInitialCategories() {
  try {
    const categoryCount = await categoriesCollection.countDocuments();
    if (categoryCount === 0) {
      console.log('Seeding initial event categories...');

      const initialCategories = [
        {
          name: "Jewish Holidays",
          type: "base",
          color: "#1E90FF",
          displayOrder: 1,
          active: true,
          description: "Jewish holiday observances and celebrations",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Services",
          type: "base",
          color: "#32CD32",
          displayOrder: 2,
          active: true,
          description: "Religious services and worship",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Education",
          type: "base",
          color: "#FFD700",
          displayOrder: 3,
          active: true,
          description: "Educational programs and classes",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Community",
          type: "base",
          color: "#FF69B4",
          displayOrder: 4,
          active: true,
          description: "Community events and gatherings",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Administrative",
          type: "base",
          color: "#808080",
          displayOrder: 5,
          active: true,
          description: "Administrative and operational events",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Meetings",
          type: "base",
          color: "#4169E1",
          displayOrder: 6,
          active: true,
          description: "Committee and board meetings",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Youth Programs",
          type: "base",
          color: "#FF8C00",
          displayOrder: 7,
          active: true,
          description: "Programs and activities for youth",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      await categoriesCollection.insertMany(initialCategories);
      console.log(`Seeded ${initialCategories.length} initial event categories`);
    }
  } catch (error) {
    console.error('Error seeding initial event categories:', error);
  }
}

/**
 * Seed initial room capability types if the collection is empty
 */
async function seedInitialRoomCapabilityTypes() {
  try {
    const capabilityCount = await roomCapabilityTypesCollection.countDocuments();
    if (capabilityCount === 0) {
      console.log('Seeding initial room capability types...');
      
      const initialCapabilities = [
        // Infrastructure
        {
          key: "hasKitchen",
          name: "Kitchen Access",
          description: "Room has direct access to kitchen facilities",
          category: "infrastructure",
          dataType: "boolean",
          icon: "🍽️",
          displayOrder: 1,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "hasStage",
          name: "Stage/Platform",
          description: "Room has a raised stage or platform area",
          category: "infrastructure", 
          dataType: "boolean",
          icon: "🎭",
          displayOrder: 2,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "hasPiano",
          name: "Piano Available",
          description: "Room has a piano available for use",
          category: "infrastructure",
          dataType: "boolean",
          icon: "🎹",
          displayOrder: 3,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "hasProjector",
          name: "Built-in Projector",
          description: "Room has permanently installed projection equipment",
          category: "infrastructure",
          dataType: "boolean",
          icon: "🎬",
          displayOrder: 4,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "hasSoundSystem",
          name: "Sound System",
          description: "Room has built-in audio/sound system",
          category: "infrastructure",
          dataType: "boolean",
          icon: "🔊",
          displayOrder: 5,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        
        // Policies
        {
          key: "allowsFood",
          name: "Food Permitted",
          description: "Food and beverages are allowed in this room",
          category: "policies",
          dataType: "boolean",
          icon: "🍽️",
          displayOrder: 10,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "allowsDancing",
          name: "Dancing Permitted",
          description: "Dancing and movement activities are allowed",
          category: "policies",
          dataType: "boolean", 
          icon: "💃",
          displayOrder: 11,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "allowsChildren",
          name: "Child-Friendly",
          description: "Room is suitable and safe for children's activities",
          category: "policies",
          dataType: "boolean",
          icon: "👶",
          displayOrder: 12,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        
        // Accessibility
        {
          key: "isWheelchairAccessible",
          name: "Wheelchair Accessible",
          description: "Room is fully accessible for wheelchair users",
          category: "accessibility",
          dataType: "boolean",
          icon: "♿",
          displayOrder: 20,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "hasHearingLoop",
          name: "Hearing Loop System",
          description: "Room has assistive hearing loop system",
          category: "accessibility",
          dataType: "boolean",
          icon: "🦻",
          displayOrder: 21,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      
      await roomCapabilityTypesCollection.insertMany(initialCapabilities);
      console.log(`Seeded ${initialCapabilities.length} initial room capability types`);
    }
  } catch (error) {
    console.error('Error seeding initial room capability types:', error);
  }
}

/**
 * Seed initial event service types if the collection is empty
 */
async function seedInitialEventServiceTypes() {
  try {
    const serviceCount = await eventServiceTypesCollection.countDocuments();
    if (serviceCount === 0) {
      console.log('Seeding initial event service types...');
      
      const initialServices = [
        // Catering
        {
          key: "needsCatering",
          name: "Professional Catering",
          description: "Professional catering services for the event",
          category: "catering",
          dataType: "boolean",
          icon: "🍽️",
          hasCost: true,
          displayOrder: 1,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "needsBeverages",
          name: "Beverage Service",
          description: "Coffee, tea, water, and other beverages",
          category: "catering",
          dataType: "boolean",
          icon: "☕",
          hasCost: true,
          displayOrder: 2,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "needsKosherCatering",
          name: "Kosher Catering",
          description: "Kosher-certified food service",
          category: "catering",
          dataType: "boolean",
          icon: "✡️",
          hasCost: true,
          displayOrder: 3,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        
        // Setup & Decorations
        {
          key: "needsTablecloths",
          name: "Tablecloths",
          description: "Tablecloths and table linens",
          category: "setup",
          dataType: "boolean", 
          icon: "🪑",
          hasCost: true,
          displayOrder: 10,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "needsChairs",
          name: "Additional Chairs",
          description: "Extra chairs beyond room's standard setup",
          category: "setup",
          dataType: "number",
          icon: "🪑",
          hasCost: true,
          displayOrder: 11,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "needsTables",
          name: "Additional Tables",
          description: "Extra tables beyond room's standard setup",
          category: "setup",
          dataType: "number",
          icon: "🪑",
          hasCost: true,
          displayOrder: 12,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "needsFlowers",
          name: "Floral Arrangements",
          description: "Fresh flower arrangements and decorations",
          category: "setup",
          dataType: "boolean",
          icon: "🌸",
          hasCost: true,
          displayOrder: 13,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "needsCandleLighting",
          name: "Candle Lighting Setup",
          description: "Sabbath or holiday candle lighting arrangement",
          category: "setup",
          dataType: "boolean",
          icon: "🕯️",
          hasCost: false,
          displayOrder: 14,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        
        // Technology & AV
        {
          key: "needsAVSetup",
          name: "Audio/Visual Setup",
          description: "Professional AV equipment setup and operation",
          category: "technology",
          dataType: "boolean",
          icon: "📽️",
          hasCost: true,
          displayOrder: 20,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "needsMicrophones",
          name: "Microphone System",
          description: "Wireless or wired microphone system",
          category: "technology", 
          dataType: "number",
          icon: "🎤",
          hasCost: true,
          displayOrder: 21,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          key: "needsLiveStreaming",
          name: "Live Streaming",
          description: "Professional live streaming of the event",
          category: "technology",
          dataType: "boolean",
          icon: "📹",
          hasCost: true,
          displayOrder: 22,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      
      await eventServiceTypesCollection.insertMany(initialServices);
      console.log(`Seeded ${initialServices.length} initial event service types`);
    }
  } catch (error) {
    console.error('Error seeding initial event service types:', error);
  }
}

/**
 * Log an event change to the audit history
 */
async function logEventAudit({
  eventId,
  userId,
  changeType, // 'create', 'update', 'delete', 'import'
  source = 'Unknown',
  changes = null,
  changeSet = null,
  metadata = {}
}) {
  try {
    const auditEntry = {
      eventId,
      userId,
      changeType,
      source,
      timestamp: new Date(),
      metadata: {
        userAgent: metadata.userAgent || 'API',
        ipAddress: metadata.ipAddress || 'Unknown',
        reason: metadata.reason || null,
        importSessionId: metadata.importSessionId || null,
        ...metadata
      }
    };

    // Add change details if provided
    if (changes) {
      auditEntry.changes = changes;
    }

    if (changeSet && Array.isArray(changeSet)) {
      auditEntry.changeSet = changeSet;
    }

    await eventAuditHistoryCollection.insertOne(auditEntry);

    logger.debug('Audit entry created:', {
      eventId,
      changeType,
      source,
      hasChanges: !!changes,
      hasChangeSet: !!changeSet
    });
  } catch (error) {
    logger.error('Failed to log audit entry:', error);
    // Don't throw error - audit logging should not break the main operation
  }
}

/**
 * Log a room reservation change to the audit history
 */
async function logReservationAudit({
  reservationId,
  userId,
  userEmail,
  changeType, // 'create', 'update', 'approve', 'reject', 'cancel', 'resubmit'
  source = 'Unknown',
  changes = null,
  changeSet = null,
  metadata = {}
}) {
  try {
    const auditEntry = {
      reservationId,
      userId,
      userEmail,
      changeType,
      source,
      timestamp: new Date(),
      metadata: {
        userAgent: metadata.userAgent || 'API',
        ipAddress: metadata.ipAddress || 'Unknown',
        reason: metadata.reason || null,
        previousRevision: metadata.previousRevision || null,
        ...metadata
      }
    };

    // Add change details if provided
    if (changes) {
      auditEntry.changes = changes;
    }

    if (changeSet && Array.isArray(changeSet)) {
      auditEntry.changeSet = changeSet;
    }

    await reservationAuditHistoryCollection.insertOne(auditEntry);

    logger.debug('Reservation audit entry created:', {
      reservationId,
      changeType,
      source,
      hasChanges: !!changes,
      hasChangeSet: !!changeSet
    });
  } catch (error) {
    logger.error('Failed to log reservation audit entry:', error);
    // Don't throw error - audit logging should not break the main operation
  }
}

/**
 * Compare two objects and generate a changeSet for audit logging
 */
function generateChangeSet(oldData, newData, fieldsToTrack = null) {
  const changeSet = [];

  if (!oldData && !newData) return changeSet;

  const oldObj = oldData || {};
  const newObj = newData || {};

  // Get all fields to check
  const allFields = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  // Filter fields if specified
  const fieldsToCheck = fieldsToTrack ?
    Array.from(allFields).filter(field => fieldsToTrack.includes(field)) :
    Array.from(allFields);

  for (const field of fieldsToCheck) {
    const oldValue = oldObj[field];
    const newValue = newObj[field];

    // Deep comparison for objects and arrays
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changeSet.push({
        field,
        oldValue: oldValue === undefined ? null : oldValue,
        newValue: newValue === undefined ? null : newValue
      });
    }
  }

  return changeSet;
}

/**
 * Extract plain text from HTML content for clean audit logging
 * @param {string} htmlContent - HTML content from Microsoft Graph API (may be HTML-encoded)
 * @returns {string|null} - Clean plain text or null if no content
 */
function extractTextFromHtml(htmlContent) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return null;
  }

  let content = htmlContent;

  // First, decode HTML entities to restore actual HTML tags
  content = content
    .replace(/&lt;/g, '<')   // Decode HTML entities first
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Now remove HTML tags and clean up
  content = content
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/&nbsp;/g, ' ') // Replace &nbsp; with spaces
    .replace(/\s+/g, ' ')    // Replace multiple whitespace with single space
    .trim();                 // Remove leading/trailing whitespace

  // If we still have HTML-like content, it might be double-encoded
  if (content.includes('&lt;') || content.includes('&gt;')) {
    // Try decoding again for double-encoded content
    content = content
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  return content || null;
}

/**
 * Generate a changeKey hash for optimistic concurrency control
 * This creates a version identifier based on key reservation fields
 * @param {Object} reservation - The reservation object
 * @returns {string} - 16-character hash representing this version
 */
function generateChangeKey(reservation) {
  const crypto = require('crypto');

  // Include only fields that matter for version tracking
  const versionData = {
    eventTitle: reservation.eventTitle,
    startDateTime: reservation.startDateTime instanceof Date
      ? reservation.startDateTime.toISOString()
      : reservation.startDateTime,
    endDateTime: reservation.endDateTime instanceof Date
      ? reservation.endDateTime.toISOString()
      : reservation.endDateTime,
    requestedRooms: reservation.requestedRooms,
    setupTimeMinutes: reservation.setupTimeMinutes || 0,
    teardownTimeMinutes: reservation.teardownTimeMinutes || 0,
    attendeeCount: reservation.attendeeCount || 0,
    status: reservation.status,
    lastModified: reservation.lastModified instanceof Date
      ? reservation.lastModified.toISOString()
      : (reservation.lastModified || new Date().toISOString())
  };

  // Create a stable hash from the version data
  return crypto.createHash('sha256')
    .update(JSON.stringify(versionData))
    .digest('hex')
    .substring(0, 16);
}

/**
 * Check for scheduling conflicts with existing reservations
 * Considers setup and teardown times when checking overlaps
 * @param {Object} reservation - The reservation to check
 * @param {string} excludeId - Optional reservation ID to exclude from conflict check (for updates)
 * @returns {Promise<Array>} - Array of conflicting reservations
 */
async function checkRoomConflicts(reservation, excludeId = null) {
  try {
    // Calculate the full time window including setup and teardown
    const setupMinutes = reservation.setupTimeMinutes || 0;
    const teardownMinutes = reservation.teardownTimeMinutes || 0;

    const startTime = new Date(reservation.startDateTime);
    const endTime = new Date(reservation.endDateTime);

    // Extend the time window for conflict checking
    const effectiveStart = new Date(startTime.getTime() - (setupMinutes * 60 * 1000));
    const effectiveEnd = new Date(endTime.getTime() + (teardownMinutes * 60 * 1000));

    // Build query to find overlapping reservations
    const query = {
      status: { $in: ['pending', 'approved'] }, // Only check against pending and approved
      requestedRooms: { $in: reservation.requestedRooms }, // Any shared rooms
      $or: [
        {
          // Case 1: Existing reservation starts during our window
          startDateTime: { $gte: effectiveStart, $lt: effectiveEnd }
        },
        {
          // Case 2: Existing reservation ends during our window
          endDateTime: { $gt: effectiveStart, $lte: effectiveEnd }
        },
        {
          // Case 3: Existing reservation completely encompasses our window
          startDateTime: { $lte: effectiveStart },
          endDateTime: { $gte: effectiveEnd }
        }
      ]
    };

    // Exclude the current reservation if we're checking for updates
    if (excludeId) {
      query._id = { $ne: new ObjectId(excludeId) };
    }

    const conflicts = await roomReservationsCollection.find(query).toArray();

    // Return detailed conflict information
    return conflicts.map(conflict => ({
      id: conflict._id.toString(),
      eventTitle: conflict.eventTitle,
      startDateTime: conflict.startDateTime,
      endDateTime: conflict.endDateTime,
      rooms: conflict.requestedRooms,
      status: conflict.status,
      setupTimeMinutes: conflict.setupTimeMinutes || 0,
      teardownTimeMinutes: conflict.teardownTimeMinutes || 0
    }));
  } catch (error) {
    console.error('Error checking room conflicts:', error);
    throw error;
  }
}

/**
 * Normalize empty values to null for consistent comparison
 * Treats undefined, null, empty string, and empty arrays as equivalent
 */
function normalizeEmptyValue(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (Array.isArray(value) && value.length === 0) {
    return null;
  }
  return value;
}

/**
 * Compare two objects and return a list of changes for the specified fields
 * Used for building revision history
 * @param {Object} oldData - The previous version of the data
 * @param {Object} newData - The new version of the data
 * @param {Array<string>} fields - The fields to compare
 * @returns {Array<Object>} - Array of change objects with field, oldValue, newValue
 */
function getChanges(oldData, newData, fields) {
  const changes = [];

  fields.forEach(field => {
    let oldValue = oldData[field];
    let newValue = newData[field];

    // Normalize empty values before comparison
    const normalizedOld = normalizeEmptyValue(oldValue);
    const normalizedNew = normalizeEmptyValue(newValue);

    // Handle different data types appropriately
    let hasChanged = false;

    if (Array.isArray(normalizedOld) && Array.isArray(normalizedNew)) {
      // Array comparison - check if contents differ
      hasChanged = JSON.stringify(normalizedOld.sort()) !== JSON.stringify(normalizedNew.sort());
    } else if (normalizedOld instanceof Date && normalizedNew instanceof Date) {
      // Date comparison
      hasChanged = normalizedOld.getTime() !== normalizedNew.getTime();
    } else if (typeof normalizedOld === 'object' && typeof normalizedNew === 'object' && normalizedOld !== null && normalizedNew !== null) {
      // Object comparison
      hasChanged = JSON.stringify(normalizedOld) !== JSON.stringify(normalizedNew);
    } else {
      // Primitive comparison (including null === null)
      hasChanged = normalizedOld !== normalizedNew;
    }

    if (hasChanged) {
      changes.push({
        field,
        oldValue: oldValue instanceof Date ? oldValue.toISOString() : oldValue,
        newValue: newValue instanceof Date ? newValue.toISOString() : newValue
      });
    }
  });

  return changes;
}

// Connect to MongoDB with reconnection logic
async function connectToDatabase() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const dbName = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
    console.log(`API Server connecting to database: '${dbName}'`);
    db = client.db(dbName);
    usersCollection = db.collection('templeEvents__Users');
    // internalEventsCollection removed - using unifiedEventsCollection (templeEvents__Events) instead
    // eventCacheCollection removed - using unifiedEventsCollection (templeEvents__Events) instead
    unifiedEventsCollection = db.collection('templeEvents__Events'); // New unified collection
    calendarDeltasCollection = db.collection('templeEvents__CalendarDeltas'); // Delta token storage
    // roomsCollection removed - DEPRECATED, using locationsCollection instead
    locationsCollection = db.collection('templeEvents__Locations'); // Unified locations for events AND reservable rooms
    roomReservationsCollection = db.collection('templeEvents__RoomReservations'); // Room reservation requests
    reservationTokensCollection = db.collection('templeEvents__ReservationTokens'); // Guest access tokens
    roomCapabilityTypesCollection = db.collection('templeEvents__RoomCapabilityTypes'); // Configurable room capability definitions
    eventServiceTypesCollection = db.collection('templeEvents__EventServiceTypes'); // Configurable event service definitions
    featureCategoriesCollection = db.collection('templeEvents__FeatureCategories'); // Feature groupings for UI organization
    categoriesCollection = db.collection('templeEvents__Categories'); // Event categories (base + dynamic)
    eventAuditHistoryCollection = db.collection('templeEvents__EventAuditHistory'); // Audit trail for event changes
    reservationAuditHistoryCollection = db.collection('templeEvents__ReservationAuditHistory'); // Audit trail for room reservation changes

    // Initialize GridFS bucket for file storage
    filesBucket = new GridFSBucket(db, { bucketName: 'templeEvents__Files' });
    eventAttachmentsCollection = db.collection('templeEvents__EventAttachments'); // Event-file relationship tracking
    reservationAttachmentsCollection = db.collection('templeEvents__ReservationAttachments'); // Reservation-file relationship tracking
    systemSettingsCollection = db.collection('templeEvents__SystemSettings'); // System-wide settings

    // Create indexes for new unified collections
    await createUnifiedEventIndexes();
    await createCalendarDeltaIndexes();
    await createEventAuditHistoryIndexes();
    await createEventAttachmentsIndexes();

    // Create indexes for room reservation system
    // createRoomIndexes() removed - deprecated, using createLocationIndexes() instead
    await createLocationIndexes();
    await createRoomReservationIndexes();
    await createReservationAuditHistoryIndexes();
    await createReservationTokenIndexes();
    
    // Create indexes for feature configuration system
    await createRoomCapabilityTypesIndexes();
    await createEventServiceTypesIndexes();
    await createFeatureCategoriesIndexes();
    await createCategoriesIndexes();
    
    // Event cache indexes removed - using unifiedEventsCollection instead

    // seedInitialRooms() removed - deprecated, rooms now stored in templeEvents__Locations

    // Seed initial feature configuration data if none exists
    await seedInitialFeatureCategories();
    await seedInitialCategories();
    await seedInitialRoomCapabilityTypes();
    await seedInitialEventServiceTypes();
    
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
// CALENDAR EVENT CREATION FUNCTIONS
// ============================================

/**
 * Create a calendar event from an approved room reservation
 * Uses the user's Graph token from the frontend
 * @param {Object} reservation - The approved reservation object
 * @param {string} calendarMode - 'sandbox' or 'production'
 * @param {string} userGraphToken - User's Graph API token from frontend
 * @returns {Object} Result object with success status and event details
 */
async function createRoomReservationCalendarEvent(reservation, calendarMode, userGraphToken) {
  const targetCalendar = calendarMode === 'production' 
    ? CALENDAR_CONFIG.PRODUCTION_CALENDAR 
    : CALENDAR_CONFIG.SANDBOX_CALENDAR;
    
  try {
    // Validate that user provided a Graph token
    if (!userGraphToken) {
      throw new Error('Graph token is required for calendar event creation');
    }
    
    const graphToken = userGraphToken;
    // Get room names for location
    const roomNames = [];
    if (reservation.requestedRooms && reservation.requestedRooms.length > 0) {
      // Try to get room names from the database (rooms are locations with isReservable: true)
      try {
        const roomDocs = await locationsCollection.find({
          _id: { $in: reservation.requestedRooms.map(id => typeof id === 'string' ? new ObjectId(id) : id) },
          isReservable: true
        }).toArray();

        roomDocs.forEach(room => {
          if (room.name || room.displayName) roomNames.push(room.name || room.displayName);
        });
      } catch (roomError) {
        logger.warn('Error fetching room names:', roomError);
        // Fallback to room IDs if name lookup fails
        roomNames.push(...reservation.requestedRooms);
      }
    }
    
    // Build event body with reservation details
    let eventBody = '';
    if (reservation.eventDescription) {
      eventBody += `${reservation.eventDescription}\n\n`;
    }
    if (reservation.specialRequirements) {
      eventBody += `Special Requirements: ${reservation.specialRequirements}\n\n`;
    }
    if (reservation.attendeeCount) {
      eventBody += `Expected Attendees: ${reservation.attendeeCount}\n\n`;
    }
    eventBody += `Requested by: ${reservation.requesterName} (${reservation.requesterEmail})\n`;
    eventBody += `Contact: ${reservation.contactEmail || reservation.requesterEmail}\n`;
    eventBody += `Reservation ID: ${reservation._id}`;
    
    // Create the calendar event object
    const eventData = {
      subject: reservation.eventTitle || 'Room Reservation',
      body: {
        contentType: 'Text',
        content: eventBody
      },
      start: {
        dateTime: reservation.startDateTime,
        timeZone: 'America/New_York'
      },
      end: {
        dateTime: reservation.endDateTime,
        timeZone: 'America/New_York'
      },
      location: {
        displayName: roomNames.length > 0 ? roomNames.join(', ') : 'Temple Location'
      },
      attendees: [
        {
          emailAddress: {
            address: reservation.requesterEmail,
            name: reservation.requesterName
          }
        }
      ],
      categories: ['Room Reservation'],
      importance: reservation.priority === 'high' ? 'high' : 'normal'
    };
    
    // Add contact person if different from requester
    if (reservation.contactEmail && reservation.contactEmail !== reservation.requesterEmail) {
      eventData.attendees.push({
        emailAddress: {
          address: reservation.contactEmail,
          name: 'Contact Person'
        }
      });
    }
    
    // Make the Graph API call to create the event
    const graphUrl = `https://graph.microsoft.com/v1.0/users/${targetCalendar}/events`;
    const response = await fetch(graphUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${graphToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(eventData)
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Graph API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }
    
    const createdEvent = await response.json();
    
    return {
      success: true,
      eventId: createdEvent.id,
      targetCalendar: targetCalendar,
      webLink: createdEvent.webLink,
      subject: createdEvent.subject
    };
    
  } catch (error) {
    logger.error('Calendar event creation failed:', {
      reservationId: reservation._id,
      targetCalendar: targetCalendar,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message,
      targetCalendar: targetCalendar
    };
  }
}

// ============================================
// INTERNAL EVENT ROUTES
// ============================================
// Sync events from Microsoft Graph to internal database (Admin only)
// Sync events from Microsoft Graph to internal database (Admin only)

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
    const events = await unifiedEventsCollection
      .find(query)
      .limit(100)
      .toArray();
    
    // Sort in memory instead
    events.sort((a, b) => {
      const dateA = new Date(a.graphData?.start?.dateTime || 0);
      const dateB = new Date(b.graphData?.start?.dateTime || 0);
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
    const userId = req.user.userId;
    
    if (!eventIds || !Array.isArray(eventIds)) {
      return res.status(400).json({ error: 'eventIds array is required' });
    }
    
    logger.log(`Enriching ${eventIds.length} events with internal data for user ${userId}`);
    
    // Fetch internal events - MUST filter by userId for security and correctness
    const internalEvents = await unifiedEventsCollection.find({
      userId: userId,
      eventId: { $in: eventIds },
      isDeleted: false
    }).toArray();
    
    logger.debug(`Found ${internalEvents.length} internal event records for enrichment out of ${eventIds.length} requested`);
    
    // Log which events were not found for debugging
    if (internalEvents.length < eventIds.length) {
      const foundEventIds = internalEvents.map(e => e.eventId);
      const missingEventIds = eventIds.filter(id => !foundEventIds.includes(id));
      logger.warn(`Missing ${missingEventIds.length} events in unified collection:`, missingEventIds.slice(0, 5)); // Log first 5
    }
    
    // Create a map for easy lookup
    const enrichmentMap = {};
    
    internalEvents.forEach(event => {
      enrichmentMap[event.eventId] = {
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
    const userId = req.user.userId;
    
    console.log(`Updating internal data for event ${graphEventId} for user ${userId}:`, updates);
    
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
    
    const result = await unifiedEventsCollection.updateOne(
      { 
        userId: userId,
        eventId: graphEventId 
      },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      // Event doesn't exist in unified DB, create it with minimal data
      const newEvent = {
        eventId: graphEventId,
        userId: req.user.userId,
        calendarId: 'unknown',
        graphData: {
          id: graphEventId,
          subject: 'Unsynced Event',
          start: { dateTime: new Date().toISOString() },
          end: { dateTime: new Date().toISOString() },
          location: { displayName: '' },
          categories: [],
          bodyPreview: '',
          importance: 'normal',
          showAs: 'busy',
          sensitivity: 'normal',
          isAllDay: false,
          lastModifiedDateTime: new Date().toISOString(),
          createdDateTime: new Date().toISOString()
        },
        internalData: {
          mecCategories: [],
          setupMinutes: 0,
          teardownMinutes: 0,
          registrationNotes: '',
          assignedTo: '',
          internalNotes: '',
          setupStatus: 'pending',
          estimatedCost: null,
          actualCost: null,
          ...updates // Apply the updates
        },
        sourceCalendars: [],
        isDeleted: false,
        lastSyncedAt: new Date(),
        lastAccessedAt: new Date(),
        cachedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      await unifiedEventsCollection.insertOne(newEvent);
      return res.status(201).json({ message: 'Created new unified event', event: newEvent });
    }
    
    // Return the updated event
    const updatedEvent = await unifiedEventsCollection.findOne({ eventId: graphEventId });
    res.status(200).json(updatedEvent);
  } catch (error) {
    console.error('Error updating internal event:', error);
    res.status(500).json({ error: 'Failed to update internal event' });
  }
});

// Delete event from MongoDB collections
app.delete('/api/internal-events/:eventId', verifyToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.userId;
    
    logger.debug(`Deleting MongoDB records for event ${eventId} for user ${userId}`);
    
    // Track deletion results
    const deletionResults = {
      unifiedEventsDeleted: 0,
      cacheEventsDeleted: 0
    };
    
    // 1. Delete from unified events collection (templeEvents__Events)
    const unifiedResult = await unifiedEventsCollection.deleteOne({
      userId: userId,
      eventId: eventId
    });
    deletionResults.unifiedEventsDeleted = unifiedResult.deletedCount;
    logger.debug(`Deleted ${unifiedResult.deletedCount} records from unified events collection`);
    
    // Legacy internal events collection removed - no longer needed
    
    // Event cache collection removed - no longer needed
    deletionResults.cacheEventsDeleted = 0;
    
    // Check if any deletion occurred
    const totalDeleted = deletionResults.unifiedEventsDeleted +
                        deletionResults.cacheEventsDeleted;
    
    if (totalDeleted === 0) {
      logger.warn(`No MongoDB records found for event ${eventId} for user ${userId}`);
      return res.status(404).json({ 
        error: 'Event not found in MongoDB',
        message: `No records found for event ${eventId}`,
        deletionResults
      });
    }
    
    logger.debug(`Successfully deleted MongoDB records for event ${eventId}:`, deletionResults);
    
    res.status(200).json({
      success: true,
      message: `Successfully deleted event ${eventId} from MongoDB`,
      eventId: eventId,
      deletionResults
    });
    
  } catch (error) {
    logger.error(`Error deleting MongoDB records for event ${req.params.eventId}:`, error);
    res.status(500).json({ 
      error: 'Failed to delete event from MongoDB',
      message: error.message,
      eventId: req.params.eventId
    });
  }
});

// Legacy sync endpoint removed - now using unified manual sync endpoint

// Get available MEC categories
app.get('/api/internal-events/mec-categories', verifyToken, async (req, res) => {
  try {
    // Get distinct MEC categories from all events
    const categories = await unifiedEventsCollection.distinct('internalData.mecCategories');
    
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
      const totalEvents = await unifiedEventsCollection.countDocuments({});
      const deletedEvents = await unifiedEventsCollection.countDocuments({ isDeleted: true });
      const lastSync = await unifiedEventsCollection.findOne(
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
      console.log('Unified events collection might not exist yet:', collectionError.message);
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
    
    // Validate required fields
    if (!userId || !calendarId || !eventData.id) {
      logger.error('cacheEvent: Missing required fields', { userId, calendarId, eventId: eventData.id });
      throw new Error('Missing required fields for caching');
    }
    
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
    
    logger.debug(`cacheEvent: Caching event`, {
      userId,
      calendarId,
      eventId: eventData.id,
      subject: eventData.subject,
      expiresAt: expiresAt.toISOString()
    });
    
    // eventCacheCollection removed - return mock result
    const result = { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
    
    logger.debug(`cacheEvent: Successfully cached`, {
      eventId: eventData.id,
      matched: result.matchedCount,
      modified: result.modifiedCount,
      upserted: result.upsertedCount
    });
    
    return cacheEntry;
  } catch (error) {
    logger.error('cacheEvent: Error caching event', {
      error: error.message,
      userId,
      calendarId,
      eventId: eventData?.id,
      subject: eventData?.subject
    });
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
      // Find events that overlap with the date range
      // An event overlaps if: event.start < range.end AND event.end > range.start
      $and: [
        {
          "eventData.start.dateTime": { $lt: endDate.toISOString() }
        },
        {
          "eventData.end.dateTime": { $gt: startDate.toISOString() }
        }
      ],
      expiresAt: { $gt: now } // Only non-expired events
    };
    
    logger.debug('getCachedEvents: Query parameters', {
      userId,
      calendarId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      now: now.toISOString()
    });
    
    // eventCacheCollection removed - return empty array
    const cachedEvents = [];
    
    logger.debug(`getCachedEvents: Found ${cachedEvents.length} cached events`, {
      eventIds: cachedEvents.slice(0, 5).map(e => ({ id: e.eventId, subject: e.eventData?.subject }))
    });
    
    // Update last accessed time for LRU
    if (cachedEvents.length > 0) {
      const eventIds = cachedEvents.map(e => e.eventId);
      // eventCacheCollection removed - no need to update last accessed time
    }
    
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
    
    // eventCacheCollection removed - return all event IDs to refresh from unified collection
    const staleEvents = [];
    logger.debug(`Found ${staleEvents.length} stale events out of ${eventIds.length} total`);
    
    return staleEvents.map(e => e.eventId);
  } catch (error) {
    logger.error('Error checking stale events:', error);
    return eventIds; // Fallback to refreshing all events
  }
}

// ============================================
// UNIFIED EVENT STORAGE WITH DELTA SYNC
// ============================================

/**
 * Get or create delta token for a calendar
 */
async function getDeltaToken(userId, calendarId) {
  try {
    const deltaRecord = await calendarDeltasCollection.findOne({
      userId: userId,
      calendarId: calendarId
    });
    
    return deltaRecord || {
      userId: userId,
      calendarId: calendarId,
      deltaToken: null,
      skipToken: null,
      lastDeltaSync: null,
      fullSyncRequired: true
    };
  } catch (error) {
    logger.error('Error getting delta token:', error);
    return {
      userId: userId,
      calendarId: calendarId,
      deltaToken: null,
      skipToken: null,
      lastDeltaSync: null,
      fullSyncRequired: true
    };
  }
}

/**
 * Update delta token after successful sync
 */
async function updateDeltaToken(userId, calendarId, deltaToken, skipToken = null) {
  try {
    const now = new Date();
    const update = {
      userId: userId,
      calendarId: calendarId,
      deltaToken: deltaToken,
      skipToken: skipToken,
      lastDeltaSync: now,
      fullSyncRequired: false,
      updatedAt: now
    };
    
    await calendarDeltasCollection.replaceOne(
      { userId: userId, calendarId: calendarId },
      update,
      { upsert: true }
    );
    
    logger.debug('Updated delta token for calendar', { userId, calendarId, deltaToken: deltaToken?.substring(0, 20) + '...' });
  } catch (error) {
    logger.error('Error updating delta token:', error);
    throw error;
  }
}

/**
 * Reset delta token to force full sync
 */
async function resetDeltaToken(userId, calendarId) {
  try {
    await calendarDeltasCollection.updateOne(
      { userId: userId, calendarId: calendarId },
      {
        $set: {
          deltaToken: null,
          skipToken: null,
          fullSyncRequired: true,
          lastDeltaSync: null,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );
    
    logger.debug('Reset delta token for calendar', { userId, calendarId });
  } catch (error) {
    logger.error('Error resetting delta token:', error);
    throw error;
  }
}

/**
 * Store or update event in unified collection
 */
async function upsertUnifiedEvent(userId, calendarId, graphEvent, internalData = {}, sourceCalendars = []) {
  try {
    const now = new Date();

    // Ensure sourceCalendars includes current calendar
    const updatedSourceCalendars = [...sourceCalendars];
    if (!updatedSourceCalendars.find(sc => sc.calendarId === calendarId)) {
      updatedSourceCalendars.push({
        calendarId: calendarId,
        calendarName: calendarId === 'primary' ? 'Primary Calendar' : 'Shared Calendar',
        role: calendarId.includes('TempleRegistration') ? 'shared' : 'primary'
      });
    }

    // Find existing event by Graph ID to get its internal eventId (UUID)
    const existingEvent = await unifiedEventsCollection.findOne({
      userId: userId,
      'graphData.id': graphEvent.id
    });

    // Use existing UUID eventId or generate new one
    const eventId = existingEvent?.eventId || crypto.randomUUID();

    const unifiedEvent = {
      userId: userId,
      calendarId: calendarId,
      eventId: eventId, // Internal UUID (preserved or newly generated)
      
      // Graph API data (source of truth)
      graphData: {
        id: graphEvent.id,
        subject: graphEvent.subject,
        start: graphEvent.start,
        end: graphEvent.end,
        location: graphEvent.location || { displayName: '' },
        categories: graphEvent.categories || [],
        bodyPreview: graphEvent.body?.content?.substring(0, 255) || '', // Keep for compatibility, truncate to 255 chars
        body: graphEvent.body || null, // Store full body object with content and contentType
        importance: graphEvent.importance || 'normal',
        showAs: graphEvent.showAs || 'busy',
        sensitivity: graphEvent.sensitivity || 'normal',
        isAllDay: graphEvent.isAllDay || false,
        organizer: graphEvent.organizer,
        attendees: graphEvent.attendees || [],
        lastModifiedDateTime: graphEvent.lastModifiedDateTime,
        createdDateTime: graphEvent.createdDateTime,
        extensions: graphEvent.extensions || [],
        singleValueExtendedProperties: graphEvent.singleValueExtendedProperties || []
      },
      
      // Internal enrichments - preserve all existing fields
      internalData: {
        mecCategories: internalData.mecCategories || [],
        setupMinutes: internalData.setupMinutes || 0,
        teardownMinutes: internalData.teardownMinutes || 0,
        registrationNotes: internalData.registrationNotes || '',
        assignedTo: internalData.assignedTo || '',
        staffAssignments: internalData.staffAssignments || [],
        internalNotes: internalData.internalNotes || '',
        setupStatus: internalData.setupStatus || 'pending',
        estimatedCost: internalData.estimatedCost,
        actualCost: internalData.actualCost,
        customFields: internalData.customFields || {},
        // Preserve CSV import specific fields
        rsId: internalData.rsId || null,
        createRegistrationEvent: internalData.createRegistrationEvent,
        isCSVImport: internalData.isCSVImport || false,
        isRegistrationEvent: internalData.isRegistrationEvent || false,
        linkedMainEventId: internalData.linkedMainEventId,
        importedAt: internalData.importedAt
      },
      
      // Change tracking
      etag: graphEvent['@odata.etag'] || null,
      changeKey: graphEvent.changeKey || null,
      lastModifiedDateTime: new Date(graphEvent.lastModifiedDateTime || now),
      lastSyncedAt: now,
      
      // Multi-calendar support
      sourceCalendars: updatedSourceCalendars,
      
      // Status
      isDeleted: false,
      cachedAt: now,
      lastAccessedAt: now
    };
    
    // Initialize new location structure with multi-location support
    // Parse location string from Graph API (semicolon-delimited)
    const locationDisplayName = graphEvent.location?.displayName || '';

    // CHECK FOR VIRTUAL MEETING (URLs) FIRST
    if (locationDisplayName && isVirtualLocation(locationDisplayName)) {
      // This is a virtual meeting - extract URL and assign Virtual Meeting location
      try {
        // Store the URL at the top level for easy access
        unifiedEvent.virtualMeetingUrl = locationDisplayName;
        unifiedEvent.virtualPlatform = getVirtualPlatform(locationDisplayName);

        // DO NOT modify graphData.location.displayName - keep original Outlook data unchanged
        // Instead, set top-level locationDisplayNames for app use

        const virtualLocation = await locationsCollection.findOne({
          name: 'Virtual Meeting'
        });

        if (virtualLocation) {
          unifiedEvent.locations = [virtualLocation._id];
          unifiedEvent.locationDisplayNames = 'Virtual Meeting';
          logger.debug('Detected virtual meeting, assigned Virtual Meeting location', {
            url: locationDisplayName.substring(0, 50) + '...',
            platform: unifiedEvent.virtualPlatform
          });
        } else {
          logger.warn('Virtual meeting detected but Virtual Meeting location not found in database');
          unifiedEvent.locations = [];
          unifiedEvent.locationDisplayNames = '';
        }
      } catch (error) {
        logger.error('Error assigning virtual location:', error);
        unifiedEvent.locations = [];
        unifiedEvent.locationDisplayNames = '';
      }
    } else {
      // Not a virtual meeting - parse normally
      const locationStrings = parseLocationString(locationDisplayName);

      // Match location strings to templeEvents__Locations via aliases
      const assignedLocationIds = [];

      if (locationStrings.length > 0) {
        for (const locationStr of locationStrings) {
          const normalized = normalizeLocationString(locationStr);

          try {
            // Find location with this alias
            const location = await locationsCollection.findOne({
              aliases: normalized
            });

            if (location && !assignedLocationIds.some(id => id.toString() === location._id.toString())) {
              assignedLocationIds.push(location._id);
              logger.debug('Matched location string via alias', {
                locationString: locationStr,
                normalized: normalized,
                matchedLocation: location.name,
                locationId: location._id
              });
            }
          } catch (error) {
            logger.error('Error matching location string:', error);
            // Continue with other locations - non-blocking
          }
        }
      }

      // Set locations array (may be empty if no matches found)
      unifiedEvent.locations = assignedLocationIds;

      // Calculate locationDisplayNames from assigned locations
      if (assignedLocationIds.length > 0) {
        try {
          unifiedEvent.locationDisplayNames = await calculateLocationDisplayNames(assignedLocationIds, db);
        } catch (error) {
          logger.error('Error calculating location display names:', error);
          unifiedEvent.locationDisplayNames = '';
        }
      } else {
        unifiedEvent.locationDisplayNames = '';
      }
    }

    // Legacy: Also upsert to templeEvents__Locations for backwards compatibility
    let locationId = null;
    if (graphEvent.location && graphEvent.location.displayName) {
      try {
        const locationResult = await upsertLocationFromEvent({
          graphData: { location: graphEvent.location }
        });
        locationId = locationResult.locationId;
      } catch (error) {
        logger.error('Error processing location for event:', error);
        // Continue without location reference - non-blocking
      }
    }

    // Add legacy locationId reference for compatibility (to be deprecated)
    if (locationId) {
      unifiedEvent.locationId = locationId;
    }

    // Check if this will be an insert or update (for creation tracking)
    const existingDoc = await unifiedEventsCollection.findOne({
      $or: [
        { userId: userId, calendarId: calendarId, eventId: eventId },
        { userId: userId, 'graphData.id': graphEvent.id }
      ]
    });

    // Only set creation tracking fields for NEW events
    if (!existingDoc) {
      unifiedEvent.createdAt = now;
      unifiedEvent.createdBy = userId;
      unifiedEvent.createdByEmail = graphEvent.organizer?.emailAddress?.address || 'system@graph-sync';
      unifiedEvent.createdByName = graphEvent.organizer?.emailAddress?.name || 'Graph Sync';
      unifiedEvent.createdSource = 'graph-sync';
    }

    // TOP-LEVEL APPLICATION FIELDS (for forms/UI - no transformation needed)
    // Parse datetime strings into separate date/time fields
    const startDateTime = graphEvent.start?.dateTime;
    const endDateTime = graphEvent.end?.dateTime;

    unifiedEvent.eventTitle = graphEvent.subject || 'Untitled Event';
    unifiedEvent.eventDescription = graphEvent.body?.content || graphEvent.bodyPreview || '';
    unifiedEvent.startDateTime = startDateTime;
    unifiedEvent.endDateTime = endDateTime;
    unifiedEvent.startDate = startDateTime ? new Date(startDateTime).toISOString().split('T')[0] : '';
    unifiedEvent.startTime = startDateTime ? new Date(startDateTime).toTimeString().slice(0, 5) : '';
    unifiedEvent.endDate = endDateTime ? new Date(endDateTime).toISOString().split('T')[0] : '';
    unifiedEvent.endTime = endDateTime ? new Date(endDateTime).toTimeString().slice(0, 5) : '';
    unifiedEvent.location = graphEvent.location?.displayName || '';
    unifiedEvent.isAllDayEvent = graphEvent.isAllDay || false;

    // Timing fields from internalData
    unifiedEvent.setupTime = internalData.setupTime || '';
    unifiedEvent.teardownTime = internalData.teardownTime || '';
    unifiedEvent.doorOpenTime = internalData.doorOpenTime || '';
    unifiedEvent.doorCloseTime = internalData.doorCloseTime || '';
    unifiedEvent.setupTimeMinutes = internalData.setupMinutes || 0;
    unifiedEvent.teardownTimeMinutes = internalData.teardownMinutes || 0;

    // Notes fields from internalData
    unifiedEvent.setupNotes = internalData.setupNotes || '';
    unifiedEvent.doorNotes = internalData.doorNotes || '';
    unifiedEvent.eventNotes = internalData.eventNotes || internalData.internalNotes || '';

    // Category/assignment fields
    unifiedEvent.mecCategories = internalData.mecCategories || [];
    unifiedEvent.assignedTo = internalData.assignedTo || '';

    // Use upsert to handle updates while preserving internal data
    // Query using $or to match either unique index constraint:
    // 1. userId + calendarId + eventId (if event exists with this combo)
    // 2. userId + graphData.id (if event exists with this Graph ID)
    const result = await unifiedEventsCollection.replaceOne(
      {
        $or: [
          { userId: userId, calendarId: calendarId, eventId: eventId },
          { userId: userId, 'graphData.id': graphEvent.id }
        ]
      },
      unifiedEvent,
      { upsert: true }
    );

    logger.debug(`Upserted unified event: ${graphEvent.subject}`, {
      eventId: eventId, // Internal UUID
      graphId: graphEvent.id, // Graph ID
      matched: result.matchedCount,
      modified: result.modifiedCount,
      upserted: result.upsertedCount
    });
    
    return unifiedEvent;
  } catch (error) {
    logger.error('Error upserting unified event:', error);
    throw error;
  }
}

/**
 * Location extraction and matching helper functions
 */

// Calculate Levenshtein distance between two strings
function levenshteinDistance(str1, str2) {
  const m = str1.length;
  const n = str2.length;
  
  // Create a matrix to store distances
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  // Initialize first column and row
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  // Fill in the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }
  
  return dp[m][n];
}

// Calculate similarity score between two strings (0-1)
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  
  // Exact match
  if (s1 === s2) return 1.0;
  
  // Calculate Levenshtein-based similarity
  const distance = levenshteinDistance(s1, s2);
  const maxLength = Math.max(s1.length, s2.length);
  const similarity = 1 - (distance / maxLength);
  
  // Check for common patterns
  let bonus = 0;
  
  // One string contains the other
  if (s1.includes(s2) || s2.includes(s1)) {
    bonus += 0.2;
  }
  
  // Start with same word
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  if (words1[0] === words2[0]) {
    bonus += 0.1;
  }
  
  // Share significant words
  const sharedWords = words1.filter(w => words2.includes(w) && w.length > 3);
  if (sharedWords.length > 0) {
    bonus += 0.1 * (sharedWords.length / Math.max(words1.length, words2.length));
  }
  
  return Math.min(1, similarity + bonus);
}

// Normalize location name for matching
function normalizeLocationName(name) {
  if (!name || typeof name !== 'string') return '';
  
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .replace(/[^\w\s-]/g, '')  // Remove special chars except spaces and hyphens
    .replace(/^(the|a|an)\s+/i, '');  // Remove articles
}

// Check for common location abbreviations and variations
function expandAbbreviations(name) {
  const abbreviations = {
    'tpl': 'temple',
    'cpl': 'chapel',
    'mus': 'museum',
    'rm': 'room',
    'bldg': 'building',
    'fl': 'floor',
    'conf': 'conference',
    'ctr': 'center',
    'lib': 'library',
    'aud': 'auditorium',
    'hall': 'hall'
  };
  
  let expanded = name.toLowerCase();
  for (const [abbr, full] of Object.entries(abbreviations)) {
    const pattern = new RegExp(`\\b${abbr}\\b`, 'gi');
    expanded = expanded.replace(pattern, full);
  }
  
  return expanded;
}

// Extract location from event data
function extractLocationFromEvent(event) {
  // Try different location fields
  const locationString = 
    event.graphData?.location?.displayName ||
    event.location?.displayName ||
    event.location ||
    '';
    
  if (!locationString) return null;
  
  // Parse location string for components
  const parts = locationString.split(/[-,]/);
  const mainName = parts[0]?.trim() || locationString;
  const additionalInfo = parts.slice(1).map(p => p.trim()).filter(Boolean);
  
  return {
    originalText: locationString,
    normalizedName: normalizeLocationName(mainName),
    mainName: mainName,
    building: additionalInfo.find(p => p.toLowerCase().includes('building')) || null,
    floor: additionalInfo.find(p => p.toLowerCase().match(/\d+(st|nd|rd|th)?\s+floor/i)) || null,
    room: additionalInfo.find(p => p.toLowerCase().match(/room\s+\d+/i)) || null,
    additionalInfo: additionalInfo
  };
}

// Find matching location in database with fuzzy matching
async function findMatchingLocation(locationInfo) {
  if (!locationInfo || !locationInfo.normalizedName) return null;
  
  try {
    // First try exact match on normalized name or aliases
    let location = await locationsCollection.findOne({
      $or: [
        { name: { $regex: `^${locationInfo.mainName}$`, $options: 'i' } },
        { aliases: { $regex: `^${locationInfo.mainName}$`, $options: 'i' } }
      ],
      status: { $ne: 'merged' } // Don't match merged locations
    });
    
    if (location) {
      return { location, confidence: 1.0, matchType: 'exact' };
    }
    
    // Try location code match (e.g., TPL, CPL)
    const possibleCode = locationInfo.originalText.match(/\b[A-Z]{2,4}\b/)?.[0];
    if (possibleCode) {
      location = await locationsCollection.findOne({ 
        locationCode: possibleCode,
        status: { $ne: 'merged' }
      });
      if (location) {
        return { location, confidence: 0.95, matchType: 'code' };
      }
    }
    
    // Expand abbreviations for better matching
    const expandedName = expandAbbreviations(locationInfo.normalizedName);
    
    // Get all active locations for fuzzy matching
    const allLocations = await locationsCollection.find({
      status: { $ne: 'merged' }
    }).toArray();
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const loc of allLocations) {
      // Check name similarity
      const nameSimilarity = calculateSimilarity(locationInfo.mainName, loc.name);
      const expandedSimilarity = calculateSimilarity(expandedName, expandAbbreviations(loc.name));
      
      // Check alias similarity
      let aliasSimilarity = 0;
      if (loc.aliases && loc.aliases.length > 0) {
        for (const alias of loc.aliases) {
          const aliasScore = calculateSimilarity(locationInfo.mainName, alias);
          aliasSimilarity = Math.max(aliasSimilarity, aliasScore);
        }
      }
      
      // Check if location has been seen with this variation
      let variationMatch = 0;
      if (loc.seenVariations && loc.seenVariations.includes(locationInfo.originalText)) {
        variationMatch = 0.95; // High confidence if we've seen this exact text before
      }
      
      // Take the best score
      const score = Math.max(nameSimilarity, expandedSimilarity, aliasSimilarity, variationMatch);
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          location: loc,
          confidence: score,
          matchType: variationMatch > 0 ? 'variation' : 
                     aliasSimilarity > nameSimilarity ? 'alias' : 
                     expandedSimilarity > nameSimilarity ? 'expanded' : 'fuzzy'
        };
      }
    }
    
    // Return match if confidence is above threshold
    if (bestMatch && bestScore > 0.6) {
      return bestMatch;
    }
    
    return null;
  } catch (error) {
    logger.error('Error finding matching location:', error);
    return null;
  }
}

// Create or update location from event
async function upsertLocationFromEvent(event) {
  const locationInfo = extractLocationFromEvent(event);
  if (!locationInfo || !locationInfo.mainName) return null;
  
  try {
    const now = new Date();
    
    // Check if location already exists
    const existing = await findMatchingLocation(locationInfo);
    
    // If exact match, use existing location
    if (existing?.confidence === 1.0) {
      // Update usage count
      await locationsCollection.updateOne(
        { _id: existing.location._id },
        { 
          $inc: { usageCount: 1 },
          $set: { updatedAt: now },
          $addToSet: { 
            // Track variations seen in the wild
            seenVariations: locationInfo.originalText 
          }
        }
      );
      return {
        locationId: existing.location._id,
        wasCreated: false,
        confidence: existing.confidence
      };
    }
    
    // All new locations are approved (admin can merge manually in Merge tab)
    const status = 'approved';
    const suggestedMatches = existing ? [{
      locationId: existing.location._id,
      locationName: existing.location.name,
      confidence: existing.confidence,
      reason: 'Possible duplicate - review in Merge tab'
    }] : [];
    
    // Create new location with review status
    const newLocation = {
      name: locationInfo.mainName,
      aliases: [],
      locationCode: null,
      building: locationInfo.building,
      floor: locationInfo.floor,
      capacity: null,
      features: [],
      accessibility: [],
      address: null,
      notes: `Auto-imported from event: ${locationInfo.originalText}`,
      
      // Review and status fields
      status: status, // 'approved' or 'merged'
      confidence: existing?.confidence || 0,
      suggestedMatches: suggestedMatches,
      needsReview: false, // No pending review - admin uses Merge tab instead
      mergedInto: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,

      // Tracking fields
      importSource: 'event-import',
      originalText: locationInfo.originalText,
      seenVariations: [locationInfo.originalText],

      // Standard fields
      active: true, // All new locations are active
      createdAt: now,
      updatedAt: now,
      importedFrom: 'event-import',
      usageCount: 1
    };
    
    const result = await locationsCollection.insertOne(newLocation);
    return {
      locationId: result.insertedId,
      wasCreated: true,
      needsReview: false,
      confidence: existing?.confidence || 0
    };
  } catch (error) {
    logger.error('Error upserting location from event:', error);
    return null;
  }
}

// Analyze locations in a list of events for migration preview
async function analyzeEventLocations(events) {
  const locationMap = new Map();
  
  // Extract and count unique locations
  for (const event of events) {
    const locationString = event.location || '';
    if (!locationString) continue;
    
    const locationInfo = extractLocationFromEvent({ graphData: { location: { displayName: locationString } } });
    if (!locationInfo) continue;
    
    const key = locationInfo.normalizedName;
    if (!locationMap.has(key)) {
      locationMap.set(key, {
        originalName: locationInfo.mainName,
        normalizedName: locationInfo.normalizedName,
        count: 0,
        examples: [],
        match: null
      });
    }
    
    const locationEntry = locationMap.get(key);
    locationEntry.count++;
    
    // Keep first 3 examples for reference
    if (locationEntry.examples.length < 3 && !locationEntry.examples.includes(locationString)) {
      locationEntry.examples.push(locationString);
    }
  }
  
  // Check for matches against existing locations
  const existingLocations = [];
  const newLocations = [];
  const ambiguousLocations = [];
  
  for (const [key, locationData] of locationMap) {
    const match = await findMatchingLocation({
      mainName: locationData.originalName,
      normalizedName: locationData.normalizedName,
      originalText: locationData.examples[0]
    });
    
    if (match) {
      if (match.confidence >= 0.9) {
        // High confidence match
        existingLocations.push({
          name: locationData.originalName,
          count: locationData.count,
          examples: locationData.examples,
          matchedLocation: {
            id: match.location._id,
            name: match.location.name,
            confidence: match.confidence,
            matchType: match.matchType,
            confidenceLabel: match.confidence === 1 ? 'Exact Match' :
                           match.confidence >= 0.95 ? 'Very High' : 'High'
          }
        });
      } else {
        // Low confidence - needs review
        ambiguousLocations.push({
          name: locationData.originalName,
          count: locationData.count,
          examples: locationData.examples,
          possibleMatches: [{
            id: match.location._id,
            name: match.location.name,
            confidence: match.confidence,
            matchType: match.matchType,
            confidenceLabel: match.confidence >= 0.8 ? 'Medium' :
                           match.confidence >= 0.7 ? 'Low' : 'Very Low',
            action: match.confidence >= 0.8 ? 'Review Recommended' : 'Manual Review Required'
          }]
        });
      }
    } else {
      // No match found - new location
      newLocations.push({
        name: locationData.originalName,
        count: locationData.count,
        examples: locationData.examples,
        suggested: {
          name: locationData.originalName,
          aliases: locationData.examples.slice(1),
          importedFrom: 'event-import',
          status: 'Will be created as new'
        }
      });
    }
  }
  
  // Sort by count (most used first)
  existingLocations.sort((a, b) => b.count - a.count);
  newLocations.sort((a, b) => b.count - a.count);
  ambiguousLocations.sort((a, b) => b.count - a.count);
  
  return {
    summary: {
      totalUniqueLocations: locationMap.size,
      existing: existingLocations.length,
      new: newLocations.length,
      ambiguous: ambiguousLocations.length
    },
    locations: {
      existing: existingLocations,
      new: newLocations,
      ambiguous: ambiguousLocations
    }
  };
}

/**
 * Merge events from multiple calendars and enhance with internal data
 * This function handles the case where the same event exists in both the user's calendar
 * and the TempleRegistration shared calendar, combining the data intelligently
 */
async function mergeEventFromMultipleCalendars(userId, eventId, newGraphEvent, newCalendarId) {
  try {
    // Find existing unified event
    const existingEvent = await unifiedEventsCollection.findOne({
      userId: userId,
      eventId: eventId
    });

    if (!existingEvent) {
      // No existing event, create new one
      logger.debug(`Creating new unified event: ${eventId}`);
      return await upsertUnifiedEvent(userId, newCalendarId, newGraphEvent);
    }

    // Event exists - merge data from multiple calendars
    logger.debug(`Merging event data from multiple calendars: ${eventId}`, {
      existingCalendars: existingEvent.sourceCalendars?.map(sc => sc.calendarId),
      newCalendar: newCalendarId
    });

    // Determine which calendar should be primary source of truth
    const isNewCalendarTempleRegistration = newCalendarId.toLowerCase().includes('templeregistration');
    const existingTempleRegistrationCalendar = existingEvent.sourceCalendars?.find(sc => 
      sc.calendarId.toLowerCase().includes('templeregistration')
    );

    // Merge internal data from TempleRegistration calendar
    let enhancedInternalData = { ...existingEvent.internalData };
    
    if (isNewCalendarTempleRegistration) {
      // New event is from TempleRegistration - extract setup/teardown info
      const setupInfo = extractSetupTeardownInfo(newGraphEvent);
      enhancedInternalData = {
        ...enhancedInternalData,
        ...setupInfo,
        registrationNotes: newGraphEvent.body?.content || enhancedInternalData.registrationNotes,
        // Preserve existing internal notes and combine with new ones
        internalNotes: combineNotes(enhancedInternalData.internalNotes, newGraphEvent.body?.content)
      };
    }

    // Update source calendars list
    const updatedSourceCalendars = [...(existingEvent.sourceCalendars || [])];
    if (!updatedSourceCalendars.find(sc => sc.calendarId === newCalendarId)) {
      updatedSourceCalendars.push({
        calendarId: newCalendarId,
        calendarName: isNewCalendarTempleRegistration ? 'TempleRegistration' : 'User Calendar',
        role: isNewCalendarTempleRegistration ? 'shared' : 'primary'
      });
    }

    // Use the most recent event data as the primary source
    const primaryGraphEvent = new Date(newGraphEvent.lastModifiedDateTime) > new Date(existingEvent.lastModifiedDateTime) 
      ? newGraphEvent 
      : existingEvent.graphData;

    // Update the unified event with merged data
    return await upsertUnifiedEvent(
      userId,
      newCalendarId,
      primaryGraphEvent,
      enhancedInternalData,
      updatedSourceCalendars
    );

  } catch (error) {
    logger.error('Error merging event from multiple calendars:', error);
    throw error;
  }
}

/**
 * Extract setup and teardown time information from TempleRegistration event
 */
function extractSetupTeardownInfo(graphEvent) {
  const setupTeardownInfo = {
    setupMinutes: 0,
    teardownMinutes: 0
  };

  // Look for setup/teardown info in the event subject, body, or categories
  const textToSearch = [
    graphEvent.subject || '',
    graphEvent.body?.content || '',
    ...(graphEvent.categories || [])
  ].join(' ').toLowerCase();

  // Extract setup time (look for patterns like "Setup: 30 min", "30 min setup", etc.)
  const setupMatches = textToSearch.match(/setup[:\s]*(\d+)\s*min/i) || 
                      textToSearch.match(/(\d+)\s*min[:\s]*setup/i);
  if (setupMatches) {
    setupTeardownInfo.setupMinutes = parseInt(setupMatches[1]);
  }

  // Extract teardown time
  const teardownMatches = textToSearch.match(/teardown[:\s]*(\d+)\s*min/i) || 
                         textToSearch.match(/(\d+)\s*min[:\s]*teardown/i);
  if (teardownMatches) {
    setupTeardownInfo.teardownMinutes = parseInt(teardownMatches[1]);
  }

  // Look for total time info and infer setup/teardown if not explicitly stated
  const totalTimeMatches = textToSearch.match(/total[:\s]*(\d+)\s*min/i);
  if (totalTimeMatches && !setupMatches && !teardownMatches) {
    const totalMinutes = parseInt(totalTimeMatches[1]);
    // Assume 50/50 split if no specific breakdown
    setupTeardownInfo.setupMinutes = Math.floor(totalMinutes / 2);
    setupTeardownInfo.teardownMinutes = Math.ceil(totalMinutes / 2);
  }

  return setupTeardownInfo;
}

/**
 * Combine notes from multiple sources
 */
function combineNotes(existingNotes, newNotes) {
  if (!existingNotes && !newNotes) return '';
  if (!existingNotes) return newNotes;
  if (!newNotes) return existingNotes;
  
  // Avoid duplicating identical notes
  if (existingNotes.includes(newNotes) || newNotes.includes(existingNotes)) {
    return existingNotes.length > newNotes.length ? existingNotes : newNotes;
  }
  
  return `${existingNotes}\n\n--- TempleRegistration Notes ---\n${newNotes}`;
}

/**
 * Get events from unified collection
 */
async function getUnifiedEvents(userId, calendarId = null, startDate = null, endDate = null) {
  try {
    const query = { userId: userId, isDeleted: { $ne: true } };
    
    // Add calendar filter if specified
    if (calendarId) {
      query.calendarId = calendarId;
    }
    
    // Add date range filter if specified
    if (startDate && endDate) {
      query.$and = [
        { "graphData.start.dateTime": { $lt: endDate.toISOString() } },
        { "graphData.end.dateTime": { $gt: startDate.toISOString() } }
      ];
    }
    
    const events = await unifiedEventsCollection.find(query).toArray();
    
    logger.debug(`Found ${events.length} unified events`, {
      userId,
      calendarId,
      dateRange: startDate && endDate ? `${startDate.toISOString()} to ${endDate.toISOString()}` : 'all'
    });
    
    return events;
  } catch (error) {
    logger.error('Error getting unified events:', error);
    return [];
  }
}

/**
 * Smart cache-first events loading API endpoint
 */
app.post('/api/events/load', verifyToken, async (req, res) => {
  try {
    logger.debug('Cache-first events load handler started');
    
    const { calendarIds, startTime, endTime, forceRefresh = false } = req.body;
    const userId = req.user.userId;
    const graphToken = req.headers['x-graph-token'] || req.headers['graph-token'];

    // Enhanced validation and logging
    logger.debug('Cache-first events load handler: validating request', {
      userId,
      hasGraphToken: !!graphToken,
      graphTokenLength: graphToken ? graphToken.length : 0,
      graphTokenPreview: graphToken ? `${graphToken.substring(0, 20)}...` : 'MISSING',
      calendarIds,
      calendarIdsType: typeof calendarIds,
      calendarIdsIsArray: Array.isArray(calendarIds),
      calendarIdsLength: Array.isArray(calendarIds) ? calendarIds.length : 'N/A',
      startTime,
      endTime,
      forceRefresh,
      requestBody: req.body
    });

    logger.log(`🔍 Graph Token Check: ${graphToken ? '✅ PRESENT (' + graphToken.length + ' chars)' : '❌ MISSING'}`);
    
    if (!calendarIds || !Array.isArray(calendarIds) || calendarIds.length === 0) {
      logger.error('Cache-first events load handler: Invalid calendarIds', {
        calendarIds,
        type: typeof calendarIds,
        isArray: Array.isArray(calendarIds),
        length: Array.isArray(calendarIds) ? calendarIds.length : 'N/A'
      });
      return res.status(400).json({ error: 'calendarIds array required' });
    }

    // Validate individual calendar IDs
    for (let i = 0; i < calendarIds.length; i++) {
      const calendarId = calendarIds[i];
      if (!calendarId || typeof calendarId !== 'string' || calendarId.trim() === '') {
        logger.error('Cache-first events load handler: Invalid calendar ID at index', {
          index: i,
          calendarId,
          type: typeof calendarId,
          isEmpty: !calendarId || calendarId.trim() === ''
        });
        return res.status(400).json({ 
          error: `Invalid calendar ID at index ${i}: must be non-empty string`,
          calendarId,
          index: i
        });
      }
    }
    
    logger.log(`Cache-first events load requested for user ${userId}, calendars: ${calendarIds.join(', ')}`);
    
    const loadResults = {
      calendars: {},
      totalEvents: 0,
      errors: [],
      strategy: 'hybrid' // Cache + Graph API
    };

    // STEP 1: Load from unified events collection (cache)
    let unifiedEvents = [];
    const cachedEventIds = new Set(); // Track which events are in cache
    logger.debug('Loading events from cache...');

    if (startTime && endTime) {
      for (const calendarId of calendarIds) {
        try {
          const cachedEvents = await getUnifiedEvents(userId, calendarId, new Date(startTime), new Date(endTime));

          if (cachedEvents.length > 0) {
            logger.debug(`Found ${cachedEvents.length} cached events for calendar ${calendarId}`);
            unifiedEvents = unifiedEvents.concat(cachedEvents);

            // Track cached event IDs for deduplication (use Graph ID, not internal eventId)
            cachedEvents.forEach(event => {
              if (event.graphData?.id) {
                cachedEventIds.add(event.graphData.id);  // Use Graph ID for comparison
              }
            });

            loadResults.calendars[calendarId] = {
              cachedEvents: cachedEvents.length,
              source: 'hybrid'
            };
          } else {
            logger.debug(`No cached events found for calendar ${calendarId} in date range`);
            loadResults.calendars[calendarId] = {
              cachedEvents: 0,
              source: 'hybrid'
            };
          }
        } catch (cacheError) {
          logger.warn(`Error checking cache for calendar ${calendarId}:`, cacheError);
          loadResults.errors.push({
            calendarId: calendarId,
            error: cacheError.message,
            step: 'cache'
          });
        }
      }
    }

    // STEP 2: Fetch from Graph API and merge with cache
    logger.log('📡 STEP 2: Fetching events from Graph API...');
    const newGraphEvents = []; // Events from Graph not in cache

    if (startTime && endTime && graphToken) {
      logger.log(`✅ Conditions met for Graph API fetch (startTime: ${!!startTime}, endTime: ${!!endTime}, graphToken: ${!!graphToken})`);

      for (const calendarId of calendarIds) {
        try {
          // Build Graph API URL using /calendarView endpoint (auto-expands recurring series)
          const calendarPath = calendarId === 'primary'
            ? '/me/calendar/calendarView'
            : `/me/calendars/${calendarId}/calendarView`;

          const startISO = new Date(startTime).toISOString();
          const endISO = new Date(endTime).toISOString();

          let nextLink = `https://graph.microsoft.com/v1.0${calendarPath}?` +
            `startDateTime=${encodeURIComponent(startISO)}` +
            `&endDateTime=${encodeURIComponent(endISO)}` +
            `&$top=250` +
            `&$select=id,subject,start,end,location,organizer,body,categories,importance,showAs,sensitivity,isAllDay,recurrence,responseStatus,attendees,extensions,singleValueExtendedProperties,onlineMeetingUrl,onlineMeeting`;

          logger.log(`🌐 Calling Graph API (/calendarView) for calendar ${calendarId.substring(0, 20)}...`);

          let graphEvents = [];
          let pageCount = 0;

          // Fetch all pages
          while (nextLink) {
            pageCount++;

            const response = await fetch(nextLink, {
              headers: {
                'Authorization': `Bearer ${graphToken}`,
                'Content-Type': 'application/json'
              }
            });

            if (!response.ok) {
              const errorBody = await response.text();
              logger.error(`❌ Graph API fetch failed for calendar ${calendarId}`, {
                status: response.status,
                statusText: response.statusText,
                errorBody: errorBody,
                url: nextLink.substring(0, 100) + '...'
              });
              loadResults.errors.push({
                calendarId: calendarId,
                error: `Graph API error: ${response.status} - ${errorBody.substring(0, 200)}`,
                step: 'graph'
              });
              break;
            }

            // Parse JSON response
            let data;
            try {
              data = await response.json();
            } catch (jsonError) {
              logger.error(`Failed to parse Graph API JSON response for calendar ${calendarId.substring(0, 20)}...`, {
                error: jsonError.message
              });
              data = { value: [] };
            }

            graphEvents = graphEvents.concat(data.value || []);
            nextLink = data['@odata.nextLink'] || null;
          }

          logger.log(`✅ Fetched ${graphEvents.length} total events from Graph API for calendar ${calendarId.substring(0, 20)}... (${pageCount} pages)`);

          // Note: /calendarView automatically expands recurring series - no manual expansion needed!

          // Find new events not in cache
          const newEvents = graphEvents.filter(graphEvent => !cachedEventIds.has(graphEvent.id));

          if (newEvents.length > 0) {
            logger.log(`📝 Adding ${newEvents.length} new events (${graphEvents.length - newEvents.length} already cached)`);

            // Query database for existing events by graphData.id to get their eventIds
            const graphEventIds = newEvents.map(e => e.id);
            const existingEventsInDb = await unifiedEventsCollection.find({
              userId: userId,
              'graphData.id': { $in: graphEventIds }
            }).toArray();

            // Create a map of graphData.id → eventId for quick lookup
            const graphIdToEventIdMap = new Map();
            existingEventsInDb.forEach(event => {
              graphIdToEventIdMap.set(event.graphData.id, event.eventId);
            });

            // Add to unified events array
            newEvents.forEach(graphEvent => {
              // Check if this event already exists in database by graphData.id
              const existingEventId = graphIdToEventIdMap.get(graphEvent.id);
              const eventId = existingEventId || crypto.randomUUID(); // Use existing or generate new

              const unifiedEvent = {
                eventId: eventId, // Use existing UUID or generate new one
                userId: userId,
                source: 'Microsoft Graph',
                calendarId: calendarId,
                graphData: {
                  id: graphEvent.id,
                  subject: graphEvent.subject,
                  start: graphEvent.start,
                  end: graphEvent.end,
                  location: graphEvent.location,
                  categories: graphEvent.categories || [],
                  bodyPreview: graphEvent.body?.content || '',
                  isAllDay: graphEvent.isAllDay,
                  importance: graphEvent.importance,
                  showAs: graphEvent.showAs,
                  sensitivity: graphEvent.sensitivity,
                  organizer: graphEvent.organizer,
                  attendees: graphEvent.attendees || [],
                  extensions: graphEvent.extensions || [],
                  singleValueExtendedProperties: graphEvent.singleValueExtendedProperties || [],
                  onlineMeetingUrl: graphEvent.onlineMeetingUrl || graphEvent.onlineMeeting?.joinUrl || null
                },
                internalData: {
                  mecCategories: [],
                  setupMinutes: 0,
                  teardownMinutes: 0,
                  registrationNotes: '',
                  assignedTo: '',
                  staffAssignments: [],
                  internalNotes: '',
                  setupStatus: 'pending',
                  estimatedCost: null,
                  actualCost: null,
                  customFields: {}
                },
                lastModifiedDateTime: new Date(graphEvent.lastModifiedDateTime || new Date()),
                lastSyncedAt: new Date(),
                sourceCalendars: [{
                  calendarId: calendarId,
                  calendarName: calendarId,
                  role: 'primary'
                }],
                _fromGraph: true // Mark as fresh from Graph
              };

              // CHECK FOR VIRTUAL MEETING (URLs) - Apply detection immediately for inline events
              const locationDisplayName = graphEvent.location?.displayName || '';
              if (locationDisplayName && isVirtualLocation(locationDisplayName)) {
                // This is a virtual meeting - set virtual meeting fields
                unifiedEvent.virtualMeetingUrl = locationDisplayName;
                unifiedEvent.virtualPlatform = getVirtualPlatform(locationDisplayName);
                // DO NOT modify graphData.location.displayName - keep original Outlook data unchanged
                // Set top-level locationDisplayNames for app use
                unifiedEvent.locations = []; // Will be set by background sync
                unifiedEvent.locationDisplayNames = 'Virtual Meeting';

                logger.debug('Detected virtual meeting in inline event creation', {
                  subject: graphEvent.subject,
                  platform: unifiedEvent.virtualPlatform,
                  url: locationDisplayName.substring(0, 50) + '...'
                });
              }

              // Only add to unifiedEvents if not already in cache (prevent duplicates)
              if (!cachedEventIds.has(graphEvent.id)) {
                unifiedEvents.push(unifiedEvent);
              }

              // Always track for database sync
              newGraphEvents.push(unifiedEvent);
            });
          }

          // Update load results
          if (loadResults.calendars[calendarId]) {
            loadResults.calendars[calendarId].graphEvents = graphEvents.length;
            loadResults.calendars[calendarId].newEvents = newEvents.length;
            loadResults.calendars[calendarId].totalEvents =
              loadResults.calendars[calendarId].cachedEvents + newEvents.length;
          }
        } catch (graphError) {
          logger.error(`❌ Exception during Graph API fetch for calendar ${calendarId}`, {
            errorMessage: graphError.message,
            errorStack: graphError.stack,
            calendarId: calendarId
          });
          loadResults.errors.push({
            calendarId: calendarId,
            error: `Exception: ${graphError.message}`,
            step: 'graph'
          });
        }
      }

      logger.log(`📊 Graph API Fetch Summary: ${newGraphEvents.length} new events added from ${calendarIds.length} calendar(s)`);
    } else {
      logger.warn(`⚠️ Skipping Graph API fetch - Missing required data:`);
      logger.warn(`   - startTime: ${!!startTime}`);
      logger.warn(`   - endTime: ${!!endTime}`);
      logger.warn(`   - graphToken: ${!!graphToken}`);
    }

    // STEP 3: Asynchronously sync new Graph events to cache for future renders
    if (newGraphEvents.length > 0) {
      // Don't await - let this run in background
      Promise.all(
        newGraphEvents.map(event =>
          upsertUnifiedEvent(
            userId,
            event.calendarId,
            event.graphData,
            event.internalData,
            event.sourceCalendars
          ).catch(err => {
            logger.warn(`Failed to cache event ${event.eventId}:`, err.message);
          })
        )
      ).catch(err => {
        logger.warn('Error in background cache sync:', err);
      });
    }

    // STEP 2: Return events with full database structure (preserving graphData and internalData)
    const transformedLoadEvents = unifiedEvents.map(event => {
      // Check if graphData exists and has required properties
      if (!event.graphData || !event.graphData.start || !event.graphData.end) {
        logger.warn('Cached event missing required graphData properties:', {
          eventId: event.eventId,
          hasGraphData: !!event.graphData,
          hasStart: event.graphData?.start ? true : false,
          hasEnd: event.graphData?.end ? true : false
        });
        return null;
      }

      // Ensure event has a subject
      if (!event.graphData.subject) {
        event.graphData.subject = event.internalData?.subject || '(No Subject)';
      }

      // Return the full database object with nested structure intact
      return {
        // Core identifiers
        eventId: event.eventId,                          // Internal unique ID (UUID)
        id: event.graphData?.id || event.eventId,       // Graph ID or fallback to eventId
        _id: event._id,                                 // MongoDB document ID
        userId: event.userId,
        calendarId: event.calendarId,

        // Nested data structures (PRESERVED)
        graphData: event.graphData,                     // Full Graph API data
        internalData: event.internalData || {},         // Full internal enrichments
        roomReservationData: event.roomReservationData, // Room reservation data

        // Top-level compatibility fields for frontend (extracted from nested data)
        subject: event.graphData?.subject,
        start: event.graphData?.start,
        end: event.graphData?.end,
        location: event.graphData?.location,
        bodyPreview: event.graphData?.bodyPreview,
        isAllDay: event.graphData?.isAllDay,

        // TOP-LEVEL APPLICATION FIELDS (added by migration)
        eventTitle: event.eventTitle,
        eventDescription: event.eventDescription,
        startDateTime: event.startDateTime,
        endDateTime: event.endDateTime,
        startDate: event.startDate,
        startTime: event.startTime,
        endDate: event.endDate,
        endTime: event.endTime,
        setupTime: event.setupTime,
        teardownTime: event.teardownTime,
        doorOpenTime: event.doorOpenTime,
        doorCloseTime: event.doorCloseTime,
        setupTimeMinutes: event.setupTimeMinutes,
        teardownTimeMinutes: event.teardownTimeMinutes,
        setupNotes: event.setupNotes,
        doorNotes: event.doorNotes,
        eventNotes: event.eventNotes,
        isAllDayEvent: event.isAllDayEvent,

        // Room reservation fields
        requestedRooms: event.requestedRooms,
        requesterName: event.requesterName,
        requesterEmail: event.requesterEmail,
        department: event.department,
        phone: event.phone,
        attendeeCount: event.attendeeCount,
        priority: event.priority,
        specialRequirements: event.specialRequirements,
        contactName: event.contactName,
        contactEmail: event.contactEmail,
        isOnBehalfOf: event.isOnBehalfOf,
        reviewNotes: event.reviewNotes,

        // Category and assignment fields
        mecCategories: event.mecCategories,
        assignedTo: event.assignedTo,

        // Additional metadata
        virtualMeetingUrl: event.virtualMeetingUrl,
        virtualPlatform: event.virtualPlatform,
        locations: event.locations,
        locationDisplayNames: event.locationDisplayNames,
        sourceCalendars: event.sourceCalendars,
        lastSyncedAt: event.lastSyncedAt,
        lastModifiedDateTime: event.lastModifiedDateTime,
        status: event.status,
        isDeleted: event.isDeleted,

        // Timestamps
        createdAt: event.createdAt,
        createdBy: event.createdBy,
        createdByEmail: event.createdByEmail,
        createdByName: event.createdByName,
        createdSource: event.createdSource,

        // Flags for backward compatibility
        _hasInternalData: Object.keys(event.internalData || {}).some(key =>
          event.internalData[key] &&
          (Array.isArray(event.internalData[key]) ? event.internalData[key].length > 0 : true)
        ),
        _cached: true
      };
    }).filter(event => event !== null);

    // Calculate totals
    const cachedCount = unifiedEvents.filter(e => !e._fromGraph).length;
    const graphCount = newGraphEvents.length;

    logger.log(`\n${'='.repeat(60)}`);
    logger.log(`📊 EVENTS LOADED - Summary`);
    logger.log(`${'='.repeat(60)}`);
    logger.log(`📅 Calendars: ${calendarIds.length} | 📋 Total Events: ${transformedLoadEvents.length}`);
    logger.log(`📦 From Cache: ${cachedCount} | 🌐 From Graph API: ${graphCount} (new)`);

    // Log details of loaded events
    if (transformedLoadEvents.length > 0) {
      logger.log(`\n📋 Event Details:`);
      transformedLoadEvents
        .filter(event => event.start?.dateTime) // Only include events with valid start time
        .sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime))
        .forEach((event, idx) => {
          const eventDate = new Date(event.start.dateTime).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
          });
          const location = event.location?.displayName || 'No location';
          logger.log(`  ${idx + 1}. "${event.subject}" | ${eventDate} | ${location} | ID: ${event.eventId?.substring(0, 8)}...`);
        });
    }

    if (loadResults.errors.length > 0) {
      logger.log(`\n⚠️  Errors: ${loadResults.errors.length}`);
      loadResults.errors.forEach((err, idx) => {
        logger.error(`   ${idx + 1}. ${err.error} (calendar: ${err.calendarId.substring(0, 20)}...)`);
      });
    }
    logger.log(`${'='.repeat(60)}\n`);

    return res.status(200).json({
      loadResults: loadResults,
      events: transformedLoadEvents,
      count: transformedLoadEvents.length,
      source: 'hybrid',
      breakdown: {
        cached: cachedCount,
        fromGraph: graphCount,
        total: transformedLoadEvents.length
      }
    });

    // Unreachable code removed - function returns above
    
  } catch (error) {
    logger.error('Error in cache-first events load:', error);
    res.status(500).json({ error: 'Failed to load events', details: error.message });
  }
});

/**
 * Force full sync endpoint
 */
app.post('/api/events/force-sync', verifyToken, async (req, res) => {
  try {
    const { calendarIds } = req.body;
    const userId = req.user.userId;
    
    if (!calendarIds || !Array.isArray(calendarIds)) {
      return res.status(400).json({ error: 'calendarIds array required' });
    }
    
    // Reset delta tokens for all calendars
    for (const calendarId of calendarIds) {
      await resetDeltaToken(userId, calendarId);
    }
    
    logger.log(`Reset delta tokens for user ${userId}, calendars: ${calendarIds.join(', ')}`);
    
    res.status(200).json({ 
      message: 'Delta tokens reset, next sync will be full sync',
      calendarIds: calendarIds
    });
    
  } catch (error) {
    logger.error('Error in force sync:', error);
    res.status(500).json({ error: 'Failed to reset sync tokens' });
  }
});

/**
 * Get unified events endpoint
 */
app.get('/api/events', verifyToken, async (req, res) => {
  console.log('===== /api/events endpoint hit =====');
  try {
    const { calendarId, startTime, endTime, status, page = 1, limit = 20 } = req.query;
    const userId = req.user.userId;
    const userEmail = req.user.email;

    // NEW: Handle room-reservation-request filtering
    if (status === 'room-reservation-request') {
      console.log('🔍 Filtering for room reservation requests');

      // Build query for room reservations
      const query = {
        isDeleted: { $ne: true },
        status: 'room-reservation-request',
        roomReservationData: { $exists: true, $ne: null }
      };

      // Check if user can view all reservations
      const user = await usersCollection.findOne({ userId });
      const canViewAll = user?.permissions?.canViewAllReservations || userEmail.includes('admin');

      console.log('👤 User info:', { userId, userEmail, canViewAll });

      // Non-admin users can only see their own requests
      if (!canViewAll) {
        query['roomReservationData.requestedBy.userId'] = userId;
      }

      console.log('🔍 MongoDB query:', JSON.stringify(query, null, 2));

      // Execute query
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const events = await unifiedEventsCollection
        .find(query)
        .sort({ 'graphData.start.dateTime': -1, submittedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .toArray();

      const totalCount = await unifiedEventsCollection.countDocuments(query);

      console.log('📊 Query results:', { totalCount, returnedCount: events.length });

      return res.json({
        events,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalCount,
          totalPages: Math.ceil(totalCount / parseInt(limit))
        }
      });
    }

    // OLD: Original logic for calendar events
    let startDate = null;
    let endDate = null;
    if (startTime && endTime) {
      startDate = new Date(startTime);
      endDate = new Date(endTime);
    }

    const unifiedEvents = await getUnifiedEvents(userId, calendarId, startDate, endDate);
    
    // Transform events to frontend format
    const transformedApiEvents = unifiedEvents.map(event => {
      // Normalize category field - frontend expects a single string
      let category = '';
      if (event.internalData.mecCategories && event.internalData.mecCategories.length > 0) {
        // CSV imports use mecCategories
        category = event.internalData.mecCategories[0];
      } else if (event.graphData.categories && event.graphData.categories.length > 0) {
        // Graph events use categories
        category = event.graphData.categories[0];
      }
      
      return {
        // Use Graph data as base
        ...event.graphData,
        // Add internal enrichments
        ...event.internalData,
        // Explicitly include ID fields (ensures they're not overwritten)
        eventId: event.eventId,                          // Internal unique ID (UUID)
        id: event.graphData?.id || event.eventId,       // Graph ID or fallback to eventId
        graphId: event.graphData?.id || null,           // Explicit Graph/Outlook ID
        // Override with normalized category
        category: category,
        // Add metadata
        calendarId: event.calendarId,
        sourceCalendars: event.sourceCalendars,
        _hasInternalData: Object.keys(event.internalData).some(key =>
          event.internalData[key] &&
          (Array.isArray(event.internalData[key]) ? event.internalData[key].length > 0 : true)
        ),
        _lastSyncedAt: event.lastSyncedAt,
        _cached: true
      };
    });
    
    res.status(200).json({
      events: transformedApiEvents,
      count: transformedApiEvents.length,
      source: 'unified_storage'
    });
    
  } catch (error) {
    logger.error('Error getting unified events:', error);
    res.status(500).json({ error: 'Failed to get events' });
  }
});

/**
 * NEW: Get room reservation request events (dedicated endpoint)
 * GET /api/room-reservation-events?limit=1000
 */
app.get('/api/room-reservation-events', verifyToken, async (req, res) => {
  console.log('===== /api/room-reservation-events endpoint hit =====');
  try {
    const { page = 1, limit = 20 } = req.query;
    const userId = req.user.userId;
    const userEmail = req.user.email;

    // Build query for room reservations (all statuses: pending, approved, rejected)
    const query = {
      isDeleted: { $ne: true },
      roomReservationData: { $exists: true, $ne: null }
    };

    // Check if user can view all reservations
    const user = await usersCollection.findOne({ userId });
    const canViewAll = user?.permissions?.canViewAllReservations || userEmail.includes('admin');

    console.log('👤 User info:', { userId, userEmail, canViewAll });

    // Non-admin users can only see their own requests
    if (!canViewAll) {
      query['roomReservationData.requestedBy.userId'] = userId;
    }

    console.log('🔍 MongoDB query:', JSON.stringify(query, null, 2));

    // Execute query (no sort due to Cosmos DB index limitations)
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const events = await unifiedEventsCollection
      .find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const totalCount = await unifiedEventsCollection.countDocuments(query);

    console.log('📊 Query results:', { totalCount, returnedCount: events.length });

    res.json({
      events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    logger.error('Error fetching room reservation events:', error);
    res.status(500).json({ error: 'Failed to fetch room reservation events' });
  }
});

/**
 * Update internal data for an event
 */
app.patch('/api/events/:eventId/internal', verifyToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { internalData } = req.body;
    const userId = req.user.userId;

    if (!internalData) {
      return res.status(400).json({ error: 'internalData required' });
    }

    logger.debug(`Updating internal data for event ${eventId}`, { userId, internalData });

    // Fetch current event data before updating for change detection
    const currentEvent = await unifiedEventsCollection.findOne({
      userId: userId,
      eventId: eventId
    });

    if (!currentEvent) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Detect changes between old and new internal data
    const oldInternalData = currentEvent.internalData || {};
    const changeSet = [];

    // Compare each field in the new internal data
    for (const [field, newValue] of Object.entries(internalData)) {
      const oldValue = oldInternalData[field];

      // Skip if values are the same (deep comparison for arrays/objects)
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changeSet.push({
          field: `internalData.${field}`,
          oldValue: oldValue,
          newValue: newValue
        });
      }
    }

    // Check for removed fields (fields that existed in old but not in new)
    for (const [field, oldValue] of Object.entries(oldInternalData)) {
      if (!(field in internalData)) {
        changeSet.push({
          field: `internalData.${field}`,
          oldValue: oldValue,
          newValue: undefined
        });
      }
    }

    // Update only internal data, preserve everything else
    const result = await unifiedEventsCollection.updateOne(
      { userId: userId, eventId: eventId },
      {
        $set: {
          'internalData': internalData,
          lastAccessedAt: new Date()
        }
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Log audit entry if there were changes
    if (changeSet.length > 0) {
      try {
        await logEventAudit({
          eventId: eventId,
          userId: userId,
          changeType: 'update',
          source: 'Manual Edit',
          changeSet: changeSet,
          metadata: {
            userAgent: req.headers['user-agent'] || 'Unknown',
            ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
            reason: 'Event internal data updated via UI'
          }
        });

        logger.debug(`Audit entry created for event ${eventId}`, {
          changesCount: changeSet.length
        });
      } catch (auditError) {
        logger.error('Failed to create audit entry:', auditError);
        // Don't fail the request if audit logging fails
      }
    } else {
      logger.debug(`No changes detected for event ${eventId}, skipping audit entry`);
    }

    // Return updated event
    const updatedEvent = await unifiedEventsCollection.findOne({
      userId: userId,
      eventId: eventId
    });

    if (!updatedEvent) {
      return res.status(404).json({ error: 'Event not found after update' });
    }

    // Transform to frontend format
    const transformedEvent = {
      ...updatedEvent.graphData,
      ...updatedEvent.internalData,
      calendarId: updatedEvent.calendarId,
      sourceCalendars: updatedEvent.sourceCalendars,
      _hasInternalData: Object.keys(updatedEvent.internalData).some(key =>
        updatedEvent.internalData[key] &&
        (Array.isArray(updatedEvent.internalData[key]) ? updatedEvent.internalData[key].length > 0 : true)
      ),
      _lastSyncedAt: updatedEvent.lastSyncedAt
    };

    logger.debug(`Successfully updated internal data for event ${eventId}`);

    res.status(200).json({
      event: transformedEvent,
      message: 'Internal data updated successfully'
    });

  } catch (error) {
    logger.error('Error updating event internal data:', error);
    res.status(500).json({ error: 'Failed to update internal data' });
  }
});

/**
 * Unified audit update endpoint - handles both Graph API and internal field updates with comprehensive audit logging
 */
app.post('/api/events/:eventId/audit-update', verifyToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const { graphFields, internalFields, calendarId, graphToken } = req.body;
    const userId = req.user.userId;

    logger.debug(`Starting unified audit update for event ${eventId}`, {
      hasGraphFields: !!graphFields,
      hasInternalFields: !!internalFields,
      calendarId,
      hasGraphToken: !!graphToken
    });

    if (!graphFields && !internalFields) {
      return res.status(400).json({ error: 'Either graphFields or internalFields must be provided' });
    }

    // Handle new event creation vs existing event updates
    let currentEvent = null;
    let isNewEvent = false;
    let actualEventId = eventId; // Working copy of eventId that can be updated

    if (eventId && eventId !== 'new') {
      // Fetch current event data for existing events
      currentEvent = await unifiedEventsCollection.findOne({
        userId: userId,
        eventId: eventId
      });

      if (!currentEvent) {
        return res.status(404).json({ error: 'Event not found' });
      }
    } else {
      // New event creation
      isNewEvent = true;
      logger.debug('Processing new event creation');
    }

    // Capture complete "before" state for audit comparison
    const beforeState = isNewEvent ? {
      // New events start with empty/null values
      subject: null,
      location: null,
      start: null,
      end: null,
      body: null,
      categories: null,
      isAllDay: null,
      setupMinutes: null,
      teardownMinutes: null,
      assignedTo: null,
      registrationNotes: null
    } : {
      // Graph API fields from graphData
      subject: currentEvent.graphData?.subject,
      location: currentEvent.graphData?.location?.displayName,
      start: currentEvent.graphData?.start,
      end: currentEvent.graphData?.end,
      body: extractTextFromHtml(currentEvent.graphData?.body?.content),
      categories: currentEvent.graphData?.categories,
      isAllDay: currentEvent.graphData?.isAllDay,
      // Internal fields from internalData
      setupMinutes: currentEvent.internalData?.setupMinutes,
      teardownMinutes: currentEvent.internalData?.teardownMinutes,
      assignedTo: currentEvent.internalData?.assignedTo,
      registrationNotes: currentEvent.internalData?.registrationNotes
    };

    let graphUpdateResult = null;
    let updatedGraphData = currentEvent?.graphData || {};

    // 1. Update or Create event in Graph API if graphFields provided
    if (graphFields && graphToken) {
      try {
        // Construct batch request - use POST for new events, PATCH for existing events
        const batchBody = {
          requests: [
            {
              id: '1',
              method: isNewEvent ? 'POST' : 'PATCH',
              url: isNewEvent ?
                (calendarId ? `/me/calendars/${calendarId}/events` : `/me/events`) :
                (calendarId ? `/me/calendars/${calendarId}/events/${eventId}` : `/me/events/${eventId}`),
              body: graphFields,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          ]
        };

        logger.debug(`Making Graph API batch ${isNewEvent ? 'create' : 'update'}:`, { batchBody });

        const graphResponse = await fetch('https://graph.microsoft.com/v1.0/$batch', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${graphToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(batchBody)
        });

        if (!graphResponse.ok) {
          const errorText = await graphResponse.text();
          logger.error('Graph API batch request failed:', {
            status: graphResponse.status,
            statusText: graphResponse.statusText,
            error: errorText,
            isNewEvent
          });
          return res.status(502).json({ error: `Graph API ${isNewEvent ? 'create' : 'update'} failed: ${graphResponse.status} ${graphResponse.statusText}` });
        }

        const batchResult = await graphResponse.json();

        if (batchResult.responses && batchResult.responses.length > 0) {
          const mainResponse = batchResult.responses[0];
          if (mainResponse.status >= 200 && mainResponse.status < 300) {
            graphUpdateResult = mainResponse.body;
            logger.debug(`Graph API ${isNewEvent ? 'create' : 'update'} successful:`, {
              eventId: graphUpdateResult.id,
              subject: graphUpdateResult.subject
            });

            // For new events, generate a unique internal UUID (eventId is separate from Graph ID)
            if (isNewEvent && graphUpdateResult.id) {
              actualEventId = crypto.randomUUID();
              logger.debug('New event created - Graph ID:', graphUpdateResult.id, '| Internal eventId:', actualEventId);
            }
          } else {
            logger.error('Graph API batch response error:', mainResponse);
            return res.status(502).json({ error: `Graph API ${isNewEvent ? 'create' : 'update'} failed: ${mainResponse.status}` });
          }
        }

        // Update local graphData with the new values
        updatedGraphData = {
          ...(currentEvent?.graphData || {}),
          ...graphUpdateResult
        };

      } catch (graphError) {
        logger.error('Graph API update error:', graphError);
        return res.status(502).json({ error: `Graph API update failed: ${graphError.message}` });
      }
    }

    // 2. Update or insert event in database
    let dbUpdateResult;

    if (isNewEvent) {
      // Insert new event document
      const newEventDoc = {
        userId: userId,
        eventId: actualEventId,
        calendarId: calendarId,
        graphData: updatedGraphData,
        internalData: internalFields || {},
        createdAt: new Date(),
        createdBy: req.user.userId,
        createdByEmail: req.user.email,
        createdByName: req.user.name || req.user.email,
        createdSource: 'unified-form',
        lastAccessedAt: new Date(),
        syncedAt: new Date()
      };

      // Initialize location fields for new events
      newEventDoc.locations = [];
      newEventDoc.locationDisplayNames = updatedGraphData.location?.displayName || '';

      // TOP-LEVEL APPLICATION FIELDS (for forms/UI - no transformation needed)
      const startDateTime = updatedGraphData.start?.dateTime;
      const endDateTime = updatedGraphData.end?.dateTime;

      newEventDoc.eventTitle = updatedGraphData.subject || 'Untitled Event';
      newEventDoc.eventDescription = updatedGraphData.body?.content || updatedGraphData.bodyPreview || '';
      newEventDoc.startDateTime = startDateTime;
      newEventDoc.endDateTime = endDateTime;
      newEventDoc.startDate = startDateTime ? new Date(startDateTime).toISOString().split('T')[0] : '';
      newEventDoc.startTime = startDateTime ? new Date(startDateTime).toTimeString().slice(0, 5) : '';
      newEventDoc.endDate = endDateTime ? new Date(endDateTime).toISOString().split('T')[0] : '';
      newEventDoc.endTime = endDateTime ? new Date(endDateTime).toTimeString().slice(0, 5) : '';
      newEventDoc.location = updatedGraphData.location?.displayName || '';
      newEventDoc.isAllDayEvent = updatedGraphData.isAllDay || false;

      // Timing fields from internalData
      newEventDoc.setupTime = internalFields?.setupTime || '';
      newEventDoc.teardownTime = internalFields?.teardownTime || '';
      newEventDoc.doorOpenTime = internalFields?.doorOpenTime || '';
      newEventDoc.doorCloseTime = internalFields?.doorCloseTime || '';
      newEventDoc.setupTimeMinutes = internalFields?.setupMinutes || 0;
      newEventDoc.teardownTimeMinutes = internalFields?.teardownMinutes || 0;

      // Notes fields from internalData
      newEventDoc.setupNotes = internalFields?.setupNotes || '';
      newEventDoc.doorNotes = internalFields?.doorNotes || '';
      newEventDoc.eventNotes = internalFields?.eventNotes || '';

      // Category and assignment fields
      newEventDoc.mecCategories = internalFields?.mecCategories || [];
      newEventDoc.assignedTo = internalFields?.assignedTo || '';

      // Virtual meeting fields
      newEventDoc.virtualMeetingUrl = updatedGraphData.onlineMeetingUrl || updatedGraphData.onlineMeeting?.joinUrl || null;
      newEventDoc.virtualPlatform = null; // Not typically in Graph data

      dbUpdateResult = await unifiedEventsCollection.insertOne(newEventDoc);
      logger.debug('New event inserted into database:', {
        eventId: actualEventId,
        insertedId: dbUpdateResult.insertedId,
        locationDisplayNames: newEventDoc.locationDisplayNames
      });
    } else {
      // Update existing event
      const updateOperations = {};

      if (internalFields) {
        updateOperations['internalData'] = {
          ...currentEvent.internalData,
          ...internalFields
        };

        // Update top-level timing and notes fields from internalData
        if (internalFields.setupTime !== undefined) updateOperations['setupTime'] = internalFields.setupTime;
        if (internalFields.teardownTime !== undefined) updateOperations['teardownTime'] = internalFields.teardownTime;
        if (internalFields.doorOpenTime !== undefined) updateOperations['doorOpenTime'] = internalFields.doorOpenTime;
        if (internalFields.doorCloseTime !== undefined) updateOperations['doorCloseTime'] = internalFields.doorCloseTime;
        if (internalFields.setupMinutes !== undefined) updateOperations['setupTimeMinutes'] = internalFields.setupMinutes;
        if (internalFields.teardownMinutes !== undefined) updateOperations['teardownTimeMinutes'] = internalFields.teardownMinutes;
        if (internalFields.setupNotes !== undefined) updateOperations['setupNotes'] = internalFields.setupNotes;
        if (internalFields.doorNotes !== undefined) updateOperations['doorNotes'] = internalFields.doorNotes;
        if (internalFields.eventNotes !== undefined) updateOperations['eventNotes'] = internalFields.eventNotes;
        if (internalFields.mecCategories !== undefined) updateOperations['mecCategories'] = internalFields.mecCategories;
        if (internalFields.assignedTo !== undefined) updateOperations['assignedTo'] = internalFields.assignedTo;
      }

      // Always update graphData if we got new data from Graph API
      if (graphUpdateResult) {
        updateOperations['graphData'] = updatedGraphData;

        // Update locationDisplayNames if location changed in graphData
        const newLocationDisplayName = updatedGraphData.location?.displayName || '';
        if (newLocationDisplayName !== currentEvent.locationDisplayNames) {
          updateOperations['locationDisplayNames'] = newLocationDisplayName;
          // Note: locations array is NOT auto-updated - requires manual assignment in Phase 2
        }

        // Update top-level fields from graphData
        const startDateTime = updatedGraphData.start?.dateTime;
        const endDateTime = updatedGraphData.end?.dateTime;

        updateOperations['eventTitle'] = updatedGraphData.subject || 'Untitled Event';
        updateOperations['eventDescription'] = updatedGraphData.body?.content || updatedGraphData.bodyPreview || '';
        updateOperations['startDateTime'] = startDateTime;
        updateOperations['endDateTime'] = endDateTime;
        updateOperations['startDate'] = startDateTime ? new Date(startDateTime).toISOString().split('T')[0] : '';
        updateOperations['startTime'] = startDateTime ? new Date(startDateTime).toTimeString().slice(0, 5) : '';
        updateOperations['endDate'] = endDateTime ? new Date(endDateTime).toISOString().split('T')[0] : '';
        updateOperations['endTime'] = endDateTime ? new Date(endDateTime).toTimeString().slice(0, 5) : '';
        updateOperations['location'] = newLocationDisplayName;
        updateOperations['isAllDayEvent'] = updatedGraphData.isAllDay || false;
        updateOperations['virtualMeetingUrl'] = updatedGraphData.onlineMeetingUrl || updatedGraphData.onlineMeeting?.joinUrl || null;
      }

      updateOperations['lastAccessedAt'] = new Date();
      updateOperations['syncedAt'] = new Date();

      dbUpdateResult = await unifiedEventsCollection.updateOne(
        { userId: userId, eventId: eventId },
        { $set: updateOperations }
      );

      if (dbUpdateResult.matchedCount === 0) {
        return res.status(404).json({ error: 'Event not found in database' });
      }
    }

    // 3. Generate comprehensive changeSet for audit logging
    const afterState = {
      // Graph API fields - use updated values if changed, otherwise current values
      subject: graphFields?.subject !== undefined ? graphFields.subject : beforeState.subject,
      location: graphFields?.location?.displayName !== undefined ? graphFields.location.displayName : beforeState.location,
      start: graphFields?.start !== undefined ? graphFields.start : beforeState.start,
      end: graphFields?.end !== undefined ? graphFields.end : beforeState.end,
      body: graphFields?.body?.content !== undefined ? extractTextFromHtml(graphFields.body.content) : beforeState.body,
      categories: graphFields?.categories !== undefined ? graphFields.categories : beforeState.categories,
      isAllDay: graphFields?.isAllDay !== undefined ? graphFields.isAllDay : beforeState.isAllDay,
      // Internal fields
      setupMinutes: internalFields?.setupMinutes !== undefined ? internalFields.setupMinutes : beforeState.setupMinutes,
      teardownMinutes: internalFields?.teardownMinutes !== undefined ? internalFields.teardownMinutes : beforeState.teardownMinutes,
      assignedTo: internalFields?.assignedTo !== undefined ? internalFields.assignedTo : beforeState.assignedTo,
      registrationNotes: internalFields?.registrationNotes !== undefined ? internalFields.registrationNotes : beforeState.registrationNotes
    };

    // Generate changeSet by comparing before and after states
    const changeSet = [];

    for (const [field, afterValue] of Object.entries(afterState)) {
      const beforeValue = beforeState[field];

      // Deep comparison for complex values
      if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
        changeSet.push({
          field: field,
          oldValue: beforeValue,
          newValue: afterValue
        });
      }
    }

    // 4. Create audit entry if there were changes (or if it's a new event)
    if (changeSet.length > 0 || isNewEvent) {
      try {
        await logEventAudit({
          eventId: actualEventId,
          userId: userId,
          changeType: isNewEvent ? 'create' : 'update',
          source: isNewEvent ? 'Unified Form Create' : 'Unified Form Edit',
          changeSet: changeSet,
          metadata: {
            userAgent: req.headers['user-agent'] || 'Unknown',
            ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
            reason: isNewEvent ? 'Event created via unified audit system' : 'Event updated via unified audit system',
            graphFieldsUpdated: !!graphFields,
            internalFieldsUpdated: !!internalFields
          }
        });

        logger.debug(`Unified audit entry created for event ${actualEventId}`, {
          changeType: isNewEvent ? 'create' : 'update',
          changesCount: changeSet.length,
          changes: changeSet.map(c => c.field)
        });
      } catch (auditError) {
        logger.error('Failed to create unified audit entry:', auditError);
        // Don't fail the request if audit logging fails
      }
    } else {
      logger.debug(`No changes detected for event ${actualEventId}, skipping audit entry`);
    }

    // 5. Return updated event
    const finalEvent = await unifiedEventsCollection.findOne({
      userId: userId,
      eventId: actualEventId
    });

    if (!finalEvent) {
      return res.status(404).json({ error: 'Event not found after update' });
    }

    // Transform to frontend format
    const transformedEvent = {
      ...finalEvent.graphData,
      ...finalEvent.internalData,
      calendarId: finalEvent.calendarId,
      sourceCalendars: finalEvent.sourceCalendars,
      _hasInternalData: Object.keys(finalEvent.internalData || {}).some(key =>
        finalEvent.internalData[key] &&
        (Array.isArray(finalEvent.internalData[key]) ? finalEvent.internalData[key].length > 0 : true)
      ),
      _lastSyncedAt: finalEvent.lastSyncedAt
    };

    logger.debug(`Successfully completed unified update for event ${actualEventId}`, {
      graphFieldsUpdated: !!graphFields,
      internalFieldsUpdated: !!internalFields,
      auditChangesCount: changeSet.length
    });

    res.status(200).json({
      event: transformedEvent,
      message: 'Event updated successfully with comprehensive audit logging',
      auditChanges: changeSet.length,
      graphUpdated: !!graphUpdateResult,
      internalUpdated: !!internalFields
    });

  } catch (error) {
    logger.error('Error in unified audit update:', error);
    res.status(500).json({ error: 'Failed to update event with audit logging' });
  }
});

/**
 * Upload file attachment to an event
 */
app.post('/api/events/:eventId/attachments', verifyToken, attachmentUpload.single('file'), async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.userId;
    const file = req.file;
    const { description = '' } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    logger.debug(`Uploading attachment for event ${eventId}`, {
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      userId
    });

    // Verify event exists and user has permission
    const event = await unifiedEventsCollection.findOne({
      userId: userId,
      eventId: eventId
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found or access denied' });
    }

    // Create a readable stream from the buffer
    const uploadStream = filesBucket.openUploadStream(file.originalname, {
      metadata: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        uploadedBy: userId,
        uploadedAt: new Date(),
        eventId: eventId
      }
    });

    // Store file in GridFS
    const fileId = await new Promise((resolve, reject) => {
      uploadStream.end(file.buffer, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve(uploadStream.id);
        }
      });
    });

    // Create attachment record
    const attachmentRecord = {
      eventId: eventId,
      gridfsFileId: fileId,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: userId,
      uploadedAt: new Date(),
      description: description
    };

    const insertResult = await eventAttachmentsCollection.insertOne(attachmentRecord);

    // Log audit entry for file upload
    await logEventAudit({
      eventId: eventId,
      userId: userId,
      changeType: 'update',
      source: 'File Attachment',
      changeSet: [{
        field: 'attachments',
        oldValue: null,
        newValue: `Added file: ${file.originalname} (${Math.round(file.size / 1024)}KB)`
      }],
      metadata: {
        userAgent: req.headers['user-agent'] || 'Unknown',
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
        reason: 'File attachment uploaded',
        fileName: file.originalname,
        fileSize: file.size
      }
    });

    logger.debug(`File uploaded successfully for event ${eventId}`, {
      fileId: fileId,
      attachmentId: insertResult.insertedId
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      attachment: {
        id: insertResult.insertedId,
        fileId: fileId,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedAt: attachmentRecord.uploadedAt,
        description: description,
        downloadUrl: `/files/${fileId}`
      }
    });

  } catch (error) {
    logger.error('Error uploading file attachment:', error);
    res.status(500).json({ error: 'Failed to upload file attachment' });
  }
});

/**
 * Get all attachments for an event
 */
app.get('/api/events/:eventId/attachments', verifyToken, async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.userId;

    logger.debug(`Fetching attachments for event ${eventId}`, { userId });

    // Verify event exists and user has permission
    const event = await unifiedEventsCollection.findOne({
      userId: userId,
      eventId: eventId
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found or access denied' });
    }

    // Get all attachments for this event
    const attachments = await eventAttachmentsCollection.find({
      eventId: eventId
    }).sort({ uploadedAt: -1 }).toArray();

    // Transform attachment data for frontend
    const attachmentList = attachments.map(attachment => ({
      id: attachment._id,
      fileId: attachment.gridfsFileId,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      uploadedBy: attachment.uploadedBy,
      uploadedAt: attachment.uploadedAt,
      description: attachment.description,
      downloadUrl: `/files/${attachment.gridfsFileId}`
    }));

    logger.debug(`Found ${attachmentList.length} attachments for event ${eventId}`);

    res.status(200).json({
      eventId: eventId,
      attachments: attachmentList,
      totalCount: attachmentList.length
    });

  } catch (error) {
    logger.error('Error fetching event attachments:', error);
    res.status(500).json({ error: 'Failed to fetch event attachments' });
  }
});

/**
 * Delete an event attachment
 */
app.delete('/api/events/:eventId/attachments/:attachmentId', verifyToken, async (req, res) => {
  try {
    const { eventId, attachmentId } = req.params;
    const userId = req.user.userId;

    logger.debug(`Deleting attachment ${attachmentId} for event ${eventId}`, { userId });

    // Verify event exists and user has permission
    const event = await unifiedEventsCollection.findOne({
      userId: userId,
      eventId: eventId
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found or access denied' });
    }

    // Find the attachment
    const attachment = await eventAttachmentsCollection.findOne({
      _id: new ObjectId(attachmentId),
      eventId: eventId
    });

    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // Delete the file from GridFS
    try {
      await filesBucket.delete(attachment.gridfsFileId);
    } catch (error) {
      logger.warn('Failed to delete file from GridFS (may not exist):', error);
    }

    // Delete the attachment record
    await eventAttachmentsCollection.deleteOne({
      _id: new ObjectId(attachmentId)
    });

    // Log audit entry for file deletion
    await logEventAudit({
      eventId: eventId,
      userId: userId,
      changeType: 'update',
      source: 'File Attachment',
      changeSet: [{
        field: 'attachments',
        oldValue: `File: ${attachment.fileName}`,
        newValue: null
      }],
      metadata: {
        userAgent: req.headers['user-agent'] || 'Unknown',
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
        reason: 'File attachment deleted',
        fileName: attachment.fileName
      }
    });

    logger.debug(`Attachment ${attachmentId} deleted successfully`);

    res.status(200).json({
      message: 'Attachment deleted successfully',
      attachmentId: attachmentId
    });

  } catch (error) {
    logger.error('Error deleting event attachment:', error);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

/**
 * Download a file by its GridFS fileId
 * Supports both event and reservation attachments
 */
app.get('/api/files/:fileId', verifyToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.userId;

    logger.debug(`Downloading file ${fileId}`, { userId });

    // Convert string to ObjectId
    let objectId;
    try {
      objectId = new ObjectId(fileId);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid file ID format' });
    }

    // Check if attachment exists in event attachments
    let attachment = await eventAttachmentsCollection.findOne({
      gridfsFileId: objectId
    });

    let hasPermission = false;

    if (attachment) {
      // Verify user has access to the event
      const event = await unifiedEventsCollection.findOne({
        userId: userId,
        eventId: attachment.eventId
      });
      hasPermission = !!event;
    } else {
      // Check if attachment exists in reservation attachments
      attachment = await reservationAttachmentsCollection.findOne({
        gridfsFileId: objectId
      });

      if (attachment) {
        // Verify user has access to the reservation
        const reservation = await roomReservationsCollection.findOne({
          _id: new ObjectId(attachment.reservationId)
        });

        if (reservation) {
          // Check if user is admin or requester
          const user = await usersCollection.findOne({ email: userId });
          const isAdmin = user && (user.role === 'admin' || user.role === 'superadmin');
          const isRequester = reservation.requesterEmail === userId;
          hasPermission = isAdmin || isRequester;
        }
      }
    }

    if (!attachment) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (!hasPermission) {
      return res.status(403).json({ error: 'Access denied - you do not have permission to download this file' });
    }

    // Stream file from GridFS
    const downloadStream = filesBucket.openDownloadStream(objectId);

    // Handle stream errors
    downloadStream.on('error', (error) => {
      logger.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(404).json({ error: 'File not found in storage' });
      }
    });

    // Set appropriate headers
    res.set({
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${attachment.fileName}"`,
      'Cache-Control': 'private, max-age=3600' // Cache for 1 hour
    });

    // Stream the file to response
    downloadStream.pipe(res);

    logger.debug(`File ${fileId} streamed successfully to user ${userId}`);

  } catch (error) {
    logger.error('Error downloading file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download file' });
    }
  }
});

// ========================================
// RESERVATION ATTACHMENTS ENDPOINTS
// ========================================

/**
 * Upload file attachment to a reservation
 */
app.post('/api/reservations/:reservationId/attachments', verifyToken, attachmentUpload.single('file'), async (req, res) => {
  try {
    const { reservationId } = req.params;
    const userId = req.user.userId;
    const file = req.file;
    const { description = '' } = req.body;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    logger.debug(`Uploading attachment for reservation ${reservationId}`, {
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      userId
    });

    // Verify reservation exists and user has permission (admin or owner)
    const reservation = await roomReservationsCollection.findOne({
      _id: new ObjectId(reservationId)
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Check if user has permission (admin or is the requester)
    const user = await usersCollection.findOne({ email: userId });
    const isAdmin = user && (user.role === 'admin' || user.role === 'superadmin');
    const isRequester = reservation.requesterEmail === userId;

    if (!isAdmin && !isRequester) {
      return res.status(403).json({ error: 'Access denied - you do not have permission to upload attachments to this reservation' });
    }

    // Create a readable stream from the buffer
    const uploadStream = filesBucket.openUploadStream(file.originalname, {
      metadata: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        uploadedBy: userId,
        uploadedAt: new Date(),
        reservationId: reservationId,
        resourceType: 'reservation'
      }
    });

    // Store file in GridFS
    const fileId = await new Promise((resolve, reject) => {
      uploadStream.end(file.buffer, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve(uploadStream.id);
        }
      });
    });

    // Create attachment record
    const attachmentRecord = {
      reservationId: reservationId,
      gridfsFileId: fileId,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: userId,
      uploadedAt: new Date(),
      description: description
    };

    const insertResult = await reservationAttachmentsCollection.insertOne(attachmentRecord);

    // Log audit entry for file upload
    await logReservationAudit({
      reservationId: new ObjectId(reservationId),
      userId: userId,
      changeType: 'update',
      source: 'File Attachment',
      changeSet: [{
        field: 'attachments',
        oldValue: null,
        newValue: `Added file: ${file.originalname} (${Math.round(file.size / 1024)}KB)`
      }],
      metadata: {
        userAgent: req.headers['user-agent'] || 'Unknown',
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
        reason: 'File attachment uploaded',
        fileName: file.originalname,
        fileSize: file.size
      }
    });

    logger.debug(`File uploaded successfully for reservation ${reservationId}`, {
      fileId: fileId,
      attachmentId: insertResult.insertedId
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      attachment: {
        id: insertResult.insertedId,
        fileId: fileId,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        uploadedAt: attachmentRecord.uploadedAt,
        description: description,
        downloadUrl: `/files/${fileId}`
      }
    });

  } catch (error) {
    logger.error('Error uploading reservation attachment:', error);
    res.status(500).json({ error: 'Failed to upload file attachment' });
  }
});

/**
 * Get all attachments for a reservation
 */
app.get('/api/reservations/:reservationId/attachments', verifyToken, async (req, res) => {
  try {
    const { reservationId } = req.params;
    const userId = req.user.userId;

    logger.debug(`Fetching attachments for reservation ${reservationId}`, { userId });

    // Verify reservation exists and user has permission
    const reservation = await roomReservationsCollection.findOne({
      _id: new ObjectId(reservationId)
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Check if user has permission (admin or is the requester)
    const user = await usersCollection.findOne({ email: userId });
    const isAdmin = user && (user.role === 'admin' || user.role === 'superadmin');
    const isRequester = reservation.requesterEmail === userId;

    if (!isAdmin && !isRequester) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get all attachments for this reservation
    const attachments = await reservationAttachmentsCollection.find({
      reservationId: reservationId
    }).sort({ uploadedAt: -1 }).toArray();

    // Transform attachment data for frontend
    const attachmentList = attachments.map(attachment => ({
      id: attachment._id,
      fileId: attachment.gridfsFileId,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      uploadedBy: attachment.uploadedBy,
      uploadedAt: attachment.uploadedAt,
      description: attachment.description,
      downloadUrl: `/files/${attachment.gridfsFileId}`
    }));

    logger.debug(`Found ${attachmentList.length} attachments for reservation ${reservationId}`);

    res.status(200).json({
      reservationId: reservationId,
      attachments: attachmentList,
      totalCount: attachmentList.length
    });

  } catch (error) {
    logger.error('Error fetching reservation attachments:', error);
    res.status(500).json({ error: 'Failed to fetch reservation attachments' });
  }
});

/**
 * Delete a reservation attachment
 */
app.delete('/api/reservations/:reservationId/attachments/:attachmentId', verifyToken, async (req, res) => {
  try {
    const { reservationId, attachmentId } = req.params;
    const userId = req.user.userId;

    logger.debug(`Deleting attachment ${attachmentId} for reservation ${reservationId}`, { userId });

    // Verify reservation exists and user has permission
    const reservation = await roomReservationsCollection.findOne({
      _id: new ObjectId(reservationId)
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Check if user has permission (admin or is the requester)
    const user = await usersCollection.findOne({ email: userId });
    const isAdmin = user && (user.role === 'admin' || user.role === 'superadmin');
    const isRequester = reservation.requesterEmail === userId;

    if (!isAdmin && !isRequester) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Find the attachment
    const attachment = await reservationAttachmentsCollection.findOne({
      _id: new ObjectId(attachmentId),
      reservationId: reservationId
    });

    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // Delete the file from GridFS
    try {
      await filesBucket.delete(attachment.gridfsFileId);
    } catch (error) {
      logger.warn('Failed to delete file from GridFS (may not exist):', error);
    }

    // Delete the attachment record
    await reservationAttachmentsCollection.deleteOne({
      _id: new ObjectId(attachmentId)
    });

    // Log audit entry for file deletion
    await logReservationAudit({
      reservationId: new ObjectId(reservationId),
      userId: userId,
      changeType: 'update',
      source: 'File Attachment',
      changeSet: [{
        field: 'attachments',
        oldValue: `File: ${attachment.fileName}`,
        newValue: null
      }],
      metadata: {
        userAgent: req.headers['user-agent'] || 'Unknown',
        ipAddress: req.ip || req.connection.remoteAddress || 'Unknown',
        reason: 'File attachment deleted',
        fileName: attachment.fileName
      }
    });

    logger.debug(`Attachment ${attachmentId} deleted successfully`);

    res.status(200).json({
      message: 'Attachment deleted successfully',
      attachmentId: attachmentId
    });

  } catch (error) {
    logger.error('Error deleting reservation attachment:', error);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

/**
 * Get sync statistics
 */
app.get('/api/events/sync-stats', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get unified events stats
    const totalEvents = await unifiedEventsCollection.countDocuments({ userId: userId });
    const deletedEvents = await unifiedEventsCollection.countDocuments({ 
      userId: userId, 
      isDeleted: true 
    });
    const activeEvents = totalEvents - deletedEvents;
    
    // Get delta token stats
    const deltaTokens = await calendarDeltasCollection.find({ userId: userId }).toArray();
    
    // Get last sync times
    const recentSyncs = await unifiedEventsCollection.aggregate([
      { $match: { userId: userId } },
      { $group: { 
        _id: "$calendarId", 
        lastSync: { $max: "$lastSyncedAt" },
        eventCount: { $sum: 1 }
      }},
      { $sort: { lastSync: -1 } }
    ]).toArray();
    
    res.status(200).json({
      totalEvents: totalEvents,
      activeEvents: activeEvents,
      deletedEvents: deletedEvents,
      deltaTokens: deltaTokens.map(dt => ({
        calendarId: dt.calendarId,
        lastDeltaSync: dt.lastDeltaSync,
        fullSyncRequired: dt.fullSyncRequired
      })),
      recentSyncs: recentSyncs
    });
    
  } catch (error) {
    logger.error('Error getting sync stats:', error);
    res.status(500).json({ error: 'Failed to get sync stats' });
  }
});

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
    // Get the user's Graph token from custom headers
    const graphToken = req.headers['x-graph-token'] || req.headers['graph-token'];
    
    if (!graphToken) {
      return res.status(200).json({
        events: [],
        source: 'cache_miss',
        message: 'Cache miss - Graph token required for fallback',
        needsGraphApi: true
      });
    }
    
    try {
      // Fetch events from Graph API using calendarView (auto-expands recurring series)
      const calendarPath = calendarId ?
        `/me/calendars/${calendarId}/calendarView` :
        '/me/calendar/calendarView';

      const graphUrl = `https://graph.microsoft.com/v1.0${calendarPath}?` +
        `startDateTime=${encodeURIComponent(startDate.toISOString())}&` +
        `endDateTime=${encodeURIComponent(endDate.toISOString())}&` +
        `$select=id,subject,start,end,location,organizer,body,categories,importance,showAs,sensitivity,isAllDay,recurrence,responseStatus,attendees,extensions,singleValueExtendedProperties&` +
        `$expand=extensions&` +
        `$top=1000`;
      
      const graphResponse = await fetch(graphUrl, {
        headers: {
          Authorization: `Bearer ${graphToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!graphResponse.ok) {
        throw new Error(`Graph API failed: ${graphResponse.status} ${graphResponse.statusText}`);
      }
      
      // Safely parse response to handle empty or invalid JSON
      let graphData;
      try {
        const responseText = await graphResponse.text();
        if (!responseText) {
          logger.warn('Graph API returned empty response');
          graphData = { value: [] };
        } else {
          graphData = JSON.parse(responseText);
        }
      } catch (parseError) {
        logger.error('Failed to parse Graph API response:', parseError);
        graphData = { value: [] };
      }
      
      const events = graphData.value || [];
      
      logger.log(`Fetched ${events.length} events from Graph API for cache miss`);
      
      // Cache the fetched events asynchronously (fire-and-forget)
      setTimeout(async () => {
        try {
          for (const event of events) {
            await cacheEvent(userId, calendarId, {
              ...event,
              calendarId: calendarId // Ensure calendarId is set
            });
          }
          logger.debug(`Cached ${events.length} events after Graph API fetch`);
        } catch (cacheError) {
          logger.warn('Failed to cache events after Graph API fetch:', cacheError);
        }
      }, 100); // Small delay to avoid blocking the response
      
      // Return the events with metadata indicating they came from Graph API
      const responseEvents = events.map(event => ({
        ...event,
        calendarId: calendarId,
        _cached: false,
        _source: 'graph'
      }));
      
      return res.status(200).json({
        events: responseEvents,
        source: 'graph_fallback',
        message: 'Cache miss - fetched from Graph API',
        count: responseEvents.length
      });
      
    } catch (graphError) {
      logger.error('Graph API fallback failed:', graphError);
      return res.status(500).json({
        error: 'Failed to fetch events from Graph API',
        details: graphError.message
      });
    }
    
  } catch (error) {
    logger.error('Error in cache-first loading:', error);
    res.status(500).json({ error: 'Failed to load events' });
  }
});

/**
 * Legacy cache statistics endpoint - REMOVED
 * Now reports unified events collection statistics instead
 */
app.get('/api/events/cache-stats', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Use unified events collection for stats
    const totalEvents = await unifiedEventsCollection.countDocuments({ userId: userId });
    const deletedEvents = await unifiedEventsCollection.countDocuments({
      userId: userId,
      isDeleted: true
    });

    res.status(200).json({
      userId: userId,
      totalEvents: totalEvents,
      activeEvents: totalEvents - deletedEvents,
      deletedEvents: deletedEvents,
      message: 'Cache system migrated to unified events collection',
      collection: 'unifiedEventsCollection'
    });
  } catch (error) {
    logger.error('Error getting unified events stats:', error);
    res.status(500).json({ error: 'Failed to get event statistics' });
  }
});

/**
 * Legacy cache invalidate endpoint - REMOVED
 * Cache invalidation is no longer needed with unified events collection
 */
app.post('/api/events/cache-invalidate', verifyToken, async (req, res) => {
  res.status(410).json({
    error: 'Cache invalidation endpoint no longer available',
    message: 'Events are now managed through the unified events collection which does not require cache invalidation'
  });
});

/**
 * Legacy cache clean-duplicates admin endpoint - REMOVED
 * Duplicate handling is now managed in the unified events collection
 */
app.post('/api/admin/cache/clean-duplicates', verifyToken, async (req, res) => {
  res.status(410).json({
    error: 'Cache cleanup endpoint no longer available',
    message: 'Duplicate handling is now managed through the unified events collection'
  });
});

/**
 * Legacy cache events endpoint - REMOVED
 * This endpoint has been disabled as part of cache system migration to unified events collection
 */
app.post('/api/events/cache', verifyToken, async (req, res) => {
  res.status(410).json({
    error: 'Cache endpoint no longer available',
    message: 'Event caching is now handled automatically through the unified events system'
  });
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
    // eventCacheCollection removed - return empty array to indicate no cache
    const cachedEventIds = [];
    
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
// UNIFIED EVENTS ADMIN ENDPOINTS
// ============================================

/**
 * Admin endpoint - Get simple counts for unified events
 * Cosmos DB compatible - uses simple count queries
 */
app.get('/api/admin/unified/counts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Check if collections are initialized
    if (!unifiedEventsCollection) {
      logger.error('Collections not initialized in unified counts');
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    // Get simple counts using count queries (Cosmos DB compatible)
    const [total, deleted, enrichedResult] = await Promise.all([
      // Total events
      unifiedEventsCollection.countDocuments({ userId: userId }),
      
      // Deleted events
      unifiedEventsCollection.countDocuments({ 
        userId: userId, 
        isDeleted: true 
      }),
      
      // Enriched events - using find with limit to check if any exist
      unifiedEventsCollection.findOne({
        userId: userId,
        isDeleted: { $ne: true },
        "internalData.mecCategories.0": { $exists: true }
      })
    ]);
    
    // Calculate enriched count more simply
    let enrichedCount = 0;
    if (enrichedResult) {
      // If we found one, count them properly
      enrichedCount = await unifiedEventsCollection.countDocuments({
        userId: userId,
        isDeleted: { $ne: true },
        $or: [
          { "internalData.mecCategories.0": { $exists: true } },
          { "internalData.setupMinutes": { $gt: 0 } },
          { "internalData.teardownMinutes": { $gt: 0 } }
        ]
      });
    }
    
    const active = total - deleted;
    
    res.status(200).json({
      total,
      active,
      deleted,
      enriched: enrichedCount
    });
  } catch (error) {
    logger.error('Error getting unified counts:', error);
    res.status(500).json({ error: 'Failed to get counts' });
  }
});

/**
 * Admin endpoint - Get delta tokens
 * Simple query, no aggregation needed
 */
app.get('/api/admin/unified/delta-tokens', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    if (!calendarDeltasCollection) {
      logger.error('Delta collection not initialized');
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    // Simple find query
    const tokens = await calendarDeltasCollection.find({ 
      userId: userId 
    }).toArray();
    
    // Format response
    const formattedTokens = tokens.map(token => ({
      calendarId: token.calendarId,
      hasToken: !!token.deltaToken,
      lastSync: token.lastDeltaSync,
      fullSyncRequired: token.fullSyncRequired
    }));
    
    res.status(200).json({
      tokens: formattedTokens
    });
  } catch (error) {
    logger.error('Error getting delta tokens:', error);
    res.status(500).json({ error: 'Failed to get delta tokens' });
  }
});

/**
 * Admin endpoint - Get calendar configuration settings
 * Returns the default calendar and list of available calendars
 */
app.get('/api/admin/calendar-settings', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Load calendar-config.json to get available calendars
    const fs = require('fs');
    const path = require('path');
    const calendarConfigPath = path.join(__dirname, 'calendar-config.json');
    const calendarConfig = JSON.parse(fs.readFileSync(calendarConfigPath, 'utf8'));

    // Remove the _instructions field
    const { _instructions, ...calendars } = calendarConfig;

    // Get current default calendar setting from database
    let settings = await systemSettingsCollection.findOne({ _id: 'calendar-settings' });

    // If no settings exist, create default
    if (!settings) {
      settings = {
        _id: 'calendar-settings',
        defaultCalendar: 'templesandbox@emanuelnyc.org',
        lastModifiedBy: 'system',
        lastModifiedAt: new Date()
      };
      await systemSettingsCollection.insertOne(settings);
    }

    res.json({
      defaultCalendar: settings.defaultCalendar,
      availableCalendars: Object.keys(calendars),
      calendarIds: calendars,
      lastModifiedBy: settings.lastModifiedBy,
      lastModifiedAt: settings.lastModifiedAt
    });

  } catch (error) {
    logger.error('Error getting calendar settings:', error);
    res.status(500).json({ error: 'Failed to get calendar settings' });
  }
});

/**
 * Admin endpoint - Update calendar configuration settings
 * Updates the default calendar for room reservations
 */
app.put('/api/admin/calendar-settings', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { defaultCalendar } = req.body;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!defaultCalendar || !defaultCalendar.trim()) {
      return res.status(400).json({ error: 'defaultCalendar is required' });
    }

    // Validate that the calendar exists in calendar-config.json
    const fs = require('fs');
    const path = require('path');
    const calendarConfigPath = path.join(__dirname, 'calendar-config.json');
    const calendarConfig = JSON.parse(fs.readFileSync(calendarConfigPath, 'utf8'));

    if (!calendarConfig[defaultCalendar]) {
      return res.status(400).json({
        error: 'Invalid calendar',
        message: `Calendar "${defaultCalendar}" not found in calendar-config.json`
      });
    }

    // Update settings in database
    const updatedSettings = {
      _id: 'calendar-settings',
      defaultCalendar: defaultCalendar.trim(),
      lastModifiedBy: userEmail,
      lastModifiedAt: new Date()
    };

    await systemSettingsCollection.updateOne(
      { _id: 'calendar-settings' },
      { $set: updatedSettings },
      { upsert: true }
    );

    logger.info('Calendar settings updated:', {
      defaultCalendar: updatedSettings.defaultCalendar,
      updatedBy: userEmail
    });

    res.json({
      success: true,
      settings: updatedSettings
    });

  } catch (error) {
    logger.error('Error updating calendar settings:', error);
    res.status(500).json({ error: 'Failed to update calendar settings' });
  }
});

/**
 * Admin endpoint - Browse unified events with simple filtering
 * Cosmos DB compatible - uses find with simple queries
 */
app.get('/api/admin/unified/events', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    if (!unifiedEventsCollection) {
      logger.error('Events collection not initialized');
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    const { 
      page = 1, 
      limit = 20, 
      status = 'all',
      search = ''
    } = req.query;
    
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    
    // Build query
    let query = { userId: userId };
    
    // Debug logging
    logger.debug('Unified events query:', { userId, status, search, page: pageNum, limit: limitNum });
    
    // Status filter
    if (status === 'active') {
      query.isDeleted = { $ne: true };
    } else if (status === 'deleted') {
      query.isDeleted = true;
    } else if (status === 'enriched') {
      query.isDeleted = { $ne: true };
      query.$or = [
        { "internalData.mecCategories.0": { $exists: true } },
        { "internalData.setupMinutes": { $gt: 0 } },
        { "internalData.teardownMinutes": { $gt: 0 } }
      ];
    }
    
    // Search filter - add to database query
    if (search) {
      const searchRegex = new RegExp(search, 'i'); // case-insensitive regex
      const searchConditions = [
        { subject: searchRegex },
        { location: searchRegex },
        { 'graphData.subject': searchRegex },
        { 'graphData.location.displayName': searchRegex },
        { 'graphData.bodyPreview': searchRegex }
      ];
      
      // If there's already an $or condition (for enriched status), combine them
      if (query.$or) {
        query.$and = [
          { $or: query.$or }, // existing status filter
          { $or: searchConditions } // search filter
        ];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }
    
    // Get total count first
    const total = await unifiedEventsCollection.countDocuments(query);
    
    logger.debug('Total events found:', total, 'with query:', JSON.stringify(query));
    
    // Get events without sorting to avoid Cosmos DB index issues
    const events = await unifiedEventsCollection.find(query)
      .skip(skip)
      .limit(limitNum)
      .toArray();
    
    // Format events for response
    const formattedEvents = events.map(event => ({
      _id: event._id,
      eventId: event.eventId,
      subject: event.subject || event.graphData?.subject || 'No Subject',
      startTime: event.startTime || event.graphData?.start?.dateTime,
      location: event.location || event.graphData?.location?.displayName,
      isDeleted: event.isDeleted || false,
      hasEnrichment: !!(event.internalData && Object.keys(event.internalData).length > 0),
      internalData: event.internalData,
      sourceCalendars: event.sourceCalendars || [],
      lastSyncedAt: event.lastSyncedAt
    }));
    
    res.status(200).json({
      events: formattedEvents,
      total: total,
      page: pageNum,
      limit: limitNum
    });
  } catch (error) {
    logger.error('Error getting unified events:', error);
    res.status(500).json({ error: 'Failed to get events' });
  }
});

/**
 * Admin endpoint - Force full sync
 */
app.post('/api/admin/unified/force-sync', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { calendarId } = req.body;
    
    if (!calendarDeltasCollection) {
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    if (calendarId) {
      // Reset specific calendar
      await calendarDeltasCollection.updateOne(
        { userId: userId, calendarId: calendarId },
        { $set: { fullSyncRequired: true } }
      );
      res.status(200).json({ message: `Force sync initiated for calendar ${calendarId}` });
    } else {
      // Reset all calendars for user
      await calendarDeltasCollection.updateMany(
        { userId: userId },
        { $set: { fullSyncRequired: true } }
      );
      res.status(200).json({ message: 'Force sync initiated for all calendars' });
    }
  } catch (error) {
    logger.error('Error forcing sync:', error);
    res.status(500).json({ error: 'Failed to force sync' });
  }
});

/**
 * Admin endpoint - Clean deleted events
 */
app.post('/api/admin/unified/clean-deleted', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    if (!unifiedEventsCollection) {
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    // Delete soft-deleted events
    const result = await unifiedEventsCollection.deleteMany({
      userId: userId,
      isDeleted: true
    });
    
    res.status(200).json({ 
      message: 'Deleted events cleaned',
      removed: result.deletedCount 
    });
  } catch (error) {
    logger.error('Error cleaning deleted:', error);
    res.status(500).json({ error: 'Failed to clean deleted events' });
  }
});

// ============================================
// EVENT AUDIT HISTORY ENDPOINTS
// ============================================

/**
 * Get audit history for a specific event
 */
app.get('/api/events/:eventId/audit-history', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { eventId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    // Verify user has access to this event
    const event = await unifiedEventsCollection.findOne({
      eventId: eventId,
      userId: userId
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found or access denied' });
    }

    // Get audit history for this event
    const auditHistory = await eventAuditHistoryCollection
      .find({ eventId: eventId })
      .sort({ timestamp: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .toArray();

    // Get total count for pagination
    const totalCount = await eventAuditHistoryCollection.countDocuments({
      eventId: eventId
    });

    res.status(200).json({
      auditHistory,
      pagination: {
        total: totalCount,
        offset: parseInt(offset),
        limit: parseInt(limit),
        hasMore: totalCount > (parseInt(offset) + parseInt(limit))
      }
    });

  } catch (error) {
    logger.error('Error fetching audit history:', error);
    res.status(500).json({ error: 'Failed to fetch audit history' });
  }
});

/**
 * Get audit history for an import session
 */
app.get('/api/audit/import-session/:sessionId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { sessionId } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    // Get audit history for this import session
    const auditHistory = await eventAuditHistoryCollection
      .find({
        userId: userId,
        'metadata.importSessionId': sessionId
      })
      .sort({ timestamp: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .toArray();

    // Get total count for pagination
    const totalCount = await eventAuditHistoryCollection.countDocuments({
      userId: userId,
      'metadata.importSessionId': sessionId
    });

    // Get session summary
    const sessionSummary = await eventAuditHistoryCollection.aggregate([
      {
        $match: {
          userId: userId,
          'metadata.importSessionId': sessionId
        }
      },
      {
        $group: {
          _id: '$changeType',
          count: { $sum: 1 },
          firstTimestamp: { $min: '$timestamp' },
          lastTimestamp: { $max: '$timestamp' }
        }
      }
    ]).toArray();

    res.status(200).json({
      sessionId,
      auditHistory,
      sessionSummary,
      pagination: {
        total: totalCount,
        offset: parseInt(offset),
        limit: parseInt(limit),
        hasMore: totalCount > (parseInt(offset) + parseInt(limit))
      }
    });

  } catch (error) {
    logger.error('Error fetching import session audit:', error);
    res.status(500).json({ error: 'Failed to fetch import session audit history' });
  }
});

/**
 * Get recent audit activity for a user
 */
app.get('/api/audit/recent', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 20, changeType, source } = req.query;

    // Build query filter
    const query = { userId: userId };
    if (changeType) {
      query.changeType = changeType;
    }
    if (source) {
      query.source = { $regex: source, $options: 'i' };
    }

    // Get recent audit entries
    const auditHistory = await eventAuditHistoryCollection
      .find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .toArray();

    // Get counts by change type
    const changeTypeCounts = await eventAuditHistoryCollection.aggregate([
      { $match: { userId: userId } },
      {
        $group: {
          _id: '$changeType',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    // Get counts by source
    const sourceCounts = await eventAuditHistoryCollection.aggregate([
      { $match: { userId: userId } },
      {
        $group: {
          _id: '$source',
          count: { $sum: 1 }
        }
      }
    ]).toArray();

    res.status(200).json({
      auditHistory,
      statistics: {
        changeTypes: changeTypeCounts,
        sources: sourceCounts
      }
    });

  } catch (error) {
    logger.error('Error fetching recent audit activity:', error);
    res.status(500).json({ error: 'Failed to fetch recent audit activity' });
  }
});

/**
 * Filter events by source
 */
app.get('/api/events/by-source', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { source, startDate, endDate, limit = 100, offset = 0 } = req.query;

    if (!source) {
      return res.status(400).json({ error: 'Source parameter is required' });
    }

    // Build query filter
    const query = {
      userId: userId,
      source: { $regex: source, $options: 'i' },
      isDeleted: { $ne: true }
    };

    // Add date range filter if provided
    if (startDate || endDate) {
      query['graphData.start.dateTime'] = {};
      if (startDate) {
        query['graphData.start.dateTime'].$gte = startDate;
      }
      if (endDate) {
        query['graphData.start.dateTime'].$lte = endDate;
      }
    }

    // Get events
    const events = await unifiedEventsCollection
      .find(query)
      .sort({ 'graphData.start.dateTime': 1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .toArray();

    // Get total count
    const totalCount = await unifiedEventsCollection.countDocuments(query);

    // Transform events to frontend format
    const transformedSourceEvents = events.map(event => ({
      ...event.graphData,
      ...event.internalData,
      // Explicitly include ID fields
      eventId: event.eventId,                          // Internal unique ID (UUID)
      id: event.graphData?.id || event.eventId,       // Graph ID or fallback to eventId
      graphId: event.graphData?.id || null,           // Explicit Graph/Outlook ID
      source: event.source,
      sourceMetadata: event.sourceMetadata,
      calendarId: event.calendarId,
      sourceCalendars: event.sourceCalendars,
      _lastSyncedAt: event.lastSyncedAt
    }));

    res.status(200).json({
      events: transformedSourceEvents,
      pagination: {
        total: totalCount,
        offset: parseInt(offset),
        limit: parseInt(limit),
        hasMore: totalCount > (parseInt(offset) + parseInt(limit))
      },
      source: source
    });

  } catch (error) {
    logger.error('Error fetching events by source:', error);
    res.status(500).json({ error: 'Failed to fetch events by source' });
  }
});

// ============================================
// MIGRATION ENDPOINTS
// ============================================

// Migration sessions storage (in-memory for active sessions)
const migrationSessions = new Map();

/**
 * Determine calendar access level based on permissions
 */
function determineAccessLevel(calendarData) {
  // Full access: Can edit OR can view private items
  if (calendarData.canEdit || calendarData.canViewPrivateItems) {
    return 'full';
  }
  
  // Owner access (inferred from having share permission but not edit)
  if (calendarData.canShare && !calendarData.owner) {
    return 'owner';
  }
  
  // Limited access: Has some permissions but can't see private items
  if (!calendarData.canEdit && !calendarData.canViewPrivateItems && !calendarData.canShare) {
    return 'limited';
  }
  
  // Free/busy only: Minimal access
  return 'freeBusy';
}

/**
 * Preview migration - analyze what would be migrated
 */
app.post('/api/admin/migration/preview', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate, calendarIds, options = {}, includeEvents = false } = req.body;
    
    // Validate input
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date are required' });
    }
    
    if (!calendarIds || !Array.isArray(calendarIds) || calendarIds.length === 0) {
      return res.status(400).json({ error: 'At least one calendar must be selected' });
    }
    
    const graphToken = req.headers['x-graph-token'] || req.headers['graph-token'];
    if (!graphToken) {
      return res.status(401).json({ error: 'Graph token is required for migration' });
    }
    
    logger.debug('Migration preview requested:', { userId, startDate, endDate, calendars: calendarIds.length });
    
    // Calculate existing events in the database
    const startDateTime = new Date(startDate);
    const endDateTime = new Date(endDate);
    
    // Debug: Log the working statistics query
    const statsQuery = {
      userId: userId,
      'graphData.start.dateTime': { 
        $gte: startDateTime.toISOString(), 
        $lte: endDateTime.toISOString() 
      },
      isDeleted: { $ne: true }
    };
    logger.debug('Statistics query (working):', statsQuery);
    
    const existingEvents = await unifiedEventsCollection.countDocuments(statsQuery);
    
    // Get calendar details and estimate event counts
    const calendarDetails = [];
    let totalOutlookEvents = 0;
    
    for (const calendarId of calendarIds) {
      try {
        // Get calendar name and permission info
        const calendarPath = calendarId === 'primary' 
          ? '/me/calendar' 
          : `/me/calendars/${calendarId}`;
        
        // Request calendar with permission properties
        const calendarUrl = `https://graph.microsoft.com/v1.0${calendarPath}?` +
          `$select=id,name,owner,canEdit,canShare,canViewPrivateItems`;
        
        const calendarResponse = await fetch(calendarUrl, {
          headers: {
            'Authorization': `Bearer ${graphToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        let calendarInfo = {
          name: 'Unknown Calendar',
          canEdit: false,
          canShare: false,
          canViewPrivateItems: false,
          owner: null,
          accessLevel: 'unknown'
        };
        
        if (calendarResponse.ok) {
          const calendarData = await calendarResponse.json();
          calendarInfo = {
            name: calendarData.name || calendarId,
            canEdit: calendarData.canEdit || false,
            canShare: calendarData.canShare || false,
            canViewPrivateItems: calendarData.canViewPrivateItems || false,
            owner: calendarData.owner || null,
            accessLevel: determineAccessLevel(calendarData)
          };
        } else {
          const errorText = await calendarResponse.text();
          logger.warn(`Failed to get calendar permissions for ${calendarId}:`, {
            status: calendarResponse.status,
            error: errorText
          });
        }
        
        // Count events using calendarView (Microsoft's recommended approach for date ranges)
        const calendarViewPath = calendarId === 'primary' 
          ? '/me/calendar/calendarView' 
          : `/me/calendars/${calendarId}/calendarView`;
        
        // Use ISO 8601 format for calendarView parameters
        const startDateStr = startDateTime.toISOString();
        const endDateStr = endDateTime.toISOString();
        
        const countUrl = `https://graph.microsoft.com/v1.0${calendarViewPath}?` + 
          `startDateTime=${encodeURIComponent(startDateStr)}&` +
          `endDateTime=${encodeURIComponent(endDateStr)}&` +
          `$select=id&$top=1000`;
        
        logger.debug(`Counting events for calendar ${calendarId} using calendarView:`, countUrl);
        
        const countResponse = await fetch(countUrl, {
          headers: {
            'Authorization': `Bearer ${graphToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        let eventCount = 0;
        if (countResponse.ok) {
          const responseData = await countResponse.json();
          eventCount = responseData.value ? responseData.value.length : 0;
          logger.debug(`CalendarView count response for ${calendarId}:`, eventCount);
          
          // Check if there are more results (pagination)
          if (responseData['@odata.nextLink']) {
            logger.debug(`Calendar ${calendarId} has more than 1000 events, showing first 1000`);
          }
        } else {
          const errorText = await countResponse.text();
          logger.error(`CalendarView count failed for ${calendarId}:`, {
            url: countUrl,
            status: countResponse.status,
            statusText: countResponse.statusText,
            error: errorText,
            calendarId: calendarId
          });
          eventCount = -1; // Indicate error
        }
        
        calendarDetails.push({
          id: calendarId,
          name: calendarInfo.name,
          eventCount: eventCount,
          permissions: {
            canEdit: calendarInfo.canEdit,
            canShare: calendarInfo.canShare,
            canViewPrivateItems: calendarInfo.canViewPrivateItems,
            accessLevel: calendarInfo.accessLevel
          },
          owner: calendarInfo.owner,
          hasLimitedAccess: calendarInfo.accessLevel === 'limited' || calendarInfo.accessLevel === 'freeBusy'
        });
        
        totalOutlookEvents += eventCount;
        
      } catch (error) {
        logger.error(`Error getting info for calendar ${calendarId}:`, error);
        calendarDetails.push({
          id: calendarId,
          name: calendarId,
          eventCount: 0,
          error: error.message,
          permissions: {
            canEdit: false,
            canShare: false,
            canViewPrivateItems: false,
            accessLevel: 'unknown'
          },
          owner: null,
          hasLimitedAccess: true
        });
      }
    }
    
    // Calculate statistics
    const preview = {
      dateRange: {
        start: startDate,
        end: endDate
      },
      statistics: {
        totalInOutlook: totalOutlookEvents,
        alreadyImported: existingEvents,
        estimatedNewEvents: Math.max(0, totalOutlookEvents - existingEvents),
        estimatedDuplicates: Math.min(existingEvents, totalOutlookEvents)
      },
      calendars: calendarDetails,
      options: options
    };

    // If detailed events are requested, fetch and categorize them
    if (includeEvents) {
      logger.debug('Fetching detailed event lists for migration preview');
      
      try {
        const eventDetails = {
          alreadyImported: [],
          newEvents: []
        };

        // Debug: Log query parameters
        logger.debug('Event details query parameters:', {
          userId: userId,
          startDateTime: startDateTime.toISOString(),
          endDateTime: endDateTime.toISOString(),
          collection: unifiedEventsCollection.collectionName
        });

        // Debug: Sample a few documents to see actual structure
        const sampleDocs = await unifiedEventsCollection.find({userId: userId}).limit(3).toArray();
        logger.debug('Sample document structures:', sampleDocs.map(doc => ({
          id: doc._id,
          hasGraphData: !!doc.graphData,
          graphDataKeys: doc.graphData ? Object.keys(doc.graphData) : 'No graphData',
          startStructure: doc.graphData?.start,
          isDeleted: doc.isDeleted
        })));

        // Get existing events from database
        const existingEventsList = await unifiedEventsCollection.find({
          userId: userId,
          'graphData.start.dateTime': { 
            $gte: startDateTime.toISOString(), 
            $lte: endDateTime.toISOString() 
          },
          isDeleted: { $ne: true }
        }).toArray();

        logger.debug('Raw existing events found:', {
          count: existingEventsList.length,
          sampleEvent: existingEventsList[0] ? {
            id: existingEventsList[0]._id,
            graphId: existingEventsList[0].graphData?.id,
            subject: existingEventsList[0].graphData?.subject,
            startDateTime: existingEventsList[0].graphData?.start?.dateTime,
            hasGraphData: !!existingEventsList[0].graphData
          } : 'No events found'
        });

        // If main query returned 0 but stats showed >0, try alternative queries
        if (existingEventsList.length === 0 && existingEvents > 0) {
          logger.debug('Main query returned 0 but stats show positive count. Trying alternative queries...');
          
          // Try query without date filter first
          const allUserEvents = await unifiedEventsCollection.find({
            userId: userId,
            isDeleted: { $ne: true }
          }).limit(5).toArray();
          
          logger.debug('Alternative query - all user events sample:', {
            count: allUserEvents.length,
            samples: allUserEvents.map(event => ({
              id: event._id,
              subject: event.graphData?.subject,
              startDateTime: event.graphData?.start?.dateTime,
              startDate: event.graphData?.start?.date,
              startType: typeof event.graphData?.start?.dateTime
            }))
          });

          // Try different date field structures
          const altQuery1 = await unifiedEventsCollection.find({
            userId: userId,
            'graphData.start.date': { 
              $gte: startDate, 
              $lte: endDate 
            },
            isDeleted: { $ne: true }
          }).toArray();
          
          logger.debug('Alternative query 1 (using start.date):', { count: altQuery1.length });

          // If alt query works, use it instead
          if (altQuery1.length > 0) {
            logger.debug('Alternative query worked! Using start.date instead of start.dateTime');
            existingEventsList.length = 0; // Clear original array
            existingEventsList.push(...altQuery1); // Use alternative results
          }
        }

        // Convert existing events to the display format
        existingEventsList.forEach(event => {
          // Try multiple fields to get a meaningful title
          const subject = event.graphData.subject || 
                         event.graphData.bodyPreview?.substring(0, 50) || 
                         event.graphData.location?.displayName ||
                         event.graphData.organizer?.emailAddress?.name ||
                         `Event ${event.graphData.id?.substring(0, 8)}...` ||
                         'Untitled Event';

          eventDetails.alreadyImported.push({
            id: event.graphData.id || event._id,
            subject: subject,
            startDateTime: event.graphData.start.dateTime || event.graphData.start.date,
            endDateTime: event.graphData.end.dateTime || event.graphData.end.date,
            calendarId: event.calendarId || 'unknown',
            location: event.graphData.location?.displayName || '',
            organizer: event.graphData.organizer?.emailAddress?.name || '',
            categories: event.graphData.categories?.join(', ') || '',
            bodyPreview: event.graphData.bodyPreview?.substring(0, 100) || ''
          });
        });

        // Create a Set of existing event IDs for quick lookup
        const existingEventIds = new Set(existingEventsList.map(e => e.graphData.id));

        // Fetch sample of new events from Graph API for each calendar
        for (const calendarId of calendarIds) {
          try {
            const eventsPath = calendarId === 'primary'
              ? '/me/calendar/calendarView'
              : `/me/calendars/${calendarId}/calendarView`;

            const eventsUrl = `https://graph.microsoft.com/v1.0${eventsPath}?` +
              `startDateTime=${encodeURIComponent(startDateTime.toISOString())}&` +
              `endDateTime=${encodeURIComponent(endDateTime.toISOString())}` +
              `&$select=id,subject,start,end,location` +
              `&$top=100`; // Limit to first 100 events per calendar for preview

            const eventsResponse = await fetch(eventsUrl, {
              headers: {
                'Authorization': `Bearer ${graphToken}`,
                'Content-Type': 'application/json'
              }
            });

            if (eventsResponse.ok) {
              const eventsData = await eventsResponse.json();
              const calendarName = calendarDetails.find(c => c.id === calendarId)?.name || calendarId;
              
              eventsData.value?.forEach(event => {
                // Only include events that are NOT already imported
                if (!existingEventIds.has(event.id)) {
                  eventDetails.newEvents.push({
                    id: event.id,
                    subject: event.subject || 'No Title',
                    startDateTime: event.start.dateTime,
                    endDateTime: event.end.dateTime,
                    calendarId: calendarId,
                    calendarName: calendarName,
                    location: event.location?.displayName || ''
                  });
                }
              });
            }
          } catch (error) {
            logger.warn(`Error fetching events for calendar ${calendarId}:`, error.message);
          }
        }

        // Sort events by start date
        eventDetails.alreadyImported.sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));
        eventDetails.newEvents.sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));

        preview.eventDetails = eventDetails;
        
        // Analyze locations in events
        try {
          const locationAnalysis = await analyzeEventLocations([
            ...eventDetails.alreadyImported,
            ...eventDetails.newEvents
          ]);
          preview.locationAnalysis = locationAnalysis;
        } catch (error) {
          logger.warn('Error analyzing locations:', error);
          preview.locationAnalysisError = 'Failed to analyze event locations';
        }
        
        logger.debug(`Event details included: ${eventDetails.alreadyImported.length} existing, ${eventDetails.newEvents.length} new`);
      } catch (error) {
        logger.warn('Error fetching event details:', error);
        preview.eventDetailsError = 'Failed to fetch detailed event information';
      }
    }
    
    res.status(200).json(preview);
    
  } catch (error) {
    logger.error('Error in migration preview:', error);
    res.status(500).json({ error: 'Failed to generate migration preview' });
  }
});

/**
 * Start migration - begin importing events
 */
app.post('/api/admin/migration/start', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate, calendarIds, options = {} } = req.body;
    
    // Validate input
    if (!startDate || !endDate || !calendarIds || !calendarIds.length) {
      return res.status(400).json({ error: 'Invalid migration parameters' });
    }
    
    const graphToken = req.headers['x-graph-token'] || req.headers['graph-token'];
    if (!graphToken) {
      return res.status(401).json({ error: 'Graph token is required for migration' });
    }
    
    // Create migration session
    const sessionId = `migration_${userId}_${Date.now()}`;
    const session = {
      sessionId,
      userId,
      status: 'running',
      config: { startDate, endDate, calendarIds, options },
      progress: {
        totalEvents: 0,
        processed: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        errors: []
      },
      startedAt: new Date(),
      currentCalendar: '',
      currentEvent: ''
    };
    
    migrationSessions.set(sessionId, session);
    
    // Start migration in background
    processMigration(sessionId, userId, graphToken, startDate, endDate, calendarIds, options)
      .then(() => {
        const session = migrationSessions.get(sessionId);
        if (session) {
          session.status = 'completed';
          session.completedAt = new Date();
        }
      })
      .catch(error => {
        logger.error('Migration failed:', error);
        const session = migrationSessions.get(sessionId);
        if (session) {
          session.status = 'failed';
          session.error = error.message;
          session.completedAt = new Date();
        }
      });
    
    res.status(200).json({ 
      sessionId, 
      status: 'started',
      message: 'Migration started successfully'
    });
    
  } catch (error) {
    logger.error('Error starting migration:', error);
    res.status(500).json({ error: 'Failed to start migration' });
  }
});

/**
 * Get migration status
 */
app.get('/api/admin/migration/status/:sessionId', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = migrationSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Migration session not found' });
    }
    
    // Only return session if it belongs to the requesting user
    if (session.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    res.status(200).json({
      status: session.status,
      progress: session.progress,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      currentCalendar: session.currentCalendar,
      currentEvent: session.currentEvent,
      error: session.error
    });
    
  } catch (error) {
    logger.error('Error getting migration status:', error);
    res.status(500).json({ error: 'Failed to get migration status' });
  }
});

/**
 * Cancel migration
 */
app.post('/api/admin/migration/cancel/:sessionId', verifyToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = migrationSessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Migration session not found' });
    }
    
    if (session.userId !== req.user.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (session.status !== 'running') {
      return res.status(400).json({ error: 'Migration is not running' });
    }
    
    session.status = 'cancelled';
    session.completedAt = new Date();
    
    res.status(200).json({ 
      status: 'cancelled',
      processed: session.progress.processed
    });
    
  } catch (error) {
    logger.error('Error cancelling migration:', error);
    res.status(500).json({ error: 'Failed to cancel migration' });
  }
});

/**
 * Process migration in background
 */
async function processMigration(sessionId, userId, graphToken, startDate, endDate, calendarIds, options) {
  const session = migrationSessions.get(sessionId);
  if (!session) return;
  
  const { skipDuplicates = true, preserveEnrichments = true, forceOverwrite = false } = options;
  
  try {
    for (const calendarId of calendarIds) {
      if (session.status === 'cancelled') break;
      
      session.currentCalendar = calendarId;
      
      // Fetch events from Graph API using calendarView
      const calendarPath = calendarId === 'primary'
        ? '/me/calendar/calendarView'
        : `/me/calendars/${calendarId}/calendarView`;

      let nextLink = `https://graph.microsoft.com/v1.0${calendarPath}?` +
        `startDateTime=${encodeURIComponent(startDate)}&` +
        `endDateTime=${encodeURIComponent(endDate)}&` +
        `$top=100`;
      
      while (nextLink && session.status === 'running') {
        const response = await fetch(nextLink, {
          headers: {
            'Authorization': `Bearer ${graphToken}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error(`Graph API error: ${response.status}`);
        }
        
        const data = await response.json();
        const events = data.value || [];
        
        // Process each event
        for (const graphEvent of events) {
          if (session.status === 'cancelled') break;
          
          session.currentEvent = graphEvent.subject || 'Untitled Event';
          
          try {
            // Check for duplicates
            if (skipDuplicates && !forceOverwrite) {
              const existing = await unifiedEventsCollection.findOne({
                userId: userId,
                eventId: graphEvent.id
              });
              
              if (existing) {
                session.progress.skipped++;
                session.progress.processed++;
                continue;
              }
            }
            
            // Use existing merge function to handle the event
            const wasExisting = await unifiedEventsCollection.findOne({
              userId: userId,
              eventId: graphEvent.id
            });
            
            await mergeEventFromMultipleCalendars(
              userId,
              graphEvent.id,
              graphEvent,
              calendarId
            );
            
            if (wasExisting) {
              session.progress.updated++;
            } else {
              session.progress.created++;
            }
            
            session.progress.processed++;
            
          } catch (eventError) {
            logger.error(`Error processing event ${graphEvent.id}:`, eventError);
            session.progress.errors.push({
              eventId: graphEvent.id,
              subject: graphEvent.subject,
              error: eventError.message
            });
          }
        }
        
        // Get next page
        nextLink = data['@odata.nextLink'] || null;
      }
    }
    
  } catch (error) {
    logger.error('Migration processing error:', error);
    throw error;
  } finally {
    // Clean up session after 1 hour
    setTimeout(() => {
      migrationSessions.delete(sessionId);
    }, 3600000);
  }
}

// ============================================
// CSV IMPORT ENDPOINTS
// ============================================

/**
 * Create a TempleRegistration event from a main event
 */
function createRegistrationEventFromMain(mainEvent, userId) {
  const setupMinutes = mainEvent.internalData.setupMinutes || 0;
  const teardownMinutes = mainEvent.internalData.teardownMinutes || 0;
  
  // Calculate extended start/end times
  const mainStartTime = new Date(mainEvent.graphData.start.dateTime);
  const mainEndTime = new Date(mainEvent.graphData.end.dateTime);
  
  const registrationStartTime = new Date(mainStartTime.getTime() - (setupMinutes * 60 * 1000));
  const registrationEndTime = new Date(mainEndTime.getTime() + (teardownMinutes * 60 * 1000));
  
  // Create registration event subject
  const setupTeardownInfo = [];
  if (setupMinutes > 0) setupTeardownInfo.push(`Setup: ${setupMinutes} min`);
  if (teardownMinutes > 0) setupTeardownInfo.push(`Teardown: ${teardownMinutes} min`);
  const registrationSubject = `[SETUP/TEARDOWN] ${mainEvent.graphData.subject}${setupTeardownInfo.length > 0 ? ` (${setupTeardownInfo.join(', ')})` : ''}`;
  
  return {
    userId: userId,
    calendarId: 'csv_import_templeregistration',
    eventId: `${mainEvent.eventId}_registration`,
    
    graphData: {
      id: `${mainEvent.eventId}_registration`,
      subject: registrationSubject,
      start: {
        dateTime: registrationStartTime.toISOString(),
        timeZone: 'UTC'
      },
      end: {
        dateTime: registrationEndTime.toISOString(),
        timeZone: 'UTC'
      },
      location: mainEvent.graphData.location,
      categories: [...(mainEvent.graphData.categories || []), 'Setup/Teardown'],
      bodyPreview: mainEvent.internalData.registrationNotes || '',
      body: {
        contentType: 'text',
        content: mainEvent.internalData.registrationNotes || ''
      },
      isAllDay: false,
      importance: 'normal',
      showAs: 'busy',
      organizer: {
        emailAddress: {
          name: 'CSV Import Registration',
          address: 'csv-import-registration@system'
        }
      },
      attendees: [],
      createdDateTime: new Date().toISOString(),
      lastModifiedDateTime: new Date().toISOString(),
      type: 'singleInstance'
    },
    
    internalData: {
      mecCategories: mainEvent.internalData.mecCategories,
      setupMinutes: setupMinutes,
      teardownMinutes: teardownMinutes,
      createRegistrationEvent: false, // This IS the registration event
      registrationNotes: mainEvent.internalData.registrationNotes,
      assignedTo: mainEvent.internalData.assignedTo,
      isCSVImport: true,
      isRegistrationEvent: true,
      linkedMainEventId: mainEvent.eventId,
      rsId: mainEvent.internalData.rsId,
      importedAt: new Date().toISOString()
    },
    
    sourceCalendars: [{
      calendarId: 'csv_import_templeregistration',
      calendarName: 'CSV Import TempleRegistration',
      role: 'shared'
    }],
    
    lastSyncedAt: new Date(),
    lastAccessedAt: new Date(),
    createdAt: mainEvent.createdAt || new Date(),
    createdBy: mainEvent.createdBy || userId,
    createdByEmail: mainEvent.createdByEmail || 'csv-import@system',
    createdByName: mainEvent.createdByName || 'CSV Import',
    createdSource: mainEvent.createdSource || 'csv-import',
    isDeleted: false,
    isCSVImport: true,
    isRegistrationEvent: true
  };
}

/**
 * Admin endpoint - Upload and import CSV file
 */
app.post('/api/admin/csv-import', verifyToken, upload.single('csvFile'), async (req, res) => {
  try {
    const userId = req.user.userId;
    
    if (!unifiedEventsCollection) {
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }
    
    // Parse CSV from buffer
    const csvData = [];
    const csvHeaders = [];
    let headersParsed = false;
    
    // Create readable stream from buffer
    const stream = Readable.from(req.file.buffer.toString());
    
    // Parse CSV
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('headers', (headers) => {
          csvHeaders.push(...headers);
          headersParsed = true;
        })
        .on('data', (row) => {
          csvData.push(row);
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    logger.debug('CSV parsed:', { headerCount: csvHeaders.length, rowCount: csvData.length });
    logger.debug('CSV headers:', csvHeaders);
    
    // Check for rsId column specifically
    const rsIdHeaders = csvHeaders.filter(h => h.toLowerCase().includes('rsid') || h.toLowerCase().includes('rs_id') || h.toLowerCase().includes('resourceschedule'));
    logger.debug('Potential rsId headers found:', rsIdHeaders);
    
    // Validate CSV headers
    const validation = csvUtils.validateCSVHeaders(csvHeaders);
    if (!validation.isValid) {
      return res.status(400).json({ 
        error: 'Invalid CSV format',
        missing: validation.missing,
        missingRecommended: validation.missingRecommended,
        headers: validation.headers
      });
    }
    
    // Transform CSV rows to unified events
    const unifiedEvents = [];
    const errors = [];
    
    for (let i = 0; i < csvData.length; i++) {
      try {
        const row = csvData[i];
        
        // DEBUG: Log processing of each row
        logger.debug(`Processing CSV row ${i + 1}:`, {
          subject: row.Subject,
          rsId: row.rsId,
          rsIdType: typeof row.rsId
        });
        
        const unifiedEvent = csvUtils.csvRowToUnifiedEvent(row, userId);
        
        // DEBUG: Log transformed event rsId
        logger.debug(`Transformed event ${i + 1}:`, {
          eventId: unifiedEvent.eventId,
          rsId: unifiedEvent.internalData.rsId,
          rsIdType: typeof unifiedEvent.internalData.rsId
        });
        
        unifiedEvents.push(unifiedEvent);
      } catch (error) {
        errors.push({
          row: i + 1,
          data: csvData[i],
          error: error.message
        });
      }
    }
    
    logger.debug('Events transformed:', { 
      successful: unifiedEvents.length, 
      errors: errors.length 
    });
    
    // If there are errors and no successful transformations, return error
    if (unifiedEvents.length === 0 && errors.length > 0) {
      return res.status(400).json({
        error: 'Failed to parse any events from CSV',
        errors: errors.slice(0, 10), // Limit error details
        totalErrors: errors.length
      });
    }
    
    // Insert events into database (with TempleRegistration support)
    let insertedCount = 0;
    let duplicateCount = 0;
    let registrationEventsCreated = 0;
    const insertErrors = [];
    
    if (unifiedEvents.length > 0) {
      try {
        // Check for existing events (by eventId)
        const existingEventIds = await unifiedEventsCollection.find(
          { 
            userId: userId,
            eventId: { $in: unifiedEvents.map(e => e.eventId) }
          },
          { projection: { eventId: 1 } }
        ).toArray();
        
        const existingIds = new Set(existingEventIds.map(e => e.eventId));
        
        // Filter out duplicates
        const newEvents = unifiedEvents.filter(event => !existingIds.has(event.eventId));
        duplicateCount = unifiedEvents.length - newEvents.length;
        
        // Prepare events for insertion (main events + registration events)
        const allEventsToInsert = [];
        
        for (const event of newEvents) {
          // DEBUG: Log event before insertion
          logger.debug(`Preparing event for insertion:`, {
            eventId: event.eventId,
            subject: event.graphData.subject,
            rsId: event.internalData.rsId,
            rsIdType: typeof event.internalData.rsId,
            createRegistrationEvent: event.internalData.createRegistrationEvent
          });
          
          // Add main event
          allEventsToInsert.push(event);
          
          // Create TempleRegistration event if setup/teardown is enabled
          if (event.internalData.createRegistrationEvent) {
            const registrationEvent = createRegistrationEventFromMain(event, userId);
            
            // DEBUG: Log registration event rsId
            logger.debug(`Registration event created:`, {
              eventId: registrationEvent.eventId,
              rsId: registrationEvent.internalData.rsId,
              rsIdType: typeof registrationEvent.internalData.rsId
            });
            
            allEventsToInsert.push(registrationEvent);
            registrationEventsCreated++;
          }
        }
        
        if (allEventsToInsert.length > 0) {
          // DEBUG: Log sample event before insertion
          logger.debug('Sample event being inserted:', {
            eventId: allEventsToInsert[0].eventId,
            rsId: allEventsToInsert[0].internalData.rsId,
            internalDataKeys: Object.keys(allEventsToInsert[0].internalData)
          });
          
          const result = await unifiedEventsCollection.insertMany(allEventsToInsert, { ordered: false });
          insertedCount = result.insertedCount;
          
          // DEBUG: Verify insertion by querying one event back
          const sampleEventId = allEventsToInsert[0].eventId;
          const insertedEvent = await unifiedEventsCollection.findOne({
            userId: userId,
            eventId: sampleEventId
          });
          
          logger.debug('Sample event after insertion:', {
            eventId: insertedEvent?.eventId,
            rsId: insertedEvent?.internalData?.rsId,
            rsIdType: typeof insertedEvent?.internalData?.rsId,
            internalDataKeys: insertedEvent?.internalData ? Object.keys(insertedEvent.internalData) : null
          });
        }
        
      } catch (insertError) {
        logger.error('Error inserting events:', insertError);
        insertErrors.push(insertError.message);
      }
    }
    
    // Return import summary
    res.status(200).json({
      success: true,
      summary: {
        totalRows: csvData.length,
        successfulTransforms: unifiedEvents.length,
        transformErrors: errors.length,
        inserted: insertedCount,
        duplicates: duplicateCount,
        registrationEventsCreated: registrationEventsCreated,
        insertErrors: insertErrors.length
      },
      errors: errors.slice(0, 5), // Include first 5 transform errors
      insertErrors: insertErrors.slice(0, 5) // Include first 5 insert errors
    });
    
  } catch (error) {
    logger.error('Error in CSV import:', error);
    res.status(500).json({ error: 'Failed to process CSV import' });
  }
});

/**
 * Admin endpoint - Clear all CSV imported events
 */
app.post('/api/admin/csv-import/clear', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    if (!unifiedEventsCollection) {
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    // Delete all CSV imported events for this user (including registration events)
    const result = await unifiedEventsCollection.deleteMany({
      userId: userId,
      isCSVImport: true
    });
    
    res.status(200).json({
      success: true,
      message: 'CSV imported events cleared',
      deletedCount: result.deletedCount
    });
    
  } catch (error) {
    logger.error('Error clearing CSV imports:', error);
    res.status(500).json({ error: 'Failed to clear CSV imports' });
  }
});

/**
 * Admin endpoint - Get CSV import statistics
 */
app.get('/api/admin/csv-import/stats', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    if (!unifiedEventsCollection) {
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    // Get statistics about CSV imported events
    const stats = await unifiedEventsCollection.aggregate([
      { $match: { userId: userId, isCSVImport: true } },
      {
        $group: {
          _id: null,
          totalEvents: { $sum: 1 },
          activeEvents: { $sum: { $cond: [{ $ne: ['$isDeleted', true] }, 1, 0] } },
          deletedEvents: { $sum: { $cond: ['$isDeleted', 1, 0] } },
          oldestImport: { $min: '$internalData.importedAt' },
          newestImport: { $max: '$internalData.importedAt' }
        }
      }
    ]).toArray();
    
    const result = stats.length > 0 ? stats[0] : {
      totalEvents: 0,
      activeEvents: 0,
      deletedEvents: 0,
      oldestImport: null,
      newestImport: null
    };
    
    res.status(200).json(result);
    
  } catch (error) {
    logger.error('Error getting CSV import stats:', error);
    res.status(500).json({ error: 'Failed to get CSV import statistics' });
  }
});

/**
 * Admin endpoint - Stream CSV clear with Server-Sent Events for large datasets
 */
app.post('/api/admin/csv-import/clear-stream', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    if (!unifiedEventsCollection || !db) {
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    // Set headers for Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    // Send initial status
    res.write('data: ' + JSON.stringify({
      type: 'start',
      message: 'Starting comprehensive CSV clear operation...',
      timestamp: new Date().toISOString()
    }) + '\n\n');
    
    // Configuration for chunked deletion
    const BATCH_SIZE = 100; // Increased for better performance
    let totalDeleted = {
      unifiedEvents: 0,
      registrationEvents: 0,
      cacheEvents: 0,
      total: 0
    };
    const startTime = Date.now();
    
    try {
      // Count events across all collections
      const counts = {
        unifiedEvents: await unifiedEventsCollection.countDocuments({
          userId: userId,
          isCSVImport: true
        }),
        registrationEvents: await unifiedEventsCollection.countDocuments({
          userId: userId,
          calendarId: 'csv_import_templeregistration'
        }),
        // internalEvents removed - using unifiedEvents instead
        cacheEvents: 0 // Will be counted if cache collection exists
      };
      
      // Get event IDs for internal events count
      const csvEventIds = await unifiedEventsCollection.distinct('eventId', {
        userId: userId,
        isCSVImport: true
      });
      
      // internalEventsCollection removed - no longer needed
      // eventCacheCollection removed - no longer needed
      counts.cacheEvents = 0; // Legacy cache collection no longer exists

      counts.total = counts.unifiedEvents + counts.registrationEvents + counts.cacheEvents;
      
      res.write('data: ' + JSON.stringify({
        type: 'count',
        message: `Found ${counts.total} CSV-related records to delete across all collections`,
        counts: counts,
        totalCount: counts.total,
        timestamp: new Date().toISOString()
      }) + '\n\n');
      
      if (counts.total === 0) {
        res.write('data: ' + JSON.stringify({
          type: 'complete',
          message: 'No CSV events found to delete',
          totalDeleted: totalDeleted,
          timestamp: new Date().toISOString()
        }) + '\n\n');
        res.end();
        return;
      }
      
      let processedTotal = 0;
      const errors = [];
      
      // 1. Delete main CSV imported events
      if (counts.unifiedEvents > 0) {
        res.write('data: ' + JSON.stringify({
          type: 'collection_start',
          collection: 'unifiedEvents',
          message: `Deleting ${counts.unifiedEvents} main CSV events...`,
          timestamp: new Date().toISOString()
        }) + '\n\n');
        
        let processed = 0;
        while (processed < counts.unifiedEvents) {
          try {
            const batchEvents = await unifiedEventsCollection.find(
              { userId: userId, isCSVImport: true },
              { projection: { _id: 1, eventId: 1 } }
            ).limit(BATCH_SIZE).toArray();
            
            if (batchEvents.length === 0) break;
            
            const batchIds = batchEvents.map(event => event._id);
            const deleteResult = await unifiedEventsCollection.deleteMany({
              _id: { $in: batchIds }
            });
            
            totalDeleted.unifiedEvents += deleteResult.deletedCount;
            totalDeleted.total += deleteResult.deletedCount;
            processed += batchEvents.length;
            processedTotal += batchEvents.length;
            
            const progress = Math.round((processedTotal / counts.total) * 100);
            res.write('data: ' + JSON.stringify({
              type: 'progress',
              collection: 'unifiedEvents',
              message: `Deleted ${deleteResult.deletedCount} main events`,
              processed: processedTotal,
              totalCount: counts.total,
              progress: progress,
              deleted: totalDeleted,
              timestamp: new Date().toISOString()
            }) + '\n\n');
            
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (error) {
            errors.push({ collection: 'unifiedEvents', error: error.message });
            logger.error('Error deleting unified events batch:', error);
          }
        }
      }
      
      // 2. Delete registration events
      if (counts.registrationEvents > 0) {
        res.write('data: ' + JSON.stringify({
          type: 'collection_start',
          collection: 'registrationEvents',
          message: `Deleting ${counts.registrationEvents} registration events...`,
          timestamp: new Date().toISOString()
        }) + '\n\n');
        
        let processed = 0;
        while (processed < counts.registrationEvents) {
          try {
            const batchEvents = await unifiedEventsCollection.find(
              { userId: userId, calendarId: 'csv_import_templeregistration' },
              { projection: { _id: 1 } }
            ).limit(BATCH_SIZE).toArray();
            
            if (batchEvents.length === 0) break;
            
            const batchIds = batchEvents.map(event => event._id);
            const deleteResult = await unifiedEventsCollection.deleteMany({
              _id: { $in: batchIds }
            });
            
            totalDeleted.registrationEvents += deleteResult.deletedCount;
            totalDeleted.total += deleteResult.deletedCount;
            processed += batchEvents.length;
            processedTotal += batchEvents.length;
            
            const progress = Math.round((processedTotal / counts.total) * 100);
            res.write('data: ' + JSON.stringify({
              type: 'progress',
              collection: 'registrationEvents',
              message: `Deleted ${deleteResult.deletedCount} registration events`,
              processed: processedTotal,
              totalCount: counts.total,
              progress: progress,
              deleted: totalDeleted,
              timestamp: new Date().toISOString()
            }) + '\n\n');
            
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (error) {
            errors.push({ collection: 'registrationEvents', error: error.message });
            logger.error('Error deleting registration events batch:', error);
          }
        }
      }
      
      // Internal events collection removed - using unifiedEvents instead
      
      // 4. Delete cache entries
      if (counts.cacheEvents > 0 && csvEventIds.length > 0) {
        res.write('data: ' + JSON.stringify({
          type: 'collection_start',
          collection: 'cacheEvents',
          message: `Deleting ${counts.cacheEvents} cache entries...`,
          timestamp: new Date().toISOString()
        }) + '\n\n');
        
        try {
          // eventCacheCollection removed - no longer exists
          const deleteResult = { deletedCount: 0 };

          totalDeleted.cacheEvents += deleteResult.deletedCount;
          totalDeleted.total += deleteResult.deletedCount;
          processedTotal += deleteResult.deletedCount;
          
          const progress = Math.round((processedTotal / counts.total) * 100);
          res.write('data: ' + JSON.stringify({
            type: 'progress',
            collection: 'cacheEvents',
            message: `Deleted ${deleteResult.deletedCount} cache entries`,
            processed: processedTotal,
            totalCount: counts.total,
            progress: progress,
            deleted: totalDeleted,
            timestamp: new Date().toISOString()
          }) + '\n\n');
        } catch (error) {
          errors.push({ collection: 'cacheEvents', error: error.message });
          logger.error('Error deleting cache events:', error);
        }
      }
      
      // Calculate elapsed time
      const elapsedTime = Date.now() - startTime;
      const elapsedSeconds = Math.round(elapsedTime / 1000);
      
      // Send final completion status
      res.write('data: ' + JSON.stringify({
        type: 'complete',
        message: `CSV clear completed. Deleted ${totalDeleted.total} records across all collections in ${elapsedSeconds} seconds.`,
        totalDeleted: totalDeleted,
        errors: errors,
        elapsedTime: elapsedSeconds,
        timestamp: new Date().toISOString()
      }) + '\n\n');
      
      logger.log('Streaming CSV clear completed:', {
        userId,
        totalDeleted: totalDeleted.total,
        breakdown: totalDeleted,
        errors: errors.length,
        elapsedSeconds
      });
      
    } catch (error) {
      logger.error('Error in streaming CSV clear:', error);
      res.write('data: ' + JSON.stringify({
        type: 'error',
        message: 'Clear operation failed',
        error: error.message,
        timestamp: new Date().toISOString()
      }) + '\n\n');
    }
    
    res.end();
    
  } catch (error) {
    logger.error('Error in streaming CSV clear endpoint:', error);
    res.status(500).json({ error: 'Failed to clear CSV events' });
  }
});

/**
 * Admin endpoint - Stream CSV import with Server-Sent Events for large files
 */
app.post('/api/admin/csv-import/stream', verifyToken, upload.single('csvFile'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const targetCalendarId = req.body.targetCalendarId;
    
    if (!unifiedEventsCollection) {
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }
    
    if (!targetCalendarId) {
      return res.status(400).json({ error: 'Target calendar ID is required' });
    }
    
    // Set headers for Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
    
    // Send initial status
    res.write('data: ' + JSON.stringify({
      type: 'start',
      message: 'Starting CSV import...',
      timestamp: new Date().toISOString()
    }) + '\n\n');
    
    // Configuration for chunked processing
    const CHUNK_SIZE = 50; // Process 50 rows at a time
    let totalRows = 0;
    let processedRows = 0;
    let successfulInserts = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    let registrationEventsCreated = 0;
    const errors = [];
    
    try {
      // Parse CSV headers first
      const csvData = [];
      const csvHeaders = [];
      
      // Create readable stream from buffer
      const stream = Readable.from(req.file.buffer.toString());
      
      // Parse CSV
      await new Promise((resolve, reject) => {
        stream
          .pipe(csv())
          .on('headers', (headers) => {
            csvHeaders.push(...headers);
          })
          .on('data', (row) => {
            csvData.push(row);
          })
          .on('end', resolve)
          .on('error', reject);
      });
      
      totalRows = csvData.length;
      
      // Send header validation status
      res.write('data: ' + JSON.stringify({
        type: 'headers',
        message: `CSV parsed: ${totalRows} rows found`,
        headers: csvHeaders,
        totalRows: totalRows,
        timestamp: new Date().toISOString()
      }) + '\n\n');
      
      // Validate CSV headers
      const validation = csvUtils.validateCSVHeaders(csvHeaders);
      if (!validation.isValid) {
        res.write('data: ' + JSON.stringify({
          type: 'error',
          message: 'Invalid CSV format',
          error: {
            missing: validation.missing,
            missingRecommended: validation.missingRecommended,
            headers: validation.headers
          },
          timestamp: new Date().toISOString()
        }) + '\n\n');
        res.end();
        return;
      }
      
      // Process CSV in chunks
      for (let i = 0; i < csvData.length; i += CHUNK_SIZE) {
        const chunk = csvData.slice(i, i + CHUNK_SIZE);
        const chunkStart = i + 1;
        const chunkEnd = Math.min(i + CHUNK_SIZE, csvData.length);
        
        // Send chunk processing status
        res.write('data: ' + JSON.stringify({
          type: 'progress',
          message: `Processing rows ${chunkStart} to ${chunkEnd}...`,
          processed: processedRows,
          total: totalRows,
          progress: Math.round((processedRows / totalRows) * 100),
          timestamp: new Date().toISOString()
        }) + '\n\n');
        
        // Transform chunk rows to unified events
        const chunkEvents = [];
        const chunkErrors = [];
        
        for (let j = 0; j < chunk.length; j++) {
          const rowIndex = i + j;
          try {
            const row = chunk[j];
            const unifiedEvent = csvUtils.csvRowToUnifiedEvent(row, userId, targetCalendarId);
            chunkEvents.push(unifiedEvent);
          } catch (error) {
            chunkErrors.push({
              row: rowIndex + 1,
              data: chunk[j],
              error: error.message
            });
            errorCount++;
          }
        }
        
        // Insert chunk events into database
        if (chunkEvents.length > 0) {
          try {
            // Check for existing events
            const existingEventIds = await unifiedEventsCollection.find(
              { 
                userId: userId,
                eventId: { $in: chunkEvents.map(e => e.eventId) }
              },
              { projection: { eventId: 1 } }
            ).toArray();
            
            const existingIds = new Set(existingEventIds.map(e => e.eventId));
            
            // Filter out duplicates
            const newEvents = chunkEvents.filter(event => !existingIds.has(event.eventId));
            const chunkDuplicates = chunkEvents.length - newEvents.length;
            duplicateCount += chunkDuplicates;
            
            // Prepare events for insertion (main events + registration events)
            const allEventsToInsert = [];
            
            for (const event of newEvents) {
              // Add main event
              allEventsToInsert.push(event);
              
              // Create TempleRegistration event if setup/teardown is enabled
              if (event.internalData.createRegistrationEvent) {
                const registrationEvent = createRegistrationEventFromMain(event, userId);
                allEventsToInsert.push(registrationEvent);
                registrationEventsCreated++;
              }
            }
            
            if (allEventsToInsert.length > 0) {
              const result = await unifiedEventsCollection.insertMany(allEventsToInsert, { ordered: false });
              successfulInserts += result.insertedCount;
            }
            
            // Send chunk completion status
            res.write('data: ' + JSON.stringify({
              type: 'chunk',
              message: `Chunk completed: ${newEvents.length} new events, ${chunkDuplicates} duplicates, ${chunkErrors.length} errors`,
              chunkStart: chunkStart,
              chunkEnd: chunkEnd,
              newEvents: newEvents.length,
              duplicates: chunkDuplicates,
              errors: chunkErrors.length,
              timestamp: new Date().toISOString()
            }) + '\n\n');
            
          } catch (insertError) {
            logger.error('Error inserting chunk:', insertError);
            chunkErrors.push({
              row: 'chunk',
              error: `Insert error: ${insertError.message}`
            });
            errorCount++;
          }
        }
        
        // Store errors for final report
        errors.push(...chunkErrors);
        processedRows += chunk.length;
        
        // Send progress update
        res.write('data: ' + JSON.stringify({
          type: 'progress',
          message: `Processed ${processedRows} of ${totalRows} rows`,
          processed: processedRows,
          total: totalRows,
          progress: Math.round((processedRows / totalRows) * 100),
          successful: successfulInserts,
          duplicates: duplicateCount,
          errors: errorCount,
          timestamp: new Date().toISOString()
        }) + '\n\n');
        
        // Small delay to prevent overwhelming the client
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Send final completion status
      res.write('data: ' + JSON.stringify({
        type: 'complete',
        message: 'CSV import completed successfully',
        summary: {
          totalRows: totalRows,
          successfulInserts: successfulInserts,
          duplicates: duplicateCount,
          errors: errorCount,
          registrationEventsCreated: registrationEventsCreated
        },
        errors: errors.slice(0, 10), // First 10 errors
        timestamp: new Date().toISOString()
      }) + '\n\n');
      
      logger.log('Streaming CSV import completed:', {
        userId,
        totalRows,
        successfulInserts,
        duplicates: duplicateCount,
        errors: errorCount,
        registrationEventsCreated
      });
      
    } catch (error) {
      logger.error('Error in streaming CSV import:', error);
      res.write('data: ' + JSON.stringify({
        type: 'error',
        message: 'Import failed',
        error: error.message,
        timestamp: new Date().toISOString()
      }) + '\n\n');
    }
    
    res.end();
    
  } catch (error) {
    logger.error('Error in streaming CSV import endpoint:', error);
    res.status(500).json({ error: 'Failed to process CSV file' });
  }
});

/**
 * Debug endpoint - Inspect raw CSV file buffer
 */
app.post('/api/admin/csv-import/debug', verifyToken, upload.single('csvFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const buffer = req.file.buffer;
    const firstBytes = buffer.slice(0, 500);
    const asString = firstBytes.toString('utf8');
    const asHex = firstBytes.toString('hex');

    // Check for BOM
    let hasBOM = false;
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
      hasBOM = true;
    }

    // Try parsing first few lines manually
    const lines = asString.split(/\r?\n/);
    const firstThreeLines = lines.slice(0, 3);

    logger.debug('CSV Debug Info:', {
      fileSize: buffer.length,
      hasBOM,
      firstBytesHex: asHex.substring(0, 50),
      firstThreeLines,
      originalName: req.file.originalname
    });

    res.json({
      fileSize: buffer.length,
      hasBOM,
      firstBytesHex: asHex.substring(0, 100),
      firstBytesString: asString.substring(0, 200),
      firstThreeLines,
      encoding: req.file.encoding,
      originalName: req.file.originalname
    });
  } catch (error) {
    logger.error('Error debugging CSV:', error);
    res.status(500).json({ error: 'Failed to debug CSV: ' + error.message });
  }
});

/**
 * Admin endpoint - Analyze Excel/CSV file structure for field mapping
 * Returns column information and suggests field mappings
 */
app.post('/api/admin/csv-import/analyze', verifyToken, upload.single('csvFile'), async (req, res) => {
  try {
    const userId = req.user.userId;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const fileName = req.file.originalname || '';
    const isExcel = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls');
    
    let csvData = [];
    let csvHeaders = [];
    
    if (isExcel) {
      // Parse Excel file using xlsx
      const XLSX = require('xlsx');
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON
      csvData = XLSX.utils.sheet_to_json(worksheet);
      
      // Get headers from first row
      if (csvData.length > 0) {
        csvHeaders = Object.keys(csvData[0]);
      }
      
      // Limit to first 10 rows for analysis
      csvData = csvData.slice(0, 10);
    } else {
      // Parse CSV from buffer - simplified approach
      await new Promise((resolve, reject) => {
        let cleanBuffer = req.file.buffer;
        // Remove UTF-8 BOM if present (EF BB BF)
        if (cleanBuffer.length >= 3 &&
            cleanBuffer[0] === 0xEF &&
            cleanBuffer[1] === 0xBB &&
            cleanBuffer[2] === 0xBF) {
          cleanBuffer = cleanBuffer.slice(3);
          logger.debug('Removed UTF-8 BOM from CSV file');
        }

        const stream = Readable.from([cleanBuffer]);

        // Use the 'headers' event to capture headers
        stream
          .pipe(csv({
            skipEmptyLines: true
          }))
          .on('headers', (headers) => {
            // Clean headers - remove BOM and trim
            csvHeaders = headers.map(h => {
              if (typeof h === 'string') {
                return h.replace(/^\uFEFF/, '').replace(/^﻿/, '').trim();
              }
              return h;
            });
            logger.debug('CSV headers parsed:', csvHeaders);
          })
          .on('data', (row) => {
            // Only collect first 10 rows for analysis
            if (csvData.length < 10) {
              csvData.push(row);
            }
          })
          .on('end', () => {
            // If we still don't have headers, get them from first row
            if (csvHeaders.length === 0 && csvData.length > 0) {
              csvHeaders = Object.keys(csvData[0]);
              logger.debug('Headers from first data row:', csvHeaders);
            }
            resolve();
          })
          .on('error', reject);
      });
    }
    
    if (csvData.length === 0) {
      return res.status(400).json({ error: 'File appears to be empty or invalid' });
    }
    
    // Analyze columns and generate samples
    const columns = csvHeaders;
    const samples = {};
    const totalRows = csvData.length; // This is just the sample size
    
    // Generate sample data for each column
    columns.forEach(column => {
      samples[column] = csvData.map(row => row[column]).filter(val => val !== null && val !== undefined && val !== '').slice(0, 5);
    });
    
    // Smart field mapping suggestions for Resource Scheduler Excel
    const COLUMN_PATTERNS = {
      'rsId': [/^rsId$/i, /rs.*id/i, /resource.*schedule.*id/i, /scheduler.*id/i],
      'Subject': [/^Subject$/i, /title/i, /event.*name/i, /event.*title/i],
      'StartDateTime': [/^StartDateTime$/i, /start.*date.*time/i, /start/i],
      'EndDateTime': [/^EndDateTime$/i, /end.*date.*time/i, /end/i],
      'StartDate': [/^StartDate$/i, /start.*date/i],
      'StartTime': [/^StartTime$/i, /start.*time/i],
      'EndDate': [/^EndDate$/i, /end.*date/i],
      'EndTime': [/^EndTime$/i, /end.*time/i],
      'Location': [/^Location$/i, /room/i, /venue/i, /place/i],
      'Categories': [/^Categories$/i, /categor/i, /type/i],
      'EventCode': [/^EventCode$/i, /event.*code/i, /code/i],
      'Description': [/^Description$/i, /desc/i, /notes/i, /details/i],
      'RequesterName': [/^RequesterName$/i, /requester.*name/i, /requested.*by/i],
      'RequesterEmail': [/^RequesterEmail$/i, /requester.*email/i, /email/i],
      'RequesterID': [/^RequesterID$/i, /requester.*id/i],
      'AllDayEvent': [/^AllDayEvent$/i, /all.*day/i],
      'IsRecurring': [/^IsRecurring$/i, /recurring/i, /recur/i],
      'Deleted': [/^Deleted$/i, /deleted/i, /removed/i]
    };
    
    const detectedMappings = {};
    
    // Auto-detect field mappings
    columns.forEach(column => {
      for (const [targetField, patterns] of Object.entries(COLUMN_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(column)) {
            detectedMappings[targetField] = column;
            break;
          }
        }
        if (detectedMappings[targetField]) break;
      }
    });
    
    logger.debug('File Analysis completed:', {
      userId,
      fileType: isExcel ? 'Excel' : 'CSV',
      columnsDetected: columns.length,
      sampleRows: csvData.length,
      detectedMappings: Object.keys(detectedMappings).length
    });
    
    res.json({
      columns,
      samples,
      totalRows: csvData.length, // This is sample size, not actual total
      detectedMappings,
      analysisInfo: {
        sampleSize: csvData.length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logger.error('Error analyzing file:', error);
    res.status(500).json({ error: 'Failed to analyze file: ' + error.message });
  }
});

// CSV Import Preview Endpoint
app.post('/api/admin/csv-import/preview', verifyToken, upload.single('csvFile'), async (req, res) => {
  try {
    const userId = req.user.userId;
    let { fieldMappings } = req.body;

    logger.debug('CSV Preview request received:', {
      userId,
      fileSize: req.file?.size,
      fileName: req.file?.originalname,
      fieldMappingsRaw: fieldMappings
    });

    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded' });
    }

    if (!fieldMappings) {
      logger.debug('No field mappings provided in request body');
      return res.status(400).json({ error: 'Field mappings are required for preview' });
    }

    // Parse field mappings (may come as string from FormData)
    if (typeof fieldMappings === 'string') {
      try {
        fieldMappings = JSON.parse(fieldMappings);
        logger.debug('Parsed field mappings from string:', fieldMappings);
      } catch (parseError) {
        logger.error('Failed to parse field mappings JSON:', parseError);
        return res.status(400).json({ error: 'Invalid field mappings JSON' });
      }
    }

    if (!fieldMappings || Object.keys(fieldMappings).length === 0) {
      logger.debug('Field mappings object is empty:', fieldMappings);
      return res.status(400).json({ error: 'Field mappings are required for preview' });
    }

    logger.debug('Final field mappings for preview:', fieldMappings);
    
    // Parse CSV from buffer - use same logic as analysis endpoint
    const csvData = [];
    let csvHeaders = [];

    await new Promise((resolve, reject) => {
      let cleanBuffer = req.file.buffer;
      // Remove UTF-8 BOM if present (EF BB BF)
      if (cleanBuffer.length >= 3 &&
          cleanBuffer[0] === 0xEF &&
          cleanBuffer[1] === 0xBB &&
          cleanBuffer[2] === 0xBF) {
        cleanBuffer = cleanBuffer.slice(3);
        logger.debug('Removed UTF-8 BOM from CSV file (preview)');
      }

      const stream = Readable.from([cleanBuffer]);

      // Use the 'headers' event to capture headers
      stream
        .pipe(csv({
          skipEmptyLines: true
        }))
        .on('headers', (headers) => {
          // Clean headers - remove BOM and trim
          csvHeaders = headers.map(h => {
            if (typeof h === 'string') {
              return h.replace(/^\uFEFF/, '').replace(/^﻿/, '').trim();
            }
            return h;
          });
          logger.debug('CSV headers parsed (preview):', csvHeaders);
        })
        .on('data', (row) => {
          // Collect more rows for preview (first 50)
          if (csvData.length < 50) {
            csvData.push(row);
          }
        })
        .on('end', () => {
          // If we still don't have headers, get them from first row
          if (csvHeaders.length === 0 && csvData.length > 0) {
            csvHeaders = Object.keys(csvData[0]);
            logger.debug('Headers from first data row (preview):', csvHeaders);
          }
          resolve();
        })
        .on('error', reject);
    });

    logger.debug('CSV parsing completed:', {
      rowsParsed: csvData.length,
      headersParsed: csvHeaders.length,
      headers: csvHeaders,
      firstRowSample: csvData[0]
    });

    if (csvData.length === 0) {
      logger.debug('CSV data is empty after parsing');
      return res.status(400).json({ error: 'CSV file appears to be empty or invalid' });
    }

    // Transform data using field mappings
    const transformedEvents = [];
    const validationErrors = [];

    logger.debug('Starting data transformation with field mappings:', fieldMappings);

    csvData.forEach((row, index) => {
      const transformedEvent = {
        _originalRowIndex: index + 1, // 1-based for user display
        _originalData: row
      };
      
      const rowErrors = [];
      
      // Apply field mappings (same format as main import: {csvColumn: targetField})
      Object.entries(fieldMappings).forEach(([csvColumn, targetField]) => {
        if (csvColumn && targetField && row[csvColumn] !== undefined) {
          const rawValue = row[csvColumn];
          
          try {
            // Transform based on field type
            switch (targetField) {
              case 'startDateTime':
              case 'endDateTime':
                if (rawValue && rawValue.trim()) {
                  const parsedDate = new Date(rawValue);
                  if (isNaN(parsedDate.getTime())) {
                    rowErrors.push(`Invalid date format in ${targetField}: "${rawValue}"`);
                    transformedEvent[targetField] = null;
                  } else {
                    transformedEvent[targetField] = parsedDate.toISOString();
                  }
                } else {
                  transformedEvent[targetField] = null;
                }
                break;
                
              case 'setupMinutes':
              case 'teardownMinutes':
              case 'attendeeCount':
              case 'estimatedCost':
                if (rawValue && rawValue.toString().trim()) {
                  const numValue = parseFloat(rawValue);
                  if (isNaN(numValue)) {
                    rowErrors.push(`Invalid number in ${targetField}: "${rawValue}"`);
                    transformedEvent[targetField] = null;
                  } else {
                    transformedEvent[targetField] = targetField === 'estimatedCost' ? numValue : Math.round(numValue);
                  }
                } else {
                  transformedEvent[targetField] = null;
                }
                break;
                
              case 'categories':
                if (rawValue && rawValue.toString().trim()) {
                  // Split by comma and clean up
                  transformedEvent[targetField] = rawValue.toString().split(',')
                    .map(cat => cat.trim())
                    .filter(cat => cat.length > 0);
                } else {
                  transformedEvent[targetField] = [];
                }
                break;
                
              case 'rsId':
                if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
                  // Convert to string and handle numeric IDs
                  transformedEvent[targetField] = rawValue.toString();
                } else {
                  transformedEvent[targetField] = null;
                }
                break;
                
              default:
                // String fields (subject, location, assignedTo, description, etc.)
                transformedEvent[targetField] = rawValue && rawValue.toString().trim() || null;
                break;
            }
          } catch (err) {
            rowErrors.push(`Error transforming ${targetField}: ${err.message}`);
            transformedEvent[targetField] = null;
          }
        } else {
          transformedEvent[targetField] = null;
        }
      });
      
      // Validate required fields
      const requiredFields = ['rsId', 'subject', 'startDateTime', 'endDateTime'];
      requiredFields.forEach(field => {
        if (!transformedEvent[field]) {
          rowErrors.push(`Missing required field: ${field}`);
        }
      });
      
      if (rowErrors.length > 0) {
        validationErrors.push({
          rowIndex: index + 1,
          errors: rowErrors
        });
      }
      
      transformedEvents.push(transformedEvent);
    });
    
    // Generate preview statistics
    const previewStats = {
      totalRows: csvData.length,
      validRows: transformedEvents.filter(event => 
        event.rsId && event.subject && event.startDateTime && event.endDateTime
      ).length,
      rowsWithErrors: validationErrors.length,
      fieldsMapped: Object.keys(fieldMappings).length
    };
    
    // Sample of transformed events (first 10 for display)
    const previewSample = transformedEvents.slice(0, 10).map(event => {
      // Remove internal fields from preview
      const { _originalRowIndex, _originalData, ...cleanEvent } = event;
      return {
        ...cleanEvent,
        _preview: {
          rowIndex: _originalRowIndex,
          originalSubject: _originalData[fieldMappings.Subject?.csvColumn] || 'N/A',
          originalStart: _originalData[fieldMappings.StartDateTime?.csvColumn] || 'N/A'
        }
      };
    });
    
    logger.debug('CSV Preview generated:', {
      userId,
      totalRows: previewStats.totalRows,
      validRows: previewStats.validRows,
      errorsFound: previewStats.rowsWithErrors
    });
    
    res.json({
      statistics: previewStats,
      sample: previewSample,
      validationErrors: validationErrors.slice(0, 20), // Limit error display
      fieldMappings,
      previewInfo: {
        timestamp: new Date().toISOString(),
        sampleSize: Math.min(csvData.length, 10)
      }
    });
    
  } catch (error) {
    logger.error('Error previewing CSV import:', error);
    res.status(500).json({ error: 'Failed to preview CSV import: ' + error.message });
  }
});

// Excel/CSV Import Execution Endpoint for templeEvents__Events
app.post('/api/admin/csv-import/execute', verifyToken, upload.single('csvFile'), async (req, res) => {
  try {
    const userId = req.user.userId;
    let { fieldMappings, importOptions = {} } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    if (!fieldMappings || Object.keys(fieldMappings).length === 0) {
      return res.status(400).json({ error: 'Field mappings are required for import' });
    }
    
    // Parse field mappings (may come as string from FormData)
    if (typeof fieldMappings === 'string') {
      fieldMappings = JSON.parse(fieldMappings);
    }
    if (typeof importOptions === 'string') {
      importOptions = JSON.parse(importOptions);
    }
    
    // Set response headers for streaming
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no'
    });
    
    const streamProgress = (data) => {
      res.write(JSON.stringify(data) + '\n');
    };
    
    const fileName = req.file.originalname || '';
    const isExcel = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls');
    
    let csvData = [];
    let csvHeaders = [];
    
    streamProgress({ type: 'info', message: `Parsing ${isExcel ? 'Excel' : 'CSV'} file...` });
    
    if (isExcel) {
      // Parse Excel file
      const XLSX = require('xlsx');
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // Convert to JSON
      csvData = XLSX.utils.sheet_to_json(worksheet);
      
      // Get headers
      if (csvData.length > 0) {
        csvHeaders = Object.keys(csvData[0]);
      }
    } else {
      // Parse CSV from buffer
      await new Promise((resolve, reject) => {
        const stream = Readable.from([req.file.buffer]);
        stream
          .pipe(csv({
            skipEmptyLines: true,
            headers: (headers) => {
              csvHeaders.push(...headers);
              return headers;
            }
          }))
          .on('data', (row) => {
            csvData.push(row);
          })
          .on('end', resolve)
          .on('error', reject);
      });
    }
    
    if (csvData.length === 0) {
      streamProgress({ type: 'error', message: 'File appears to be empty or invalid' });
      return res.end();
    }
    
    streamProgress({ 
      type: 'progress', 
      message: `Parsed ${csvData.length} rows from ${isExcel ? 'Excel' : 'CSV'}`,
      totalRows: csvData.length 
    });
    
    // Import statistics
    const stats = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };
    
    // Process events in batches
    const BATCH_SIZE = 10;
    
    for (let i = 0; i < csvData.length; i += BATCH_SIZE) {
      const batch = csvData.slice(i, Math.min(i + BATCH_SIZE, csvData.length));
      
      for (const [batchIndex, row] of batch.entries()) {
        const rowIndex = i + batchIndex + 1;
        
        try {
          // Transform row data for templeEvents__Events collection
          const importSessionId = req.body.importSessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const now = new Date();

          const transformedEvent = {
            userId,
            source: 'Resource Scheduler Import',
            sourceMetadata: {
              importType: 'resourceScheduler',
              importSessionId: importSessionId,
              importedAt: now,
              importedBy: userId,
              originalFilename: req.file.originalname,
              fileType: isExcel ? 'Excel' : 'CSV'
            },
            sourceCalendars: [{
              calendarId: 'resource-scheduler-import',
              calendarName: 'Resource Scheduler Import',
              role: 'imported'
            }],
            isDeleted: false,
            lastSyncedAt: now,
            lastAccessedAt: now,
            cachedAt: now,
            createdAt: now,
            updatedAt: now,
            graphData: {
              importance: 'normal',
              showAs: 'busy',
              sensitivity: 'normal',
              isAllDay: false,
              lastModifiedDateTime: new Date().toISOString(),
              createdDateTime: new Date().toISOString()
            },
            internalData: {
              mecCategories: [],
              setupMinutes: 0,
              teardownMinutes: 0,
              registrationNotes: '',
              assignedTo: '',
              internalNotes: '',
              setupStatus: 'pending',
              estimatedCost: null,
              actualCost: null,
              // Resource Scheduler specific fields
              rsImportSource: 'resourceScheduler',
              rsImportedAt: now,
              lastModifiedBy: userId,
              lastModifiedAt: now,
              lastModifiedReason: 'Resource Scheduler import'
            }
          };
          
          // Apply field mappings
          Object.entries(fieldMappings).forEach(([targetField, mapping]) => {
            if (mapping.csvColumn && row[mapping.csvColumn] !== undefined) {
              const rawValue = row[mapping.csvColumn];
              
              // Transform based on field type for Resource Scheduler fields
              switch (targetField) {
                case 'StartDateTime':
                case 'EndDateTime':
                  if (rawValue && rawValue.trim()) {
                    const parsedDate = new Date(rawValue);
                    if (!isNaN(parsedDate.getTime())) {
                      if (targetField === 'StartDateTime') {
                        transformedEvent.startTime = parsedDate.toISOString();
                        transformedEvent.graphData.start = { dateTime: parsedDate.toISOString() };
                      } else {
                        transformedEvent.endTime = parsedDate.toISOString();
                        transformedEvent.graphData.end = { dateTime: parsedDate.toISOString() };
                      }
                    }
                  }
                  break;
                  
                case 'Subject':
                  if (rawValue && rawValue.toString().trim()) {
                    transformedEvent.subject = rawValue.toString().trim();
                    transformedEvent.graphData.subject = rawValue.toString().trim();
                  }
                  break;
                  
                case 'Location':
                  if (rawValue && rawValue.toString().trim()) {
                    transformedEvent.location = rawValue.toString().trim();
                    transformedEvent.graphData.location = { displayName: rawValue.toString().trim() };
                  }
                  break;
                  
                case 'Categories':
                  if (rawValue && rawValue.toString().trim()) {
                    const category = rawValue.toString().trim();
                    transformedEvent.graphData.categories = [category];
                    transformedEvent.internalData.mecCategories = [category];
                  }
                  break;

                case 'EventCode':
                  if (rawValue && rawValue.toString().trim()) {
                    const eventCode = rawValue.toString().trim();
                    transformedEvent.internalData.rsEventCode = eventCode;
                    // Also add to categories if not already set
                    if (!transformedEvent.graphData.categories || transformedEvent.graphData.categories.length === 0) {
                      transformedEvent.graphData.categories = [eventCode];
                      transformedEvent.internalData.mecCategories = [eventCode];
                    }
                  }
                  break;
                  
                case 'Description':
                  if (rawValue && rawValue.toString().trim()) {
                    const description = rawValue.toString().trim();
                    transformedEvent.graphData.bodyPreview = description.substring(0, 255);
                    transformedEvent.graphData.body = {
                      contentType: 'text',
                      content: description
                    };
                    transformedEvent.internalData.internalNotes = description;
                  }
                  break;
                  
                case 'RequesterName':
                  if (rawValue && rawValue.toString().trim()) {
                    transformedEvent.internalData.requesterName = rawValue.toString().trim();
                  }
                  break;
                  
                case 'RequesterEmail':
                  if (rawValue && rawValue.toString().trim()) {
                    transformedEvent.internalData.requesterEmail = rawValue.toString().trim();
                  }
                  break;
                  
                case 'RequesterID':
                  if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
                    transformedEvent.internalData.requesterID = parseInt(rawValue) || 0;
                  }
                  break;
                  
                case 'AllDayEvent':
                  if (rawValue !== undefined && rawValue !== null) {
                    transformedEvent.graphData.isAllDay = rawValue === 1 || rawValue === '1' || rawValue === true;
                  }
                  break;
                  
                case 'IsRecurring':
                  if (rawValue !== undefined && rawValue !== null) {
                    transformedEvent.internalData.isRecurring = rawValue === 1 || rawValue === '1' || rawValue === true;
                  }
                  break;
                  
                case 'Deleted':
                  if (rawValue !== undefined && rawValue !== null) {
                    transformedEvent.isDeleted = rawValue === 1 || rawValue === '1' || rawValue === true;
                  }
                  break;
                  
                case 'setupMinutes':
                case 'teardownMinutes':
                  if (rawValue && rawValue.toString().trim()) {
                    const numValue = parseFloat(rawValue);
                    if (!isNaN(numValue)) {
                      transformedEvent.internalData[targetField] = Math.round(numValue);
                    }
                  }
                  break;
                  
                case 'attendeeCount':
                  if (rawValue && rawValue.toString().trim()) {
                    const numValue = parseFloat(rawValue);
                    if (!isNaN(numValue)) {
                      transformedEvent.internalData.attendeeCount = Math.round(numValue);
                    }
                  }
                  break;
                  
                case 'estimatedCost':
                  if (rawValue && rawValue.toString().trim()) {
                    const numValue = parseFloat(rawValue);
                    if (!isNaN(numValue)) {
                      transformedEvent.internalData.estimatedCost = numValue;
                    }
                  }
                  break;
                  
                case 'rsId':
                  if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
                    transformedEvent.internalData.rsId = rawValue.toString();
                  }
                  break;

                case 'StartDate':
                  if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
                    transformedEvent.internalData.rsStartDate = parseFloat(rawValue) || 0;
                  }
                  break;

                case 'StartTime':
                  if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
                    transformedEvent.internalData.rsStartTime = parseFloat(rawValue) || 0;
                  }
                  break;

                case 'EndDate':
                  if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
                    transformedEvent.internalData.rsEndDate = parseFloat(rawValue) || 0;
                  }
                  break;

                case 'EndTime':
                  if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
                    transformedEvent.internalData.rsEndTime = parseFloat(rawValue) || 0;
                  }
                  break;
              }
            }
          });
          
          // Validate required fields for Resource Scheduler import
          if (!transformedEvent.internalData.rsId || !transformedEvent.subject || !transformedEvent.startTime || !transformedEvent.endTime) {
            stats.errors.push({
              row: rowIndex,
              subject: transformedEvent.subject || 'Unknown',
              error: 'Missing required fields (rsId, Subject, StartDateTime, EndDateTime)'
            });
            stats.skipped++;
          } else {
            // Generate eventId using Resource Scheduler ID
            if (!transformedEvent.eventId) {
              transformedEvent.eventId = `rs-import-${transformedEvent.internalData.rsId}`;
              transformedEvent.graphData.id = transformedEvent.eventId;
            }
            
            // Check if event already exists (by rsId)
            const existingEvent = await unifiedEventsCollection.findOne({
              userId,
              'internalData.rsId': transformedEvent.internalData.rsId
            });
            
            if (existingEvent && !importOptions.forceOverwrite) {
              stats.skipped++;
              streamProgress({ 
                type: 'progress', 
                message: `Skipped existing event: ${transformedEvent.subject} (rsId: ${transformedEvent.internalData.rsId})` 
              });
            } else {
              if (existingEvent) {
                // Generate change set for audit logging
                const changeSet = generateChangeSet(existingEvent, transformedEvent, [
                  'subject', 'startTime', 'endTime', 'location', 'source', 'sourceMetadata', 'internalData'
                ]);

                // Update existing event
                await unifiedEventsCollection.updateOne(
                  { _id: existingEvent._id },
                  {
                    $set: {
                      ...transformedEvent,
                      updatedAt: new Date(),
                      // Preserve enrichments if requested
                      ...(importOptions.preserveEnrichments && existingEvent.internalData ? {
                        'internalData.internalNotes': existingEvent.internalData.internalNotes || transformedEvent.internalData.internalNotes,
                        'internalData.mecCategories': existingEvent.internalData.mecCategories || transformedEvent.internalData.mecCategories
                      } : {})
                    }
                  }
                );
                stats.updated++;

                // Log audit entry for update
                await logEventAudit({
                  eventId: transformedEvent.eventId,
                  userId: userId,
                  changeType: 'update',
                  source: 'Resource Scheduler Import',
                  changeSet: changeSet,
                  metadata: {
                    importSessionId: importSessionId,
                    reason: 'Resource Scheduler import update',
                    originalFilename: req.file.originalname,
                    fileType: isExcel ? 'Excel' : 'CSV'
                  }
                });

                streamProgress({
                  type: 'progress',
                  message: `Updated: ${transformedEvent.subject}`
                });
              } else {
                // Create new event
                await unifiedEventsCollection.insertOne(transformedEvent);
                stats.created++;

                // Log audit entry for creation
                await logEventAudit({
                  eventId: transformedEvent.eventId,
                  userId: userId,
                  changeType: 'create',
                  source: 'Resource Scheduler Import',
                  metadata: {
                    importSessionId: importSessionId,
                    reason: 'Resource Scheduler import',
                    originalFilename: req.file.originalname,
                    fileType: isExcel ? 'Excel' : 'CSV'
                  }
                });

                streamProgress({
                  type: 'progress',
                  message: `Created: ${transformedEvent.subject}`
                });
              }
            }
          }
        } catch (error) {
          stats.errors.push({
            row: rowIndex,
            subject: row[fieldMappings.subject?.csvColumn] || 'Unknown',
            error: error.message
          });
          logger.error(`Error processing row ${rowIndex}:`, error);
        }
        
        stats.processed++;
        
        // Update progress every 5 items
        if (stats.processed % 5 === 0) {
          streamProgress({
            type: 'progress',
            message: `Processed ${stats.processed}/${csvData.length} rows`,
            processed: stats.processed,
            created: stats.created,
            updated: stats.updated,
            skipped: stats.skipped,
            errors: stats.errors.length,
            total: csvData.length
          });
        }
      }
    }
    
    // Send final results
    streamProgress({
      type: 'complete',
      message: 'CSV import completed successfully',
      statistics: stats,
      summary: {
        totalRows: csvData.length,
        processed: stats.processed,
        created: stats.created,
        updated: stats.updated,
        skipped: stats.skipped,
        errors: stats.errors.length
      }
    });
    
    logger.info('CSV import completed:', {
      userId,
      totalRows: csvData.length,
      created: stats.created,
      updated: stats.updated,
      skipped: stats.skipped,
      errors: stats.errors.length
    });
    
    res.end();
    
  } catch (error) {
    logger.error('Error executing CSV import:', error);
    try {
      res.write(JSON.stringify({ 
        type: 'error', 
        message: 'Failed to execute CSV import: ' + error.message 
      }) + '\n');
      res.end();
    } catch (resError) {
      logger.error('Error writing error response:', resError);
    }
  }
});

/**
 * JSON Import Analysis Endpoint
 * Analyzes JSON file structure for field mapping
 */
app.post('/api/admin/json-import/analyze', verifyToken, upload.single('jsonFile'), async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Parse JSON from buffer
    let jsonData;
    try {
      const jsonString = req.file.buffer.toString('utf8');
      jsonData = JSON.parse(jsonString);
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON file: ' + parseError.message });
    }

    // Ensure it's an array
    if (!Array.isArray(jsonData)) {
      if (typeof jsonData === 'object' && jsonData !== null) {
        jsonData = [jsonData];
      } else {
        return res.status(400).json({ error: 'JSON file must contain an array or object' });
      }
    }

    if (jsonData.length === 0) {
      return res.status(400).json({ error: 'JSON file is empty' });
    }

    // Get columns from first object
    const columns = Object.keys(jsonData[0]);

    // Generate samples
    const samples = {};
    columns.forEach(column => {
      samples[column] = jsonData
        .slice(0, 10)
        .map(row => row[column])
        .filter(val => val !== null && val !== undefined && val !== '');
    });

    // Smart field mapping suggestions
    const COLUMN_PATTERNS = {
      'rsId': [/^rsId$/i, /rs.*id/i, /resource.*schedule.*id/i],
      'Subject': [/^Subject$/i, /title/i, /event.*name/i],
      'StartDateTime': [/^StartDateTime$/i, /start.*date.*time/i, /start$/i],
      'EndDateTime': [/^EndDateTime$/i, /end.*date.*time/i, /end$/i],
      'Location': [/^Location$/i, /room/i, /venue/i],
      'Categories': [/^Categories$/i, /categor/i, /type/i],
      'Description': [/^Description$/i, /desc/i, /notes/i],
      'AllDayEvent': [/^AllDayEvent$/i, /all.*day/i],
      'Deleted': [/^Deleted$/i, /deleted/i, /removed/i]
    };

    const detectedMappings = {};
    columns.forEach(column => {
      for (const [targetField, patterns] of Object.entries(COLUMN_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(column)) {
            detectedMappings[targetField] = column;
            break;
          }
        }
        if (detectedMappings[targetField]) break;
      }
    });

    logger.debug('JSON Analysis completed:', {
      userId,
      columnsDetected: columns.length,
      totalRows: jsonData.length,
      detectedMappings: Object.keys(detectedMappings).length
    });

    res.json({
      columns,
      samples,
      totalRows: jsonData.length,
      detectedMappings,
      analysisInfo: {
        fileSize: req.file.size,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Error analyzing JSON file:', error);
    res.status(500).json({ error: 'Failed to analyze JSON file: ' + error.message });
  }
});

/**
 * JSON Import with Calendar Sync
 * Imports events from JSON and optionally syncs to Microsoft 365 calendar
 */
app.post('/api/admin/json-import/with-calendar', verifyToken, upload.single('jsonFile'), async (req, res) => {
  try {
    const userId = req.user.userId;
    let { fieldMappings, selectedCalendar, importMode = 'update' } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No JSON file uploaded' });
    }

    // Parse parameters
    if (typeof fieldMappings === 'string') {
      fieldMappings = JSON.parse(fieldMappings);
    }

    if (typeof selectedCalendar === 'string') {
      selectedCalendar = JSON.parse(selectedCalendar);
    }

    // Validate required fields
    if (!fieldMappings.rsId?.csvColumn || !fieldMappings.Subject?.csvColumn ||
        !fieldMappings.StartDateTime?.csvColumn || !fieldMappings.EndDateTime?.csvColumn) {
      return res.status(400).json({ error: 'Required field mappings missing (rsId, Subject, StartDateTime, EndDateTime)' });
    }

    // Parse JSON from buffer
    let jsonData;
    try {
      const jsonString = req.file.buffer.toString('utf8');
      jsonData = JSON.parse(jsonString);
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON file: ' + parseError.message });
    }

    if (!Array.isArray(jsonData)) {
      if (typeof jsonData === 'object' && jsonData !== null) {
        jsonData = [jsonData];
      } else {
        return res.status(400).json({ error: 'JSON file must contain an array or object' });
      }
    }

    // Get Graph token if calendar sync is requested
    let graphToken = null;
    if (selectedCalendar) {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Graph token required for calendar sync' });
      }
      graphToken = authHeader.split(' ')[1];
    }

    const results = {
      total: jsonData.length,
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    // Process each row
    for (const [index, row] of jsonData.entries()) {
      try {
        // Extract values based on field mappings
        const rsId = row[fieldMappings.rsId.csvColumn];
        const subject = row[fieldMappings.Subject.csvColumn];
        const startDateTime = row[fieldMappings.StartDateTime.csvColumn];
        const endDateTime = row[fieldMappings.EndDateTime.csvColumn];
        const location = fieldMappings.Location ? row[fieldMappings.Location.csvColumn] : null;
        const description = fieldMappings.Description ? row[fieldMappings.Description.csvColumn] : null;

        // Skip if essential fields are missing
        if (!rsId || !subject || !startDateTime || !endDateTime) {
          results.skipped++;
          results.errors.push(`Row ${index + 1}: Missing required fields`);
          continue;
        }

        // Parse dates
        const start = new Date(startDateTime);
        const end = new Date(endDateTime);

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          results.errors.push(`Row ${index + 1}: Invalid date format`);
          results.skipped++;
          continue;
        }

        // Create event object
        const eventData = {
          userId,
          source: 'Resource Scheduler Import',
          rsId: rsId.toString(),
          internalData: {
            rsId: rsId.toString(),
            subject,
            startDateTime: start.toISOString(),
            endDateTime: end.toISOString(),
            location: location || '',
            description: description || '',
            importedAt: new Date().toISOString()
          },
          graphData: {
            subject,
            start: { dateTime: start.toISOString(), timeZone: 'UTC' },
            end: { dateTime: end.toISOString(), timeZone: 'UTC' },
            location: location ? { displayName: location } : undefined,
            body: description ? { content: description, contentType: 'text' } : undefined
          }
        };

        // Check if event already exists
        const existingEvent = await db.collection('templeEvents__Events').findOne({
          userId,
          'internalData.rsId': rsId.toString()
        });

        if (existingEvent) {
          if (importMode === 'skip') {
            results.skipped++;
            continue;
          }
          await db.collection('templeEvents__Events').updateOne(
            { _id: existingEvent._id },
            { $set: eventData }
          );
          results.updated++;
        } else {
          await db.collection('templeEvents__Events').insertOne(eventData);
          results.created++;
        }

        results.processed++;

      } catch (rowError) {
        logger.error(`Error processing row ${index + 1}:`, rowError);
        results.errors.push(`Row ${index + 1}: ${rowError.message}`);
        results.skipped++;
      }
    }

    logger.info('JSON import completed:', results);
    res.json(results);

  } catch (error) {
    logger.error('Error in JSON import:', error);
    res.status(500).json({ error: 'Failed to import JSON file: ' + error.message });
  }
});

/**
 * Enhanced CSV Import with Calendar Selection and Sync
 * Creates events in both database and optionally syncs to a selected Microsoft 365 calendar
 */
app.post('/api/admin/csv-import/with-calendar', verifyToken, upload.single('csvFile'), async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    let {
      fieldMappings,
      importOptions = {},
      targetCalendarId,
      syncToCalendar = false,
      graphToken
    } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!fieldMappings || Object.keys(fieldMappings).length === 0) {
      return res.status(400).json({ error: 'Field mappings are required for import' });
    }

    if (syncToCalendar && !graphToken) {
      return res.status(400).json({ error: 'Graph token is required for calendar sync' });
    }

    if (syncToCalendar && !targetCalendarId) {
      return res.status(400).json({ error: 'Target calendar ID is required for calendar sync' });
    }

    // Parse field mappings (may come as string from FormData)
    if (typeof fieldMappings === 'string') {
      fieldMappings = JSON.parse(fieldMappings);
    }
    if (typeof importOptions === 'string') {
      importOptions = JSON.parse(importOptions);
    }
    if (typeof syncToCalendar === 'string') {
      syncToCalendar = syncToCalendar === 'true';
    }

    // Set response headers for streaming
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
      'X-Accel-Buffering': 'no'
    });

    const streamProgress = (data) => {
      res.write(JSON.stringify(data) + '\n');
    };

    const fileName = req.file.originalname || '';
    const isExcel = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls');
    const importSessionId = `rsimport-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    let csvData = [];
    let csvHeaders = [];

    streamProgress({ type: 'info', message: `Parsing ${isExcel ? 'Excel' : 'CSV'} file...` });

    if (isExcel) {
      // Parse Excel file
      const XLSX = require('xlsx');
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      // Convert to JSON
      csvData = XLSX.utils.sheet_to_json(worksheet);

      // Get headers
      if (csvData.length > 0) {
        csvHeaders = Object.keys(csvData[0]);
      }
    } else {
      // Parse CSV from buffer - use same working logic as preview endpoint
      await new Promise((resolve, reject) => {
        let cleanBuffer = req.file.buffer;
        // Remove UTF-8 BOM if present (EF BB BF)
        if (cleanBuffer.length >= 3 &&
            cleanBuffer[0] === 0xEF &&
            cleanBuffer[1] === 0xBB &&
            cleanBuffer[2] === 0xBF) {
          cleanBuffer = cleanBuffer.slice(3);
          logger.debug('Removed UTF-8 BOM from CSV file (import)');
        }

        const stream = Readable.from([cleanBuffer]);

        // Use the 'headers' event to capture headers
        stream
          .pipe(csv({
            skipEmptyLines: true
          }))
          .on('headers', (headers) => {
            // Clean headers - remove BOM and trim
            csvHeaders = headers.map(h => {
              if (typeof h === 'string') {
                return h.replace(/^\uFEFF/, '').replace(/^﻿/, '').trim();
              }
              return h;
            });
            logger.debug('CSV headers parsed (import):', csvHeaders);
          })
          .on('data', (row) => {
            csvData.push(row);
          })
          .on('end', () => {
            // If we still don't have headers, get them from first row
            if (csvHeaders.length === 0 && csvData.length > 0) {
              csvHeaders = Object.keys(csvData[0]);
              logger.debug('Headers from first data row (import):', csvHeaders);
            }
            resolve();
          })
          .on('error', reject);
      });
    }

    if (csvData.length === 0) {
      streamProgress({ type: 'error', message: 'File appears to be empty or invalid' });
      return res.end();
    }

    streamProgress({
      type: 'progress',
      message: `Parsed ${csvData.length} rows from ${isExcel ? 'Excel' : 'CSV'}`,
      totalRows: csvData.length
    });

    // Import statistics
    const stats = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      synced: 0,
      syncFailed: 0,
      errors: []
    };

    // Process events in batches for database creation
    const BATCH_SIZE = 10;
    const eventsToSync = [];

    for (let i = 0; i < csvData.length; i += BATCH_SIZE) {
      const batch = csvData.slice(i, Math.min(i + BATCH_SIZE, csvData.length));

      for (const [batchIndex, row] of batch.entries()) {
        const rowIndex = i + batchIndex + 1;

        try {
          stats.processed++;

          // Transform row data based on field mappings
          const now = new Date();
          const transformedEvent = {
            userId,
            source: 'Resource Scheduler Import',
            sourceMetadata: {
              importType: 'resourceScheduler',
              importSessionId: importSessionId,
              importedAt: now,
              importedBy: userEmail,
              originalFilename: req.file.originalname,
              fileType: isExcel ? 'Excel' : 'CSV',
              targetCalendarId: targetCalendarId || null,
              syncToCalendar: syncToCalendar
            },
            sourceCalendars: [{
              calendarId: targetCalendarId || 'resource-scheduler-import',
              calendarName: targetCalendarId ? 'Target Calendar' : 'Resource Scheduler Import',
              role: 'imported'
            }],
            isDeleted: false,
            lastSyncedAt: now,
            lastAccessedAt: now,
            cachedAt: now,
            createdAt: now,
            createdBy: userId,
            createdByEmail: userEmail,
            createdByName: req.user.name || userEmail,
            createdSource: 'csv-import',
            updatedAt: now,
            graphData: {
              importance: 'normal',
              showAs: 'busy',
              sensitivity: 'normal',
              isAllDay: false,
              lastModifiedDateTime: now.toISOString(),
              createdDateTime: now.toISOString()
            },
            internalData: {
              mecCategories: [],
              setupMinutes: 0,
              teardownMinutes: 0,
              registrationNotes: '',
              assignedTo: '',
              internalNotes: '',
              setupStatus: 'pending',
              estimatedCost: null,
              actualCost: null,
              rsImportSource: 'resourceScheduler',
              rsImportSessionId: importSessionId
            }
          };

          // Map fields from CSV to event structure
          let rsId = null;
          let startDateTime = null;
          let endDateTime = null;

          for (const [csvColumn, targetField] of Object.entries(fieldMappings)) {
            const rawValue = row[csvColumn];

            switch (targetField) {
              case 'rsId':
                if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
                  rsId = rawValue.toString();
                  transformedEvent.internalData.rsId = rsId;
                }
                break;

              case 'subject':
                if (rawValue) {
                  transformedEvent.graphData.subject = rawValue;
                }
                break;

              case 'startDateTime':
                if (rawValue) {
                  startDateTime = new Date(rawValue);
                  if (!isNaN(startDateTime.getTime())) {
                    transformedEvent.graphData.start = {
                      dateTime: startDateTime.toISOString(),
                      timeZone: 'UTC'
                    };
                  }
                }
                break;

              case 'endDateTime':
                if (rawValue) {
                  endDateTime = new Date(rawValue);
                  if (!isNaN(endDateTime.getTime())) {
                    transformedEvent.graphData.end = {
                      dateTime: endDateTime.toISOString(),
                      timeZone: 'UTC'
                    };
                  }
                }
                break;

              case 'location':
                if (rawValue) {
                  transformedEvent.graphData.location = {
                    displayName: rawValue
                  };
                }
                break;

              case 'description':
                if (rawValue) {
                  transformedEvent.graphData.body = {
                    contentType: 'Text',
                    content: rawValue
                  };
                  transformedEvent.graphData.bodyPreview = rawValue.substring(0, 255);
                }
                break;

              case 'categories':
                if (rawValue) {
                  const categories = rawValue.split(',').map(c => c.trim()).filter(c => c);
                  transformedEvent.graphData.categories = categories;
                  transformedEvent.internalData.mecCategories = categories;
                }
                break;

              case 'isAllDay':
                if (rawValue !== undefined) {
                  transformedEvent.graphData.isAllDay = rawValue === 1 || rawValue === '1' ||
                                                         rawValue === true || rawValue === 'true';
                }
                break;

              case 'attendeeEmails':
                if (rawValue) {
                  const emails = rawValue.split(',').map(e => e.trim()).filter(e => e);
                  transformedEvent.graphData.attendees = emails.map(email => ({
                    emailAddress: {
                      address: email,
                      name: email.split('@')[0]
                    },
                    type: 'required'
                  }));
                }
                break;

              case 'isDeleted':
              case 'Deleted':
                if (rawValue !== undefined) {
                  transformedEvent.isDeleted = rawValue === 1 || rawValue === '1' ||
                                              rawValue === true || rawValue === 'true';
                }
                break;
            }
          }

          // Validate required fields
          if (!transformedEvent.graphData.subject) {
            throw new Error('Subject is required');
          }

          if (!transformedEvent.graphData.start || !transformedEvent.graphData.end) {
            throw new Error('Start and end date/time are required');
          }

          // Generate eventId based on rsId or create new
          const eventId = rsId ? `rsimport_${rsId}` :
                         `rsimport_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          transformedEvent.eventId = eventId;

          // Check if event with this rsId already exists
          let existingEvent = null;
          if (rsId) {
            existingEvent = await unifiedEventsCollection.findOne({
              userId,
              'internalData.rsId': rsId
            });
          }

          if (existingEvent) {
            // Update existing event
            const updateResult = await unifiedEventsCollection.updateOne(
              {
                userId,
                'internalData.rsId': rsId
              },
              {
                $set: {
                  ...transformedEvent,
                  updatedAt: now
                }
              }
            );

            if (updateResult.modifiedCount > 0) {
              stats.updated++;
              streamProgress({
                type: 'progress',
                message: `Updated event (row ${rowIndex}): ${transformedEvent.graphData.subject}`,
                row: rowIndex,
                action: 'updated'
              });
            } else {
              stats.skipped++;
            }
          } else {
            // Create new event
            await unifiedEventsCollection.insertOne(transformedEvent);
            stats.created++;

            streamProgress({
              type: 'progress',
              message: `Created event (row ${rowIndex}): ${transformedEvent.graphData.subject}`,
              row: rowIndex,
              action: 'created'
            });
          }

          // Add to sync queue if calendar sync is enabled and event is not deleted
          if (syncToCalendar && !transformedEvent.isDeleted) {
            eventsToSync.push({
              rowIndex,
              event: transformedEvent,
              rsId
            });
          }

        } catch (rowError) {
          stats.errors.push({
            row: rowIndex,
            error: rowError.message,
            data: row
          });

          streamProgress({
            type: 'warning',
            message: `Error in row ${rowIndex}: ${rowError.message}`,
            row: rowIndex
          });
        }
      }
    }

    // Sync events to calendar if requested
    if (syncToCalendar && eventsToSync.length > 0) {
      streamProgress({
        type: 'info',
        message: `Syncing ${eventsToSync.length} events to calendar ${targetCalendarId}...`
      });

      // Process sync in batches
      const SYNC_BATCH_SIZE = 5;

      for (let i = 0; i < eventsToSync.length; i += SYNC_BATCH_SIZE) {
        const syncBatch = eventsToSync.slice(i, Math.min(i + SYNC_BATCH_SIZE, eventsToSync.length));

        for (const { rowIndex, event, rsId } of syncBatch) {
          try {
            // Prepare event data for Graph API
            const graphEventData = {
              subject: event.graphData.subject,
              body: event.graphData.body || { contentType: 'Text', content: '' },
              start: event.graphData.start,
              end: event.graphData.end,
              location: event.graphData.location || { displayName: '' },
              categories: event.graphData.categories || [],
              isAllDay: event.graphData.isAllDay || false,
              attendees: event.graphData.attendees || [],
              importance: event.graphData.importance || 'normal',
              showAs: event.graphData.showAs || 'busy'
            };

            // Add rsId as an extended property if it exists
            if (rsId) {
              graphEventData.singleValueExtendedProperties = [{
                id: 'String {00000000-0000-0000-0000-000000000001} Name rsId',
                value: rsId
              }];
            }

            // Make Graph API call to create event
            const graphUrl = `https://graph.microsoft.com/v1.0/users/${targetCalendarId}/events`;
            const graphResponse = await fetch(graphUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${graphToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(graphEventData)
            });

            if (graphResponse.ok) {
              const createdEvent = await graphResponse.json();

              // Update the database record with Graph event ID
              await unifiedEventsCollection.updateOne(
                {
                  userId,
                  eventId: event.eventId
                },
                {
                  $set: {
                    'sourceMetadata.graphEventId': createdEvent.id,
                    'sourceMetadata.syncStatus': 'synced',
                    'sourceMetadata.syncedAt': new Date(),
                    'graphData.id': createdEvent.id,
                    'graphData.webLink': createdEvent.webLink
                  }
                }
              );

              stats.synced++;
              streamProgress({
                type: 'progress',
                message: `Synced to calendar (row ${rowIndex}): ${event.graphData.subject}`,
                row: rowIndex,
                action: 'synced',
                eventId: createdEvent.id
              });

            } else {
              const errorData = await graphResponse.json();
              throw new Error(errorData.error?.message || 'Failed to create calendar event');
            }

          } catch (syncError) {
            stats.syncFailed++;

            // Update database record with sync failure
            await unifiedEventsCollection.updateOne(
              {
                userId,
                eventId: event.eventId
              },
              {
                $set: {
                  'sourceMetadata.syncStatus': 'failed',
                  'sourceMetadata.syncError': syncError.message,
                  'sourceMetadata.syncAttemptedAt': new Date()
                }
              }
            );

            streamProgress({
              type: 'warning',
              message: `Failed to sync row ${rowIndex}: ${syncError.message}`,
              row: rowIndex,
              action: 'sync_failed'
            });
          }
        }
      }
    }

    // Final summary
    streamProgress({
      type: 'complete',
      message: 'Import completed successfully',
      summary: {
        total: csvData.length,
        processed: stats.processed,
        created: stats.created,
        updated: stats.updated,
        skipped: stats.skipped,
        synced: stats.synced,
        syncFailed: stats.syncFailed,
        errors: stats.errors.length
      }
    });

    logger.info('CSV import with calendar sync completed:', {
      userId,
      targetCalendarId,
      syncToCalendar,
      totalRows: csvData.length,
      created: stats.created,
      updated: stats.updated,
      synced: stats.synced,
      syncFailed: stats.syncFailed,
      errors: stats.errors.length
    });

    res.end();

  } catch (error) {
    logger.error('Error executing CSV import with calendar:', error);
    try {
      res.write(JSON.stringify({
        type: 'error',
        message: 'Failed to execute CSV import: ' + error.message
      }) + '\n');
      res.end();
    } catch (resError) {
      logger.error('Error writing error response:', resError);
    }
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
    
    // Check if collections are initialized
    if (!unifiedEventsCollection || !calendarDeltasCollection) {
      logger.error('Collections not initialized in cache overview');
      return res.status(500).json({ error: 'Database collections not initialized' });
    }
    
    // Basic unified events statistics
    const totalEvents = await unifiedEventsCollection.countDocuments({ userId: userId });
    const deletedCount = await unifiedEventsCollection.countDocuments({ 
      userId: userId,
      isDeleted: true 
    });
    const activeEvents = totalEvents - deletedCount;
    
    // Events with internal data (enriched)
    const enrichedCount = await unifiedEventsCollection.countDocuments({
      userId: userId,
      isDeleted: { $ne: true },
      $or: [
        { "internalData.mecCategories.0": { $exists: true } },
        { "internalData.setupMinutes": { $gt: 0 } },
        { "internalData.teardownMinutes": { $gt: 0 } },
        { "internalData.internalNotes": { $ne: "" } }
      ]
    });
    
    // Events by calendar breakdown
    const eventsByCalendar = await unifiedEventsCollection.aggregate([
      { $match: { userId: userId, isDeleted: { $ne: true } } },
      { $unwind: "$sourceCalendars" },
      { $group: { 
        _id: "$sourceCalendars.calendarId", 
        calendarName: { $first: "$sourceCalendars.calendarName" },
        role: { $first: "$sourceCalendars.role" },
        count: { $sum: 1 },
        oldestSynced: { $min: "$lastSyncedAt" },
        newestSynced: { $max: "$lastSyncedAt" }
      }},
      { $sort: { count: -1 } }
    ]).toArray();
    
    // Recent sync operations (last 24 hours)
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentOperations = await unifiedEventsCollection.find({
      userId: userId,
      lastSyncedAt: { $gte: last24Hours }
    })
    .sort({ lastSyncedAt: -1 })
    .limit(10)
    .project({
      eventId: 1,
      "graphData.subject": 1,
      calendarId: 1,
      lastSyncedAt: 1,
      sourceCalendars: 1
    })
    .toArray();
    
    // Delta token information
    const deltaTokens = await calendarDeltasCollection.find({ userId: userId }).toArray();
    
    // Storage utilization for new collections
    const unifiedCollectionStats = await db.collection('templeEvents__Events').stats();
    const deltaCollectionStats = await db.collection('templeEvents__CalendarDeltas').stats();
    
    // Legacy cache stats removed - eventCacheCollection no longer exists
    let legacyCacheStats = null;
    
    res.status(200).json({
      userId: userId,
      systemType: 'unified_events',
      statistics: {
        totalEvents: totalEvents,
        activeEvents: activeEvents,
        deletedEvents: deletedCount,
        enrichedEvents: enrichedCount,
        enrichmentRatio: totalEvents > 0 ? ((enrichedCount / totalEvents) * 100).toFixed(2) : 0
      },
      eventsByCalendar: eventsByCalendar,
      deltaTokens: deltaTokens.map(dt => ({
        calendarId: dt.calendarId,
        lastDeltaSync: dt.lastDeltaSync,
        fullSyncRequired: dt.fullSyncRequired,
        hasValidToken: !!dt.deltaToken
      })),
      recentOperations: recentOperations.map(op => ({
        eventId: op.eventId,
        calendarId: op.calendarId,
        subject: op.graphData?.subject || 'Unknown',
        lastSyncedAt: op.lastSyncedAt,
        sourceCalendars: op.sourceCalendars?.map(sc => sc.calendarName).join(', ') || op.calendarId
      })),
      storage: {
        unifiedEvents: {
          totalSize: unifiedCollectionStats.size,
          indexSize: unifiedCollectionStats.totalIndexSize,
          documentCount: unifiedCollectionStats.count
        },
        deltaTokens: {
          totalSize: deltaCollectionStats.size,
          indexSize: deltaCollectionStats.totalIndexSize,
          documentCount: deltaCollectionStats.count
        },
        legacy: legacyCacheStats
      },
      configuration: {
        deltaQueryEnabled: true,
        multiCalendarSupport: true,
        autoSync: true
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
    logger.debug('Admin unified events request:', { userId, query: req.query });
    
    // Check if we have a valid userId
    if (!userId) {
      logger.error('No userId found in request');
      return res.status(400).json({ error: 'User ID not found' });
    }
    
    // Check if unifiedEventsCollection is initialized
    if (!unifiedEventsCollection) {
      logger.error('unifiedEventsCollection is not initialized');
      return res.status(500).json({ error: 'Unified events collection not initialized' });
    }
    
    const { 
      page = 1, 
      limit, 
      calendarId, 
      status, 
      search,
      sortBy = 'lastSyncedAt',
      sortOrder = 'desc',
      categories,
      locations,
      startDate,
      endDate
    } = req.query;
    
    // Parse numeric parameters
    const pageNum = parseInt(page);
    // Handle null limit (return all results)
    const limitNum = (limit === null || limit === 'null' || limit === undefined || limit === '') ? null : parseInt(limit);
    
    logger.debug('=== PAGINATION DEBUG ===');
    logger.debug('Raw limit parameter:', limit, '(type:', typeof limit, ')');
    logger.debug('Parsed limitNum:', limitNum, '(type:', typeof limitNum, ')');
    logger.debug('Will apply pagination:', limitNum !== null);
    logger.debug('=== END PAGINATION DEBUG ===');
    
    // Build query for unified events
    const query = { userId: userId };
    
    // Apply calendar filter
    if (calendarId) {
      query["sourceCalendars.calendarId"] = calendarId;
    }
    
    // Apply status filter
    if (status === 'deleted') {
      query.isDeleted = true;
    } else if (status === 'active') {
      query.isDeleted = { $ne: true };
    } else if (status === 'enriched') {
      query.isDeleted = { $ne: true };
      query.$or = [
        { "internalData.mecCategories.0": { $exists: true } },
        { "internalData.setupMinutes": { $gt: 0 } },
        { "internalData.teardownMinutes": { $gt: 0 } },
        { "internalData.internalNotes": { $ne: "" } }
      ];
    } else {
      // Default to active events
      query.isDeleted = { $ne: true };
    }
    
    // Apply category filter
    if (categories) {
      const categoryList = categories.split(',').map(cat => cat.trim());
      
      // Handle "Uncategorized" special case
      if (categoryList.includes('Uncategorized')) {
        const otherCategories = categoryList.filter(cat => cat !== 'Uncategorized');
        
        if (otherCategories.length > 0) {
          // Include both uncategorized events AND events with specified categories
          query.$or = [
            // Uncategorized events (no categories in either location)
            {
              $and: [
                { $or: [
                  { "graphData.categories": { $exists: false } },
                  { "graphData.categories": { $size: 0 } }
                ]},
                { $or: [
                  { "internalData.mecCategories": { $exists: false } },
                  { "internalData.mecCategories": { $size: 0 } }
                ]}
              ]
            },
            // Events with specified categories
            {
              $or: [
                { "graphData.categories": { $in: otherCategories } },
                { "internalData.mecCategories": { $in: otherCategories } }
              ]
            }
          ];
        } else {
          // Only uncategorized events
          query.$and = [
            { $or: [
              { "graphData.categories": { $exists: false } },
              { "graphData.categories": { $size: 0 } }
            ]},
            { $or: [
              { "internalData.mecCategories": { $exists: false } },
              { "internalData.mecCategories": { $size: 0 } }
            ]}
          ];
        }
      } else {
        // Regular category filtering - check both graphData and internalData
        query.$or = [
          { "graphData.categories": { $in: categoryList } },
          { "internalData.mecCategories": { $in: categoryList } }
        ];
      }
    }
    
    // Apply location filter
    if (locations) {
      const locationList = locations.split(',').map(loc => loc.trim());
      // Use regex for partial matching (case-insensitive)
      const locationRegexes = locationList.map(loc => new RegExp(loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
      query["graphData.location.displayName"] = { $in: locationRegexes };
    }
    
    // Apply date range filter
    logger.debug('=== DATE FILTERING DEBUG ===');
    logger.debug('Raw startDate parameter:', startDate, '(type:', typeof startDate, ')');
    logger.debug('Raw endDate parameter:', endDate, '(type:', typeof endDate, ')');
    logger.debug('Query state before date filtering:', JSON.stringify(query, null, 2));
    
    if (startDate || endDate) {
      const dateConditions = [];
      
      if (startDate) {
        const startDateTime = new Date(startDate);
        logger.debug('Parsed startDateTime:', startDateTime, '(valid:', !isNaN(startDateTime.getTime()), ')');
        // Event must end after the start date (event doesn't end before range starts)
        // Use ISO string since that's how dates are stored in CSV import
        const startCondition = { "graphData.end.dateTime": { $gt: startDateTime.toISOString() } };
        dateConditions.push(startCondition);
        logger.debug('Added start condition (overlap):', JSON.stringify(startCondition));
      }
      
      if (endDate) {
        // Event must start before the end date (event doesn't start after range ends)
        const endDateTime = new Date(endDate);
        endDateTime.setDate(endDateTime.getDate() + 1); // Include events ending on the end date
        logger.debug('Parsed endDateTime (with +1 day):', endDateTime, '(valid:', !isNaN(endDateTime.getTime()), ')');
        // Use ISO string since that's how dates are stored in CSV import
        const endCondition = { "graphData.start.dateTime": { $lt: endDateTime.toISOString() } };
        dateConditions.push(endCondition);
        logger.debug('Added end condition (overlap):', JSON.stringify(endCondition));
      }
      
      // Add date conditions to the query using $and
      if (dateConditions.length > 0) {
        if (query.$and) {
          query.$and.push(...dateConditions);
        } else {
          query.$and = dateConditions;
        }
        logger.debug('Applied date conditions to query. Total $and conditions:', query.$and.length);
      }
    } else {
      logger.debug('No date filtering applied - startDate and endDate are both falsy');
    }
    logger.debug('Query state after date filtering:', JSON.stringify(query, null, 2));
    logger.debug('=== END DATE FILTERING DEBUG ===');
    
    logger.debug('Executing query for unified events');
    logger.debug('MongoDB query:', JSON.stringify(query, null, 2));
    logger.debug('Query parameters:', { categories, locations, startDate, endDate, search, sortBy, sortOrder });
    
    const allEvents = await unifiedEventsCollection.find(query).toArray();
    logger.debug('Found total events for user:', allEvents.length);
    
    // Debug: Show sample event dates to understand format
    if (allEvents.length > 0) {
      logger.debug('=== SAMPLE EVENT DATES DEBUG ===');
      const sampleEvents = allEvents.slice(0, 3);
      sampleEvents.forEach((event, index) => {
        logger.debug(`Event ${index + 1}:`, {
          subject: event.graphData?.subject,
          startTime: event.graphData?.start?.dateTime,
          endTime: event.graphData?.end?.dateTime,
          startType: typeof event.graphData?.start?.dateTime,
          endType: typeof event.graphData?.end?.dateTime
        });
      });
      logger.debug('=== END SAMPLE EVENT DATES DEBUG ===');
    }
    
    // Apply search filter in memory (easier than complex MongoDB text search)
    let filteredEvents = allEvents;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredEvents = filteredEvents.filter(event => 
        (event.graphData?.subject || '').toLowerCase().includes(searchLower) ||
        (event.eventId || '').toLowerCase().includes(searchLower) ||
        (event.graphData?.location?.displayName || '').toLowerCase().includes(searchLower) ||
        (event.calendarId || '').toLowerCase().includes(searchLower)
      );
    }
    
    // Sort in memory
    filteredEvents.sort((a, b) => {
      if (sortBy === 'lastSyncedAt') {
        const dateA = new Date(a.lastSyncedAt || 0);
        const dateB = new Date(b.lastSyncedAt || 0);
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      } else if (sortBy === 'subject') {
        const subjectA = (a.graphData?.subject || '').toLowerCase();
        const subjectB = (b.graphData?.subject || '').toLowerCase();
        const result = subjectA.localeCompare(subjectB);
        return sortOrder === 'desc' ? -result : result;
      } else if (sortBy === 'startTime') {
        const dateA = new Date(a.graphData?.start?.dateTime || 0);
        const dateB = new Date(b.graphData?.start?.dateTime || 0);
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      }
      return 0;
    });
    
    // Apply pagination in memory
    const totalCount = filteredEvents.length;
    let paginatedEvents;
    
    if (limitNum === null) {
      // Return all results when no limit is specified
      paginatedEvents = filteredEvents;
    } else {
      // Apply pagination when limit is specified
      const startIdx = (pageNum - 1) * limitNum;
      paginatedEvents = filteredEvents.slice(startIdx, startIdx + limitNum);
    }
    
    res.status(200).json({
      events: paginatedEvents.map(event => ({
        _id: event._id,
        eventId: event.eventId,
        calendarId: event.calendarId,
        calendarName: event.calendarName,
        subject: event.graphData?.subject || 'Unknown',
        startTime: event.graphData?.start?.dateTime,
        endTime: event.graphData?.end?.dateTime,
        location: event.graphData?.location?.displayName,
        // Include full graphData and internalData for compatibility
        graphData: event.graphData,
        internalData: event.internalData,
        // Also include flattened fields for backward compatibility
        categories: event.graphData?.categories || [],
        lastSyncedAt: event.lastSyncedAt,
        lastAccessedAt: event.lastAccessedAt,
        isDeleted: event.isDeleted,
        etag: event.etag,
        changeKey: event.changeKey,
        sourceCalendars: event.sourceCalendars || [],
        hasInternalData: Object.keys(event.internalData || {}).some(key => 
          event.internalData[key] && 
          (Array.isArray(event.internalData[key]) ? event.internalData[key].length > 0 : true)
        )
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalCount: totalCount,
        totalPages: limitNum === null ? 1 : Math.ceil(totalCount / limitNum)
      },
      filters: {
        calendarId,
        status,
        search,
        sortBy,
        sortOrder,
        categories,
        locations,
        startDate,
        endDate
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
    const { eventIds, calendarIds } = req.body;
    
    if (!eventIds && !calendarIds) {
      return res.status(400).json({ error: 'eventIds array or calendarIds array is required' });
    }
    
    let refreshedCount = 0;
    let errorCount = 0;
    const errors = [];
    
    if (eventIds && Array.isArray(eventIds)) {
      // Refresh specific events by marking them for re-sync
      for (const eventId of eventIds) {
        try {
          const result = await unifiedEventsCollection.updateOne(
            { userId: userId, eventId: eventId },
            { 
              $set: { 
                lastAccessedAt: new Date(),
                // Could add a flag to force refresh on next sync
                forceRefresh: true
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
    }
    
    if (calendarIds && Array.isArray(calendarIds)) {
      // Reset delta tokens to force full sync
      for (const calendarId of calendarIds) {
        try {
          await resetDeltaToken(userId, calendarId);
          refreshedCount++;
        } catch (error) {
          errorCount++;
          errors.push({
            calendarId: calendarId,
            error: error.message
          });
        }
      }
    }
    
    res.status(200).json({
      message: 'Refresh completed',
      refreshedCount: refreshedCount,
      errorCount: errorCount,
      errors: errors.length > 0 ? errors : undefined,
      note: calendarIds ? 'Delta tokens reset - next sync will be full' : 'Events marked for refresh'
    });
  } catch (error) {
    logger.error('Error refreshing events:', error);
    res.status(500).json({ error: 'Failed to refresh events' });
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
    
    // eventCacheCollection removed - no longer exists
    const deleteResult = { deletedCount: 0 };

    res.status(200).json({
      message: `Cache cleanup operation no longer available - cache system migrated to unified events collection`,
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
    
    // Fetch events from unified collection without sorting to avoid index issues
    const events = await unifiedEventsCollection
      .find(query)
      .limit(1000) // Increased limit for exports
      .toArray();

    // Sort in memory instead
    events.sort((a, b) => {
      const dateA = new Date(a.graphData?.start?.dateTime || 0);
      const dateB = new Date(b.graphData?.start?.dateTime || 0);
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
    const categories = await unifiedEventsCollection.distinct('internalData.mecCategories');
    
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

/**
 * Helper function - Process virtual location for events
 * Detects if location is a URL and enriches with virtual meeting metadata
 * @param {object} event - Event object from Graph API
 * @param {object} db - MongoDB database instance
 * @returns {object} Processed event with virtual location metadata
 */
async function processVirtualLocation(event, db) {
  // Check if event has a location and if it's a URL
  const locationDisplayName = event.location?.displayName;

  if (!locationDisplayName || !isVirtualLocation(locationDisplayName)) {
    // Not a virtual location, return event as-is
    return event;
  }

  // It's a virtual meeting! Add virtual location metadata
  const virtualPlatform = getVirtualPlatform(locationDisplayName);

  // Enhance the location object with virtual meeting metadata
  if (!event.location) {
    event.location = {};
  }

  // Store the original URL
  event.location.virtualMeetingUrl = locationDisplayName;
  event.location.isVirtual = true;
  event.location.virtualPlatform = virtualPlatform;

  // Find the Virtual Meeting location ID from the database
  try {
    const virtualLocationDoc = await db.collection('templeEvents__Locations').findOne({
      name: 'Virtual Meeting'
    });

    if (virtualLocationDoc) {
      // Store the Virtual Meeting location ID for later assignment
      event._virtualLocationId = virtualLocationDoc._id;
    } else {
      logger.warn('Virtual Meeting location not found in database');
    }
  } catch (error) {
    logger.error('Error fetching Virtual Meeting location:', error);
  }

  return event;
}

/**
 * Manual sync endpoint - Creates enriched templeEvents__Events records for loaded events
 */
app.post('/api/internal-events/sync', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { events, dateRange, calendarId } = req.body;
    
    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: 'events array is required' });
    }
    
    if (!calendarId) {
      return res.status(400).json({ error: 'calendarId is required' });
    }
    
    logger.debug(`[MANUAL SYNC] Starting manual sync for user ${userId}`, {
      eventCount: events.length,
      dateRange,
      calendarId,
      collectionName: 'templeEvents__Events',
      endpoint: '/api/internal-events/sync'
    });
    
    let enrichedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    const errors = [];
    
    for (const event of events) {
      try {
        // Skip events without IDs
        if (!event.id) {
          logger.warn('Skipping event without ID:', event.subject);
          continue;
        }

        // Process virtual location detection
        await processVirtualLocation(event, db);

        // Check if unified event already exists
        const existingUnified = await unifiedEventsCollection.findOne({
          eventId: event.id,
          userId: userId
        });

        const now = new Date();

        // Prepare source calendars array
        const sourceCalendars = [{
          calendarId: calendarId,
          calendarName: calendarId?.includes('TempleRegistration') ? 'Temple Registrations' : 'Calendar',
          role: calendarId?.includes('TempleRegistration') ? 'shared' : 'primary'
        }];

        // Prepare locations array - preserve existing or assign Virtual Meeting location
        let locations = existingUnified?.locations || [];
        let locationDisplayNames = existingUnified?.locationDisplayNames || '';
        let locationId = existingUnified?.locationId || null;

        if (event._virtualLocationId) {
          // This is a virtual meeting - assign the Virtual Meeting location
          locations = [event._virtualLocationId];
          locationDisplayNames = 'Virtual Meeting';
          locationId = event._virtualLocationId;
        }
        // Otherwise preserve existing location data (or leave empty if none)

        // Prepare unified event structure
        const unifiedEventData = {
          userId: userId,
          calendarId: calendarId,
          eventId: event.id,

          // Location assignments (preserved from existing or set for virtual meetings)
          locations: locations,
          locationDisplayNames: locationDisplayNames,
          locationId: locationId,

          // Graph API data (source of truth)
          graphData: {
            id: event.id,
            subject: event.subject,
            start: event.start,
            end: event.end,
            location: event.location || { displayName: '' },
            categories: event.categories || [],
            bodyPreview: event.bodyPreview || '',
            body: event.body || null, // Include body object for full description content
            importance: event.importance || 'normal',
            showAs: event.showAs || 'busy',
            sensitivity: event.sensitivity || 'normal',
            isAllDay: event.isAllDay || false,
            seriesMasterId: event.seriesMasterId || null,
            type: event.type || 'singleInstance',
            recurrence: event.recurrence || null,
            responseStatus: event.responseStatus || { response: 'none' },
            attendees: event.attendees || [],
            organizer: event.organizer || { emailAddress: { name: '', address: '' } },
            extensions: event.extensions || [],
            singleValueExtendedProperties: event.singleValueExtendedProperties || [],
            lastModifiedDateTime: event.lastModifiedDateTime || now.toISOString(),
            createdDateTime: event.createdDateTime || now.toISOString()
          },
          
          // Internal enrichment data (preserve existing or set defaults)
          internalData: existingUnified?.internalData || {
            mecCategories: [],
            setupMinutes: 0,
            teardownMinutes: 0,
            registrationNotes: '',
            assignedTo: '',
            internalNotes: '',
            setupStatus: 'pending',
            estimatedCost: null,
            actualCost: null
          },
          
          // Source calendars tracking
          sourceCalendars: sourceCalendars,
          
          // Metadata
          etag: event.etag || null,
          changeKey: event.changeKey || null,
          isDeleted: false,
          lastSyncedAt: now,
          lastAccessedAt: now,
          cachedAt: now
        };
        
        if (existingUnified) {
          // Update existing unified event (preserve internal data and merge source calendars)
          const mergedSourceCalendars = [...(existingUnified.sourceCalendars || [])];
          
          // Add current calendar if not already in source calendars
          if (!mergedSourceCalendars.find(sc => sc.calendarId === calendarId)) {
            mergedSourceCalendars.push(sourceCalendars[0]);
          }
          
          const updateResult = await unifiedEventsCollection.updateOne(
            { _id: existingUnified._id },
            { 
              $set: {
                ...unifiedEventData,
                sourceCalendars: mergedSourceCalendars,
                // Preserve existing internal data
                internalData: existingUnified.internalData || unifiedEventData.internalData,
                updatedAt: now
              }
            }
          );
          
          if (updateResult.modifiedCount > 0) {
            updatedCount++;
            enrichedCount++;
            logger.debug(`[MANUAL SYNC] Updated unified event in templeEvents__Events: ${event.subject}`, {
              eventId: event.id,
              collection: 'templeEvents__Events'
            });
          }
        } else {
          // Create new unified event
          const insertResult = await unifiedEventsCollection.insertOne({
            ...unifiedEventData,
            createdAt: now,
            updatedAt: now
          });
          
          if (insertResult.insertedId) {
            createdCount++;
            enrichedCount++;
            logger.debug(`[MANUAL SYNC] Created unified event in templeEvents__Events: ${event.subject}`, {
              eventId: event.id,
              insertedId: insertResult.insertedId,
              collection: 'templeEvents__Events'
            });
          }
        }
        
      } catch (eventError) {
        logger.error(`Error processing event ${event.id}:`, eventError);
        errors.push({
          eventId: event.id,
          subject: event.subject,
          error: eventError.message
        });
      }
    }
    
    const result = {
      success: true,
      enrichedCount,
      createdCount,
      updatedCount,
      totalProcessed: events.length,
      errors: errors.length > 0 ? errors : undefined,
      dateRange
    };
    
    logger.debug('[MANUAL SYNC] Manual sync completed successfully:', {
      ...result,
      collection: 'templeEvents__Events',
      userId
    });
    res.status(200).json(result);
    
  } catch (error) {
    logger.error('Error in manual sync:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to sync events to database',
      details: error.message 
    });
  }
});

// ==========================================
// ROOM RESERVATION ENDPOINTS
// ==========================================

/**
 * Get all available rooms
 */
app.get('/api/rooms', async (req, res) => {
  try {
    logger.debug('Getting reservable rooms from templeEvents__Locations collection');

    // Query the locations collection for reservable rooms
    const rooms = await db.collection('templeEvents__Locations').find({
      isReservable: true,
      active: { $ne: false } // Include locations that are not explicitly set to false
    }).sort({ name: 1 }).toArray();

    // Transform to consistent format (ensure name field exists)
    const transformedRooms = rooms.map(room => ({
      _id: room._id,
      name: room.name || room.displayName || 'Unnamed Room',
      displayName: room.displayName || room.name,
      description: room.description || '',
      building: room.building || '',
      floor: room.floor || '',
      capacity: room.capacity || 0,
      features: room.features || [],
      accessibility: room.accessibility || [],
      active: room.active !== false,
      notes: room.notes || '',
      locationCode: room.locationCode || '',
      isReservable: room.isReservable || false
    }));

    logger.debug(`Reservable rooms loaded successfully: ${transformedRooms.length} rooms found`);

    // Return the rooms array
    res.status(200).json(transformedRooms);

  } catch (error) {
    console.error('Error in rooms endpoint:', error);
    logger.error('Error in rooms endpoint:', error);

    // Return empty array instead of hardcoded fallback
    // Frontend should handle empty state gracefully
    logger.warn('Database error - returning empty rooms array');
    res.status(200).json([]);
  }
});

/**
 * Get all available locations from templeEvents__Locations collection
 */
app.get('/api/locations', async (req, res) => {
  try {
    logger.debug('Getting locations from templeEvents__Locations collection');
    
    // Query the locations collection
    const locations = await db.collection('templeEvents__Locations').find({
      active: { $ne: false } // Include locations that are not explicitly set to false
    }).sort({ name: 1 }).toArray();
    
    // Transform to consistent format (ensure name field exists)
    const transformedLocations = locations.map(location => ({
      _id: location._id,
      name: location.name || location.displayName || 'Unnamed Location',
      displayName: location.displayName || location.name,
      description: location.description || '',
      building: location.building || '',
      floor: location.floor || '',
      capacity: location.capacity || 0,
      features: location.features || [],
      accessibility: location.accessibility || [],
      active: location.active !== false,
      notes: location.notes || '',
      locationCode: location.locationCode || '',
      isReservable: location.isReservable || false, // Required for frontend filtering
      // Include additional metadata if present
      ...(location.coordinates && { coordinates: location.coordinates }),
      ...(location.address && { address: location.address }),
      ...(location.contactInfo && { contactInfo: location.contactInfo })
    }));
    
    logger.debug(`Locations loaded successfully: ${transformedLocations.length} locations found`);
    
    // Return the locations array
    res.status(200).json(transformedLocations);
    
  } catch (error) {
    console.error('Error in locations endpoint:', error);
    logger.error('Error in locations endpoint:', error);
    
    // Return empty array instead of hardcoded fallback locations
    // Frontend should handle empty state gracefully
    logger.warn('Database error - returning empty locations array');
    res.status(200).json([]);
  }
});

/**
 * Get room availability for a specific date range
 */
app.get('/api/rooms/availability', async (req, res) => {
  try {
    const { startDateTime, endDateTime, roomIds, setupTimeMinutes = 0, teardownTimeMinutes = 0 } = req.query;
    
    if (!startDateTime || !endDateTime) {
      return res.status(400).json({ error: 'startDateTime and endDateTime are required' });
    }
    
    const eventStart = new Date(startDateTime);
    const eventEnd = new Date(endDateTime);
    
    // Calculate buffer times
    const setupMinutes = parseInt(setupTimeMinutes) || 0;
    const teardownMinutes = parseInt(teardownTimeMinutes) || 0;
    
    // Extended time window including setup/teardown buffers
    const start = new Date(eventStart.getTime() - (setupMinutes * 60 * 1000));
    const end = new Date(eventEnd.getTime() + (teardownMinutes * 60 * 1000));

    // Query locations from templeEvents__Locations collection (rooms are locations with isReservable: true)
    let locationQuery = { isReservable: true, active: true };

    // If specific roomIds requested, filter to those locations
    if (roomIds) {
      const requestedRoomIds = roomIds.split(',').map(id => id.trim()).filter(id => id);

      // Validate and convert to ObjectIds
      const validObjectIds = [];
      for (const id of requestedRoomIds) {
        try {
          validObjectIds.push(new ObjectId(id));
        } catch (err) {
          logger.warn(`Invalid room ID format: ${id}`);
        }
      }

      // Only add $in filter if we have valid ObjectIds
      if (validObjectIds.length > 0) {
        locationQuery._id = { $in: validObjectIds };
      } else {
        // If no valid IDs provided, return empty array (no rooms to check)
        return res.json([]);
      }
    }

    // Fetch rooms from database
    const rooms = await locationsCollection.find(locationQuery).toArray();
    
    // Get ALL reservations for the requested time period
    // Return all events so frontend can display full day schedule and dynamically calculate conflicts
    const allReservations = await roomReservationsCollection.find({
      status: { $in: ['pending', 'approved'] },
      // Get all reservations that fall within the requested date range
      startDateTime: { $lt: new Date(end.getTime() + (8 * 60 * 60 * 1000)) }, // Add 8 hours buffer for query
      endDateTime: { $gt: new Date(start.getTime() - (8 * 60 * 60 * 1000)) }   // Subtract 8 hours buffer for query
    }).toArray();

    // Get ALL calendar events for the requested time period
    // Build $or query only if we have rooms with names
    const roomNames = rooms.map(room => room.name || room.displayName).filter(name => name);

    let allEvents = [];
    if (roomNames.length > 0) {
      allEvents = await unifiedEventsCollection.find({
        isDeleted: false,
        startTime: { $lt: end },
        endTime: { $gt: start },
        $or: roomNames.map(name => ({ location: { $regex: name, $options: 'i' } }))
      }).toArray();
    }
    
    // Helper function to format time for display
    const formatTime = (date) => date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    
    // Build availability response with detailed conflict information
    const availability = rooms.map(room => {
      const roomIdString = room._id.toString();

      // Get ALL reservations for this room
      const roomReservations = allReservations.filter(res =>
        res.requestedRooms.some(reqRoomId => reqRoomId.toString() === roomIdString)
      );

      // Get ALL events for this room
      const roomEvents = allEvents.filter(event =>
        event.location && event.location.toLowerCase().includes(room.name.toLowerCase())
      );

      // Return detailed reservation data (frontend will calculate conflicts dynamically)
      const detailedReservationConflicts = roomReservations.map(res => {
        let effectiveStart, effectiveEnd;

        // Smart calculation: Try stored values first, then time-based, then minutes-based
        if (res.effectiveStart && res.effectiveEnd) {
          // New reservations have these stored (post time-blocking update)
          effectiveStart = res.effectiveStart;
          effectiveEnd = res.effectiveEnd;
        } else if (res.setupTime || res.teardownTime) {
          // Calculate from time-based fields
          const baseStart = new Date(res.startDateTime);
          const baseEnd = new Date(res.endDateTime);

          if (res.setupTime) {
            const [setupHours, setupMinutes] = res.setupTime.split(':').map(Number);
            effectiveStart = new Date(baseStart);
            effectiveStart.setHours(setupHours, setupMinutes, 0, 0);
          } else {
            effectiveStart = baseStart;
          }

          if (res.teardownTime) {
            const [teardownHours, teardownMinutes] = res.teardownTime.split(':').map(Number);
            effectiveEnd = new Date(baseEnd);
            effectiveEnd.setHours(teardownHours, teardownMinutes, 0, 0);
          } else {
            effectiveEnd = baseEnd;
          }
        } else {
          // Fall back to minutes-based calculation (old reservations)
          const resSetupMinutes = res.setupTimeMinutes || 0;
          const resTeardownMinutes = res.teardownTimeMinutes || 0;
          effectiveStart = new Date(res.startDateTime.getTime() - (resSetupMinutes * 60 * 1000));
          effectiveEnd = new Date(res.endDateTime.getTime() + (resTeardownMinutes * 60 * 1000));
        }

        return {
          id: res._id,
          eventTitle: res.eventTitle,
          requesterName: res.requesterName,
          status: res.status,
          originalStart: res.startDateTime,
          originalEnd: res.endDateTime,
          effectiveStart,
          effectiveEnd,
          setupTimeMinutes: res.setupTimeMinutes || 0,
          teardownTimeMinutes: res.teardownTimeMinutes || 0
        };
      });

      // Return detailed event data (frontend will calculate conflicts dynamically)
      const detailedEventConflicts = roomEvents.map(event => ({
        id: event._id,
        subject: event.subject,
        organizer: event.organizer?.emailAddress?.name || event.organizer?.name || 'Unknown',
        start: event.startTime,
        end: event.endTime,
        location: event.location
      }));

      // Frontend calculates conflicts dynamically based on user's current time selection
      // This allows real-time updates as user drags events in scheduling assistant
      return {
        room,
        conflicts: {
          reservations: detailedReservationConflicts,
          events: detailedEventConflicts,
          totalConflicts: detailedReservationConflicts.length + detailedEventConflicts.length
        }
      };
    });

    res.json(availability);
  } catch (error) {
    logger.error('Error checking room availability:', error);
    res.status(500).json({ error: 'Failed to check room availability' });
  }
});

/**
 * Submit a room reservation request (authenticated users)
 */
app.post('/api/room-reservations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    const {
      eventTitle,
      eventDescription,
      startDateTime,
      endDateTime,
      attendeeCount,
      requestedRooms,
      requiredFeatures,
      specialRequirements,
      department,
      phone,
      priority = 'medium',
      // Setup/teardown times (in minutes)
      setupTimeMinutes = 0,
      teardownTimeMinutes = 0,
      // Access & Operations Times
      setupTime,
      teardownTime,
      doorOpenTime,
      doorCloseTime,
      // Internal Notes
      setupNotes,
      doorNotes,
      eventNotes,
      // New delegation fields
      isOnBehalfOf = false,
      contactName,
      contactEmail
    } = req.body;
    
    // Validation
    if (!eventTitle || !startDateTime || !endDateTime || !requestedRooms || requestedRooms.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required fields: eventTitle, startDateTime, endDateTime, requestedRooms' 
      });
    }
    
    // Validate delegation fields if on behalf of someone else
    if (isOnBehalfOf) {
      if (!contactName || !contactEmail) {
        return res.status(400).json({
          error: 'Contact name and email are required when submitting on behalf of someone else'
        });
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactEmail)) {
        return res.status(400).json({
          error: 'Invalid contact email format'
        });
      }
    }

    // Calculate effective blocking times (setup to teardown)
    const baseStart = new Date(startDateTime);
    const baseEnd = new Date(endDateTime);

    // If setup time is provided, use it as the effective start
    let effectiveStart = baseStart;
    if (setupTime) {
      const [setupHours, setupMinutes] = setupTime.split(':').map(Number);
      effectiveStart = new Date(baseStart);
      effectiveStart.setHours(setupHours, setupMinutes, 0, 0);
    }

    // If teardown time is provided, use it as the effective end
    let effectiveEnd = baseEnd;
    if (teardownTime) {
      const [teardownHours, teardownMinutes] = teardownTime.split(':').map(Number);
      effectiveEnd = new Date(baseEnd);
      effectiveEnd.setHours(teardownHours, teardownMinutes, 0, 0);
    }

    // Helper function to create reservation snapshot
    const createReservationSnapshot = (reservationData) => ({
      eventTitle: reservationData.eventTitle,
      eventDescription: reservationData.eventDescription,
      startDateTime: reservationData.startDateTime,
      endDateTime: reservationData.endDateTime,
      attendeeCount: reservationData.attendeeCount,
      requestedRooms: reservationData.requestedRooms,
      requiredFeatures: reservationData.requiredFeatures,
      specialRequirements: reservationData.specialRequirements,
      priority: reservationData.priority,
      contactEmail: reservationData.contactEmail,
      department: reservationData.department,
      phone: reservationData.phone,
      setupTimeMinutes: reservationData.setupTimeMinutes,
      teardownTimeMinutes: reservationData.teardownTimeMinutes,
      // Access & Operations Times
      setupTime: reservationData.setupTime,
      teardownTime: reservationData.teardownTime,
      doorOpenTime: reservationData.doorOpenTime,
      doorCloseTime: reservationData.doorCloseTime,
      // Internal Notes
      setupNotes: reservationData.setupNotes,
      doorNotes: reservationData.doorNotes,
      eventNotes: reservationData.eventNotes
    });

    // Create initial communication history entry
    const initialSubmissionEntry = {
      timestamp: new Date(),
      type: 'submission',
      author: userId,
      authorName: req.user.name || userEmail,
      message: 'Initial reservation submission',
      revisionNumber: 1,
      reservationSnapshot: createReservationSnapshot({
        eventTitle,
        eventDescription: eventDescription || '',
        startDateTime: new Date(startDateTime),
        endDateTime: new Date(endDateTime),
        attendeeCount: attendeeCount || 0,
        requestedRooms,
        requiredFeatures: requiredFeatures || [],
        specialRequirements: specialRequirements || '',
        priority,
        contactEmail: isOnBehalfOf ? contactEmail : null,
        department: department || '',
        phone: phone || '',
        setupTimeMinutes: setupTimeMinutes || 0,
        teardownTimeMinutes: teardownTimeMinutes || 0,
        setupTime: setupTime || null,
        teardownTime: teardownTime || null,
        doorOpenTime: doorOpenTime || null,
        doorCloseTime: doorCloseTime || null,
        setupNotes: setupNotes || '',
        doorNotes: doorNotes || '',
        eventNotes: eventNotes || ''
      })
    };

    // Create reservation record
    const reservation = {
      requesterId: userId,
      requesterName: req.user.name || userEmail,
      requesterEmail: userEmail,
      department: department || '',
      phone: phone || '',

      // Delegation fields
      isOnBehalfOf: isOnBehalfOf,
      contactName: isOnBehalfOf ? contactName : null,
      contactEmail: isOnBehalfOf ? contactEmail : null,

      eventTitle,
      eventDescription: eventDescription || '',
      startDateTime: new Date(startDateTime),
      endDateTime: new Date(endDateTime),
      effectiveStart: effectiveStart, // Used for room blocking (includes setup)
      effectiveEnd: effectiveEnd, // Used for room blocking (includes teardown)
      attendeeCount: attendeeCount || 0,

      requestedRooms,
      requiredFeatures: requiredFeatures || [],
      specialRequirements: specialRequirements || '',

      // Setup and teardown times (legacy minutes)
      setupTimeMinutes: setupTimeMinutes || 0,
      teardownTimeMinutes: teardownTimeMinutes || 0,

      // Access & Operations Times
      setupTime: setupTime || null,
      teardownTime: teardownTime || null,
      doorOpenTime: doorOpenTime || null,
      doorCloseTime: doorCloseTime || null,

      // Internal Notes (staff use only)
      setupNotes: setupNotes || '',
      doorNotes: doorNotes || '',
      eventNotes: eventNotes || '',

      status: 'pending',
      priority,

      // New resubmission fields
      currentRevision: 1,
      resubmissionAllowed: true,
      communicationHistory: [initialSubmissionEntry],

      // Conflict resolution fields
      reviewStatus: 'not_reviewing',
      revisions: [],
      lastModifiedBy: userEmail,

      assignedTo: null,
      reviewNotes: '',
      approvedBy: null,
      actionDate: null,
      rejectionReason: '',
      createdEventIds: [],

      submittedAt: new Date(),
      lastModified: new Date(),
      attachments: []
    };

    // Generate changeKey for the new reservation
    reservation.changeKey = generateChangeKey(reservation);

    const result = await roomReservationsCollection.insertOne(reservation);
    const createdReservation = await roomReservationsCollection.findOne({ _id: result.insertedId });

    // Log audit entry for reservation creation
    await logReservationAudit({
      reservationId: result.insertedId,
      userId: userId,
      userEmail: userEmail,
      changeType: 'create',
      source: 'Space Booking Form',
      metadata: {
        eventTitle: eventTitle,
        rooms: requestedRooms,
        startDateTime: startDateTime,
        endDateTime: endDateTime
      }
    });

    logger.log('Room reservation submitted:', {
      reservationId: result.insertedId,
      requester: userEmail,
      eventTitle,
      rooms: requestedRooms
    });

    res.status(201).json(createdReservation);
  } catch (error) {
    logger.error('Error submitting room reservation:', error);
    res.status(500).json({ error: 'Failed to submit room reservation' });
  }
});

/**
 * Submit a room reservation request using a token (guest users)
 */
app.post('/api/room-reservations/public/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    // Validate token
    const tokenDoc = await reservationTokensCollection.findOne({
      token,
      expiresAt: { $gt: new Date() },
      currentUses: { $lt: 1 }
    });
    
    if (!tokenDoc) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    const {
      requesterName,
      requesterEmail,
      eventTitle,
      eventDescription,
      startDateTime,
      endDateTime,
      attendeeCount,
      requestedRooms,
      requiredFeatures,
      specialRequirements,
      department,
      phone,
      priority = 'medium',
      // Setup/teardown times (in minutes)
      setupTimeMinutes = 0,
      teardownTimeMinutes = 0,
      // Access & Operations Times
      setupTime,
      teardownTime,
      doorOpenTime,
      doorCloseTime,
      // Internal Notes
      setupNotes,
      doorNotes,
      eventNotes,
      // New delegation fields
      isOnBehalfOf = false,
      contactName,
      contactEmail
    } = req.body;
    
    // Validation
    if (!requesterName || !requesterEmail || !eventTitle || !startDateTime || !endDateTime || !requestedRooms || requestedRooms.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required fields: requesterName, requesterEmail, eventTitle, startDateTime, endDateTime, requestedRooms' 
      });
    }
    
    // Validate delegation fields if on behalf of someone else
    if (isOnBehalfOf) {
      if (!contactName || !contactEmail) {
        return res.status(400).json({
          error: 'Contact name and email are required when submitting on behalf of someone else'
        });
      }

      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(contactEmail)) {
        return res.status(400).json({
          error: 'Invalid contact email format'
        });
      }
    }

    // Calculate effective blocking times (setup to teardown)
    const baseStart = new Date(startDateTime);
    const baseEnd = new Date(endDateTime);

    // If setup time is provided, use it as the effective start
    let effectiveStart = baseStart;
    if (setupTime) {
      const [setupHours, setupMinutes] = setupTime.split(':').map(Number);
      effectiveStart = new Date(baseStart);
      effectiveStart.setHours(setupHours, setupMinutes, 0, 0);
    }

    // If teardown time is provided, use it as the effective end
    let effectiveEnd = baseEnd;
    if (teardownTime) {
      const [teardownHours, teardownMinutes] = teardownTime.split(':').map(Number);
      effectiveEnd = new Date(baseEnd);
      effectiveEnd.setHours(teardownHours, teardownMinutes, 0, 0);
    }

    // Mark token as used
    await reservationTokensCollection.updateOne(
      { _id: tokenDoc._id },
      { 
        $inc: { currentUses: 1 },
        $set: { 
          usedAt: new Date(),
          usedBy: requesterEmail 
        }
      }
    );
    
    // Helper function to create reservation snapshot (reuse from authenticated endpoint)
    const createReservationSnapshot = (reservationData) => ({
      eventTitle: reservationData.eventTitle,
      eventDescription: reservationData.eventDescription,
      startDateTime: reservationData.startDateTime,
      endDateTime: reservationData.endDateTime,
      attendeeCount: reservationData.attendeeCount,
      requestedRooms: reservationData.requestedRooms,
      requiredFeatures: reservationData.requiredFeatures,
      specialRequirements: reservationData.specialRequirements,
      priority: reservationData.priority,
      contactEmail: reservationData.contactEmail,
      department: reservationData.department,
      phone: reservationData.phone,
      setupTimeMinutes: reservationData.setupTimeMinutes,
      teardownTimeMinutes: reservationData.teardownTimeMinutes
    });

    // Create initial communication history entry
    const initialSubmissionEntry = {
      timestamp: new Date(),
      type: 'submission',
      author: `guest-${tokenDoc._id}`,
      authorName: requesterName,
      message: 'Initial reservation submission (public form)',
      revisionNumber: 1,
      reservationSnapshot: createReservationSnapshot({
        eventTitle,
        eventDescription: eventDescription || '',
        startDateTime: new Date(startDateTime),
        endDateTime: new Date(endDateTime),
        attendeeCount: attendeeCount || 0,
        requestedRooms,
        requiredFeatures: requiredFeatures || [],
        specialRequirements: specialRequirements || '',
        priority,
        contactEmail: isOnBehalfOf ? contactEmail : null,
        department: department || '',
        phone: phone || '',
        setupTimeMinutes: setupTimeMinutes || 0,
        teardownTimeMinutes: teardownTimeMinutes || 0,
        setupTime: setupTime || null,
        teardownTime: teardownTime || null,
        doorOpenTime: doorOpenTime || null,
        doorCloseTime: doorCloseTime || null,
        setupNotes: setupNotes || '',
        doorNotes: doorNotes || '',
        eventNotes: eventNotes || ''
      })
    };

    // Create reservation record
    const reservation = {
      requesterId: `guest-${tokenDoc._id}`,
      requesterName,
      requesterEmail,
      department: department || '',
      phone: phone || '',
      
      // Delegation fields
      isOnBehalfOf: isOnBehalfOf,
      contactName: isOnBehalfOf ? contactName : null,
      contactEmail: isOnBehalfOf ? contactEmail : null,
      
      eventTitle,
      eventDescription: eventDescription || '',
      startDateTime: new Date(startDateTime),
      endDateTime: new Date(endDateTime),
      effectiveStart: effectiveStart, // Used for room blocking (includes setup)
      effectiveEnd: effectiveEnd, // Used for room blocking (includes teardown)
      attendeeCount: attendeeCount || 0,

      requestedRooms,
      requiredFeatures: requiredFeatures || [],
      specialRequirements: specialRequirements || '',

      // Setup and teardown times (legacy minutes)
      setupTimeMinutes: setupTimeMinutes || 0,
      teardownTimeMinutes: teardownTimeMinutes || 0,

      // Access & Operations Times
      setupTime: setupTime || null,
      teardownTime: teardownTime || null,
      doorOpenTime: doorOpenTime || null,
      doorCloseTime: doorCloseTime || null,

      // Internal Notes (staff use only)
      setupNotes: setupNotes || '',
      doorNotes: doorNotes || '',
      eventNotes: eventNotes || '',

      status: 'pending',
      priority,

      // New resubmission fields
      currentRevision: 1,
      resubmissionAllowed: true,
      communicationHistory: [initialSubmissionEntry],

      // Conflict resolution fields
      reviewStatus: 'not_reviewing',
      revisions: [],
      lastModifiedBy: requesterEmail,

      assignedTo: null,
      reviewNotes: '',
      approvedBy: null,
      actionDate: null,
      rejectionReason: '',
      createdEventIds: [],

      submittedAt: new Date(),
      lastModified: new Date(),
      attachments: [],

      // Token metadata
      tokenUsed: tokenDoc._id,
      sponsoredBy: tokenDoc.createdByEmail
    };

    // Generate changeKey for the new reservation
    reservation.changeKey = generateChangeKey(reservation);

    const result = await roomReservationsCollection.insertOne(reservation);
    const createdReservation = await roomReservationsCollection.findOne({ _id: result.insertedId });

    // Log audit entry for guest reservation creation
    await logReservationAudit({
      reservationId: result.insertedId,
      userId: tokenDoc.createdBy,
      userEmail: requesterEmail,
      changeType: 'create',
      source: 'Guest Reservation Form',
      metadata: {
        eventTitle: eventTitle,
        rooms: requestedRooms,
        startDateTime: startDateTime,
        endDateTime: endDateTime,
        sponsor: tokenDoc.createdByEmail
      }
    });

    logger.log('Guest room reservation submitted:', {
      reservationId: result.insertedId,
      requester: requesterEmail,
      sponsor: tokenDoc.createdByEmail,
      eventTitle,
      rooms: requestedRooms
    });

    res.status(201).json(createdReservation);
  } catch (error) {
    logger.error('Error submitting guest room reservation:', error);
    res.status(500).json({ error: 'Failed to submit room reservation' });
  }
});

/**
 * Get room reservations (filtered by permissions)
 */
app.get('/api/room-reservations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { status, page = 1, limit = 20 } = req.query;
    
    // Build filter based on user permissions
    let filter = {};
    
    // Check if user can view all reservations or just their own
    const user = await usersCollection.findOne({ userId });
    const canViewAll = user?.permissions?.canViewAllReservations || userEmail.includes('admin');
    
    if (!canViewAll) {
      filter.requesterId = userId;
    }
    
    if (status) {
      filter.status = status;
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const reservations = await roomReservationsCollection
      .find(filter)
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();
    
    const total = await roomReservationsCollection.countDocuments(filter);
    
    res.json({
      reservations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error('Error fetching room reservations:', error);
    res.status(500).json({ error: 'Failed to fetch room reservations' });
  }
});

/**
 * Get a specific room reservation
 */
app.get('/api/room-reservations/:id', verifyToken, async (req, res) => {
  try {
    const reservationId = req.params.id;
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    const reservation = await roomReservationsCollection.findOne({ _id: new ObjectId(reservationId) });
    
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    
    // Check permissions
    const user = await usersCollection.findOne({ userId });
    const canViewAll = user?.permissions?.canViewAllReservations || userEmail.includes('admin');
    
    if (!canViewAll && reservation.requesterId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json(reservation);
  } catch (error) {
    logger.error('Error fetching room reservation:', error);
    res.status(500).json({ error: 'Failed to fetch room reservation' });
  }
});

/**
 * Get audit history for a specific room reservation
 */
app.get('/api/room-reservations/:id/audit-history', verifyToken, async (req, res) => {
  try {
    const reservationId = req.params.id;
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { limit = 50, offset = 0 } = req.query;

    // Verify user has access to this reservation
    const reservation = await roomReservationsCollection.findOne({ _id: new ObjectId(reservationId) });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Check permissions
    const user = await usersCollection.findOne({ userId });
    const canViewAll = user?.permissions?.canViewAllReservations || userEmail.includes('admin');

    if (!canViewAll && reservation.requesterId !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get audit history for this reservation
    const auditHistory = await reservationAuditHistoryCollection
      .find({ reservationId: new ObjectId(reservationId) })
      .sort({ timestamp: -1 })
      .skip(parseInt(offset))
      .limit(parseInt(limit))
      .toArray();

    // Get total count for pagination
    const totalCount = await reservationAuditHistoryCollection.countDocuments({
      reservationId: new ObjectId(reservationId)
    });

    res.status(200).json({
      auditHistory,
      pagination: {
        total: totalCount,
        offset: parseInt(offset),
        limit: parseInt(limit),
        hasMore: totalCount > (parseInt(offset) + parseInt(limit))
      }
    });

  } catch (error) {
    logger.error('Error fetching reservation audit history:', error);
    res.status(500).json({ error: 'Failed to fetch audit history' });
  }
});

/**
 * Cancel a room reservation (users can only cancel their own pending reservations)
 */
app.put('/api/room-reservations/:id/cancel', verifyToken, async (req, res) => {
  try {
    const reservationId = req.params.id;
    const userId = req.user.userId;
    const { reason } = req.body;
    
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Cancellation reason is required' });
    }
    
    const reservation = await roomReservationsCollection.findOne({ _id: new ObjectId(reservationId) });
    
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    
    // Only allow users to cancel their own reservations
    if (reservation.requesterId !== userId) {
      return res.status(403).json({ error: 'You can only cancel your own reservation requests' });
    }
    
    // Only allow cancellation of pending requests
    if (reservation.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending reservations can be cancelled' });
    }
    
    // Update the reservation
    const updateResult = await roomReservationsCollection.updateOne(
      { _id: new ObjectId(reservationId) },
      {
        $set: {
          status: 'cancelled',
          cancelReason: reason,
          actionDate: new Date(),
          actionBy: userId
        }
      }
    );
    
    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Log audit entry for cancellation
    await logReservationAudit({
      reservationId: new ObjectId(reservationId),
      userId: userId,
      userEmail: req.user.email,
      changeType: 'cancel',
      source: 'User Cancellation',
      metadata: {
        reason: reason.trim()
      }
    });

    logger.info('Room reservation cancelled:', {
      reservationId,
      cancelledBy: userId,
      reason: reason
    });

    res.json({
      message: 'Reservation cancelled successfully',
      reservationId,
      status: 'cancelled'
    });
  } catch (error) {
    logger.error('Error cancelling room reservation:', error);
    res.status(500).json({ error: 'Failed to cancel reservation' });
  }
});

/**
 * Resubmit a rejected room reservation with changes
 */
app.put('/api/room-reservations/:id/resubmit', verifyToken, async (req, res) => {
  try {
    const reservationId = req.params.id;
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    const {
      eventTitle,
      eventDescription,
      startDateTime,
      endDateTime,
      attendeeCount,
      requestedRooms,
      requiredFeatures,
      specialRequirements,
      department,
      phone,
      priority,
      contactEmail,
      userMessage,
      // Setup/teardown times (in minutes)
      setupTimeMinutes = 0,
      teardownTimeMinutes = 0
    } = req.body;
    
    // Validation
    if (!eventTitle || !startDateTime || !endDateTime || !requestedRooms || requestedRooms.length === 0) {
      return res.status(400).json({ 
        error: 'Missing required fields: eventTitle, startDateTime, endDateTime, requestedRooms' 
      });
    }
    
    if (!userMessage || !userMessage.trim()) {
      return res.status(400).json({
        error: 'Response message is required for resubmissions'
      });
    }
    
    // Find the original reservation
    const reservation = await roomReservationsCollection.findOne({ _id: new ObjectId(reservationId) });
    
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    
    // Only allow users to resubmit their own reservations
    if (reservation.requesterId !== userId) {
      return res.status(403).json({ error: 'You can only resubmit your own reservation requests' });
    }
    
    // Validate resubmission eligibility
    if (reservation.status !== 'rejected') {
      return res.status(400).json({ error: 'Only rejected reservations can be resubmitted' });
    }
    
    if (!reservation.resubmissionAllowed) {
      return res.status(400).json({ error: 'Resubmission has been disabled for this reservation' });
    }
    
    // Check revision limits (max 5 revisions)
    const currentRevision = reservation.currentRevision || 1;
    if (currentRevision >= 5) {
      return res.status(400).json({ error: 'Maximum number of revisions reached (5)' });
    }
    
    
    // Helper function to create reservation snapshot
    const createReservationSnapshot = (reservationData) => ({
      eventTitle: reservationData.eventTitle,
      eventDescription: reservationData.eventDescription,
      startDateTime: reservationData.startDateTime,
      endDateTime: reservationData.endDateTime,
      attendeeCount: reservationData.attendeeCount,
      requestedRooms: reservationData.requestedRooms,
      requiredFeatures: reservationData.requiredFeatures,
      specialRequirements: reservationData.specialRequirements,
      priority: reservationData.priority,
      contactEmail: reservationData.contactEmail,
      department: reservationData.department,
      phone: reservationData.phone,
      setupTimeMinutes: reservationData.setupTimeMinutes,
      teardownTimeMinutes: reservationData.teardownTimeMinutes,
      // Access & Operations Times
      setupTime: reservationData.setupTime,
      teardownTime: reservationData.teardownTime,
      doorOpenTime: reservationData.doorOpenTime,
      doorCloseTime: reservationData.doorCloseTime,
      // Internal Notes
      setupNotes: reservationData.setupNotes,
      doorNotes: reservationData.doorNotes,
      eventNotes: reservationData.eventNotes
    });
    
    const newRevisionNumber = currentRevision + 1;
    const newStartDateTime = new Date(startDateTime);
    const newEndDateTime = new Date(endDateTime);
    
    // Create resubmission communication history entry
    const resubmissionEntry = {
      timestamp: new Date(),
      type: 'resubmission',
      author: userId,
      authorName: req.user.name || userEmail,
      message: userMessage.trim(),
      revisionNumber: newRevisionNumber,
      reservationSnapshot: createReservationSnapshot({
        eventTitle,
        eventDescription: eventDescription || '',
        startDateTime: newStartDateTime,
        endDateTime: newEndDateTime,
        attendeeCount: attendeeCount || 0,
        requestedRooms,
        requiredFeatures: requiredFeatures || [],
        specialRequirements: specialRequirements || '',
        priority,
        contactEmail: contactEmail || null,
        department: department || '',
        phone: phone || '',
        setupTimeMinutes: setupTimeMinutes || 0,
        teardownTimeMinutes: teardownTimeMinutes || 0
      })
    };
    
    // Track changes for revision history
    const fieldsToTrack = [
      'eventTitle', 'eventDescription', 'startDateTime', 'endDateTime',
      'attendeeCount', 'requestedRooms', 'requiredFeatures', 'specialRequirements',
      'setupTimeMinutes', 'teardownTimeMinutes', 'department', 'phone', 'priority'
    ];

    const newData = {
      eventTitle,
      eventDescription: eventDescription || '',
      startDateTime: newStartDateTime,
      endDateTime: newEndDateTime,
      attendeeCount: attendeeCount || 0,
      requestedRooms,
      requiredFeatures: requiredFeatures || [],
      specialRequirements: specialRequirements || '',
      setupTimeMinutes: setupTimeMinutes || 0,
      teardownTimeMinutes: teardownTimeMinutes || 0,
      department: department || '',
      phone: phone || '',
      priority
    };

    const changes = getChanges(reservation, newData, fieldsToTrack);

    // Create revision entry
    const revisionEntry = {
      revisionNumber: newRevisionNumber,
      timestamp: new Date(),
      modifiedBy: userEmail,
      modifiedByName: req.user.name || userEmail,
      changes: changes,
      type: 'resubmission'
    };

    // Update reservation with new data and add communication history
    const updateDoc = {
      $set: {
        // Update main reservation fields
        eventTitle,
        eventDescription: eventDescription || '',
        startDateTime: newStartDateTime,
        endDateTime: newEndDateTime,
        attendeeCount: attendeeCount || 0,
        requestedRooms,
        requiredFeatures: requiredFeatures || [],
        specialRequirements: specialRequirements || '',
        department: department || '',
        phone: phone || '',
        priority,
        contactEmail: contactEmail || null,

        // Setup and teardown times
        setupTimeMinutes: setupTimeMinutes || 0,
        teardownTimeMinutes: teardownTimeMinutes || 0,

        // Update status and revision tracking
        status: 'pending',
        currentRevision: newRevisionNumber,
        lastModified: new Date(),
        lastModifiedBy: userEmail,

        // Clear previous action data
        actionDate: null,
        approvedBy: null,
        actionBy: null,
        actionByEmail: null
      },
      $push: {
        communicationHistory: resubmissionEntry,
        revisions: revisionEntry
      }
    };

    const result = await roomReservationsCollection.findOneAndUpdate(
      { _id: new ObjectId(reservationId) },
      updateDoc,
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Generate new changeKey after resubmission
    const newChangeKey = generateChangeKey(result.value);
    await roomReservationsCollection.updateOne(
      { _id: new ObjectId(reservationId) },
      { $set: { changeKey: newChangeKey } }
    );
    result.value.changeKey = newChangeKey;

    // Log audit entry for resubmission
    await logReservationAudit({
      reservationId: new ObjectId(reservationId),
      userId: userId,
      userEmail: userEmail,
      changeType: 'resubmit',
      source: 'Resubmission Form',
      changeSet: changes,
      metadata: {
        previousRevision: currentRevision,
        newRevision: newRevisionNumber,
        userMessage: userMessage
      }
    });

    logger.info('Room reservation resubmitted:', {
      reservationId,
      resubmittedBy: userEmail,
      revisionNumber: newRevisionNumber,
      eventTitle,
      changesApplied: changes.length
    });

    res.json({
      message: 'Reservation resubmitted successfully',
      reservation: result.value,
      revisionNumber: newRevisionNumber,
      changeKey: newChangeKey
    });
    
  } catch (error) {
    logger.error('Error resubmitting room reservation:', error);
    res.status(500).json({ error: 'Failed to resubmit reservation' });
  }
});

/**
 * Generate a reservation token for guest access (authenticated users only)
 */
app.post('/api/room-reservations/generate-token', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { purpose, recipientEmail, expiresInHours = 24 } = req.body;
    
    // Check permissions
    const user = await usersCollection.findOne({ userId });
    const canGenerate = user?.permissions?.canGenerateReservationTokens || userEmail.includes('admin');
    
    if (!canGenerate) {
      return res.status(403).json({ error: 'Insufficient permissions to generate tokens' });
    }
    
    const token = require('crypto').randomUUID();
    const expiresAt = new Date(Date.now() + (expiresInHours * 60 * 60 * 1000));
    
    const tokenDoc = {
      token,
      createdBy: userId,
      createdByEmail: userEmail,
      purpose: purpose || 'Room reservation request',
      recipientEmail: recipientEmail || '',
      expiresAt,
      maxUses: 1,
      currentUses: 0,
      createdAt: new Date()
    };
    
    await reservationTokensCollection.insertOne(tokenDoc);
    
    const frontendUrl = process.env.NODE_ENV === 'production' ? webAppURL : 'https://localhost:5173';
    const link = `${frontendUrl}/room-reservation/public/${token}`;
    
    logger.log('Reservation token generated:', {
      token,
      createdBy: userEmail,
      purpose,
      expiresAt
    });
    
    res.json({
      token,
      link,
      expiresAt,
      purpose
    });
  } catch (error) {
    logger.error('Error generating reservation token:', error);
    res.status(500).json({ error: 'Failed to generate reservation token' });
  }
});

// ==========================================
// ROOM MANAGEMENT ADMIN ENDPOINTS
// ==========================================

/**
 * Create a new room (Admin only)
 */
app.post('/api/admin/rooms', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { name, building, floor, capacity, features, accessibility, active, description, notes } = req.body;
    
    if (!name || !building || !floor || capacity === undefined) {
      return res.status(400).json({ error: 'Missing required fields: name, building, floor, capacity' });
    }
    
    const roomDoc = {
      name: name.trim(),
      displayName: name.trim(), // Set displayName same as name by default
      building: building.trim(),
      floor: floor.trim(),
      capacity: parseInt(capacity) || 0,
      features: features || [],
      accessibility: accessibility || [],
      active: active !== false,
      isReservable: true, // All rooms created through admin are reservable
      description: description?.trim() || '',
      notes: notes?.trim() || '',
      createdAt: new Date(),
      createdBy: userId,
      updatedAt: new Date()
    };

    const result = await db.collection('templeEvents__Locations').insertOne(roomDoc);
    const savedRoom = await db.collection('templeEvents__Locations').findOne({ _id: result.insertedId });
    
    logger.log('Room created:', { roomId: result.insertedId, name, createdBy: userEmail });
    res.json(savedRoom);
  } catch (error) {
    logger.error('Error creating room:', error);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

/**
 * Update a room (Admin only)
 */
app.put('/api/admin/rooms/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { name, building, floor, capacity, features, accessibility, active, description, notes, isReservable } = req.body;

    // First, get the current location to check if status needs to be set
    const currentLocation = await db.collection('templeEvents__Locations').findOne({ _id: new ObjectId(id) });

    const updateDoc = {
      $set: {
        ...(name && { name: name.trim(), displayName: name.trim() }), // Update displayName when name changes
        ...(building && { building: building.trim() }),
        ...(floor && { floor: floor.trim() }),
        ...(capacity !== undefined && { capacity: parseInt(capacity) || 0 }),
        ...(features && { features }),
        ...(accessibility && { accessibility }),
        ...(active !== undefined && { active }),
        ...(description !== undefined && { description: description?.trim() || '' }),
        ...(notes !== undefined && { notes: notes?.trim() || '' }),
        ...(isReservable !== undefined && { isReservable }),
        // Default status to 'approved' if it's currently undefined
        ...(!currentLocation?.status && { status: 'approved' }),
        updatedAt: new Date()
      }
    };

    const result = await db.collection('templeEvents__Locations').findOneAndUpdate(
      { _id: new ObjectId(id) },
      updateDoc,
      { returnDocument: 'after' }
    );
    
    if (!result.value) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    logger.log('Room updated:', { roomId: id, updatedBy: userEmail });
    res.json(result.value);
  } catch (error) {
    logger.error('Error updating room:', error);
    res.status(500).json({ error: 'Failed to update room' });
  }
});

/**
 * LOCATION MANAGEMENT ENDPOINTS
 */

/**
 * Get all locations with filters (Admin only)
 */
app.get('/api/admin/locations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { status, includeVariations } = req.query;
    const filter = {};
    
    if (status) {
      filter.status = status;
    }
    
    const locations = await locationsCollection.find(filter).toArray();
    
    res.json(locations);
  } catch (error) {
    logger.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

/**
 * Merge locations (Admin only)
 */
app.post('/api/admin/locations/merge', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { sourceId, targetId, mergeAliases } = req.body;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    if (!sourceId || !targetId) {
      return res.status(400).json({ error: 'Both sourceId and targetId are required' });
    }
    
    if (sourceId === targetId) {
      return res.status(400).json({ error: 'Cannot merge a location into itself' });
    }
    
    // Get both locations
    const sourceLocation = await locationsCollection.findOne({ _id: new ObjectId(sourceId) });
    const targetLocation = await locationsCollection.findOne({ _id: new ObjectId(targetId) });
    
    if (!sourceLocation || !targetLocation) {
      return res.status(404).json({ error: 'One or both locations not found' });
    }
    
    // Update all events that reference the source location
    const eventUpdateResult = await unifiedEventsCollection.updateMany(
      { locationId: sourceLocation._id },
      { $set: { locationId: targetLocation._id } }
    );
    
    // Merge aliases and variations
    const mergedAliases = [...(targetLocation.aliases || [])];
    const mergedVariations = [...(targetLocation.seenVariations || [])];
    
    if (mergeAliases) {
      // Add source location name as an alias
      if (!mergedAliases.includes(sourceLocation.name)) {
        mergedAliases.push(sourceLocation.name);
      }
      
      // Add source aliases
      if (sourceLocation.aliases) {
        for (const alias of sourceLocation.aliases) {
          if (!mergedAliases.includes(alias)) {
            mergedAliases.push(alias);
          }
        }
      }
      
      // Add source variations
      if (sourceLocation.seenVariations) {
        for (const variation of sourceLocation.seenVariations) {
          if (!mergedVariations.includes(variation)) {
            mergedVariations.push(variation);
          }
        }
      }
    }
    
    // Update target location with merged data
    await locationsCollection.updateOne(
      { _id: targetLocation._id },
      {
        $set: {
          aliases: mergedAliases,
          seenVariations: mergedVariations,
          usageCount: (targetLocation.usageCount || 0) + (sourceLocation.usageCount || 0),
          updatedAt: new Date()
        }
      }
    );
    
    // Mark source location as merged
    await locationsCollection.updateOne(
      { _id: sourceLocation._id },
      {
        $set: {
          status: 'merged',
          active: false,
          mergedInto: targetLocation._id,
          mergedBy: userEmail,
          mergedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );
    
    logger.log('Locations merged:', { 
      sourceId, 
      targetId, 
      eventsUpdated: eventUpdateResult.modifiedCount,
      mergedBy: userEmail 
    });
    
    res.json({
      message: 'Locations merged successfully',
      eventsUpdated: eventUpdateResult.modifiedCount,
      targetLocation: await locationsCollection.findOne({ _id: targetLocation._id })
    });
  } catch (error) {
    logger.error('Error merging locations:', error);
    res.status(500).json({ error: 'Failed to merge locations' });
  }
});

/**
 * Update location aliases (Admin only)
 */
app.post('/api/admin/locations/:id/aliases', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;
    const { aliases } = req.body;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    if (!Array.isArray(aliases)) {
      return res.status(400).json({ error: 'Aliases must be an array' });
    }
    
    const result = await locationsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          aliases: aliases.filter(a => a && a.trim()),
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    
    if (!result.value) {
      return res.status(404).json({ error: 'Location not found' });
    }
    
    logger.log('Location aliases updated:', { locationId: id, updatedBy: userEmail });
    res.json(result.value);
  } catch (error) {
    logger.error('Error updating location aliases:', error);
    res.status(500).json({ error: 'Failed to update location aliases' });
  }
});

/**
 * Get unassigned location strings (Admin only)
 * Returns unique location strings from events that haven't been assigned to any location's aliases
 */
app.get('/api/admin/locations/unassigned-strings', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    logger.log('Fetching unassigned location strings');

    // Get all locations with their aliases
    const locations = await locationsCollection.find({}).toArray();
    const assignedAliases = new Set();

    locations.forEach(loc => {
      if (loc.aliases && Array.isArray(loc.aliases)) {
        loc.aliases.forEach(alias => {
          assignedAliases.add(normalizeLocationString(alias));
        });
      }
    });

    // Get all events and extract location strings
    const events = await unifiedEventsCollection.find({
      'graphData.location.displayName': { $exists: true, $ne: '' }
    }).toArray();

    const locationStringStats = new Map();

    events.forEach(event => {
      const locationString = event.graphData?.location?.displayName;
      if (!locationString) return;

      // Parse multi-location strings
      const locationParts = parseLocationString(locationString);

      locationParts.forEach(part => {
        const normalized = normalizeLocationString(part);

        // Skip if already assigned
        if (assignedAliases.has(normalized)) return;

        if (!locationStringStats.has(normalized)) {
          locationStringStats.set(normalized, {
            locationString: part,  // original
            normalizedString: normalized,
            eventCount: 0,
            sampleEventIds: []
          });
        }

        const stats = locationStringStats.get(normalized);
        stats.eventCount++;
        if (stats.sampleEventIds.length < 3) {
          stats.sampleEventIds.push(event.eventId);
        }
      });
    });

    // Convert to array and sort by event count
    const unassignedStrings = Array.from(locationStringStats.values())
      .sort((a, b) => b.eventCount - a.eventCount);

    logger.log(`Found ${unassignedStrings.length} unassigned location strings`);

    res.json(unassignedStrings);
  } catch (error) {
    logger.error('Error fetching unassigned location strings:', error);
    res.status(500).json({ error: 'Failed to fetch unassigned location strings' });
  }
});

/**
 * Assign a location string to a location (Admin only)
 * Adds the string as an alias and updates all matching events
 */
app.post('/api/admin/locations/assign-string', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { locationId, locationString } = req.body;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!locationId || !locationString) {
      return res.status(400).json({ error: 'locationId and locationString are required' });
    }

    logger.log('Assigning location string:', { locationId, locationString });

    // Get the location
    const location = await locationsCollection.findOne({ _id: new ObjectId(locationId) });
    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const normalized = normalizeLocationString(locationString);

    // Add to aliases if not already present
    const aliases = location.aliases || [];
    if (!aliases.some(a => normalizeLocationString(a) === normalized)) {
      aliases.push(normalized);

      await locationsCollection.updateOne(
        { _id: new ObjectId(locationId) },
        {
          $set: {
            aliases: aliases,
            updatedAt: new Date()
          }
        }
      );
    }

    // Find all events with this location string
    const events = await unifiedEventsCollection.find({
      'graphData.location.displayName': { $exists: true, $ne: '' }
    }).toArray();

    let eventsUpdated = 0;

    for (const event of events) {
      const locationDisplayName = event.graphData?.location?.displayName;
      if (!locationDisplayName) continue;

      const locationParts = parseLocationString(locationDisplayName);
      let hasMatch = false;

      for (const part of locationParts) {
        if (normalizeLocationString(part) === normalized) {
          hasMatch = true;
          break;
        }
      }

      if (hasMatch) {
        // Add locationId to locations array if not already present
        const locations = event.locations || [];
        const locationIdObj = new ObjectId(locationId);

        if (!locations.some(id => id.toString() === locationIdObj.toString())) {
          locations.push(locationIdObj);

          // Recalculate locationDisplayNames
          const displayNames = await calculateLocationDisplayNames(locations, db);

          await unifiedEventsCollection.updateOne(
            { _id: event._id },
            {
              $set: {
                locations: locations,
                locationDisplayNames: displayNames,
                updatedAt: new Date()
              }
            }
          );

          eventsUpdated++;
        }
      }
    }

    logger.log(`Assigned location string "${locationString}" to ${location.name}, updated ${eventsUpdated} events`);

    res.json({
      locationId: locationId,
      locationName: location.name,
      aliasAdded: normalized,
      eventsUpdated: eventsUpdated,
      updatedAliases: aliases
    });
  } catch (error) {
    logger.error('Error assigning location string:', error);
    res.status(500).json({ error: 'Failed to assign location string' });
  }
});

/**
 * Remove an alias from a location (Admin only)
 * Removes the alias and updates all affected events
 */
app.delete('/api/admin/locations/remove-alias', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { locationId, alias } = req.body;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!locationId || !alias) {
      return res.status(400).json({ error: 'locationId and alias are required' });
    }

    logger.log('Removing alias from location:', { locationId, alias });

    const normalized = normalizeLocationString(alias);
    const locationIdObj = new ObjectId(locationId);

    // Remove from location aliases
    await locationsCollection.updateOne(
      { _id: locationIdObj },
      {
        $pull: { aliases: normalized },
        $set: { updatedAt: new Date() }
      }
    );

    // Find and update all events with this locationId
    const events = await unifiedEventsCollection.find({
      locations: locationIdObj
    }).toArray();

    let eventsUpdated = 0;

    for (const event of events) {
      // Check if event's original location string still matches this location via other aliases
      const locationDisplayName = event.graphData?.location?.displayName;
      if (!locationDisplayName) continue;

      const locationParts = parseLocationString(locationDisplayName);
      let stillMatches = false;

      // Get updated location with remaining aliases
      const location = await locationsCollection.findOne({ _id: locationIdObj });
      const remainingAliases = location?.aliases || [];

      for (const part of locationParts) {
        const partNormalized = normalizeLocationString(part);
        if (remainingAliases.some(a => normalizeLocationString(a) === partNormalized)) {
          stillMatches = true;
          break;
        }
      }

      if (!stillMatches) {
        // Remove locationId from event
        const updatedLocations = (event.locations || []).filter(
          id => id.toString() !== locationIdObj.toString()
        );

        // Recalculate locationDisplayNames
        const displayNames = await calculateLocationDisplayNames(updatedLocations, db);

        await unifiedEventsCollection.updateOne(
          { _id: event._id },
          {
            $set: {
              locations: updatedLocations,
              locationDisplayNames: displayNames,
              updatedAt: new Date()
            }
          }
        );

        eventsUpdated++;
      }
    }

    logger.log(`Removed alias "${alias}" from location ${locationId}, updated ${eventsUpdated} events`);

    res.json({
      aliasRemoved: normalized,
      eventsUpdated: eventsUpdated
    });
  } catch (error) {
    logger.error('Error removing alias:', error);
    res.status(500).json({ error: 'Failed to remove alias' });
  }
});

/**
 * Create a new location (Admin only)
 * Creates a location with all specified fields
 */
app.post('/api/admin/locations', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const {
      name,
      displayName,
      aliases,
      locationCode,
      building,
      floor,
      capacity,
      features,
      accessibility,
      address,
      description,
      notes
    } = req.body;

    // Validate required fields
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Check for duplicate name
    const existing = await locationsCollection.findOne({
      name: name.trim(),
      status: { $ne: 'merged' }
    });

    if (existing) {
      return res.status(409).json({ error: 'A location with this name already exists' });
    }

    logger.log('Creating new location:', { name, building, floor });

    // Create location object
    const newLocation = {
      name: name.trim(),
      displayName: displayName?.trim() || name.trim(),
      aliases: Array.isArray(aliases) ? aliases.map(a => normalizeLocationString(a)).filter(a => a) : [],
      locationCode: locationCode?.trim() || '',
      building: building?.trim() || '',
      floor: floor?.trim() || '',
      capacity: capacity ? parseInt(capacity) : 0,
      features: Array.isArray(features) ? features : [],
      accessibility: Array.isArray(accessibility) ? accessibility : [],
      address: address?.trim() || '',
      description: description?.trim() || '',
      notes: notes?.trim() || '',
      status: 'approved',
      active: true,
      usageCount: 0,
      importSource: 'manual-creation',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await locationsCollection.insertOne(newLocation);
    const createdLocation = await locationsCollection.findOne({ _id: result.insertedId });

    logger.log(`Created location: ${createdLocation.name} (ID: ${result.insertedId})`);

    res.status(201).json(createdLocation);
  } catch (error) {
    logger.error('Error creating location:', error);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

/**
 * Update an existing location (Admin only)
 * Updates location fields while preserving system fields
 */
app.put('/api/admin/locations/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const locationId = new ObjectId(id);
    const existingLocation = await locationsCollection.findOne({ _id: locationId });

    if (!existingLocation) {
      return res.status(404).json({ error: 'Location not found' });
    }

    const {
      name,
      displayName,
      aliases,
      locationCode,
      building,
      floor,
      capacity,
      features,
      accessibility,
      address,
      description,
      notes
    } = req.body;

    // Validate name if provided
    if (name !== undefined && (!name || name.trim() === '')) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }

    // Check for duplicate name (if name is being changed)
    if (name && name.trim() !== existingLocation.name) {
      const duplicate = await locationsCollection.findOne({
        name: name.trim(),
        _id: { $ne: locationId },
        status: { $ne: 'merged' }
      });

      if (duplicate) {
        return res.status(409).json({ error: 'A location with this name already exists' });
      }
    }

    logger.log('Updating location:', { id, name: name || existingLocation.name });

    // Build update object (only update provided fields)
    const updateFields = {
      updatedAt: new Date()
    };

    if (name !== undefined) updateFields.name = name.trim();
    if (displayName !== undefined) updateFields.displayName = displayName.trim();
    if (aliases !== undefined) updateFields.aliases = Array.isArray(aliases) ? aliases.map(a => normalizeLocationString(a)).filter(a => a) : [];
    if (locationCode !== undefined) updateFields.locationCode = locationCode.trim();
    if (building !== undefined) updateFields.building = building.trim();
    if (floor !== undefined) updateFields.floor = floor.trim();
    if (capacity !== undefined) updateFields.capacity = parseInt(capacity) || 0;
    if (features !== undefined) updateFields.features = Array.isArray(features) ? features : [];
    if (accessibility !== undefined) updateFields.accessibility = Array.isArray(accessibility) ? accessibility : [];
    if (address !== undefined) updateFields.address = address.trim();
    if (description !== undefined) updateFields.description = description.trim();
    if (notes !== undefined) updateFields.notes = notes.trim();

    await locationsCollection.updateOne(
      { _id: locationId },
      { $set: updateFields }
    );

    const updatedLocation = await locationsCollection.findOne({ _id: locationId });

    logger.log(`Updated location: ${updatedLocation.name} (ID: ${id})`);

    res.json(updatedLocation);
  } catch (error) {
    logger.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

/**
 * Get deletion progress for a location (Admin only)
 * Returns current status of an ongoing or completed deletion operation
 */
app.get('/api/admin/locations/:id/delete-progress', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const progress = locationDeletionProgress.get(id);

    if (!progress) {
      return res.status(404).json({ error: 'No deletion operation found for this location' });
    }

    res.json(progress);
  } catch (error) {
    logger.error('Error fetching deletion progress:', error);
    res.status(500).json({ error: 'Failed to fetch deletion progress' });
  }
});

/**
 * Get count of events referencing a specific location
 * Used before deletion to show impact to user
 */
app.get('/api/admin/locations/:id/event-count', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const locationId = new ObjectId(id);

    // Count events with this location in their locations array
    const eventCount = await unifiedEventsCollection.countDocuments({
      locations: locationId
    });

    res.json({
      locationId: id,
      eventCount: eventCount
    });
  } catch (error) {
    logger.error('Error counting location events:', error);
    res.status(500).json({ error: 'Failed to count events' });
  }
});

/**
 * Soft delete a location (Admin only)
 * Sets active=false and status='deleted' instead of removing from database
 * Optimized with bulkWrite for faster event updates and progress tracking
 */
app.delete('/api/admin/locations/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const locationId = new ObjectId(id);
    const location = await locationsCollection.findOne({ _id: locationId });

    if (!location) {
      return res.status(404).json({ error: 'Location not found' });
    }

    // Count affected events BEFORE deletion
    const affectedEventsCount = await unifiedEventsCollection.countDocuments({
      locations: locationId
    });

    logger.log('Soft deleting location:', {
      id,
      name: location.name,
      affectedEvents: affectedEventsCount
    });

    // Initialize progress tracking
    setDeletionProgress(id, {
      status: 'in_progress',
      locationName: location.name,
      totalEvents: affectedEventsCount,
      processedEvents: 0,
      percentage: 0
    });

    // 1. Soft delete: set active=false and status='deleted'
    await locationsCollection.updateOne(
      { _id: locationId },
      {
        $set: {
          active: false,
          status: 'deleted',
          deletedBy: userEmail,
          deletedAt: new Date(),
          updatedAt: new Date()
        }
      }
    );

    // 2. Clean up event references - optimized with batching
    const events = await unifiedEventsCollection.find({
      locations: locationId
    }).toArray();

    let eventsUpdated = 0;
    const BATCH_SIZE = 50; // Process 50 events at a time
    const batches = [];

    // Group events into batches
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      batches.push(events.slice(i, i + BATCH_SIZE));
    }

    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      const bulkOps = [];

      // Prepare bulk operations for this batch
      for (const event of batch) {
        // Remove locationId from locations array
        const updatedLocations = (event.locations || []).filter(
          id => id.toString() !== locationId.toString()
        );

        // Recalculate locationDisplayNames
        const displayNames = await calculateLocationDisplayNames(updatedLocations, db);

        bulkOps.push({
          updateOne: {
            filter: { _id: event._id },
            update: {
              $set: {
                locations: updatedLocations,
                locationDisplayNames: displayNames,
                updatedAt: new Date()
              }
            }
          }
        });
      }

      // Execute bulk write for this batch
      if (bulkOps.length > 0) {
        await unifiedEventsCollection.bulkWrite(bulkOps);
        eventsUpdated += bulkOps.length;

        // Update progress
        const percentage = Math.round((eventsUpdated / affectedEventsCount) * 100);
        setDeletionProgress(id, {
          status: 'in_progress',
          locationName: location.name,
          totalEvents: affectedEventsCount,
          processedEvents: eventsUpdated,
          percentage: percentage
        });
      }
    }

    // Mark as completed
    setDeletionProgress(id, {
      status: 'completed',
      locationName: location.name,
      totalEvents: affectedEventsCount,
      processedEvents: eventsUpdated,
      percentage: 100
    });

    logger.log(`Soft deleted location: ${location.name} (ID: ${id}), cleaned ${eventsUpdated} events`, {
      locationId: id,
      locationName: location.name,
      eventsUpdated
    });

    res.json({
      message: 'Location deleted successfully',
      locationId: id,
      locationName: location.name,
      eventsUpdated: eventsUpdated,
      totalEvents: affectedEventsCount
    });
  } catch (error) {
    logger.error('Error deleting location:', error);

    // Mark as error in progress tracking
    if (req.params && req.params.id) {
      setDeletionProgress(req.params.id, {
        status: 'error',
        error: error.message
      });
    }

    res.status(500).json({ error: 'Failed to delete location' });
  }
});

/**
 * Delete a room (Admin only)
 */
app.delete('/api/admin/rooms/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Check if room has active reservations
    const activeReservations = await roomReservationsCollection.countDocuments({
      requestedRooms: { $in: [id] },
      status: { $in: ['pending', 'approved'] },
      endDateTime: { $gte: new Date() }
    });
    
    if (activeReservations > 0) {
      return res.status(400).json({ 
        error: `Cannot delete room with ${activeReservations} active reservations. Please cancel or complete them first.` 
      });
    }
    
    const result = await db.collection('templeEvents__Locations').deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    logger.log('Room deleted:', { roomId: id, deletedBy: userEmail });
    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    logger.error('Error deleting room:', error);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

/**
 * Start reviewing a room reservation (Admin only)
 * This creates a soft hold on the reservation to prevent concurrent edits
 */
app.post('/api/admin/room-reservations/:id/start-review', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get current reservation
    const reservation = await roomReservationsCollection.findOne({ _id: new ObjectId(id) });
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Check if already being reviewed by someone else
    if (reservation.reviewStatus === 'reviewing' && reservation.reviewingBy && reservation.reviewingBy !== userEmail) {
      return res.status(423).json({
        error: 'Reservation is currently being reviewed by another user',
        reviewingBy: reservation.reviewingBy,
        reviewStartedAt: reservation.reviewStartedAt
      });
    }

    // Generate initial changeKey if it doesn't exist
    const changeKey = reservation.changeKey || generateChangeKey(reservation);

    // Update reservation to mark as being reviewed
    const result = await roomReservationsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          reviewStatus: 'reviewing',
          reviewingBy: userEmail,
          reviewStartedAt: new Date(),
          changeKey: changeKey,
          lastModified: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    logger.log('Review started:', { reservationId: id, reviewer: userEmail });
    res.json({
      message: 'Review session started',
      reservation: result,
      changeKey: changeKey
    });
  } catch (error) {
    logger.error('Error starting review:', error);
    res.status(500).json({ error: 'Failed to start review session' });
  }
});

/**
 * Release review hold on a room reservation (Admin only)
 */
app.post('/api/admin/room-reservations/:id/release-review', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get current reservation
    const reservation = await roomReservationsCollection.findOne({ _id: new ObjectId(id) });
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Only allow releasing if you're the reviewer or if no one is reviewing
    if (reservation.reviewingBy && reservation.reviewingBy !== userEmail) {
      return res.status(403).json({
        error: 'Cannot release review hold - reservation is being reviewed by another user',
        reviewingBy: reservation.reviewingBy
      });
    }

    // Release the review hold
    const result = await roomReservationsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          reviewStatus: 'not_reviewing',
          lastModified: new Date()
        },
        $unset: {
          reviewingBy: '',
          reviewStartedAt: ''
        }
      },
      { returnDocument: 'after' }
    );

    logger.log('Review released:', { reservationId: id, reviewer: userEmail });
    res.json({
      message: 'Review session released',
      reservation: result
    });
  } catch (error) {
    logger.error('Error releasing review:', error);
    res.status(500).json({ error: 'Failed to release review session' });
  }
});

/**
 * Check for scheduling conflicts with a room reservation (Admin only)
 */
app.get('/api/admin/room-reservations/:id/check-conflicts', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get the reservation
    const reservation = await roomReservationsCollection.findOne({ _id: new ObjectId(id) });
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Check for conflicts
    const conflicts = await checkRoomConflicts(reservation, id);

    res.json({
      hasConflicts: conflicts.length > 0,
      conflicts: conflicts
    });
  } catch (error) {
    logger.error('Error checking conflicts:', error);
    res.status(500).json({ error: 'Failed to check conflicts' });
  }
});

/**
 * Update a room reservation with optimistic concurrency control (Admin only)
 */
app.put('/api/admin/room-reservations/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;
    const ifMatch = req.headers['if-match'];
    const updates = req.body;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get current reservation
    const currentReservation = await roomReservationsCollection.findOne({ _id: new ObjectId(id) });
    if (!currentReservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Validate ETag if provided
    if (ifMatch) {
      const currentChangeKey = currentReservation.changeKey || generateChangeKey(currentReservation);
      if (ifMatch !== currentChangeKey) {
        return res.status(409).json({
          error: 'Conflict: Reservation has been modified by another user',
          currentChangeKey: currentChangeKey,
          providedChangeKey: ifMatch
        });
      }
    }

    // Check if being reviewed by someone else
    if (currentReservation.reviewStatus === 'reviewing' &&
        currentReservation.reviewingBy &&
        currentReservation.reviewingBy !== userEmail) {
      return res.status(423).json({
        error: 'Reservation is currently being reviewed by another user',
        reviewingBy: currentReservation.reviewingBy
      });
    }

    // Fields that can be updated
    const allowedFields = [
      'eventTitle', 'eventDescription', 'startDateTime', 'endDateTime',
      'attendeeCount', 'requestedRooms', 'requiredFeatures', 'specialRequirements',
      'setupTimeMinutes', 'teardownTimeMinutes', 'department', 'phone',
      'contactName', 'contactEmail', 'priority', 'reviewNotes',
      'setupTime', 'doorOpenTime', 'doorCloseTime', 'teardownTime',
      'setupNotes', 'doorNotes', 'eventNotes'
    ];

    // Build update document
    const updateDoc = { $set: {} };
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        updateDoc.$set[field] = updates[field];
      }
    });

    // Convert date fields
    if (updateDoc.$set.startDateTime) {
      updateDoc.$set.startDateTime = new Date(updateDoc.$set.startDateTime);
    }
    if (updateDoc.$set.endDateTime) {
      updateDoc.$set.endDateTime = new Date(updateDoc.$set.endDateTime);
    }

    // Track changes for revision history
    const changes = getChanges(currentReservation, updateDoc.$set, allowedFields);

    if (changes.length > 0) {
      // Increment revision number
      const newRevision = (currentReservation.currentRevision || 1) + 1;
      updateDoc.$set.currentRevision = newRevision;

      // Create revision entry
      const revisionEntry = {
        revisionNumber: newRevision,
        timestamp: new Date(),
        modifiedBy: userEmail,
        modifiedByName: req.user.name || userEmail,
        changes: changes
      };

      updateDoc.$push = {
        revisions: revisionEntry
      };
    }

    // Update lastModified and lastModifiedBy
    updateDoc.$set.lastModified = new Date();
    updateDoc.$set.lastModifiedBy = userEmail;

    // Perform the update
    const result = await roomReservationsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      updateDoc,
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Extract the document from the result
    // MongoDB driver may return either the document directly or wrapped in {value: ...}
    const updatedReservation = result.value || result;

    // Generate new changeKey
    const newChangeKey = generateChangeKey(updatedReservation);
    await roomReservationsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { changeKey: newChangeKey } }
    );

    updatedReservation.changeKey = newChangeKey;

    // Log audit entry for update if there were changes
    if (changes.length > 0) {
      await logReservationAudit({
        reservationId: new ObjectId(id),
        userId: userId,
        userEmail: userEmail,
        changeType: 'update',
        source: 'Admin Edit',
        changeSet: changes,
        metadata: {
          revisionNumber: updatedReservation.currentRevision
        }
      });
    }

    logger.log('Reservation updated:', {
      reservationId: id,
      updatedBy: userEmail,
      changes: changes.map(c => c.field)
    });

    res.json({
      message: 'Reservation updated successfully',
      reservation: updatedReservation,
      changeKey: newChangeKey,
      changesApplied: changes.length
    });
  } catch (error) {
    logger.error('Error updating reservation:', error);
    res.status(500).json({ error: 'Failed to update reservation' });
  }
});

/**
 * Approve a room reservation (Admin only)
 */
app.put('/api/admin/room-reservations/:id/approve', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;
    const ifMatch = req.headers['if-match'];
    const { notes, calendarMode = CALENDAR_CONFIG.DEFAULT_MODE, createCalendarEvent = true, graphToken, ignoreConflicts = false } = req.body;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get the current reservation to determine revision number
    const currentReservation = await roomReservationsCollection.findOne({ _id: new ObjectId(id) });
    if (!currentReservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Validate ETag if provided
    if (ifMatch) {
      const currentChangeKey = currentReservation.changeKey || generateChangeKey(currentReservation);
      if (ifMatch !== currentChangeKey) {
        return res.status(409).json({
          error: 'Conflict: Reservation has been modified by another user',
          currentChangeKey: currentChangeKey,
          providedChangeKey: ifMatch
        });
      }
    }

    // Check for scheduling conflicts unless explicitly ignored
    let conflictDetails = null;
    if (!ignoreConflicts) {
      const conflicts = await checkRoomConflicts(currentReservation, id);
      if (conflicts.length > 0) {
        return res.status(409).json({
          error: 'Scheduling conflict detected',
          conflicts: conflicts,
          message: 'This reservation conflicts with existing reservations. Set ignoreConflicts=true to approve anyway.'
        });
      }
    } else {
      // If conflicts were ignored, record them for audit purposes
      const conflicts = await checkRoomConflicts(currentReservation, id);
      if (conflicts.length > 0) {
        conflictDetails = {
          conflictsDetected: conflicts.length,
          overriddenBy: userEmail,
          overriddenAt: new Date()
        };
      }
    }

    // Create approval communication history entry
    const approvalEntry = {
      timestamp: new Date(),
      type: 'approval',
      author: userId,
      authorName: req.user.name || userEmail,
      message: notes ? notes.trim() : 'Reservation approved',
      revisionNumber: currentReservation.currentRevision || 1,
      reservationSnapshot: null // No changes to reservation data on approval
    };

    const updateDoc = {
      $set: {
        status: 'approved',
        actionDate: new Date(),
        actionBy: userId,
        actionByEmail: userEmail,
        lastModified: new Date(),
        lastModifiedBy: userEmail,
        // Release review hold
        reviewStatus: 'not_reviewing',
        ...(notes && { actionNotes: notes.trim() }),
        ...(conflictDetails && { approvedWithOverride: conflictDetails })
      },
      $push: {
        communicationHistory: approvalEntry
      },
      $unset: {
        reviewingBy: '',
        reviewStartedAt: ''
      }
    };

    const result = await roomReservationsCollection.findOneAndUpdate(
      { _id: new ObjectId(id), status: 'pending' },
      updateDoc,
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({ error: 'Pending reservation not found' });
    }

    // Generate new changeKey after approval
    const newChangeKey = generateChangeKey(result.value);
    await roomReservationsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { changeKey: newChangeKey } }
    );
    result.value.changeKey = newChangeKey;

    // Log audit entry for approval
    await logReservationAudit({
      reservationId: new ObjectId(id),
      userId: userId,
      userEmail: userEmail,
      changeType: 'approve',
      source: 'Admin Review',
      metadata: {
        notes: notes,
        conflictOverride: !!conflictDetails,
        calendarEventCreated: createCalendarEvent
      }
    });

    // Create calendar event if requested (uses automatic service authentication)
    let calendarEventResult = null;
    if (createCalendarEvent) {
      try {
        calendarEventResult = await createRoomReservationCalendarEvent(
          result.value, 
          calendarMode,
          graphToken
        );
        
        // Update the reservation with calendar event information
        if (calendarEventResult.success) {
          await roomReservationsCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $set: {
                calendarEventId: calendarEventResult.eventId,
                targetCalendar: calendarEventResult.targetCalendar,
                calendarCreatedAt: new Date()
              }
            }
          );
        }
        
        logger.log('Calendar event created for reservation:', {
          reservationId: id,
          eventId: calendarEventResult.eventId,
          calendar: calendarEventResult.targetCalendar
        });
      } catch (calendarError) {
        logger.error('Failed to create calendar event:', {
          reservationId: id,
          error: calendarError.message
        });
        // Don't fail the approval if calendar creation fails
        calendarEventResult = { 
          success: false, 
          error: calendarError.message 
        };
      }
    }
    
    logger.log('Room reservation approved:', { reservationId: id, approvedBy: userEmail });
    res.json({
      ...result.value,
      calendarEvent: calendarEventResult
    });
  } catch (error) {
    logger.error('Error approving reservation:', error);
    res.status(500).json({ error: 'Failed to approve reservation' });
  }
});

/**
 * Reject a room reservation (Admin only)
 */
app.put('/api/admin/room-reservations/:id/reject', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;
    const ifMatch = req.headers['if-match'];
    const { reason } = req.body;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    // Get the current reservation to determine revision number
    const currentReservation = await roomReservationsCollection.findOne({ _id: new ObjectId(id) });
    if (!currentReservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Validate ETag if provided
    if (ifMatch) {
      const currentChangeKey = currentReservation.changeKey || generateChangeKey(currentReservation);
      if (ifMatch !== currentChangeKey) {
        return res.status(409).json({
          error: 'Conflict: Reservation has been modified by another user',
          currentChangeKey: currentChangeKey,
          providedChangeKey: ifMatch
        });
      }
    }

    // Create rejection communication history entry
    const rejectionEntry = {
      timestamp: new Date(),
      type: 'rejection',
      author: userId,
      authorName: req.user.name || userEmail,
      message: reason.trim(),
      revisionNumber: currentReservation.currentRevision || 1,
      reservationSnapshot: null // No changes to reservation data on rejection
    };

    const updateDoc = {
      $set: {
        status: 'rejected',
        actionDate: new Date(),
        actionBy: userId,
        actionByEmail: userEmail,
        rejectionReason: reason.trim(), // Keep for backward compatibility
        lastModified: new Date(),
        lastModifiedBy: userEmail,
        // Release review hold
        reviewStatus: 'not_reviewing'
      },
      $push: {
        communicationHistory: rejectionEntry
      },
      $unset: {
        reviewingBy: '',
        reviewStartedAt: ''
      }
    };

    const result = await roomReservationsCollection.findOneAndUpdate(
      { _id: new ObjectId(id), status: 'pending' },
      updateDoc,
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({ error: 'Pending reservation not found' });
    }

    // Generate new changeKey after rejection
    const newChangeKey = generateChangeKey(result.value);
    await roomReservationsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { changeKey: newChangeKey } }
    );
    result.value.changeKey = newChangeKey;

    // Log audit entry for rejection
    await logReservationAudit({
      reservationId: new ObjectId(id),
      userId: userId,
      userEmail: userEmail,
      changeType: 'reject',
      source: 'Admin Review',
      metadata: {
        reason: reason.trim()
      }
    });

    logger.log('Room reservation rejected:', { reservationId: id, rejectedBy: userEmail, reason });
    res.json(result.value);
  } catch (error) {
    logger.error('Error rejecting reservation:', error);
    res.status(500).json({ error: 'Failed to reject reservation' });
  }
});

/**
 * Delete a room reservation (Admin only)
 */
app.delete('/api/admin/room-reservations/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Get the reservation to check if it exists and for logging
    const reservation = await roomReservationsCollection.findOne({ _id: new ObjectId(id) });
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    
    // Delete the reservation
    const result = await roomReservationsCollection.deleteOne({ _id: new ObjectId(id) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    
    logger.log('Room reservation deleted:', { 
      reservationId: id, 
      eventTitle: reservation.eventTitle,
      deletedBy: userEmail,
      originalStatus: reservation.status
    });
    
    res.json({ 
      message: 'Reservation deleted successfully', 
      deletedId: id,
      eventTitle: reservation.eventTitle
    });
  } catch (error) {
    logger.error('Error deleting reservation:', error);
    res.status(500).json({ error: 'Failed to delete reservation' });
  }
});

/**
 * Sync/create calendar event for an approved room reservation (Admin only)
 */
app.put('/api/admin/room-reservations/:id/sync', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;
    const { calendarMode = CALENDAR_CONFIG.DEFAULT_MODE, graphToken } = req.body;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Get the reservation
    const reservation = await roomReservationsCollection.findOne({ _id: new ObjectId(id) });
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    
    // Only allow sync for approved reservations
    if (reservation.status !== 'approved') {
      return res.status(400).json({ error: 'Can only sync calendar events for approved reservations' });
    }
    
    // Create calendar event
    let calendarEventResult = null;
    try {
      calendarEventResult = await createRoomReservationCalendarEvent(
        reservation,
        calendarMode,
        graphToken
      );
      
      // Update the reservation with calendar event information if successful
      if (calendarEventResult.success) {
        await roomReservationsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              calendarEventId: calendarEventResult.eventId,
              targetCalendar: calendarEventResult.targetCalendar,
              calendarCreatedAt: new Date(),
              calendarSyncedAt: new Date() // Track when it was manually synced
            }
          }
        );
      }
      
      logger.log('Room reservation calendar event synced:', { 
        reservationId: id, 
        syncedBy: userEmail,
        success: calendarEventResult.success,
        eventId: calendarEventResult.eventId
      });
      
      res.json({
        message: calendarEventResult.success ? 
          `Calendar event synced successfully in ${calendarEventResult.targetCalendar}` : 
          `Calendar event sync failed: ${calendarEventResult.error}`,
        calendarEvent: calendarEventResult,
        reservation: reservation
      });
      
    } catch (calendarError) {
      logger.error('Calendar sync error:', calendarError);
      res.json({
        message: 'Reservation found but calendar event sync failed',
        calendarEvent: { 
          success: false, 
          error: calendarError.message 
        },
        reservation: reservation
      });
    }
  } catch (error) {
    logger.error('Error syncing reservation calendar event:', error);
    res.status(500).json({ error: 'Failed to sync calendar event' });
  }
});

// ==========================================
// FEATURE CONFIGURATION ENDPOINTS
// ==========================================

/**
 * Get all feature categories
 */
app.get('/api/feature-categories', async (req, res) => {
  try {
    const categories = await featureCategoriesCollection.find({ active: true })
      .sort({ displayOrder: 1 })
      .toArray();

    res.json(categories);
  } catch (error) {
    logger.error('Error fetching feature categories:', error);
    res.status(500).json({ error: 'Failed to fetch feature categories' });
  }
});

/**
 * Get all event categories (base + dynamic)
 */
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await categoriesCollection.find({ active: true })
      .sort({ displayOrder: 1 })
      .toArray();

    res.json(categories);
  } catch (error) {
    logger.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * Create a new event category
 */
app.post('/api/categories', verifyToken, async (req, res) => {
  try {
    const { name, color, description, displayOrder, type } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    // Check for duplicate name
    const existingCategory = await categoriesCollection.findOne({ name: name.trim() });
    if (existingCategory) {
      return res.status(400).json({ error: 'Category with this name already exists' });
    }

    const newCategory = {
      name: name.trim(),
      type: type || 'base',
      color: color || '#808080',
      description: description || '',
      displayOrder: displayOrder || 999,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await categoriesCollection.insertOne(newCategory);
    const createdCategory = await categoriesCollection.findOne({ _id: result.insertedId });

    res.status(201).json(createdCategory);
  } catch (error) {
    logger.error('Error creating category:', error);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

/**
 * Update an event category
 */
app.put('/api/categories/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, color, description, displayOrder, active } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    const updateData = {
      updatedAt: new Date()
    };

    if (name !== undefined) updateData.name = name.trim();
    if (color !== undefined) updateData.color = color;
    if (description !== undefined) updateData.description = description;
    if (displayOrder !== undefined) updateData.displayOrder = displayOrder;
    if (active !== undefined) updateData.active = active;

    // If updating name, check for duplicates
    if (name) {
      const existingCategory = await categoriesCollection.findOne({
        name: name.trim(),
        _id: { $ne: new ObjectId(id) }
      });
      if (existingCategory) {
        return res.status(400).json({ error: 'Category with this name already exists' });
      }
    }

    const result = await categoriesCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json(result);
  } catch (error) {
    logger.error('Error updating category:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

/**
 * Delete an event category (soft delete by setting active to false)
 */
app.delete('/api/categories/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid category ID' });
    }

    const result = await categoriesCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { active: false, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) {
      return res.status(404).json({ error: 'Category not found' });
    }

    res.json({ message: 'Category deleted successfully', category: result });
  } catch (error) {
    logger.error('Error deleting category:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

/**
 * Get all room capability types
 */
app.get('/api/room-capability-types', async (req, res) => {
  try {
    const { category } = req.query;
    
    const query = { active: true };
    if (category) {
      query.category = category;
    }
    
    const capabilities = await roomCapabilityTypesCollection.find(query)
      .sort({ category: 1, displayOrder: 1 })
      .toArray();
    
    res.json(capabilities);
  } catch (error) {
    logger.error('Error fetching room capability types:', error);
    res.status(500).json({ error: 'Failed to fetch room capability types' });
  }
});

/**
 * Get all event service types
 */
app.get('/api/event-service-types', async (req, res) => {
  try {
    const { category } = req.query;
    
    const query = { active: true };
    if (category) {
      query.category = category;
    }
    
    const services = await eventServiceTypesCollection.find(query)
      .sort({ category: 1, displayOrder: 1 })
      .toArray();
    
    res.json(services);
  } catch (error) {
    logger.error('Error fetching event service types:', error);
    res.status(500).json({ error: 'Failed to fetch event service types' });
  }
});

/**
 * Get complete feature configuration (categories, capabilities, and services)
 */
app.get('/api/feature-config', async (req, res) => {
  try {
    const [categories, capabilities, services] = await Promise.all([
      featureCategoriesCollection.find({ active: true }).sort({ displayOrder: 1 }).toArray(),
      roomCapabilityTypesCollection.find({ active: true }).sort({ category: 1, displayOrder: 1 }).toArray(),
      eventServiceTypesCollection.find({ active: true }).sort({ category: 1, displayOrder: 1 }).toArray()
    ]);
    
    // Group capabilities and services by category
    const capabilitiesByCategory = capabilities.reduce((acc, cap) => {
      if (!acc[cap.category]) acc[cap.category] = [];
      acc[cap.category].push(cap);
      return acc;
    }, {});
    
    const servicesByCategory = services.reduce((acc, service) => {
      if (!acc[service.category]) acc[service.category] = [];
      acc[service.category].push(service);
      return acc;
    }, {});
    
    res.json({
      categories,
      capabilities: capabilitiesByCategory,
      services: servicesByCategory
    });
  } catch (error) {
    logger.error('Error fetching complete feature configuration:', error);
    res.status(500).json({ error: 'Failed to fetch feature configuration' });
  }
});

// ==========================================
// FEATURE CONFIGURATION ADMIN ENDPOINTS  
// ==========================================

/**
 * Create a new room capability type (Admin only)
 */
app.post('/api/admin/room-capability-types', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { key, name, description, category, dataType, icon, displayOrder, active } = req.body;
    
    if (!key || !name || !category || !dataType) {
      return res.status(400).json({ 
        error: 'Missing required fields: key, name, category, dataType' 
      });
    }
    
    const capabilityType = {
      key: key.trim(),
      name: name.trim(),
      description: description?.trim() || '',
      category: category.trim(),
      dataType: dataType.trim(),
      icon: icon?.trim() || '',
      displayOrder: displayOrder || 1,
      active: active !== false,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: userId
    };
    
    const result = await roomCapabilityTypesCollection.insertOne(capabilityType);
    
    logger.info('Room capability type created:', {
      capabilityId: result.insertedId,
      key: capabilityType.key,
      createdBy: userEmail
    });
    
    res.status(201).json({
      message: 'Room capability type created successfully',
      capability: { ...capabilityType, _id: result.insertedId }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Capability key already exists' });
    }
    logger.error('Error creating room capability type:', error);
    res.status(500).json({ error: 'Failed to create room capability type' });
  }
});

/**
 * Create a new event service type (Admin only)
 */
app.post('/api/admin/event-service-types', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { key, name, description, category, dataType, icon, hasCost, displayOrder, active } = req.body;
    
    if (!key || !name || !category || !dataType) {
      return res.status(400).json({ 
        error: 'Missing required fields: key, name, category, dataType' 
      });
    }
    
    const serviceType = {
      key: key.trim(),
      name: name.trim(),
      description: description?.trim() || '',
      category: category.trim(),
      dataType: dataType.trim(),
      icon: icon?.trim() || '',
      hasCost: hasCost === true,
      displayOrder: displayOrder || 1,
      active: active !== false,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: userId
    };
    
    const result = await eventServiceTypesCollection.insertOne(serviceType);
    
    logger.info('Event service type created:', {
      serviceId: result.insertedId,
      key: serviceType.key,
      createdBy: userEmail
    });
    
    res.status(201).json({
      message: 'Event service type created successfully',
      service: { ...serviceType, _id: result.insertedId }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Service key already exists' });
    }
    logger.error('Error creating event service type:', error);
    res.status(500).json({ error: 'Failed to create event service type' });
  }
});

/**
 * Create a new feature category (Admin only)
 */
app.post('/api/admin/feature-categories', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { key, name, description, displayOrder, active } = req.body;
    
    if (!key || !name) {
      return res.status(400).json({ 
        error: 'Missing required fields: key, name' 
      });
    }
    
    const category = {
      key: key.trim(),
      name: name.trim(),
      description: description?.trim() || '',
      displayOrder: displayOrder || 1,
      active: active !== false,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: userId
    };
    
    const result = await featureCategoriesCollection.insertOne(category);
    
    logger.info('Feature category created:', {
      categoryId: result.insertedId,
      key: category.key,
      createdBy: userEmail
    });
    
    res.status(201).json({
      message: 'Feature category created successfully',
      category: { ...category, _id: result.insertedId }
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Category key already exists' });
    }
    logger.error('Error creating feature category:', error);
    res.status(500).json({ error: 'Failed to create feature category' });
  }
});

/**
 * Update a feature category (Admin only)
 */
app.put('/api/admin/feature-categories/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const categoryId = req.params.id;
    const { key, name, description, displayOrder, active } = req.body;
    
    if (!key || !name) {
      return res.status(400).json({ 
        error: 'Missing required fields: key, name' 
      });
    }
    
    const updateData = {
      key: key.trim(),
      name: name.trim(),
      description: description?.trim() || '',
      displayOrder: displayOrder || 1,
      active: active !== false,
      updatedAt: new Date(),
      updatedBy: userId
    };
    
    const result = await featureCategoriesCollection.findOneAndUpdate(
      { _id: new ObjectId(categoryId) },
      { $set: updateData },
      { returnDocument: 'after' }
    );
    
    if (!result.value) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    logger.info('Feature category updated:', {
      categoryId,
      key: updateData.key,
      updatedBy: userEmail
    });
    
    res.json({
      message: 'Feature category updated successfully',
      category: result.value
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Category key already exists' });
    }
    logger.error('Error updating feature category:', error);
    res.status(500).json({ error: 'Failed to update feature category' });
  }
});

/**
 * Delete a feature category (Admin only)
 */
app.delete('/api/admin/feature-categories/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const categoryId = req.params.id;
    
    // Check if category is in use
    const category = await featureCategoriesCollection.findOne({ _id: new ObjectId(categoryId) });
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    const capabilitiesCount = await roomCapabilityTypesCollection.countDocuments({ category: category.key });
    const servicesCount = await eventServiceTypesCollection.countDocuments({ category: category.key });
    
    if (capabilitiesCount > 0 || servicesCount > 0) {
      return res.status(400).json({ 
        error: `Cannot delete category. It has ${capabilitiesCount} capabilities and ${servicesCount} services.`,
        usage: { capabilities: capabilitiesCount, services: servicesCount }
      });
    }
    
    const result = await featureCategoriesCollection.deleteOne({ _id: new ObjectId(categoryId) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    
    logger.info('Feature category deleted:', {
      categoryId,
      key: category.key,
      deletedBy: userEmail
    });
    
    res.json({
      message: 'Feature category deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting feature category:', error);
    res.status(500).json({ error: 'Failed to delete feature category' });
  }
});

/**
 * Update a room capability type (Admin only)
 */
app.put('/api/admin/room-capability-types/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const capabilityId = req.params.id;
    const { key, name, description, category, dataType, icon, displayOrder, active } = req.body;
    
    if (!key || !name || !category || !dataType) {
      return res.status(400).json({ 
        error: 'Missing required fields: key, name, category, dataType' 
      });
    }
    
    const updateData = {
      key: key.trim(),
      name: name.trim(),
      description: description?.trim() || '',
      category: category.trim(),
      dataType: dataType.trim(),
      icon: icon?.trim() || '',
      displayOrder: displayOrder || 1,
      active: active !== false,
      updatedAt: new Date(),
      updatedBy: userId
    };
    
    const result = await roomCapabilityTypesCollection.findOneAndUpdate(
      { _id: new ObjectId(capabilityId) },
      { $set: updateData },
      { returnDocument: 'after' }
    );
    
    if (!result.value) {
      return res.status(404).json({ error: 'Room capability not found' });
    }
    
    logger.info('Room capability type updated:', {
      capabilityId,
      key: updateData.key,
      updatedBy: userEmail
    });
    
    res.json({
      message: 'Room capability type updated successfully',
      capability: result.value
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Capability key already exists' });
    }
    logger.error('Error updating room capability type:', error);
    res.status(500).json({ error: 'Failed to update room capability type' });
  }
});

/**
 * Delete a room capability type (Admin only)
 */
app.delete('/api/admin/room-capability-types/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const capabilityId = req.params.id;
    
    const result = await roomCapabilityTypesCollection.deleteOne({ _id: new ObjectId(capabilityId) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Room capability not found' });
    }
    
    logger.info('Room capability type deleted:', {
      capabilityId,
      deletedBy: userEmail
    });
    
    res.json({
      message: 'Room capability type deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting room capability type:', error);
    res.status(500).json({ error: 'Failed to delete room capability type' });
  }
});

/**
 * Update an event service type (Admin only)
 */
app.put('/api/admin/event-service-types/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const serviceId = req.params.id;
    const { key, name, description, category, dataType, icon, hasCost, displayOrder, active } = req.body;
    
    if (!key || !name || !category || !dataType) {
      return res.status(400).json({ 
        error: 'Missing required fields: key, name, category, dataType' 
      });
    }
    
    const updateData = {
      key: key.trim(),
      name: name.trim(),
      description: description?.trim() || '',
      category: category.trim(),
      dataType: dataType.trim(),
      icon: icon?.trim() || '',
      hasCost: hasCost === true,
      displayOrder: displayOrder || 1,
      active: active !== false,
      updatedAt: new Date(),
      updatedBy: userId
    };
    
    const result = await eventServiceTypesCollection.findOneAndUpdate(
      { _id: new ObjectId(serviceId) },
      { $set: updateData },
      { returnDocument: 'after' }
    );
    
    if (!result.value) {
      return res.status(404).json({ error: 'Event service not found' });
    }
    
    logger.info('Event service type updated:', {
      serviceId,
      key: updateData.key,
      updatedBy: userEmail
    });
    
    res.json({
      message: 'Event service type updated successfully',
      service: result.value
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Service key already exists' });
    }
    logger.error('Error updating event service type:', error);
    res.status(500).json({ error: 'Failed to update event service type' });
  }
});

/**
 * Delete an event service type (Admin only)
 */
app.delete('/api/admin/event-service-types/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const serviceId = req.params.id;
    
    const result = await eventServiceTypesCollection.deleteOne({ _id: new ObjectId(serviceId) });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Event service not found' });
    }
    
    logger.info('Event service type deleted:', {
      serviceId,
      deletedBy: userEmail
    });
    
    res.json({
      message: 'Event service type deleted successfully'
    });
  } catch (error) {
    logger.error('Error deleting event service type:', error);
    res.status(500).json({ error: 'Failed to delete event service type' });
  }
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await client.close();
  process.exit(0);
});

// Test endpoint to create sample events for Conference Room A and B
app.post('/api/test/create-sample-events', verifyToken, async (req, res) => {
  try {
    logger.log('Creating sample events for Conference Room A and B');

    const today = new Date('2025-08-20'); // August 20, 2025
    const userId = req.user.userId;
    
    // Find Conference Room A and B by name
    const conferenceRoomA = hardcodedRooms.find(room => room.name === 'Conference Room A');
    const conferenceRoomB = hardcodedRooms.find(room => room.name === 'Conference Room B');
    
    if (!conferenceRoomA || !conferenceRoomB) {
      return res.status(404).json({ error: 'Conference Room A or B not found' });
    }

    const sampleEvents = [
      // Conference Room A events
      {
        eventId: `test-conf-a-1-${Date.now()}`,
        userId: userId,
        calendarId: 'test-calendar',
        isDeleted: false,
        graphData: {
          id: `test-conf-a-1-${Date.now()}`,
          subject: 'Team Standup Meeting',
          start: {
            dateTime: new Date(today.getTime() + (9 * 60 * 60 * 1000)).toISOString(), // 9 AM
            timeZone: 'America/New_York'
          },
          end: {
            dateTime: new Date(today.getTime() + (11 * 60 * 60 * 1000)).toISOString(), // 11 AM
            timeZone: 'America/New_York'
          },
          location: { displayName: conferenceRoomA.displayName },
          organizer: { emailAddress: { name: 'Test User', address: req.user.email } }
        },
        internalData: {
          roomId: conferenceRoomA._id,
          categories: ['Meeting'],
          setupTime: 0,
          teardownTime: 0
        },
        lastSyncTime: new Date(),
        createdAt: new Date(),
        createdBy: userId,
        createdByEmail: req.user.email,
        createdByName: req.user.name || req.user.email,
        createdSource: 'test-data'
      },
      {
        eventId: `test-conf-a-2-${Date.now() + 1}`,
        userId: userId,
        calendarId: 'test-calendar',
        isDeleted: false,
        graphData: {
          id: `test-conf-a-2-${Date.now() + 1}`,
          subject: 'Project Review',
          start: {
            dateTime: new Date(today.getTime() + (15 * 60 * 60 * 1000)).toISOString(), // 3 PM
            timeZone: 'America/New_York'
          },
          end: {
            dateTime: new Date(today.getTime() + (15.5 * 60 * 60 * 1000)).toISOString(), // 3:30 PM
            timeZone: 'America/New_York'
          },
          location: { displayName: conferenceRoomA.displayName },
          organizer: { emailAddress: { name: 'Test User', address: req.user.email } }
        },
        internalData: {
          roomId: conferenceRoomA._id,
          categories: ['Meeting'],
          setupTime: 0,
          teardownTime: 0
        },
        lastSyncTime: new Date(),
        createdAt: new Date(),
        createdBy: userId,
        createdByEmail: req.user.email,
        createdByName: req.user.name || req.user.email,
        createdSource: 'test-data'
      },
      {
        eventId: `test-conf-a-3-${Date.now() + 2}`,
        userId: userId,
        calendarId: 'test-calendar',
        isDeleted: false,
        graphData: {
          id: `test-conf-a-3-${Date.now() + 2}`,
          subject: 'Client Presentation',
          start: {
            dateTime: new Date(today.getTime() + (18 * 60 * 60 * 1000)).toISOString(), // 6 PM
            timeZone: 'America/New_York'
          },
          end: {
            dateTime: new Date(today.getTime() + (20 * 60 * 60 * 1000)).toISOString(), // 8 PM
            timeZone: 'America/New_York'
          },
          location: { displayName: conferenceRoomA.displayName },
          organizer: { emailAddress: { name: 'Test User', address: req.user.email } }
        },
        internalData: {
          roomId: conferenceRoomA._id,
          categories: ['Meeting'],
          setupTime: 0,
          teardownTime: 0
        },
        lastSyncTime: new Date(),
        createdAt: new Date(),
        createdBy: userId,
        createdByEmail: req.user.email,
        createdByName: req.user.name || req.user.email,
        createdSource: 'test-data'
      },
      // Conference Room B events
      {
        eventId: `test-conf-b-1-${Date.now() + 3}`,
        userId: userId,
        calendarId: 'test-calendar',
        isDeleted: false,
        graphData: {
          id: `test-conf-b-1-${Date.now() + 3}`,
          subject: 'Department Meeting',
          start: {
            dateTime: new Date(today.getTime() + (10.5 * 60 * 60 * 1000)).toISOString(), // 10:30 AM
            timeZone: 'America/New_York'
          },
          end: {
            dateTime: new Date(today.getTime() + (11.5 * 60 * 60 * 1000)).toISOString(), // 11:30 AM
            timeZone: 'America/New_York'
          },
          location: { displayName: conferenceRoomB.displayName },
          organizer: { emailAddress: { name: 'Test User', address: req.user.email } }
        },
        internalData: {
          roomId: conferenceRoomB._id,
          categories: ['Meeting'],
          setupTime: 0,
          teardownTime: 0
        },
        lastSyncTime: new Date(),
        createdAt: new Date(),
        createdBy: userId,
        createdByEmail: req.user.email,
        createdByName: req.user.name || req.user.email,
        createdSource: 'test-data'
      },
      {
        eventId: `test-conf-b-2-${Date.now() + 4}`,
        userId: userId,
        calendarId: 'test-calendar',
        isDeleted: false,
        graphData: {
          id: `test-conf-b-2-${Date.now() + 4}`,
          subject: 'Training Session',
          start: {
            dateTime: new Date(today.getTime() + (14 * 60 * 60 * 1000)).toISOString(), // 2 PM
            timeZone: 'America/New_York'
          },
          end: {
            dateTime: new Date(today.getTime() + (14.25 * 60 * 60 * 1000)).toISOString(), // 2:15 PM
            timeZone: 'America/New_York'
          },
          location: { displayName: conferenceRoomB.displayName },
          organizer: { emailAddress: { name: 'Test User', address: req.user.email } }
        },
        internalData: {
          roomId: conferenceRoomB._id,
          categories: ['Training'],
          setupTime: 0,
          teardownTime: 0
        },
        lastSyncTime: new Date(),
        createdAt: new Date(),
        createdBy: userId,
        createdByEmail: req.user.email,
        createdByName: req.user.name || req.user.email,
        createdSource: 'test-data'
      },
      {
        eventId: `test-conf-b-3-${Date.now() + 5}`,
        userId: userId,
        calendarId: 'test-calendar',
        isDeleted: false,
        graphData: {
          id: `test-conf-b-3-${Date.now() + 5}`,
          subject: 'Board Meeting',
          start: {
            dateTime: new Date(today.getTime() + (17 * 60 * 60 * 1000)).toISOString(), // 5 PM
            timeZone: 'America/New_York'
          },
          end: {
            dateTime: new Date(today.getTime() + (19 * 60 * 60 * 1000)).toISOString(), // 7 PM
            timeZone: 'America/New_York'
          },
          location: { displayName: conferenceRoomB.displayName },
          organizer: { emailAddress: { name: 'Test User', address: req.user.email } }
        },
        internalData: {
          roomId: conferenceRoomB._id,
          categories: ['Meeting'],
          setupTime: 0,
          teardownTime: 0
        },
        lastSyncTime: new Date(),
        createdAt: new Date(),
        createdBy: userId,
        createdByEmail: req.user.email,
        createdByName: req.user.name || req.user.email,
        createdSource: 'test-data'
      }
    ];

    // Insert events into unified collection
    const result = await unifiedEventsCollection.insertMany(sampleEvents);
    
    logger.log(`Created ${result.insertedCount} sample events`);
    
    res.json({ 
      success: true, 
      message: `Created ${result.insertedCount} sample events`,
      eventIds: Object.values(result.insertedIds)
    });

  } catch (error) {
    logger.error('Error creating sample events:', error);
    res.status(500).json({ error: 'Failed to create sample events' });
  }
});

// ============================================================================
// NEW UNIFIED EVENT API ENDPOINTS
// These endpoints handle room reservation requests as events in the unified collection
// Running in parallel with existing /room-reservations endpoints for safe testing
// ============================================================================

/**
 * Create a new room reservation request as an event (Authenticated)
 * POST /api/events/request
 * Creates an event with status='room-reservation-request' in templeEvents__Events
 */
app.post('/api/events/request', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;

    const {
      eventTitle,
      eventDescription,
      startDateTime,
      endDateTime,
      attendeeCount,
      requestedRooms,
      specialRequirements,
      department,
      phone,
      priority,
      setupTimeMinutes,
      teardownTimeMinutes,
      setupTime,
      teardownTime,
      doorOpenTime,
      doorCloseTime,
      setupNotes,
      doorNotes,
      eventNotes,
      isOnBehalfOf,
      contactName,
      contactEmail,
      requesterName,
      requesterEmail
    } = req.body;

    // Validate required fields
    if (!eventTitle || !startDateTime || !endDateTime || !requestedRooms || requestedRooms.length === 0) {
      return res.status(400).json({
        error: 'Missing required fields: eventTitle, startDateTime, endDateTime, requestedRooms'
      });
    }

    // Validate delegation fields
    if (isOnBehalfOf && (!contactName || !contactEmail)) {
      return res.status(400).json({
        error: 'Contact person name and email required when submitting on behalf of someone else'
      });
    }

    // Get room names and location IDs for event data
    let roomNames = [];
    let locationObjectIds = [];
    try {
      logger.debug('Looking up locations (rooms):', { requestedRooms, count: requestedRooms.length });

      // Handle both ObjectId and string formats for room IDs
      const roomQuery = requestedRooms.map(id => {
        try {
          // Try to convert to ObjectId if it's a valid 24-char hex string
          if (typeof id === 'string' && id.length === 24 && /^[0-9a-fA-F]{24}$/.test(id)) {
            return new ObjectId(id);
          }
          // Otherwise use as-is (for non-ObjectId string IDs)
          return id;
        } catch (err) {
          logger.warn('Could not convert room ID to ObjectId, using as string:', id);
          return id;
        }
      });

      // Query locations collection (rooms are locations with isReservable: true)
      const rooms = await locationsCollection.find({
        _id: { $in: roomQuery },
        isReservable: true
      }).toArray();

      roomNames = rooms.map(r => r.displayName || r.name || 'Unknown Room');
      locationObjectIds = rooms.map(r => r._id);
      logger.debug('Found locations (rooms):', { count: rooms.length, names: roomNames });

      // If no rooms found, use the IDs as fallback names
      if (roomNames.length === 0) {
        logger.warn('No locations found in database, using IDs as names');
        roomNames = requestedRooms.map(id => `Room ${id}`);
      }

    } catch (err) {
      logger.error('Error looking up locations:', err);
      // Fallback: use room IDs as names
      roomNames = requestedRooms.map(id => `Room ${id}`);
    }

    // Generate unique event ID
    const eventId = `evt-request-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create event document with room reservation data
    const eventDoc = {
      eventId,
      userId,
      source: 'Room Reservation System',
      status: 'room-reservation-request', // Key status field
      isDeleted: false,

      // Minimal graphData structure (not yet a real Graph event)
      graphData: {
        subject: eventTitle,
        start: {
          dateTime: startDateTime,
          timeZone: 'America/New_York'
        },
        end: {
          dateTime: endDateTime,
          timeZone: 'America/New_York'
        },
        location: { displayName: roomNames.join('; ') },
        bodyPreview: eventDescription || '',
        categories: [],
        isAllDay: false,
        importance: priority === 'high' ? 'high' : 'normal',
        showAs: 'busy',
        sensitivity: 'normal',
        attendees: [],
        organizer: {
          emailAddress: {
            name: requesterName || userEmail,
            address: requesterEmail || userEmail
          }
        }
      },

      // Standard internal enrichments
      internalData: {
        mecCategories: [],
        setupMinutes: setupTimeMinutes || 0,
        teardownMinutes: teardownTimeMinutes || 0,
        registrationNotes: '',
        assignedTo: '',
        staffAssignments: [],
        internalNotes: eventNotes || '',
        setupStatus: 'pending',
        estimatedCost: null,
        actualCost: null,
        customFields: {}
      },

      // NEW: Room reservation metadata
      roomReservationData: {
        requestedBy: {
          userId,
          name: requesterName || userEmail,
          email: requesterEmail || userEmail,
          department: department || '',
          phone: phone || ''
        },
        contactPerson: isOnBehalfOf ? {
          name: contactName,
          email: contactEmail,
          isOnBehalfOf: true
        } : null,
        requestedRooms: requestedRooms,
        timing: {
          setupTime: setupTime || '',
          teardownTime: teardownTime || '',
          doorOpenTime: doorOpenTime || '',
          doorCloseTime: doorCloseTime || '',
          setupTimeMinutes: setupTimeMinutes || 0,
          teardownTimeMinutes: teardownTimeMinutes || 0
        },
        attendeeCount: parseInt(attendeeCount) || 0,
        priority: priority || 'medium',
        specialRequirements: specialRequirements || '',
        internalNotes: {
          setupNotes: setupNotes || '',
          doorNotes: doorNotes || '',
          eventNotes: eventNotes || ''
        },
        submittedAt: new Date(),
        changeKey: generateChangeKey({
          eventTitle,
          startDateTime,
          endDateTime,
          requestedRooms,
          attendeeCount,
          priority
        }),
        currentRevision: 1,
        reviewingBy: null,
        reviewedBy: null,
        reviewNotes: '',
        createdGraphEventIds: [],
        calendarMode: null
      },

      // TOP-LEVEL APPLICATION FIELDS (for forms/UI - no transformation needed)
      eventTitle,
      eventDescription: eventDescription || '',
      startDateTime,
      endDateTime,
      startDate: startDateTime ? new Date(startDateTime).toISOString().split('T')[0] : '',
      startTime: startDateTime ? new Date(startDateTime).toTimeString().slice(0, 5) : '',
      endDate: endDateTime ? new Date(endDateTime).toISOString().split('T')[0] : '',
      endTime: endDateTime ? new Date(endDateTime).toTimeString().slice(0, 5) : '',
      setupTime: setupTime || '',
      teardownTime: teardownTime || '',
      doorOpenTime: doorOpenTime || '',
      doorCloseTime: doorCloseTime || '',
      setupTimeMinutes: setupTimeMinutes || 0,
      teardownTimeMinutes: teardownTimeMinutes || 0,
      setupNotes: setupNotes || '',
      doorNotes: doorNotes || '',
      eventNotes: eventNotes || '',
      location: roomNames.join('; '),
      locations: locationObjectIds, // Array of ObjectId references to templeEvents__Locations
      requestedRooms: requestedRooms,
      requesterName: requesterName || userEmail,
      requesterEmail: requesterEmail || userEmail,
      department: department || '',
      phone: phone || '',
      attendeeCount: parseInt(attendeeCount) || 0,
      priority: priority || 'medium',
      specialRequirements: specialRequirements || '',
      contactName: isOnBehalfOf ? contactName : '',
      contactEmail: isOnBehalfOf ? contactEmail : '',
      isOnBehalfOf: isOnBehalfOf || false,
      reviewNotes: '',
      isAllDayEvent: false,
      virtualMeetingUrl: null,
      virtualPlatform: null,
      mecCategories: [],
      assignedTo: '',

      createdAt: new Date(),
      createdBy: userId,
      createdByEmail: userEmail,
      createdByName: requesterName || userEmail,
      createdSource: 'room-reservation',
      lastModifiedDateTime: new Date(),
      lastSyncedAt: new Date(),
      calendarId: null, // No calendar yet (pending approval)
      sourceCalendars: [],
      sourceMetadata: {},
      syncStatus: 'pending'
    };

    const result = await unifiedEventsCollection.insertOne(eventDoc);

    // Create audit history entry
    await eventAuditHistoryCollection.insertOne({
      eventId: eventDoc.eventId,
      reservationId: result.insertedId, // Link to document _id
      action: 'request_submitted',
      performedBy: userId,
      performedByEmail: userEmail,
      timestamp: new Date(),
      changes: [
        { field: 'status', oldValue: null, newValue: 'room-reservation-request' },
        { field: 'eventTitle', oldValue: null, newValue: eventTitle }
      ],
      revisionNumber: 1
    });

    logger.info('Room reservation request created as event:', {
      eventId: eventDoc.eventId,
      userId,
      eventTitle,
      requestedRooms: roomNames
    });

    res.json({
      success: true,
      eventId: eventDoc.eventId,
      _id: result.insertedId,
      message: 'Room reservation request submitted successfully'
    });

  } catch (error) {
    logger.error('Error creating room reservation request:', {
      error: error.message,
      stack: error.stack,
      userId,
      eventTitle: req.body.eventTitle
    });
    res.status(500).json({
      error: 'Failed to submit reservation request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Approve a room reservation request (Admin only)
 * PUT /api/admin/events/:id/approve
 * Changes status from 'room-reservation-request' to 'approved'
 * Optionally creates Graph calendar event
 */
app.put('/api/admin/events/:id/approve', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const id = req.params.id;
    const { notes, calendarMode, createCalendarEvent, graphToken, forceApprove, targetCalendar } = req.body;

    // Get event by _id
    const event = await unifiedEventsCollection.findOne({ _id: new ObjectId(id) });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Verify status is room-reservation-request
    if (event.status !== 'room-reservation-request') {
      return res.status(400).json({
        error: 'Event is not a pending room reservation request',
        currentStatus: event.status
      });
    }

    // ETag validation (if provided)
    const providedETag = req.headers['if-match'];
    if (providedETag && event.roomReservationData?.changeKey !== providedETag) {
      // Calculate what changed
      const changes = [];
      return res.status(409).json({
        error: 'ConflictError',
        message: 'Event was modified by another user. Please refresh and try again.',
        lastModifiedBy: event.roomReservationData?.reviewedBy?.name || 'Unknown',
        changes
      });
    }

    // Check for scheduling conflicts (unless forceApprove)
    if (!forceApprove && event.roomReservationData?.requestedRooms) {
      // TODO: Implement conflict detection
      // For now, skip conflict checking
    }

    // Create Graph calendar event (if requested)
    let graphEventId = null;
    let calendarEventResult = null;
    let selectedCalendar = null;

    if (createCalendarEvent && graphToken) {
      try {
        // Determine target calendar: use override, then database default, then fallback to sandbox
        if (targetCalendar) {
          selectedCalendar = targetCalendar;
        } else {
          // Get default from database
          const settings = await systemSettingsCollection.findOne({ _id: 'calendar-settings' });
          selectedCalendar = settings?.defaultCalendar || 'templesandbox@emanuelnyc.org';
        }

        // Create Graph event
        const graphEventData = {
          subject: event.graphData.subject,
          start: event.graphData.start,
          end: event.graphData.end,
          location: event.graphData.location,
          body: {
            contentType: 'Text',
            content: event.graphData.bodyPreview || ''
          },
          categories: event.graphData.categories || [],
          importance: event.graphData.importance || 'normal',
          showAs: event.graphData.showAs || 'busy'
        };

        const graphResponse = await fetch(
          `https://graph.microsoft.com/v1.0/users/${selectedCalendar}/events`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${graphToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(graphEventData)
          }
        );

        if (graphResponse.ok) {
          const createdEvent = await graphResponse.json();
          graphEventId = createdEvent.id;
          calendarEventResult = {
            success: true,
            eventId: graphEventId,
            targetCalendar: selectedCalendar
          };
          logger.info('Graph calendar event created:', { graphEventId, targetCalendar: selectedCalendar });
        } else {
          const errorText = await graphResponse.text();
          calendarEventResult = {
            success: false,
            error: `Graph API error: ${graphResponse.status} - ${errorText}`
          };
          logger.error('Failed to create Graph event:', errorText);
        }
      } catch (error) {
        calendarEventResult = {
          success: false,
          error: error.message
        };
        logger.error('Error creating Graph calendar event:', error);
      }
    }

    // Update event status
    const newChangeKey = generateChangeKey({
      ...event,
      status: 'approved',
      reviewedAt: new Date()
    });

    const updateDoc = {
      $set: {
        status: 'approved',
        'roomReservationData.reviewedBy': {
          userId,
          name: user?.displayName || userEmail,
          reviewedAt: new Date()
        },
        'roomReservationData.reviewNotes': notes || '',
        'roomReservationData.changeKey': newChangeKey,
        'roomReservationData.currentRevision': (event.roomReservationData?.currentRevision || 1) + 1,
        'roomReservationData.reviewingBy': null, // Release soft lock
        'roomReservationData.calendarMode': calendarMode || CALENDAR_CONFIG.DEFAULT_MODE,
        lastModifiedDateTime: new Date()
      }
    };

    // Add Graph event ID if created
    if (graphEventId) {
      updateDoc.$set['graphData.id'] = graphEventId;
      updateDoc.$set.calendarId = graphEventId;
      updateDoc.$push = {
        'roomReservationData.createdGraphEventIds': graphEventId
      };
    }

    const updateResult = await unifiedEventsCollection.updateOne({ _id: new ObjectId(id) }, updateDoc);

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Audit log
    await eventAuditHistoryCollection.insertOne({
      eventId: event.eventId,
      reservationId: event._id,
      action: 'approved',
      performedBy: userId,
      performedByEmail: userEmail,
      timestamp: new Date(),
      changes: [
        { field: 'status', oldValue: 'room-reservation-request', newValue: 'approved' },
        { field: 'reviewNotes', oldValue: '', newValue: notes || '' }
      ],
      revisionNumber: (event.roomReservationData?.currentRevision || 1) + 1
    });

    logger.info('Room reservation approved:', {
      eventId: event.eventId,
      mongoId: id,
      approvedBy: userEmail,
      graphEventCreated: !!graphEventId
    });

    res.json({
      success: true,
      changeKey: newChangeKey,
      calendarEvent: calendarEventResult,
      message: 'Reservation approved successfully'
    });

  } catch (error) {
    logger.error('Error approving room reservation:', error);
    res.status(500).json({ error: 'Failed to approve reservation' });
  }
});

/**
 * Reject a room reservation request (Admin only)
 * PUT /api/admin/events/:id/reject
 * Changes status from 'room-reservation-request' to 'rejected'
 */
app.put('/api/admin/events/:id/reject', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const id = req.params.id;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }

    // Get event by _id
    const event = await unifiedEventsCollection.findOne({ _id: new ObjectId(id) });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Verify status is room-reservation-request
    if (event.status !== 'room-reservation-request') {
      return res.status(400).json({
        error: 'Event is not a pending room reservation request',
        currentStatus: event.status
      });
    }

    // Update event status
    const newChangeKey = generateChangeKey({
      ...event,
      status: 'rejected',
      rejectionReason: reason
    });

    const updateResult = await unifiedEventsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: 'rejected',
          'roomReservationData.reviewedBy': {
            userId,
            name: user?.displayName || userEmail,
            reviewedAt: new Date()
          },
          'roomReservationData.reviewNotes': reason,
          'roomReservationData.changeKey': newChangeKey,
          'roomReservationData.currentRevision': (event.roomReservationData?.currentRevision || 1) + 1,
          'roomReservationData.reviewingBy': null, // Release soft lock
          lastModifiedDateTime: new Date()
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Audit log
    await eventAuditHistoryCollection.insertOne({
      eventId: event.eventId,
      reservationId: event._id,
      action: 'rejected',
      performedBy: userId,
      performedByEmail: userEmail,
      timestamp: new Date(),
      changes: [
        { field: 'status', oldValue: 'room-reservation-request', newValue: 'rejected' },
        { field: 'reviewNotes', oldValue: '', newValue: reason }
      ],
      revisionNumber: (event.roomReservationData?.currentRevision || 1) + 1
    });

    logger.info('Room reservation rejected:', {
      eventId: event.eventId,
      mongoId: id,
      rejectedBy: userEmail,
      reason
    });

    res.json({
      success: true,
      changeKey: newChangeKey,
      message: 'Reservation rejected successfully'
    });

  } catch (error) {
    logger.error('Error rejecting room reservation:', error);
    res.status(500).json({ error: 'Failed to reject reservation' });
  }
});

/**
 * Update an event (Admin only)
 * PUT /api/admin/events/:id
 * Updates both Graph API event and internal enrichments
 */
app.put('/api/admin/events/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const id = req.params.id;
    const updates = req.body;
    const graphToken = updates.graphToken;

    // Get event by _id
    const event = await unifiedEventsCollection.findOne({ _id: new ObjectId(id) });
    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // If event has a Graph event ID, update it in Graph API
    // Graph events store the Graph API ID in graphData.id
    const graphEventId = event.graphData?.id;
    if (graphEventId && graphToken) {
      try {
        // Prepare Graph API update payload
        // Build Graph API update with ONLY Graph-compatible fields
        const graphUpdate = {
          subject: updates.eventTitle || event.eventTitle || event.graphData?.subject,
          start: {
            dateTime: updates.startDateTime || event.startDateTime || event.graphData?.start?.dateTime,
            timeZone: updates.startTimeZone || event.startTimeZone || event.graphData?.start?.timeZone || 'America/New_York'
          },
          end: {
            dateTime: updates.endDateTime || event.endDateTime || event.graphData?.end?.dateTime,
            timeZone: updates.endTimeZone || event.endTimeZone || event.graphData?.end?.timeZone || 'America/New_York'
          }
        };

        // Handle location field - convert from our internal array format to Graph's single object format
        if (updates.locations && Array.isArray(updates.locations) && updates.locations.length > 0) {
          // Join multiple locations into a single string
          const locationString = updates.locations
            .map(loc => typeof loc === 'string' ? loc : loc.displayName || loc.name || '')
            .filter(Boolean)
            .join(', ');

          if (locationString) {
            graphUpdate.location = { displayName: locationString };
          }
        } else if (updates.location) {
          // Legacy single location field (if it exists)
          graphUpdate.location = {
            displayName: typeof updates.location === 'string'
              ? updates.location
              : updates.location.displayName || updates.location.name || ''
          };
        } else if (event.graphData?.location?.displayName) {
          // Keep existing Graph location if not changed
          graphUpdate.location = event.graphData.location;
        }

        // Handle body/description
        if (updates.eventDescription) {
          graphUpdate.body = {
            contentType: 'HTML',
            content: updates.eventDescription
          };
        } else if (updates.description) {
          graphUpdate.body = {
            contentType: 'HTML',
            content: updates.description
          };
        }

        // Add categories if they exist (Graph API supports this)
        if (updates.categories && Array.isArray(updates.categories)) {
          graphUpdate.categories = updates.categories;
        } else if (event.graphData?.categories && Array.isArray(event.graphData.categories)) {
          graphUpdate.categories = event.graphData.categories;
        }

        logger.info('Updating Graph event:', { graphEventId, updates: Object.keys(updates) });

        // Update in Graph API
        const graphResponse = await fetch(
          `https://graph.microsoft.com/v1.0/me/events/${graphEventId}`,
          {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${graphToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(graphUpdate)
          }
        );

        if (!graphResponse.ok) {
          const errorText = await graphResponse.text();
          logger.error('Graph API update failed:', { status: graphResponse.status, error: errorText });
          throw new Error(`Graph API update failed: ${graphResponse.status}`);
        }

        logger.info('Graph event updated successfully');
      } catch (graphError) {
        logger.error('Failed to update Graph event:', graphError);
        return res.status(500).json({ error: 'Failed to update calendar event', details: graphError.message });
      }
    }

    // Remove sensitive/temporary fields and immutable MongoDB fields that shouldn't be saved
    // Also remove graphData to avoid conflicts (we'll sync it manually below)
    const {
      graphToken: _graphToken,
      _id: _mongoId,
      id: _graphId,
      eventId: _eventId,
      userId: _userId,
      createdAt: _createdAt,
      createdBy: _createdBy,
      createdByEmail: _createdByEmail,
      createdByName: _createdByName,
      createdSource: _createdSource,
      graphData: _graphData,
      ...safeUpdates
    } = updates;

    // Build update operations with field syncing (same as creation flow)
    const updateOperations = { ...safeUpdates };

    // If this is a Graph event, sync graphData fields with top-level fields
    // This ensures eventTitle ↔ graphData.subject stay synchronized (same as creation)
    if (graphEventId && graphToken) {
      // Sync subject
      if (updates.eventTitle !== undefined) {
        updateOperations['graphData.subject'] = updates.eventTitle;
      }

      // Sync start datetime
      if (updates.startDateTime !== undefined) {
        updateOperations['graphData.start.dateTime'] = updates.startDateTime;
      }
      if (updates.startTimeZone !== undefined) {
        updateOperations['graphData.start.timeZone'] = updates.startTimeZone;
      }

      // Sync end datetime
      if (updates.endDateTime !== undefined) {
        updateOperations['graphData.end.dateTime'] = updates.endDateTime;
      }
      if (updates.endTimeZone !== undefined) {
        updateOperations['graphData.end.timeZone'] = updates.endTimeZone;
      }

      // Sync body/description
      if (updates.eventDescription !== undefined) {
        updateOperations['graphData.body.content'] = updates.eventDescription;
        updateOperations['graphData.body.contentType'] = 'HTML';
      }

      // Sync isAllDay
      if (updates.isAllDayEvent !== undefined) {
        updateOperations['graphData.isAllDay'] = updates.isAllDayEvent;
      }
    }

    // Update internal enrichments
    const newChangeKey = generateChangeKey({ ...event, ...updateOperations });

    const updateResult = await unifiedEventsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          ...updateOperations,
          changeKey: newChangeKey,
          lastModifiedDateTime: new Date(),
          lastModifiedBy: userId
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    logger.info('Event updated:', {
      eventId: event.eventId,
      mongoId: id,
      updatedBy: userEmail
    });

    res.json({
      success: true,
      changeKey: newChangeKey,
      message: 'Event updated successfully'
    });

  } catch (error) {
    logger.error('Error updating event:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

/**
 * Delete a Graph API event (Admin only)
 * DELETE /api/admin/events/graph/:graphEventId
 * Deletes from Microsoft Graph calendar
 */
app.delete('/api/admin/events/graph/:graphEventId', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const graphEventId = req.params.graphEventId;
    const { graphToken } = req.body;

    if (!graphToken) {
      return res.status(400).json({ error: 'Graph token required' });
    }

    // Delete from Graph API
    const graphResponse = await fetch(
      `https://graph.microsoft.com/v1.0/me/events/${graphEventId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${graphToken}`
        }
      }
    );

    if (!graphResponse.ok && graphResponse.status !== 404) {
      throw new Error(`Graph API delete failed: ${graphResponse.status}`);
    }

    // Also mark as deleted in our internal collection if it exists
    await unifiedEventsCollection.updateOne(
      { graphEventId },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: userId
        }
      }
    );

    logger.info('Graph event deleted:', {
      graphEventId,
      deletedBy: userEmail
    });

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting Graph event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

/**
 * Delete an internal event (Admin only)
 * DELETE /api/admin/events/:id
 * Soft deletes internal event
 */
app.delete('/api/admin/events/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;

    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');

    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const id = req.params.id;

    // Soft delete the event
    const updateResult = await unifiedEventsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: userId
        }
      }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    logger.info('Internal event deleted:', {
      mongoId: id,
      deletedBy: userEmail
    });

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting internal event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

/**
 * Get events by status (supports filtering for room-reservation-request)
 * GET /api/events?status=room-reservation-request
 */
app.get('/api/events', verifyToken, async (req, res) => {
  console.log('===== CODE UPDATE LOADED! =====');
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { status, page = 1, limit = 20 } = req.query;

    // Build query
    const query = { isDeleted: { $ne: true } };

    if (status) {
      query.status = status;
      // If filtering by room-reservation-request, ensure roomReservationData exists
      if (status === 'room-reservation-request') {
        query.roomReservationData = { $exists: true, $ne: null };
      }
    }

    // Check if user can view all reservations (match old endpoint logic)
    const user = await usersCollection.findOne({ userId });
    const canViewAll = user?.permissions?.canViewAllReservations || userEmail.includes('admin');

    // Non-admin users can only see their own requests
    if (!canViewAll && status === 'room-reservation-request') {
      // Filter by the userId stored in roomReservationData.requestedBy.userId
      query['roomReservationData.requestedBy.userId'] = userId;
    }

    console.log('🔍 GET /api/events query:', JSON.stringify(query, null, 2));
    console.log('👤 User info:', { userId, userEmail, canViewAll });

    // Execute query with pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const events = await unifiedEventsCollection
      .find(query)
      .sort({ 'graphData.start.dateTime': -1, submittedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    const totalCount = await unifiedEventsCollection.countDocuments(query);

    console.log('📊 Query results:', { totalCount, returnedCount: events.length });

    res.json({
      events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    logger.error('Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// ============================================================================
// END NEW UNIFIED EVENT API ENDPOINTS
// ============================================================================

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