// api-server.js - Express API for MongoDB
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');
const logger = require('./utils/logger');
const csvUtils = require('./utils/csvUtils');

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Graph-Token'],
  credentials: true,
  exposedHeaders: ['Authorization'],
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

// Handle preflight requests explicitly
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Graph-Token');
  res.header('Access-Control-Allow-Credentials', 'true');
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
let internalEventsCollection; // TODO: Remove after migration
let eventCacheCollection; // TODO: Remove after migration
let unifiedEventsCollection; // New unified collection
let calendarDeltasCollection; // Delta token storage
let roomsCollection; // Room information and features
let locationsCollection; // Unified locations from events
let roomReservationsCollection; // Room reservation requests
let reservationTokensCollection; // Guest access tokens
let roomCapabilityTypesCollection; // Configurable room capability definitions
let eventServiceTypesCollection; // Configurable event service definitions
let featureCategoriesCollection; // Feature groupings for UI organization

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

/**
 * Create indexes for the unified events collection for optimal performance
 */
async function createUnifiedEventIndexes() {
  try {
    console.log('Creating unified event indexes...');
    
    // Unique index to prevent duplicate events
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
    console.error('Error creating unified event indexes:', error);
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
 * Create indexes for the rooms collection
 */
async function createRoomIndexes() {
  try {
    console.log('Creating room indexes...');
    
    // Index for active rooms
    await roomsCollection.createIndex(
      { active: 1 },
      { name: "active_rooms", background: true }
    );
    
    // Index for searching by features
    await roomsCollection.createIndex(
      { features: 1 },
      { name: "room_features", background: true }
    );
    
    // Index for capacity searches
    await roomsCollection.createIndex(
      { capacity: 1 },
      { name: "room_capacity", background: true }
    );
    
    console.log('Room indexes created successfully');
  } catch (error) {
    console.error('Error creating room indexes:', error);
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
 * Seed initial room data if the collection is empty
 */
async function seedInitialRooms() {
  try {
    const roomCount = await roomsCollection.countDocuments();
    if (roomCount === 0) {
      console.log('Seeding initial room data...');
      
      const initialRooms = [
        {
          name: "Chapel",
          building: "Main Building",
          floor: "1st Floor",
          capacity: 200,
          features: ["piano", "stage", "microphone", "projector"],
          accessibility: ["wheelchair-accessible", "hearing-loop"],
          active: true,
          description: "Main worship space with traditional setup",
          notes: "Reserved for services on Sabbath",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Social Hall",
          building: "Main Building", 
          floor: "1st Floor",
          capacity: 150,
          features: ["kitchen", "stage", "tables", "chairs"],
          accessibility: ["wheelchair-accessible"],
          active: true,
          description: "Large multipurpose room with kitchen access",
          notes: "Can be divided with partition",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Conference Room A",
          building: "Main Building",
          floor: "2nd Floor", 
          capacity: 12,
          features: ["av-equipment", "projector", "whiteboard", "conference-table"],
          accessibility: ["elevator"],
          active: true,
          description: "Executive conference room with video conferencing",
          notes: "Requires advance booking for setup",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Conference Room B",
          building: "Main Building",
          floor: "2nd Floor",
          capacity: 8,
          features: ["whiteboard", "conference-table"],
          accessibility: ["elevator"],
          active: true,
          description: "Small meeting room for intimate discussions",
          notes: "No A/V equipment available",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Library",
          building: "Main Building",
          floor: "2nd Floor",
          capacity: 20,
          features: ["quiet-zone", "books", "study-tables"],
          accessibility: ["wheelchair-accessible", "elevator"],
          active: true,
          description: "Quiet study and small group space",
          notes: "No food or drinks allowed",
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          name: "Youth Room",
          building: "Education Wing",
          floor: "1st Floor",
          capacity: 30,
          features: ["games", "comfortable-seating", "tv", "kitchenette"],
          accessibility: ["wheelchair-accessible"],
          active: true,
          description: "Casual space designed for youth activities",
          notes: "Snacks and beverages allowed",
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];
      
      await roomsCollection.insertMany(initialRooms);
      console.log(`Seeded ${initialRooms.length} initial rooms`);
    }
  } catch (error) {
    console.error('Error seeding initial rooms:', error);
  }
}

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

// Connect to MongoDB with reconnection logic
async function connectToDatabase() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const dbName = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';
    console.log(`API Server connecting to database: '${dbName}'`);
    db = client.db(dbName);
    usersCollection = db.collection('templeEvents__Users');
    internalEventsCollection = db.collection('templeEvents__InternalEvents'); // TODO: Remove after migration
    eventCacheCollection = db.collection('templeEvents__EventCache'); // TODO: Remove after migration
    unifiedEventsCollection = db.collection('templeEvents__Events'); // New unified collection
    calendarDeltasCollection = db.collection('templeEvents__CalendarDeltas'); // Delta token storage
    roomsCollection = db.collection('templeEvents__Rooms'); // Room information and features
    locationsCollection = db.collection('templeEvents__Locations'); // Unified locations from events
    roomReservationsCollection = db.collection('templeEvents__RoomReservations'); // Room reservation requests
    reservationTokensCollection = db.collection('templeEvents__ReservationTokens'); // Guest access tokens
    roomCapabilityTypesCollection = db.collection('templeEvents__RoomCapabilityTypes'); // Configurable room capability definitions
    eventServiceTypesCollection = db.collection('templeEvents__EventServiceTypes'); // Configurable event service definitions
    featureCategoriesCollection = db.collection('templeEvents__FeatureCategories'); // Feature groupings for UI organization
    
    // Create indexes for new unified collections
    await createUnifiedEventIndexes();
    await createCalendarDeltaIndexes();
    
    // Create indexes for room reservation system
    await createRoomIndexes();
    await createLocationIndexes();
    await createRoomReservationIndexes();
    await createReservationTokenIndexes();
    
    // Create indexes for feature configuration system
    await createRoomCapabilityTypesIndexes();
    await createEventServiceTypesIndexes();
    await createFeatureCategoriesIndexes();
    
    // Keep old indexes for now during migration
    await createEventCacheIndexes();
    
    // Seed initial room data if none exists
    await seedInitialRooms();
    
    // Seed initial feature configuration data if none exists
    await seedInitialFeatureCategories();
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
      internalEventsDeleted: 0,
      cacheEventsDeleted: 0
    };
    
    // 1. Delete from unified events collection (templeEvents__Events)
    const unifiedResult = await unifiedEventsCollection.deleteOne({
      userId: userId,
      eventId: eventId
    });
    deletionResults.unifiedEventsDeleted = unifiedResult.deletedCount;
    logger.debug(`Deleted ${unifiedResult.deletedCount} records from unified events collection`);
    
    // 2. Delete from legacy internal events collection if it exists (templeEvents__InternalEvents)
    // Note: This is for backward compatibility with older data
    try {
      const internalEventsCollection = db.collection('templeEvents__InternalEvents');
      const internalResult = await internalEventsCollection.deleteOne({
        userId: userId,
        eventId: eventId
      });
      deletionResults.internalEventsDeleted = internalResult.deletedCount;
      logger.debug(`Deleted ${internalResult.deletedCount} records from internal events collection`);
    } catch (internalError) {
      // This is expected if the collection doesn't exist - just log and continue
      logger.debug('Internal events collection not found or error accessing it:', internalError.message);
    }
    
    // 3. Delete from event cache collection
    const cacheResult = await eventCacheCollection.deleteMany({
      userId: userId,
      eventId: eventId
    });
    deletionResults.cacheEventsDeleted = cacheResult.deletedCount;
    logger.debug(`Deleted ${cacheResult.deletedCount} records from event cache collection`);
    
    // Check if any deletion occurred
    const totalDeleted = deletionResults.unifiedEventsDeleted + 
                        deletionResults.internalEventsDeleted + 
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
    
    // Use upsert to handle updates
    const result = await eventCacheCollection.replaceOne(
      { 
        userId: userId, 
        calendarId: calendarId, 
        eventId: eventData.id 
      },
      cacheEntry,
      { upsert: true }
    );
    
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
    
    const cachedEvents = await eventCacheCollection.find(query).toArray();
    
    logger.debug(`getCachedEvents: Found ${cachedEvents.length} cached events`, {
      eventIds: cachedEvents.slice(0, 5).map(e => ({ id: e.eventId, subject: e.eventData?.subject }))
    });
    
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
    
    const unifiedEvent = {
      userId: userId,
      calendarId: calendarId,
      eventId: graphEvent.id,
      
      // Graph API data (source of truth)
      graphData: {
        id: graphEvent.id,
        subject: graphEvent.subject,
        start: graphEvent.start,
        end: graphEvent.end,
        location: graphEvent.location || { displayName: '' },
        categories: graphEvent.categories || [],
        bodyPreview: graphEvent.bodyPreview || '',
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
    
    // Extract and process location if present
    let locationId = null;
    if (graphEvent.location && graphEvent.location.displayName) {
      try {
        const locationResult = await upsertLocationFromEvent({
          graphData: { location: graphEvent.location }
        });
        locationId = locationResult.locationId;
        logger.debug('Processed location for event', {
          eventId: graphEvent.id,
          locationName: graphEvent.location.displayName,
          locationId: locationId,
          wasCreated: locationResult.wasCreated
        });
      } catch (error) {
        logger.error('Error processing location for event:', error);
        // Continue without location reference - non-blocking
      }
    }
    
    // Add location reference to unified event
    if (locationId) {
      unifiedEvent.locationId = locationId;
    }
    
    // Use upsert to handle updates while preserving internal data
    const result = await unifiedEventsCollection.replaceOne(
      { 
        userId: userId, 
        eventId: graphEvent.id 
      },
      unifiedEvent,
      { upsert: true }
    );
    
    logger.debug(`Upserted unified event: ${graphEvent.subject}`, {
      eventId: graphEvent.id,
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
    
    // If high confidence match, use existing location
    if (existing?.confidence >= 0.9) {
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
    
    // Determine status based on confidence
    const status = existing?.confidence >= 0.7 ? 'pending' : 'approved';
    const suggestedMatches = existing ? [{
      locationId: existing.location._id,
      locationName: existing.location.name,
      confidence: existing.confidence,
      reason: existing.confidence >= 0.7 ? 'Partial name match' : 'Possible match'
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
      status: status, // 'approved', 'pending', 'merged'
      confidence: existing?.confidence || 0,
      suggestedMatches: suggestedMatches,
      needsReview: status === 'pending',
      mergedInto: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      
      // Tracking fields
      importSource: 'event-import',
      originalText: locationInfo.originalText,
      seenVariations: [locationInfo.originalText],
      
      // Standard fields
      active: status === 'approved',
      createdAt: now,
      updatedAt: now,
      importedFrom: 'event-import',
      usageCount: 1
    };
    
    const result = await locationsCollection.insertOne(newLocation);
    return {
      locationId: result.insertedId,
      wasCreated: true,
      needsReview: status === 'pending',
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
        registrationNotes: newGraphEvent.bodyPreview || enhancedInternalData.registrationNotes,
        // Preserve existing internal notes and combine with new ones
        internalNotes: combineNotes(enhancedInternalData.internalNotes, newGraphEvent.bodyPreview)
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
    graphEvent.bodyPreview || '',
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
      calendarIds,
      calendarIdsType: typeof calendarIds,
      calendarIdsIsArray: Array.isArray(calendarIds),
      calendarIdsLength: Array.isArray(calendarIds) ? calendarIds.length : 'N/A',
      startTime,
      endTime,
      forceRefresh,
      requestBody: req.body
    });
    
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
      strategy: 'cache-first'
    };

    // STEP 1: Try to load from unified events collection first (cache-first approach)
    let unifiedEvents = [];
    let foundInCache = false;
    const cacheAge = 5 * 60 * 1000; // Consider cache fresh for 5 minutes

    if (!forceRefresh && startTime && endTime) {
      logger.debug('Checking unified events cache first...');
      
      for (const calendarId of calendarIds) {
        try {
          const cachedEvents = await getUnifiedEvents(userId, calendarId, new Date(startTime), new Date(endTime));
          
          if (cachedEvents.length > 0) {
            // Check if cached events are recent enough
            const recentCachedEvents = cachedEvents.filter(event => {
              const lastSynced = new Date(event.lastSyncedAt || event.cachedAt || 0);
              const now = new Date();
              return (now - lastSynced) < cacheAge;
            });
            
            if (recentCachedEvents.length > 0) {
              logger.debug(`Found ${recentCachedEvents.length} fresh cached events for calendar ${calendarId}`);
              unifiedEvents = unifiedEvents.concat(recentCachedEvents);
              foundInCache = true;
              
              loadResults.calendars[calendarId] = {
                totalEvents: recentCachedEvents.length,
                source: 'cache',
                cacheAge: Math.min(...recentCachedEvents.map(e => {
                  const lastSynced = new Date(e.lastSyncedAt || e.cachedAt || 0);
                  return new Date() - lastSynced;
                }))
              };
            } else {
              logger.debug(`Found ${cachedEvents.length} cached events for calendar ${calendarId}, but they are stale`);
            }
          } else {
            logger.debug(`No cached events found for calendar ${calendarId} in date range`);
          }
        } catch (cacheError) {
          logger.warn(`Error checking cache for calendar ${calendarId}:`, cacheError);
        }
      }
    }

    // STEP 2: If we found fresh cached events, return them immediately
    if (foundInCache && !forceRefresh) {
      logger.debug(`Using cached events: ${unifiedEvents.length} events from cache`);
      
      // Transform events to frontend format
      const transformedEvents = unifiedEvents.map(event => {
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
        
        // Normalize category field
        let category = '';
        if (event.internalData?.mecCategories && event.internalData.mecCategories.length > 0) {
          category = event.internalData.mecCategories[0];
        } else if (event.graphData?.categories && event.graphData.categories.length > 0) {
          category = event.graphData.categories[0];
        }
        
        const internalData = event.internalData || {};
        
        return {
          // Use Graph data as base
          ...event.graphData,
          // Add internal enrichments
          ...internalData,
          // Override with normalized category
          category: category,
          // Add metadata
          calendarId: event.calendarId,
          sourceCalendars: event.sourceCalendars,
          _hasInternalData: Object.keys(internalData).some(key => 
            internalData[key] && 
            (Array.isArray(internalData[key]) ? internalData[key].length > 0 : true)
          ),
          _lastSyncedAt: event.lastSyncedAt,
          _cached: true
        };
      }).filter(event => event !== null);
      
      logger.log(`Cache-first load complete for user ${userId}: ${transformedEvents.length} events from cache`);
      
      return res.status(200).json({
        loadResults: loadResults,
        events: transformedEvents,
        count: transformedEvents.length,
        source: 'cache'
      });
    }

    // STEP 3: Cache miss or force refresh - fetch from Graph API
    if (!graphToken) {
      logger.error('Cache-first events load handler: Graph token missing for API fallback');
      return res.status(400).json({ error: 'Graph token required for events loading when cache is unavailable' });
    }

    if (!graphToken.startsWith('eyJ')) {
      logger.error('Cache-first events load handler: Graph token appears invalid', {
        tokenPrefix: graphToken.substring(0, 10)
      });
      return res.status(400).json({ error: 'Graph token appears to be invalid format' });
    }

    logger.debug('Cache miss or force refresh - fetching from Graph API...');
    loadResults.strategy = 'graph-api-fallback';
    
    // Process each calendar
    for (const calendarId of calendarIds) {
      try {
        logger.debug(`Loading events from Graph API for calendar: ${calendarId}`);
        
        // Build Graph API URL with date filtering
        const calendarPath = calendarId === 'primary' ? '/me/events' : `/me/calendars/${calendarId}/events`;
        let graphUrl = `https://graph.microsoft.com/v1.0${calendarPath}`;
        
        // Add date range filtering
        if (startTime && endTime) {
          const startISO = new Date(startTime).toISOString();
          const endISO = new Date(endTime).toISOString();
          graphUrl += `?$filter=start/dateTime ge '${startISO}' and start/dateTime lt '${endISO}'`;
          graphUrl += `&$select=id,subject,start,end,location,categories,organizer,attendees,body,importance,showAs,isAllDay,isCancelled,responseStatus,sensitivity,webLink,hasAttachments,singleValueExtendedProperties`;
          graphUrl += `&$expand=singleValueExtendedProperties($filter=id eq 'String {66f5a359-4659-4830-9070-00047ec6ac6f} Name Emanuel-Calendar-App_linkedEventId' or id eq 'String {66f5a359-4659-4830-9070-00047ec6ac6f} Name Emanuel-Calendar-App_eventType')`;
          graphUrl += `&$top=1000`;
        } else {
          graphUrl += `?$select=id,subject,start,end,location,categories,organizer,attendees,body,importance,showAs,isAllDay,isCancelled,responseStatus,sensitivity,webLink,hasAttachments,singleValueExtendedProperties`;
          graphUrl += `&$expand=singleValueExtendedProperties($filter=id eq 'String {66f5a359-4659-4830-9070-00047ec6ac6f} Name Emanuel-Calendar-App_linkedEventId' or id eq 'String {66f5a359-4659-4830-9070-00047ec6ac6f} Name Emanuel-Calendar-App_eventType')`;
          graphUrl += `&$top=1000`;
        }
        
        let allEvents = [];
        let nextLink = graphUrl;
        let pageCount = 0;
        const maxPages = 10; // Circuit breaker
        
        // Fetch from Graph API with pagination
        while (nextLink && pageCount < maxPages) {
          pageCount++;
          logger.debug(`Calling Graph API URL (page ${pageCount}): ${nextLink}`);
          
          const response = await fetch(nextLink, {
            headers: {
              Authorization: `Bearer ${graphToken}`,
              'Content-Type': 'application/json',
              'Prefer': 'odata.maxpagesize=200'
            }
          });
          
          if (!response.ok) {
            const errorMsg = `Graph API failed: ${response.status} ${response.statusText}`;
            logger.error(`Graph API error for calendar ${calendarId}: ${errorMsg}`);
            throw new Error(errorMsg);
          }
          
          const data = await response.json();
          const pageEvents = data.value || [];
          allEvents = allEvents.concat(pageEvents);
          logger.debug(`Received ${pageEvents.length} events on page ${pageCount} for calendar ${calendarId}`);
          
          nextLink = data['@odata.nextLink'];
          if (nextLink && pageCount >= maxPages) {
            logger.warn(`Reached maximum page limit (${maxPages}) for calendar ${calendarId}, stopping pagination`);
            break;
          }
        }
        
        logger.debug(`Total received ${allEvents.length} events from Graph API for calendar ${calendarId}`);
        
        // Update unified collection with fresh data
        let eventsCreated = 0;
        let eventsUpdated = 0;
        
        for (const graphEvent of allEvents) {
          try {
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
              eventsUpdated++;
            } else {
              eventsCreated++;
            }
          } catch (eventError) {
            logger.error(`Error processing event ${graphEvent.id}:`, eventError);
            loadResults.errors.push({
              calendarId: calendarId,
              eventId: graphEvent.id,
              error: eventError.message
            });
          }
        }
        
        loadResults.calendars[calendarId] = {
          totalEvents: allEvents.length,
          created: eventsCreated,
          updated: eventsUpdated,
          pages: pageCount,
          source: 'graph-api'
        };
        
        loadResults.totalEvents += allEvents.length;
        
      } catch (calendarError) {
        logger.error(`Error loading calendar ${calendarId}:`, calendarError);
        loadResults.errors.push({
          calendarId: calendarId,
          error: calendarError.message
        });
      }
    }
    
    // STEP 4: Return updated unified events
    unifiedEvents = [];
    if (startTime && endTime) {
      for (const calendarId of calendarIds) {
        const calendarEvents = await getUnifiedEvents(userId, calendarId, new Date(startTime), new Date(endTime));
        unifiedEvents = unifiedEvents.concat(calendarEvents);
      }
    } else {
      for (const calendarId of calendarIds) {
        const calendarEvents = await getUnifiedEvents(userId, calendarId);
        unifiedEvents = unifiedEvents.concat(calendarEvents);
      }
    }
    
    // Transform events to frontend format
    const transformedEvents = unifiedEvents.map(event => {
      if (!event.graphData || !event.graphData.start || !event.graphData.end) {
        return null;
      }
      
      if (!event.graphData.subject) {
        event.graphData.subject = event.internalData?.subject || '(No Subject)';
      }
      
      let category = '';
      if (event.internalData?.mecCategories && event.internalData.mecCategories.length > 0) {
        category = event.internalData.mecCategories[0];
      } else if (event.graphData?.categories && event.graphData.categories.length > 0) {
        category = event.graphData.categories[0];
      }
      
      const internalData = event.internalData || {};
      
      return {
        ...event.graphData,
        ...internalData,
        category: category,
        calendarId: event.calendarId,
        sourceCalendars: event.sourceCalendars,
        _hasInternalData: Object.keys(internalData).some(key => 
          internalData[key] && 
          (Array.isArray(internalData[key]) ? internalData[key].length > 0 : true)
        ),
        _lastSyncedAt: event.lastSyncedAt,
        _cached: true
      };
    }).filter(event => event !== null);
    
    logger.log(`Cache-first load complete for user ${userId}: ${transformedEvents.length} events (${loadResults.strategy})`);
    
    res.status(200).json({
      loadResults: loadResults,
      events: transformedEvents,
      count: transformedEvents.length,
      source: loadResults.strategy
    });
    
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
  try {
    const { calendarId, startTime, endTime } = req.query;
    const userId = req.user.userId;
    
    let startDate = null;
    let endDate = null;
    if (startTime && endTime) {
      startDate = new Date(startTime);
      endDate = new Date(endTime);
    }
    
    const unifiedEvents = await getUnifiedEvents(userId, calendarId, startDate, endDate);
    
    // Transform events to frontend format
    const transformedEvents = unifiedEvents.map(event => {
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
      events: transformedEvents,
      count: transformedEvents.length,
      source: 'unified_storage'
    });
    
  } catch (error) {
    logger.error('Error getting unified events:', error);
    res.status(500).json({ error: 'Failed to get events' });
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
      // Fetch events from Graph API
      const calendarPath = calendarId ? 
        `/me/calendars/${calendarId}/events` : 
        '/me/events';
      
      const graphUrl = `https://graph.microsoft.com/v1.0${calendarPath}?` + 
        `$filter=start/dateTime ge '${startDate.toISOString()}' and start/dateTime le '${endDate.toISOString()}'&` +
        `$select=id,subject,start,end,location,organizer,bodyPreview,categories,importance,showAs,sensitivity,isAllDay,seriesMasterId,type,recurrence,responseStatus,attendees,extensions,singleValueExtendedProperties&` +
        `$expand=extensions&` +
        `$orderby=start/dateTime&` +
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
        // Separate event data from internal data before caching
        const { 
          setupMinutes, teardownMinutes, registrationNotes, assignedTo, 
          mecCategories, internalNotes, setupStatus, estimatedCost, actualCost,
          staffAssignments, customFields, _hasInternalData, _lastSyncedAt, _internalId,
          ...eventData 
        } = event;
        
        // Prepare internal data if it exists
        const internalData = _hasInternalData ? {
          setupMinutes, teardownMinutes, registrationNotes, assignedTo,
          mecCategories, internalNotes, setupStatus, estimatedCost, actualCost,
          staffAssignments, customFields
        } : null;
        
        await cacheEvent(userId, calendarId, eventData, internalData);
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
              ? '/me/events' 
              : `/me/calendars/${calendarId}/events`;
            
            const eventsUrl = `https://graph.microsoft.com/v1.0${eventsPath}?` + 
              `$filter=start/dateTime ge '${startDateTime.toISOString()}' and ` +
              `end/dateTime le '${endDateTime.toISOString()}'` +
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
      
      // Fetch events from Graph API
      const calendarPath = calendarId === 'primary' 
        ? '/me/events' 
        : `/me/calendars/${calendarId}/events`;
      
      let nextLink = `https://graph.microsoft.com/v1.0${calendarPath}?` +
        `$filter=start/dateTime ge '${startDate}' and end/dateTime le '${endDate}'` +
        `&$top=100&$orderby=start/dateTime`;
      
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
    
    if (!unifiedEventsCollection || !internalEventsCollection || !db) {
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
      internalEvents: 0,
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
        internalEvents: 0, // Will be counted based on eventIds
        cacheEvents: 0 // Will be counted if cache collection exists
      };
      
      // Get event IDs for internal events count
      const csvEventIds = await unifiedEventsCollection.distinct('eventId', {
        userId: userId,
        isCSVImport: true
      });
      
      if (csvEventIds.length > 0) {
        counts.internalEvents = await internalEventsCollection.countDocuments({
          eventId: { $in: csvEventIds }
        });
      }
      
      // Check if cache collection exists
      const eventCacheCollection = db.collection('eventCache');
      if (eventCacheCollection) {
        counts.cacheEvents = await eventCacheCollection.countDocuments({
          userId: userId,
          eventId: { $in: csvEventIds }
        });
      }
      
      counts.total = counts.unifiedEvents + counts.registrationEvents + counts.internalEvents + counts.cacheEvents;
      
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
      
      // 3. Delete internal events
      if (counts.internalEvents > 0 && csvEventIds.length > 0) {
        res.write('data: ' + JSON.stringify({
          type: 'collection_start',
          collection: 'internalEvents',
          message: `Deleting ${counts.internalEvents} internal event records...`,
          timestamp: new Date().toISOString()
        }) + '\n\n');
        
        try {
          const deleteResult = await internalEventsCollection.deleteMany({
            eventId: { $in: csvEventIds }
          });
          
          totalDeleted.internalEvents += deleteResult.deletedCount;
          totalDeleted.total += deleteResult.deletedCount;
          processedTotal += deleteResult.deletedCount;
          
          const progress = Math.round((processedTotal / counts.total) * 100);
          res.write('data: ' + JSON.stringify({
            type: 'progress',
            collection: 'internalEvents',
            message: `Deleted ${deleteResult.deletedCount} internal records`,
            processed: processedTotal,
            totalCount: counts.total,
            progress: progress,
            deleted: totalDeleted,
            timestamp: new Date().toISOString()
          }) + '\n\n');
        } catch (error) {
          errors.push({ collection: 'internalEvents', error: error.message });
          logger.error('Error deleting internal events:', error);
        }
      }
      
      // 4. Delete cache entries
      if (counts.cacheEvents > 0 && csvEventIds.length > 0) {
        res.write('data: ' + JSON.stringify({
          type: 'collection_start',
          collection: 'cacheEvents',
          message: `Deleting ${counts.cacheEvents} cache entries...`,
          timestamp: new Date().toISOString()
        }) + '\n\n');
        
        try {
          const deleteResult = await eventCacheCollection.deleteMany({
            userId: userId,
            eventId: { $in: csvEventIds }
          });
          
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
    
    // Legacy cache stats for comparison (if exists)
    let legacyCacheStats = null;
    try {
      const legacyCount = await eventCacheCollection.countDocuments({ userId: userId });
      if (legacyCount > 0) {
        legacyCacheStats = {
          totalCached: legacyCount,
          collectionStats: await db.collection('templeEvents__EventCache').stats()
        };
      }
    } catch (legacyError) {
      // Legacy collection might not exist
    }
    
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
        
        // Prepare unified event structure
        const unifiedEventData = {
          userId: userId,
          calendarId: calendarId,
          eventId: event.id,
          
          // Graph API data (source of truth)
          graphData: {
            id: event.id,
            subject: event.subject,
            start: event.start,
            end: event.end,
            location: event.location || { displayName: '' },
            categories: event.categories || [],
            bodyPreview: event.bodyPreview || '',
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
    console.log('Getting rooms from collection:', roomsCollection ? 'exists' : 'null');
    
    // TEMPORARY WORKAROUND: Azure Cosmos DB indexing issue
    // Return hardcoded rooms until indexing is fixed
    const hardcodedRooms = [
      // Legacy locations from calendar system (with location codes)
      {
        _id: "legacy1",
        name: "Temple Emanu-El",
        locationCode: "TPL",
        displayName: "Temple Emanu-El",
        building: "Main Building",
        floor: "1st Floor",
        capacity: 400,
        features: ["piano", "stage", "microphone", "projector", "organ"],
        accessibility: ["wheelchair-accessible", "hearing-loop"],
        active: true,
        description: "Main sanctuary for worship and large gatherings",
        notes: "Primary worship space"
      },
      {
        _id: "legacy2", 
        name: "Chapel",
        locationCode: "CPL",
        displayName: "Chapel",
        building: "Main Building",
        floor: "1st Floor",
        capacity: 200,
        features: ["piano", "stage", "microphone", "projector"],
        accessibility: ["wheelchair-accessible", "hearing-loop"],
        active: true,
        description: "Main worship space with traditional setup",
        notes: "Reserved for services on Sabbath"
      },
      {
        _id: "legacy3",
        name: "Music Room", 
        locationCode: "MUS",
        displayName: "Music Room",
        building: "Main Building",
        floor: "2nd Floor",
        capacity: 25,
        features: ["piano", "music-stands", "acoustic-treatment"],
        accessibility: ["elevator"],
        active: true,
        description: "Dedicated space for music practice and choir rehearsals",
        notes: "Requires coordination with music director"
      },
      {
        _id: "legacy4",
        name: "Room 402",
        locationCode: "402", 
        displayName: "Room 402",
        building: "Main Building",
        floor: "4th Floor",
        capacity: 20,
        features: ["tables", "chairs", "whiteboard"],
        accessibility: ["elevator"],
        active: true,
        description: "Classroom space for educational programs",
        notes: "General purpose classroom"
      },
      {
        _id: "legacy5",
        name: "Room 602",
        locationCode: "602",
        displayName: "6th Floor Lounge - 602", 
        building: "Main Building",
        floor: "6th Floor",
        capacity: 40,
        features: ["comfortable-seating", "kitchenette", "tables"],
        accessibility: ["elevator"],
        active: true,
        description: "Lounge area for social gatherings and meetings",
        notes: "Popular for committee meetings and social events"
      },
      {
        _id: "legacy6",
        name: "Nursery School",
        locationCode: "NURSERY",
        displayName: "Nursery School",
        building: "Education Wing",
        floor: "Ground Floor",
        capacity: 15,
        features: ["child-furniture", "toys", "safety-equipment"],
        accessibility: ["wheelchair-accessible", "child-safe"],
        active: true,
        description: "Early childhood education space",
        notes: "Requires advance coordination with nursery school director"
      },
      // Existing newer rooms (no location codes - newer additions)
      {
        _id: "temp2",
        name: "Social Hall",
        building: "Main Building", 
        floor: "1st Floor",
        capacity: 150,
        features: ["kitchen", "stage", "tables", "chairs"],
        accessibility: ["wheelchair-accessible"],
        active: true,
        description: "Large multipurpose room with kitchen access",
        notes: "Can be divided with partition"
      },
      {
        _id: "temp3",
        name: "Conference Room A",
        building: "Main Building",
        floor: "2nd Floor", 
        capacity: 12,
        features: ["av-equipment", "projector", "whiteboard", "conference-table"],
        accessibility: ["elevator"],
        active: true,
        description: "Executive conference room with video conferencing",
        notes: "Requires advance booking for setup"
      },
      {
        _id: "temp4",
        name: "Conference Room B",
        building: "Main Building",
        floor: "2nd Floor",
        capacity: 8,
        features: ["whiteboard", "conference-table"],
        accessibility: ["elevator"],
        active: true,
        description: "Small meeting room for intimate discussions",
        notes: "No AV equipment available"
      },
      {
        _id: "temp5",
        name: "Youth Room",
        building: "Main Building",
        floor: "1st Floor",
        capacity: 30,
        features: ["games", "comfortable-seating", "tv", "kitchenette"],
        accessibility: ["wheelchair-accessible"],
        active: true,
        description: "Casual space designed for youth activities",
        notes: "Snacks and beverages allowed"
      }
    ];
    
    console.log('Returning hardcoded rooms due to indexing issue:', hardcodedRooms.length);
    res.json(hardcodedRooms);
    
    // TODO: Fix Azure Cosmos DB indexing policy to remove this workaround
    
  } catch (error) {
    console.error('Error in rooms endpoint:', error);
    logger.error('Error in rooms endpoint:', error);
    res.status(500).json({ error: 'Failed to fetch rooms' });
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
    
    // TEMPORARY WORKAROUND: Use hardcoded rooms like /api/rooms endpoint due to indexing issue
    const hardcodedRooms = [
      // Legacy locations from calendar system (with location codes)
      {
        _id: "legacy1",
        name: "Temple Emanu-El",
        locationCode: "TPL",
        displayName: "Temple Emanu-El",
        building: "Main Building",
        floor: "Sanctuary",
        capacity: 500,
        features: ["piano", "stage", "microphone", "projector"],
        accessibility: ["wheelchair-accessible", "hearing-loop"],
        active: true,
        description: "Main worship space with traditional setup",
        notes: "Primary worship space"
      },
      {
        _id: "legacy2", 
        name: "Chapel",
        locationCode: "CPL",
        displayName: "Chapel",
        building: "Main Building",
        floor: "1st Floor",
        capacity: 200,
        features: ["piano", "stage", "microphone", "projector"],
        accessibility: ["wheelchair-accessible", "hearing-loop"],
        active: true,
        description: "Main worship space with traditional setup",
        notes: "Reserved for services on Sabbath"
      },
      {
        _id: "legacy3",
        name: "Music Room", 
        locationCode: "MUS",
        displayName: "Music Room",
        building: "Main Building",
        floor: "2nd Floor",
        capacity: 50,
        features: ["piano", "music-stands", "audio-equipment"],
        accessibility: ["elevator"],
        active: true,
        description: "Music rehearsal and performance space",
        notes: "Requires coordination with music director"
      },
      {
        _id: "legacy4",
        name: "Room 402",
        locationCode: "402", 
        displayName: "Room 402",
        building: "Education Building",
        floor: "4th Floor",
        capacity: 25,
        features: ["whiteboard", "tables", "chairs"],
        accessibility: ["elevator"],
        active: true,
        description: "Standard classroom with flexible seating",
        notes: "General purpose classroom"
      },
      {
        _id: "legacy5",
        name: "Room 602",
        locationCode: "602",
        displayName: "6th Floor Lounge - 602", 
        building: "Main Building",
        floor: "6th Floor",
        capacity: 40,
        features: ["kitchen", "lounge-seating", "coffee-station"],
        accessibility: ["elevator"],
        active: true,
        description: "Comfortable lounge space with kitchen facilities",
        notes: "Popular for committee meetings and social events"
      },
      {
        _id: "legacy6",
        name: "Nursery School",
        locationCode: "NURSERY",
        displayName: "Nursery School",
        building: "Education Building",
        floor: "Ground Floor", 
        capacity: 15,
        features: ["child-safe", "toys", "small-furniture"],
        accessibility: ["wheelchair-accessible"],
        active: true,
        description: "Child-friendly space with age-appropriate facilities",
        notes: "Requires supervision and advance notice"
      },
      {
        _id: "temp1",
        name: "Social Hall",
        building: "Main Building",
        floor: "1st Floor",
        capacity: 150,
        features: ["kitchen", "stage", "tables", "chairs"],
        accessibility: ["wheelchair-accessible"],
        active: true,
        description: "Large multipurpose room with kitchen access",
        notes: "Can be divided with partition"
      },
      {
        _id: "temp2",
        name: "Library",
        building: "Main Building",
        floor: "2nd Floor",
        capacity: 20,
        features: ["quiet-zone", "books", "study-tables"],
        accessibility: ["wheelchair-accessible", "elevator"],
        active: true,
        description: "Quiet study and small group space",
        notes: "No food or drinks allowed"
      },
      {
        _id: "temp3",
        name: "Conference Room A",
        building: "Main Building",
        floor: "2nd Floor", 
        capacity: 12,
        features: ["av-equipment", "projector", "whiteboard", "conference-table"],
        accessibility: ["elevator"],
        active: true,
        description: "Executive conference room with video conferencing",
        notes: "Requires advance booking for setup"
      },
      {
        _id: "temp4",
        name: "Conference Room B",
        building: "Main Building",
        floor: "2nd Floor",
        capacity: 8,
        features: ["whiteboard", "conference-table"],
        accessibility: ["elevator"],
        active: true,
        description: "Small meeting room for intimate discussions",
        notes: "No AV equipment available"
      },
      {
        _id: "temp5",
        name: "Youth Room",
        building: "Main Building",
        floor: "1st Floor",
        capacity: 30,
        features: ["games", "comfortable-seating", "tv", "kitchenette"],
        accessibility: ["wheelchair-accessible"],
        active: true,
        description: "Casual space designed for youth activities",
        notes: "Snacks and beverages allowed"
      }
    ];
    
    // Build room filter for hardcoded rooms
    let rooms = hardcodedRooms;
    if (roomIds) {
      const requestedRoomIds = roomIds.split(',');
      
      // Map real MongoDB ObjectIds to hardcoded room IDs
      const objectIdMapping = {
        '687973a7f5296c1bc444689c': 'temp3', // Conference Room A
        '687973a7f5296c1bc444689d': 'temp4'  // Conference Room B
      };
      
      // Convert real ObjectIds to hardcoded IDs if needed
      const mappedRoomIds = requestedRoomIds.map(id => objectIdMapping[id] || id);
      
      rooms = hardcodedRooms.filter(room => mappedRoomIds.includes(room._id));
    }
    
    // Filter for active rooms only
    rooms = rooms.filter(room => room.active);
    
    // Check for overlapping reservations (including their setup/teardown times)
    // We need to get all reservations that might overlap and then check their extended time windows
    const potentialReservations = await roomReservationsCollection.find({
      status: { $in: ['pending', 'approved'] },
      // Cast a wider net to catch reservations that might overlap when including buffer times
      startDateTime: { $lt: new Date(end.getTime() + (8 * 60 * 60 * 1000)) }, // Add 8 hours buffer for query
      endDateTime: { $gt: new Date(start.getTime() - (8 * 60 * 60 * 1000)) }   // Subtract 8 hours buffer for query
    }).toArray();
    
    
    // Filter for actual overlaps considering setup/teardown times
    const overlappingReservations = potentialReservations.filter(reservation => {
      const resSetupMinutes = reservation.setupTimeMinutes || 0;
      const resTeardownMinutes = reservation.teardownTimeMinutes || 0;
      
      const resStart = new Date(reservation.startDateTime.getTime() - (resSetupMinutes * 60 * 1000));
      const resEnd = new Date(reservation.endDateTime.getTime() + (resTeardownMinutes * 60 * 1000));
      
      // Check if the extended time windows overlap
      return resStart < end && resEnd > start;
    });
    
    // Check for overlapping calendar events (in location field)
    const roomNames = rooms.map(room => room.name);
    const overlappingEvents = await unifiedEventsCollection.find({
      isDeleted: false,
      startTime: { $lt: end },
      endTime: { $gt: start },
      $or: roomNames.map(name => ({ location: { $regex: name, $options: 'i' } }))
    }).toArray();
    
    // Helper function to format time for display
    const formatTime = (date) => date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    
    // Build availability response with detailed conflict information
    const availability = rooms.map(room => {
      // Create reverse mapping from hardcoded IDs to real ObjectIds
      const reverseMapping = {
        'temp3': '687973a7f5296c1bc444689c', // Conference Room A
        'temp4': '687973a7f5296c1bc444689d'  // Conference Room B
      };
      
      const realRoomId = reverseMapping[room._id];
      
      const roomReservationConflicts = overlappingReservations.filter(res => 
        res.requestedRooms.includes(room._id) || // Check hardcoded ID
        (realRoomId && res.requestedRooms.includes(realRoomId)) // Check real ObjectId
      );
      
      const roomEventConflicts = overlappingEvents.filter(event => 
        event.location && event.location.toLowerCase().includes(room.name.toLowerCase())
      );
      
      // Enhanced conflict details for reservations
      const detailedReservationConflicts = roomReservationConflicts.map(res => {
        const resSetupMinutes = res.setupTimeMinutes || 0;
        const resTeardownMinutes = res.teardownTimeMinutes || 0;
        const effectiveStart = new Date(res.startDateTime.getTime() - (resSetupMinutes * 60 * 1000));
        const effectiveEnd = new Date(res.endDateTime.getTime() + (resTeardownMinutes * 60 * 1000));
        
        return {
          id: res._id,
          eventTitle: res.eventTitle,
          requesterName: res.requesterName,
          status: res.status,
          originalStart: res.startDateTime,
          originalEnd: res.endDateTime,
          effectiveStart,
          effectiveEnd,
          setupTimeMinutes: resSetupMinutes,
          teardownTimeMinutes: resTeardownMinutes,
          conflictReason: resSetupMinutes > 0 || resTeardownMinutes > 0 ? 
            'Conflicts with setup/teardown time' : 'Direct time overlap'
        };
      });
      
      // Enhanced conflict details for calendar events  
      const detailedEventConflicts = roomEventConflicts.map(event => ({
        id: event._id,
        subject: event.subject,
        organizer: event.organizer?.emailAddress?.name || event.organizer?.name || 'Unknown',
        start: event.startTime,
        end: event.endTime,
        location: event.location,
        conflictReason: 'Calendar event overlap'
      }));
      
      const isAvailable = detailedReservationConflicts.length === 0 && detailedEventConflicts.length === 0;
      
      return {
        room,
        available: isAvailable,
        conflicts: {
          reservations: detailedReservationConflicts,
          events: detailedEventConflicts,
          totalConflicts: detailedReservationConflicts.length + detailedEventConflicts.length
        },
        // Availability window being checked (including buffers)
        requestedWindow: {
          eventStart,
          eventEnd,
          effectiveStart: start,
          effectiveEnd: end,
          setupTimeMinutes: setupMinutes,
          teardownTimeMinutes: teardownMinutes
        }
      };
    });
    
    // Generate smart suggestions for unavailable rooms
    const generateSmartSuggestions = async (room, requestedWindow) => {
      const suggestions = [];
      const { eventStart, eventEnd, setupTimeMinutes, teardownTimeMinutes } = requestedWindow;
      const eventDurationMs = eventEnd.getTime() - eventStart.getTime();
      
      // Search for alternative time slots within the same day
      const dayStart = new Date(eventStart);
      dayStart.setHours(8, 0, 0, 0); // Start at 8 AM
      const dayEnd = new Date(eventStart);
      dayEnd.setHours(22, 0, 0, 0); // End at 10 PM
      
      // Check slots in 30-minute intervals
      for (let time = new Date(dayStart); time <= dayEnd; time.setMinutes(time.getMinutes() + 30)) {
        const slotStart = new Date(time);
        const slotEnd = new Date(slotStart.getTime() + eventDurationMs);
        
        // Skip if slot would go past day end
        if (slotEnd > dayEnd) break;
        
        // Skip if this is too close to the requested time (within 1 hour)
        const timeDiff = Math.abs(slotStart.getTime() - eventStart.getTime()) / (1000 * 60);
        if (timeDiff < 60) continue;
        
        // Check if this slot would be available
        const slotBufferStart = new Date(slotStart.getTime() - (setupTimeMinutes * 60 * 1000));
        const slotBufferEnd = new Date(slotEnd.getTime() + (teardownTimeMinutes * 60 * 1000));
        
        const hasConflict = overlappingReservations.some(res => {
          if (!res.requestedRooms.includes(room._id.toString())) return false;
          
          const resSetupMinutes = res.setupTimeMinutes || 0;
          const resTeardownMinutes = res.teardownTimeMinutes || 0;
          const resStart = new Date(res.startDateTime.getTime() - (resSetupMinutes * 60 * 1000));
          const resEnd = new Date(res.endDateTime.getTime() + (resTeardownMinutes * 60 * 1000));
          
          return resStart < slotBufferEnd && resEnd > slotBufferStart;
        }) || overlappingEvents.some(event => {
          if (!event.location || !event.location.toLowerCase().includes(room.name.toLowerCase())) return false;
          return event.startTime < slotBufferEnd && event.endTime > slotBufferStart;
        });
        
        if (!hasConflict) {
          const timeUntilSlot = (slotStart.getTime() - eventStart.getTime()) / (1000 * 60 * 60);
          suggestions.push({
            startTime: slotStart,
            endTime: slotEnd,
            effectiveStartTime: slotBufferStart,
            effectiveEndTime: slotBufferEnd,
            hoursFromRequested: Math.round(timeUntilSlot * 10) / 10,
            recommendation: timeUntilSlot > 0 ? 'Later same day' : 'Earlier same day'
          });
          
          // Limit to 3 suggestions per room
          if (suggestions.length >= 3) break;
        }
      }
      
      return suggestions;
    };
    
    // Add suggestions to unavailable rooms
    const availabilityWithSuggestions = await Promise.all(
      availability.map(async (roomAvailability) => {
        if (!roomAvailability.available) {
          const suggestions = await generateSmartSuggestions(roomAvailability.room, roomAvailability.requestedWindow);
          return {
            ...roomAvailability,
            suggestions
          };
        }
        return roomAvailability;
      })
    );
    
    res.json(availabilityWithSuggestions);
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
      teardownTimeMinutes: reservationData.teardownTimeMinutes
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
        teardownTimeMinutes: teardownTimeMinutes || 0
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
      attendeeCount: attendeeCount || 0,
      
      requestedRooms,
      requiredFeatures: requiredFeatures || [],
      specialRequirements: specialRequirements || '',
      
      // Setup and teardown times
      setupTimeMinutes: setupTimeMinutes || 0,
      teardownTimeMinutes: teardownTimeMinutes || 0,
      
      status: 'pending',
      priority,
      
      // New resubmission fields
      currentRevision: 1,
      resubmissionAllowed: true,
      communicationHistory: [initialSubmissionEntry],
      
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
    
    const result = await roomReservationsCollection.insertOne(reservation);
    const createdReservation = await roomReservationsCollection.findOne({ _id: result.insertedId });
    
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
        teardownTimeMinutes: teardownTimeMinutes || 0
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
      attendeeCount: attendeeCount || 0,
      
      requestedRooms,
      requiredFeatures: requiredFeatures || [],
      specialRequirements: specialRequirements || '',
      
      // Setup and teardown times
      setupTimeMinutes: setupTimeMinutes || 0,
      teardownTimeMinutes: teardownTimeMinutes || 0,
      
      status: 'pending',
      priority,
      
      // New resubmission fields
      currentRevision: 1,
      resubmissionAllowed: true,
      communicationHistory: [initialSubmissionEntry],
      
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
    
    const result = await roomReservationsCollection.insertOne(reservation);
    const createdReservation = await roomReservationsCollection.findOne({ _id: result.insertedId });
    
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
      teardownTimeMinutes: reservationData.teardownTimeMinutes
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
        
        // Clear previous action data
        actionDate: null,
        approvedBy: null,
        actionBy: null,
        actionByEmail: null
      },
      $push: {
        communicationHistory: resubmissionEntry
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
    
    logger.info('Room reservation resubmitted:', {
      reservationId,
      resubmittedBy: userEmail,
      revisionNumber: newRevisionNumber,
      eventTitle
    });
    
    res.json({
      message: 'Reservation resubmitted successfully',
      reservation: result.value,
      revisionNumber: newRevisionNumber
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
      building: building.trim(),
      floor: floor.trim(),
      capacity: parseInt(capacity) || 0,
      features: features || [],
      accessibility: accessibility || [],
      active: active !== false,
      description: description?.trim() || '',
      notes: notes?.trim() || '',
      createdAt: new Date(),
      createdBy: userId,
      updatedAt: new Date()
    };
    
    const result = await roomsCollection.insertOne(roomDoc);
    const savedRoom = await roomsCollection.findOne({ _id: result.insertedId });
    
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
    
    const { name, building, floor, capacity, features, accessibility, active, description, notes } = req.body;
    
    const updateDoc = {
      $set: {
        ...(name && { name: name.trim() }),
        ...(building && { building: building.trim() }),
        ...(floor && { floor: floor.trim() }),
        ...(capacity !== undefined && { capacity: parseInt(capacity) || 0 }),
        ...(features && { features }),
        ...(accessibility && { accessibility }),
        ...(active !== undefined && { active }),
        ...(description !== undefined && { description: description?.trim() || '' }),
        ...(notes !== undefined && { notes: notes?.trim() || '' }),
        updatedAt: new Date()
      }
    };
    
    const result = await roomsCollection.findOneAndUpdate(
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
 * Get pending locations for review (Admin only)
 */
app.get('/api/admin/locations/pending', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // Get all pending locations with their suggested matches
    const pendingLocations = await locationsCollection.find({
      status: 'pending'
    }).toArray();
    
    // For each pending location, get details of suggested matches
    const locationsWithMatches = await Promise.all(pendingLocations.map(async (location) => {
      const matchDetails = [];
      if (location.suggestedMatches && location.suggestedMatches.length > 0) {
        for (const match of location.suggestedMatches) {
          const matchLocation = await locationsCollection.findOne({ 
            _id: new ObjectId(match.locationId) 
          });
          if (matchLocation) {
            matchDetails.push({
              ...match,
              location: matchLocation
            });
          }
        }
      }
      return {
        ...location,
        suggestedMatchDetails: matchDetails
      };
    }));
    
    res.json(locationsWithMatches);
  } catch (error) {
    logger.error('Error fetching pending locations:', error);
    res.status(500).json({ error: 'Failed to fetch pending locations' });
  }
});

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
 * Approve a pending location (Admin only)
 */
app.post('/api/admin/locations/:id/approve', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;
    const { reviewNotes } = req.body;
    
    // Check admin permissions
    const user = await usersCollection.findOne({ userId });
    const isAdmin = user?.isAdmin || userEmail.includes('admin') || userEmail.endsWith('@emanuelnyc.org');
    
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const result = await locationsCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      {
        $set: {
          status: 'approved',
          active: true,
          needsReview: false,
          reviewedBy: userEmail,
          reviewedAt: new Date(),
          reviewNotes: reviewNotes || null,
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    
    if (!result.value) {
      return res.status(404).json({ error: 'Location not found' });
    }
    
    logger.log('Location approved:', { locationId: id, approvedBy: userEmail });
    res.json(result.value);
  } catch (error) {
    logger.error('Error approving location:', error);
    res.status(500).json({ error: 'Failed to approve location' });
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
    
    const result = await roomsCollection.deleteOne({ _id: new ObjectId(id) });
    
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
 * Approve a room reservation (Admin only)
 */
app.put('/api/admin/room-reservations/:id/approve', verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userEmail = req.user.email;
    const { id } = req.params;
    const { notes } = req.body;
    
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
        ...(notes && { actionNotes: notes.trim() })
      },
      $push: {
        communicationHistory: approvalEntry
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
    
    logger.log('Room reservation approved:', { reservationId: id, approvedBy: userEmail });
    res.json(result.value);
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
        lastModified: new Date()
      },
      $push: {
        communicationHistory: rejectionEntry
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
    
    logger.log('Room reservation rejected:', { reservationId: id, rejectedBy: userEmail, reason });
    res.json(result.value);
  } catch (error) {
    logger.error('Error rejecting reservation:', error);
    res.status(500).json({ error: 'Failed to reject reservation' });
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
        lastSyncTime: new Date()
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
        lastSyncTime: new Date()
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
        lastSyncTime: new Date()
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
        lastSyncTime: new Date()
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
        lastSyncTime: new Date()
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
        lastSyncTime: new Date()
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