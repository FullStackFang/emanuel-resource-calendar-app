# Enhanced Calendar Display in CSV Import

## Issue Addressed
The calendar dropdown was showing unclear entries like just "Calendar" without context about which calendar it represents.

## Enhancement Applied

### Calendar Display Format
Calendars now show with comprehensive information in this format:
```
[Calendar Name] ([Owner]) [Indicators]
```

### Information Displayed

#### 1. **Calendar Name**
- Primary: `calendar.name`
- Fallback: `calendar.displayName` 
- Default: `'Unnamed Calendar'` if neither available

#### 2. **Owner Information** (in parentheses)
Shows owner details in this priority:
- `calendar.owner.name` (if different from calendar name)
- `calendar.owner.emailAddress.name` 
- `calendar.owner.emailAddress.address`

#### 3. **Visual Indicators**
- **⭐ Default** - Shows if this is the user's default calendar
- **✏️ Editable** - Shows if user can create/edit events
- **🔒 Read Only** - Shows if user has read-only access

### Example Display
Instead of:
```
Calendar
```

You'll now see:
```
Calendar (stephen.fang@emanuelnyc.org) ⭐ Default ✏️ Editable
Shared Events (Temple Admin) ✏️ Editable
Public Calendar (calendar@emanuelnyc.org) 🔒 Read Only
```

## Technical Implementation

### Enhanced Microsoft Graph Query
Now fetches additional fields:
```javascript
$select=id,name,displayName,owner,canEdit,isDefaultCalendar,color
```

### Enhanced Display Logic
```javascript
// Create descriptive calendar name
let displayName = calendar.name || calendar.displayName || 'Unnamed Calendar';

// Add owner information
if (calendar.owner?.name && calendar.owner.name !== displayName) {
  displayName += ` (${calendar.owner.name})`;
} else if (calendar.owner?.emailAddress?.name) {
  displayName += ` (${calendar.owner.emailAddress.name})`;
} else if (calendar.owner?.emailAddress?.address) {
  displayName += ` (${calendar.owner.emailAddress.address})`;
}

// Add indicators
if (calendar.isDefaultCalendar) {
  displayName += ' ⭐ Default';
}

if (calendar.canEdit === false) {
  displayName += ' 🔒 Read Only';
} else {
  displayName += ' ✏️ Editable';
}
```

## Benefits

✅ **Clear Calendar Identification**: Users can easily distinguish between calendars
✅ **Owner Information**: Shows who owns shared calendars  
✅ **Permission Awareness**: Users know if they can edit or only read
✅ **Default Calendar Highlighting**: Easy to find your primary calendar
✅ **Visual Indicators**: Icons make information scannable

## Debugging Enhancement
Added logging to help troubleshoot calendar data:
```javascript
logger.log('Calendar data received:', data.value);
```

## Expected User Experience
1. Navigate to **Admin → CSV Import**
2. **Target Calendar** dropdown now shows descriptive entries like:
   - `Personal Calendar (your.email@temple.org) ⭐ Default ✏️ Editable`
   - `Shared Temple Events (admin@temple.org) ✏️ Editable`
   - `Public Events (calendar@temple.org) 🔒 Read Only`
3. Users can easily identify which calendar to select for their CSV import

---

**Status**: ✅ **ENHANCED** - Calendar dropdown now provides clear, detailed calendar identification with owner info and permissions.