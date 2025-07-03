# Unified Event System Test Plan

## What We've Built

### **Backend Changes**
1. **New Collections**:
   - `templeEvents__Events` - Unified event storage (Graph data + internal enrichments)
   - `templeEvents__CalendarDeltas` - Delta token management

2. **New API Endpoints**:
   - `POST /api/events/sync-delta` - Delta sync with Graph API
   - `GET /api/events` - Get events from unified storage
   - `POST /api/events/force-sync` - Reset delta tokens
   - `PATCH /api/events/:eventId/internal` - Update internal data
   - `GET /api/events/sync-stats` - Sync statistics

3. **Delta Query Support**:
   - Automatic change detection using Microsoft Graph delta tokens
   - Only fetches changed events after initial sync
   - Multi-calendar support (user + TempleRegistration)
   - Fallback to full sync if delta token expires

### **Frontend Changes**
1. **New Service**: `unifiedEventService.js` - Replaces cache service
2. **Updated Calendar Component**: Now uses unified delta sync by default
3. **Fallback Support**: Falls back to old cache approach if unified sync fails

## How It Works

### **Initial Load (No Delta Token)**:
1. Frontend calls `unifiedEventService.syncEvents()`
2. Backend performs full sync from Graph API for date range
3. Events stored in unified collection with internal data structure
4. Delta token saved for future incremental syncs
5. Events returned to frontend in enriched format

### **Subsequent Loads (Delta Token Exists)**:
1. Backend uses stored delta token to call Graph delta endpoint
2. Only changed/new/deleted events are fetched from Graph API
3. Changes applied to unified collection (preserving internal data)
4. New delta token saved for next sync
5. All events for date range returned to frontend

### **Multi-Calendar Support**:
- Tracks events from both user calendar and TempleRegistration shared mailbox
- Each event has `sourceCalendars` array showing which calendars contain it
- Separate delta tokens for each calendar for optimal performance

## Testing the System

### **1. Initial Setup**
```bash
# Start backend
cd backend && npm run dev

# Start frontend  
npm run dev
```

### **2. Test Delta Sync**
1. Load calendar - should perform full sync (first time)
2. Check MongoDB for:
   - Events in `templeEvents__Events` collection
   - Delta tokens in `templeEvents__CalendarDeltas` collection
3. Reload calendar - should perform delta sync (faster)
4. Modify event in Outlook, reload - should detect change

### **3. Test Multi-Calendar**
1. Ensure TempleRegistration calendar is available
2. Load calendar - should sync both user calendar and TempleRegistration
3. Check events have proper `sourceCalendars` metadata

### **4. Test Internal Data**
1. Add MEC categories, setup/teardown times to events
2. Reload calendar - internal data should persist
3. Modify Graph event - internal data should be preserved

### **5. Performance Comparison**
- **Before**: Every load fetches all events from Graph API
- **After**: First load is full sync, subsequent loads are delta (much faster)

## Expected Benefits

1. **95% reduction in API calls** after initial sync
2. **Faster load times** - only process actual changes  
3. **Better caching** - unified storage with change tracking
4. **Multi-calendar support** - automatic TempleRegistration inclusion
5. **Data persistence** - internal enrichments preserved across syncs
6. **Automatic updates** - detects changes made in Outlook/Teams

## Monitoring

Check browser console for:
- `loadEventsUnified: Starting unified delta sync`
- `Delta sync completed` with sync statistics
- Any fallback to cache approach (indicates issues)

Check backend logs for:
- Delta token management
- Graph API delta calls
- Event upsert operations
- Sync statistics