// middleware/auth.js
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const User = require('../models/User');

// MSAL configuration
const TENANT_ID = process.env.TENANT_ID || 'common';
const CLIENT_ID = process.env.CLIENT_ID;

// JWKS client for validating Microsoft tokens
const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`
});

// Function to get the signing key
const getSigningKey = (header, callback) => {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
};

// Middleware to authenticate the Microsoft token
const authMiddleware = async (req, res, next) => {
  // Get token from header
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'No token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    // Verify the token
    jwt.verify(token, getSigningKey, {
      audience: CLIENT_ID,
      issuer: `https://login.microsoftonline.com/${TENANT_ID}/v2.0`
    }, async (err, decoded) => {
      if (err) {
        return res.status(401).json({ message: 'Invalid token' });
      }
      
      // Get user ID from token
      const userId = decoded.oid || decoded.sub;
      const email = decoded.preferred_username || decoded.email;
      
      // Store in request for further use
      req.userId = userId;
      req.userEmail = email;
      
      // Check if user exists, create if not
      let user = await User.findOne({ email });
      
      if (!user) {
        user = new User({
          userId,
          email,
          displayName: decoded.name || email.split('@')[0],
          lastLogin: new Date(),
          // Default preferences
          preferences: {
            defaultView: 'week',
            defaultGroupBy: 'categories',
            preferredZoomLevel: 100
          }
        });
        
        await user.save();
      } else {
        // Update last login
        user.lastLogin = new Date();
        await user.save();
      }
      
      next();
    });
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = authMiddleware;