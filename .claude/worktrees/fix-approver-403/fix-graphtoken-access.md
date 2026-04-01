# Fix for Graph Token Access in CSV Import

## Issue Identified
From the screenshot, the calendar selector was showing but stuck on "Loading calendars..." because the UnifiedEventsAdmin component couldn't access the Microsoft Graph token needed to fetch calendar data.

## Root Cause
**Missing Graph Token**: UnifiedEventsAdmin was only receiving `apiToken` but needed `graphToken` to call Microsoft Graph API for calendar data.

## Fix Applied

### 1. **App.jsx** - Pass Graph Token to UnifiedEventsAdmin
**Before:**
```javascript
<Route path="/admin/events" element={<UnifiedEventsAdmin apiToken={apiToken} />} />
```

**After:**
```javascript
<Route path="/admin/events" element={<UnifiedEventsAdmin apiToken={apiToken} graphToken={graphToken} />} />
```

### 2. **UnifiedEventsAdmin.jsx** - Accept and Use Graph Token
**Updated function signature:**
```javascript
export default function UnifiedEventsAdmin({ apiToken, graphToken }) {
```

**Updated calendar loading function:**
```javascript
const loadAvailableCalendars = useCallback(async () => {
  try {
    if (!graphToken) {
      logger.warn('No graph token available for calendar loading');
      return;
    }

    const response = await fetch('https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,owner,canEdit,isDefaultCalendar&$orderby=name', {
      headers: {
        Authorization: `Bearer ${graphToken}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch calendars');
    }
    
    const data = await response.json();
    setAvailableCalendars(data.value || []);
    
  } catch (err) {
    logger.error('Error loading calendars:', err);
  }
}, [graphToken]);
```

**Fixed dependency arrays:**
```javascript
}, [activeTab, apiToken, loadAvailableCalendars, loadEvents, loadOverview]);
```

## Expected Behavior Now

✅ **Calendar Dropdown Should Populate**: When you navigate to Admin → CSV Import, the "Target Calendar" dropdown should now load with your actual Microsoft calendars instead of staying on "Loading calendars..."

✅ **User's Calendars Visible**: You should see your calendars listed like:
- Calendar (default)
- Shared Calendar Name
- Other available calendars

✅ **CSV Import Functional**: Once a calendar is selected, CSV file upload should work without the "Please select a target calendar" error.

## Testing Steps
1. Navigate to **Admin → CSV Import**
2. Wait a moment for calendar loading
3. **Target Calendar** dropdown should populate with your calendars
4. Select a calendar from the dropdown
5. Upload a CSV file - should work without error

## Default Calendar
The calendar list will include your default calendar and any shared calendars you have access to. The Microsoft Graph API returns them ordered by name, so your primary calendar might not be first in the list.

## Troubleshooting
If calendars still don't load:
- Check browser dev tools console for Graph API errors
- Verify you're signed in with proper Microsoft permissions
- Check Network tab for any 401/403 errors on Graph API calls

---

**Status**: ✅ **READY FOR TESTING** - Calendar dropdown should now populate with your actual Microsoft calendars.