# Fix for Missing Calendar Selector in CSV Import

## Issue
Users couldn't see the calendar selector dropdown in CSV Import, getting error: "Please select a target calendar before importing"

## Root Cause
The `CSVImport` component was expecting an `availableCalendars` prop, but `UnifiedEventsAdmin` wasn't providing it or fetching calendar data.

## Fix Applied

### Backend (No changes needed)
The backend already handles the `targetCalendarId` parameter correctly.

### Frontend Changes

#### 1. `UnifiedEventsAdmin.jsx`

**Added state for calendars:**
```javascript
const [availableCalendars, setAvailableCalendars] = useState([]);
```

**Added calendar fetching function:**
```javascript
const loadAvailableCalendars = useCallback(async () => {
  try {
    const graphToken = localStorage.getItem('graphToken') || sessionStorage.getItem('graphToken');
    
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
}, []);
```

**Added calendar loading to useEffect:**
```javascript
} else if (activeTab === 'csv-import') {
  loadAvailableCalendars();
}
```

**Updated CSVImport prop passing:**
```javascript
{activeTab === 'csv-import' && <CSVImport apiToken={apiToken} availableCalendars={availableCalendars} />}
```

#### 2. `CSVImport.jsx`

**Enhanced calendar selector with loading state:**
```javascript
<option value="">
  {availableCalendars.length === 0 ? 'Loading calendars...' : 'Select a calendar...'}
</option>

{availableCalendars.length === 0 && (
  <p style={{ fontSize: '14px', color: '#666', marginTop: '5px' }}>
    📡 Loading your available calendars...
  </p>
)}
```

## User Experience Improvements

1. **Calendar Selector Visible**: Users now see a dropdown with their available calendars
2. **Loading Feedback**: Shows "Loading calendars..." while fetching data
3. **Clear Instructions**: Helpful message when calendars are being loaded
4. **Automatic Loading**: Calendars load when user switches to CSV Import tab

## Calendar Data Structure
The Microsoft Graph API returns calendars with this structure:
```javascript
{
  id: "calendar-guid",
  name: "Calendar Name",
  owner: { ... },
  canEdit: true,
  isDefaultCalendar: false
}
```

## Testing Status
- ✅ Build successful
- ✅ Calendar selector now visible
- ✅ Loading state implemented
- ✅ Ready for user testing

## Expected User Flow
1. User navigates to Admin → CSV Import
2. Calendar selector shows "Loading calendars..."
3. Available calendars populate in dropdown
4. User selects target calendar
5. User can now upload CSV files successfully