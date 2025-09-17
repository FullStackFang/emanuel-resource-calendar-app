// src/config.js
const hostname = window.location.hostname;
const isLocalDevelopment = hostname === 'localhost' || hostname === '127.0.0.1';
const isAzureProduction = hostname.includes('azurewebsites.net');
const isProduction = isAzureProduction || (!isLocalDevelopment && hostname !== '');

const APP_CONFIG = {
  API_BASE_URL: isProduction 
    ? 'https://emanuelnyc-services-api-c9efd3ajhserccff.canadacentral-01.azurewebsites.net/api'
    : 'http://localhost:3001/api',
  
  // Calendar configuration for room reservations
  CALENDAR_CONFIG: {
    SANDBOX_CALENDAR: 'templesandbox@emanuelnyc.org',
    PRODUCTION_CALENDAR: 'temple@emanuelnyc.org',
    // Default to sandbox for safety
    DEFAULT_MODE: 'sandbox'
  }
};

export default APP_CONFIG;