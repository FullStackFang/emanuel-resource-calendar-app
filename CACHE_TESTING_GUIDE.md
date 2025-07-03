# Event Caching Testing Guide

## Overview
This guide outlines how to test the event caching system to ensure events are properly cached and retrieved.

## What We Fixed

### 1. Calendar ID Assignment
- **Problem**: Events loaded from Graph API sometimes lacked `calendarId`, preventing caching
- **Fix**: Added fallback logic to assign default calendar ID when missing
- **Location**: `Calendar.jsx` in `loadGraphEvents()` function

### 2. Selective Caching Logic
- **Problem**: Events without `calendarId` were filtered out during caching
- **Fix**: Added fallback calendar ID assignment and proper handling of unknown events
- **Location**: `Calendar.jsx` in selective caching section

### 3. Enrichment Data Caching
- **Problem**: Enriched internal data wasn't being properly cached
- **Fix**: Separated event data from internal data before caching in backend
- **Location**: `backend/api-server.js` in `/events/cache` endpoint

### 4. Enhanced Logging
- **Added**: Comprehensive logging throughout the caching flow
- **Purpose**: Better debugging and understanding of cache behavior

## Testing Steps

### 1. Check Console Logs
Open browser dev tools and look for these log messages:

#### Frontend Logs (Console):
```
loadEventsWithCache: Starting load
EventCacheService: Checking for uncached events
EventCacheService: Caching X missing events for calendar Y
Selective caching completed for calendar X
```

#### Backend Logs (Server):
```
Cache-first loading events for [userId], calendar [calendarId]
getCachedEvents: Found X cached events
cacheEvent: Caching event [eventId]
Cached X events after Graph API fetch
```

### 2. Test Cache Hit/Miss
1. **First Load**: Should see "Loading from Graph API" and caching activity
2. **Refresh Page**: Should see "Using cached events" for subsequent loads
3. **Force Refresh**: Click "Force Refresh" button to bypass cache

### 3. Verify Cache Database
Check MongoDB collection `templeEvents__EventCache`:
```javascript
// In MongoDB Compass or shell
db.templeEvents__EventCache.find({}).limit(5)
```

Should see documents with:
- `userId`
- `calendarId` 
- `eventId`
- `eventData` (Graph API data)
- `internalData` (enrichment data)
- `cachedAt`
- `expiresAt`

### 4. Test Internal Events
1. **Create events** with setup/teardown times
2. **Check enrichment**: Look for `_hasInternalData: true` in logs
3. **Verify caching**: Enriched data should be cached with events

## Expected Behavior

### Cache Hit Scenario:
1. User loads calendar
2. System checks cache first
3. Returns cached events if found and not stale
4. Background refresh may occur to update cache

### Cache Miss Scenario:
1. User loads calendar  
2. No cached events found
3. Fetches from Graph API
4. Enriches with internal data
5. Caches enriched events
6. Returns events to frontend

### Error Scenarios:
- Events without calendar ID are logged as warnings but don't break caching
- Cache errors are logged but don't prevent event loading
- Missing API token falls back to Graph-only loading

## Debugging Tips

### If Caching Isn't Working:
1. Check for "Events without calendarId" warnings
2. Verify API token is present in requests
3. Check MongoDB connection and indexes
4. Look for cache endpoint errors in backend logs

### If Cache Always Misses:
1. Check date range formatting
2. Verify calendar ID consistency
3. Check cache expiration settings (24 hour default)
4. Verify user ID consistency

### Performance Monitoring:
- Cache hit rate should improve over time
- Initial loads will be slower (Graph API)
- Subsequent loads should be faster (cache)
- Background refreshes keep data current

## Cache Configuration

### TTL Settings (backend/api-server.js):
```javascript
const CACHE_CONFIG = {
  DEFAULT_TTL_HOURS: 24,          // Cache expiry
  MAX_CACHE_SIZE: 10000,          // Max events per user
  STALE_THRESHOLD_MINUTES: 60,    // When to refresh
  BACKGROUND_SYNC_ENABLED: true   // Background updates
};
```

### Cache Indexes:
- `userId_calendarId_startTime`: Date range queries
- `userId_eventId_etag`: Change detection
- `expiresAt_ttl`: Automatic cleanup
- `lastAccessedAt_lru`: LRU eviction
- `userId_calendarId_eventId_unique`: Prevent duplicates

## Troubleshooting Common Issues

### "No calendar selected, falling back to Graph API loading"
- User hasn't selected a specific calendar
- System uses default calendar for caching
- Events from `/me/events` get default calendar ID assigned

### "Skipping cache for X events without valid calendar ID"
- Some events couldn't be assigned a calendar ID
- These events are still displayed but not cached
- Check if default calendar is properly identified

### "Cache loading failed, falling back to Graph API"
- Network issue or backend error
- System gracefully falls back to direct Graph loading
- Check backend logs for specific error details