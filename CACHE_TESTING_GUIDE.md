# Cache System Testing Guide

This guide provides comprehensive instructions for testing the MongoDB event caching system that has been implemented in the Temple Events Calendar application.

## Overview

The cache system provides a MongoDB-based caching layer that sits between the frontend application and the Microsoft Graph API. It stores calendar events locally to reduce API calls and improve performance.

## Testing Access

### Prerequisites
1. **Admin Access**: You need admin privileges to access the Cache Management panel
2. **API Token**: Ensure you're properly authenticated with a valid API token
3. **Graph Token**: Required for Graph API fallback functionality

### Accessing the Cache Admin Panel
1. Navigate to the application
2. Click on **Admin** in the navigation menu
3. Select **Cache Management** from the dropdown
4. You'll see three tabs: **Dashboard**, **Cache Browser**, and **Performance**

## Testing Scenarios

### 1. Basic Cache Functionality Testing

#### Test 1: Initial Cache Population
**Objective**: Verify that events are cached when first loaded from Graph API

**Steps**:
1. Go to **Admin → Cache Management → Dashboard**
2. Note the initial cache statistics (should show 0 or few cached events)
3. Navigate back to the main calendar view
4. Browse different date ranges and calendar views
5. Return to **Cache Management → Dashboard**
6. Verify that cache statistics show increased event counts

**Expected Results**:
- Cache statistics show new events being cached
- "Total Cached" and "Active" counts increase
- "Cache by Calendar" section shows events for the calendars you browsed

#### Test 2: Cache Hit Verification
**Objective**: Confirm that subsequent requests use cached data

**Steps**:
1. Navigate to a specific calendar date range
2. Go to **Cache Management → Cache Browser**
3. Verify events for that date range are listed as "Active"
4. Navigate away from that date range, then back
5. Check browser developer tools Network tab for reduced API calls
6. Go to **Cache Management → Performance** tab
7. Click "Run Basic Test" to see cache performance metrics

**Expected Results**:
- Faster page load times for cached date ranges
- Reduced Graph API calls in network tab
- Performance test shows good cache lookup times (< 50ms typically)

### 2. Cache-First Loading Testing

#### Test 3: Cache vs Graph API Response Times
**Objective**: Compare performance between cached and non-cached data

**Steps**:
1. Clear cache for a specific calendar:
   - Go to **Cache Management → Dashboard**
   - Click "Clean Expired" or use cleanup tools
2. Navigate to a calendar date range and time the loading
3. Navigate away and back to the same range
4. Time the second loading (should be much faster)
5. Use **Performance** tab to run detailed tests

**Expected Results**:
- First load: Slower (Graph API call)
- Second load: Much faster (cache hit)
- Performance metrics show significant improvement

#### Test 4: Force Refresh Testing
**Objective**: Verify force refresh bypasses cache

**Steps**:
1. Navigate to a cached date range
2. In the calendar view, click the "🚀 Force Refresh" button
3. Monitor network tab for Graph API calls
4. Verify in **Cache Management** that cache is updated

**Expected Results**:
- Force refresh triggers Graph API calls even for cached data
- Cache is updated with fresh data
- Regular refresh (🔄) uses cache-first approach

### 3. Cache Invalidation Testing

#### Test 5: Event Modification Cache Invalidation
**Objective**: Ensure cache is invalidated when events are modified

**Steps**:
1. Create or edit an event in the calendar
2. Go to **Cache Management → Cache Browser**
3. Search for the modified event
4. Verify cache status and timestamps
5. Check that related cache entries are marked as dirty or refreshed

**Expected Results**:
- Cache is automatically invalidated for the affected calendar
- Modified events show updated cached timestamps
- Cache statistics reflect the changes

#### Test 6: Manual Cache Management
**Objective**: Test manual cache operations

**Steps**:
1. Go to **Cache Management → Cache Browser**
2. Select some cached events
3. Click the invalidate button (🔄) for specific events
4. Verify the events are marked as dirty
5. Navigate to those events in the calendar to trigger refresh
6. Use Dashboard cleanup tools to remove expired entries

**Expected Results**:
- Manual invalidation marks events as dirty
- Cleanup tools successfully remove expired/old entries
- Statistics update to reflect the changes

### 4. Performance and Load Testing

#### Test 7: Cache Performance Under Load
**Objective**: Test cache performance with many events

**Steps**:
1. Load calendar views with large date ranges (multiple months)
2. Switch between different calendars rapidly
3. Monitor **Cache Management → Performance** metrics
4. Run both "Basic Test" and "Detailed Test"
5. Check cache utilization percentages

**Expected Results**:
- Cache lookup times remain low (< 100ms) even with many events
- Cache utilization stays within configured limits
- Index performance metrics show efficient database operations

#### Test 8: Cache Size and TTL Testing
**Objective**: Verify cache size limits and expiration

**Steps**:
1. Load many different date ranges to populate cache
2. Check **Dashboard** storage metrics
3. Wait for TTL expiration (default: 24 hours, configurable)
4. Use cleanup tools to remove expired entries
5. Monitor cache size and utilization percentages

**Expected Results**:
- Cache size stays within configured limits
- LRU eviction works when cache is full
- TTL expiration removes old entries
- Storage metrics accurately reflect cache state

### 5. Error Handling and Edge Cases

#### Test 9: API Failure Fallback
**Objective**: Test cache behavior when Graph API is unavailable

**Steps**:
1. Simulate API failure (disable network or block Graph API endpoints)
2. Navigate to cached date ranges
3. Try to navigate to non-cached date ranges
4. Check error handling and user feedback

**Expected Results**:
- Cached data continues to work normally
- Non-cached requests show appropriate error messages
- Application gracefully handles API failures

#### Test 10: Cache Corruption Recovery
**Objective**: Test recovery from cache issues

**Steps**:
1. Use **Cache Management → Dashboard** cleanup tools
2. Clear all cache entries using "Clean All" functionality
3. Navigate calendar to repopulate cache
4. Verify system recovers properly

**Expected Results**:
- Cache can be completely cleared and rebuilt
- System gracefully handles empty cache state
- Performance returns to normal after repopulation

## Validation Checklist

Use this checklist to verify cache system functionality:

### ✅ Cache Functionality
- [ ] Events are cached on first load from Graph API
- [ ] Subsequent requests use cached data (faster loading)
- [ ] Cache hit ratio shows reasonable percentages (> 50%)
- [ ] Force refresh bypasses cache appropriately

### ✅ Cache Invalidation
- [ ] Creating events invalidates cache
- [ ] Editing events invalidates cache
- [ ] Deleting events invalidates cache
- [ ] Manual invalidation works correctly

### ✅ Performance
- [ ] Cache lookup times < 100ms typically
- [ ] Cached requests significantly faster than Graph API
- [ ] Large datasets perform well
- [ ] Index performance is efficient

### ✅ Administration
- [ ] Dashboard shows accurate statistics
- [ ] Cache browser displays events correctly
- [ ] Filtering and pagination work properly
- [ ] Cleanup operations function correctly

### ✅ Error Handling
- [ ] API failures are handled gracefully
- [ ] Cache corruption can be recovered
- [ ] Error messages are user-friendly
- [ ] System continues functioning during issues

## Monitoring and Maintenance

### Key Metrics to Monitor
1. **Hit Ratio**: Should be > 50% for good performance
2. **Cache Size**: Should stay within configured limits
3. **Response Times**: Cache hits should be < 100ms
4. **Expiration Rate**: Reasonable balance of fresh vs cached data

### Regular Maintenance Tasks
1. **Clean Expired Entries**: Use dashboard cleanup tools regularly
2. **Monitor Storage**: Keep cache size reasonable
3. **Performance Testing**: Run periodic performance tests
4. **Index Analysis**: Check index usage in detailed tests

## Troubleshooting Common Issues

### Cache Not Populating
- Check API token validity
- Verify Graph API connectivity
- Check browser console for errors
- Ensure proper calendar selection

### Poor Cache Performance
- Check cache size and utilization
- Run index analysis in performance tests
- Verify database configuration
- Consider cache size limits

### Cache Not Invalidating
- Check event modification flows
- Verify API endpoints are working
- Test manual invalidation features
- Check for JavaScript errors

## Development Testing

For developers testing cache functionality:

### Backend API Testing
```bash
# Test cache overview
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/admin/cache/overview

# Test cache events browsing
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3001/api/admin/cache/events?page=1&limit=10"

# Test performance
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  http://localhost:3001/api/admin/cache/test-performance
```

### Database Direct Inspection
```javascript
// Connect to MongoDB and inspect cache collection
use emanuelnyc
db.templeEvents__EventCache.find().limit(5).pretty()
db.templeEvents__EventCache.count()
db.templeEvents__EventCache.getIndexes()
```

This comprehensive testing guide ensures that the cache system functions correctly and provides the expected performance benefits.