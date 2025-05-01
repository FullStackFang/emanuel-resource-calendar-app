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
const webAppURL = 'emanuel-resourcescheduler-d4echehehaf3dxfg.canadacentral-01.azurewebsites.net';

// Middleware
// Updated CORS configuration to allow requests from your deployed app domain
app.use(cors({
  origin: [
    'http://localhost:80', 
    'http://localhost', 
    process.env.FRONTEND_URL || webAppURL
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
  exposedHeaders: ['Authorization']
}));
app.use(express.json());

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

// Connect to MongoDB with reconnection logic
async function connectToDatabase() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    db = client.db('emanuelnyc');
    usersCollection = db.collection('templeEvents__Users');
    
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

// MSAL Authentication Middleware - Properly implemented for production
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('No token provided or invalid format');
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const token = authHeader.split(' ')[1];
    console.log('Token received (first 20 chars):', token.substring(0, 20) + '...');
    
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
    
    // Verify token
    jwt.verify(token, getKey, { 
      algorithms: ['RS256'],
      audience: process.env.APP_ID || 'c2187009-796d-4fea-b58c-f83f7a89589e', // Your app's client ID
      issuer: `https://login.microsoftonline.com/${process.env.TENANT_ID || 'fcc71126-2b16-4653-b639-0f1ef8332302'}/v2.0` 
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

// Routes

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
  });
}

startServer();