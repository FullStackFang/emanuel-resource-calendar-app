/**
 * Azure AD configuration shared across backend services.
 * Single source of truth for APP_ID and TENANT_ID.
 */
const logger = require('../utils/logger');

const APP_ID = process.env.APP_ID || 'c2187009-796d-4fea-b58c-f83f7a89589e';
const TENANT_ID = process.env.TENANT_ID || 'fcc71126-2b16-4653-b639-0f1ef8332302';

if (!process.env.APP_ID || !process.env.TENANT_ID) {
  logger.warn('APP_ID and/or TENANT_ID not set in environment — using hardcoded defaults. Set these in .env for production.');
}

module.exports = { APP_ID, TENANT_ID };
