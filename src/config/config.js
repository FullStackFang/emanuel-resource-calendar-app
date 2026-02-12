// src/config.js
const hostname = window.location.hostname;
const isLocalDevelopment = hostname === 'localhost' || hostname === '127.0.0.1';
const isAzureProduction = hostname.includes('azurewebsites.net');
const isProduction = isAzureProduction || (!isLocalDevelopment && hostname !== '');

const API_BASE_URL = isProduction
  ? 'https://emanuelnyc-services-api-c9efd3ajhserccff.canadacentral-01.azurewebsites.net/api'
  : 'http://localhost:3001/api';

// Cache for runtime config fetched from backend
let runtimeConfig = null;

// Fetch runtime configuration from backend (controlled by CALENDAR_MODE env var)
export async function fetchRuntimeConfig() {
  if (runtimeConfig) return runtimeConfig;

  try {
    const response = await fetch(`${API_BASE_URL}/config`);
    if (response.ok) {
      runtimeConfig = await response.json();
    }
  } catch (error) {
    console.warn('Failed to fetch runtime config, using defaults:', error);
  }

  return runtimeConfig;
}

// Get the default display calendar (async - fetches from backend)
export async function getDefaultDisplayCalendar() {
  const config = await fetchRuntimeConfig();
  if (config?.defaultDisplayCalendar) {
    return config.defaultDisplayCalendar;
  }
  // Fallback to sandbox if backend unreachable
  return 'TempleEventsSandbox@emanuelnyc.org';
}

const APP_CONFIG = {
  API_BASE_URL,

  // Static fallback - use getDefaultDisplayCalendar() for runtime value
  DEFAULT_DISPLAY_CALENDAR: 'TempleEventsSandbox@emanuelnyc.org',

  // Calendar configuration for room reservations
  CALENDAR_CONFIG: {
    SANDBOX_CALENDAR: 'templeeventssandbox@emanuelnyc.org',
    PRODUCTION_CALENDAR: 'templeevents@emanuelnyc.org',
    DEFAULT_MODE: 'sandbox'
  }
};

export default APP_CONFIG;