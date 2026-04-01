/* global use, db */
// MongoDB Playground for Emanuel NYC - Temple Events User Preferences

// Database and collection names
const database = 'emanuelnyc';
const collection = 'templeEvents__Users';

// Create a new database
use(database);

// Create a new collection with validation for our user preference fields
db.createCollection(collection, {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["userId", "email", "preferences"],
      properties: {
        userId: {
          bsonType: "string",
          description: "User ID from authentication system, required"
        },
        email: {
          bsonType: "string",
          description: "User email address, required"
        },
        displayName: {
          bsonType: "string",
          description: "User's display name"
        },
        preferences: {
          bsonType: "object",
          required: ["startOfWeek"],
          properties: {
            startOfWeek: {
              bsonType: "string",
              enum: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
              description: "User's preferred start of week day"
            },
            createEvents: {
              bsonType: "bool",
              description: "Permission to create Microsoft Graph events"
            },
            editEvents: {
              bsonType: "bool",
              description: "Permission to edit Microsoft Graph events"
            },
            deleteEvents: {
              bsonType: "bool",
              description: "Permission to delete Microsoft Graph events"
            }
          }
        },
        createdAt: {
          bsonType: "date",
          description: "Date the user was created"
        },
        updatedAt: {
          bsonType: "date",
          description: "Date the user was last updated"
        }
      }
    }
  }
});

// Create an index on userId for faster lookups
db[collection].createIndex({ "userId": 1 }, { unique: true });

// Create an index on email for faster lookups and to ensure uniqueness
db[collection].createIndex({ "email": 1 }, { unique: true });

// Insert a sample user document
db[collection].insertOne({
  userId: "user123",
  email: "sample@example.com",
  displayName: "Sample User",
  preferences: {
    startOfWeek: "Sunday",
    createEvents: true,
    editEvents: true,
    deleteEvents: false
  },
  createdAt: new Date(),
  updatedAt: new Date()
});

// Verify the collection was created
print("Collection created: " + collection);
print("Sample document inserted. Collection now contains: " + db[collection].countDocuments() + " document(s)");