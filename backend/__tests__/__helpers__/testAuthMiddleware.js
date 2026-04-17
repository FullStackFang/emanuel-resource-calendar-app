'use strict';

/**
 * Test authentication middleware.
 * Decodes JWT tokens without verification — test tokens are trusted.
 * Extracted from testApp.js createTestAuthMiddleware().
 */

const jose = require('jose');

function createTestAuthMiddleware() {
  return async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const token = authHeader.split(' ')[1];
      const payload = jose.decodeJwt(token);

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

module.exports = { createTestAuthMiddleware };
