# APPLICATION.md

This document tracks application-level changes, fixes, and architectural decisions for the Temple Events Calendar application.

## Change Log

### 2025-11-29: Fix Location Loading Race Condition

**Issue:** When first loading the main calendar page, all events were being sorted into "Unspecified" before locations finished loading. This created a poor user experience with a visible flash of incorrectly grouped events.

**Root Cause:** The event loading process in `Calendar.jsx` was not waiting for the `LocationContext` to finish loading locations from the database. The `getDynamicLocations` function depends on `generalLocations` from the LocationContext, but events were being loaded and displayed before locations were available.

**Solution:** Modified `Calendar.jsx` to wait for locations to load before:
1. Starting the main initialization process
2. Loading events after calendar changes

**Files Changed:**
- `src/components/Calendar.jsx`
  - Added `!locationsLoading` condition to the initialization useEffect (line 5463)
  - Added `!locationsLoading` condition to the event loading useEffect (line 5482)
  - Added `locationsLoading` to both dependency arrays

**Technical Details:**
- The `LocationContext` provides a `loading` state that indicates when locations are being fetched
- Previously, the `initializeApp` function would run and call `loadEvents` before locations were ready
- The useEffect that triggers event loading on calendar changes also did not wait for locations
- Both now check `!locationsLoading` before proceeding

**Testing:**
- Verify that on initial page load, events appear with correct location groupings
- Verify that switching calendars waits for any pending location loads
- Verify that the loading indicator shows until both locations AND events are ready

---

## Architectural Notes

### Loading Dependencies

The following loading dependencies should be respected:

```
Authentication (tokens)
    └── LocationContext (loads locations)
           └── Calendar initialization
                  └── Event loading
```

Events should only be loaded after locations are available to ensure proper location matching and grouping.

### Key State Management

- **locationsLoading** (from LocationContext): Indicates if locations are being fetched
- **initializing** (Calendar state): Indicates if the app is in the initialization phase
- **loading** (Calendar state): Indicates if events are being loaded

### Race Condition Prevention Patterns

When adding new features that depend on multiple async data sources:
1. Identify all data dependencies
2. Add appropriate loading state checks before triggering dependent operations
3. Include loading states in useEffect dependency arrays
4. Consider showing unified loading states to users
