# CSV Import with Calendar Config

Simple CSV import for Resource Scheduler data that uses calendar names instead of IDs.

## Quick Start

1. **Add your CSV file**
   ```bash
   cp /path/to/Rsched_Export1.csv backend/csv-imports/
   ```

2. **Run the import**
   ```bash
   cd backend
   node quick-csv-import.js "Temple Emanu-El Sandbox"
   ```

That's it! The script will:
- Find the calendar ID from `calendar-config.json`
- Import all events from the CSV
- Associate them with the specified calendar

## Adding More Calendars

Edit `backend/calendar-config.json` and add your calendar:

```json
{
  "Your Calendar Name": "AAMkADgwMDdhZjYzLWM0NmE..."
}
```

### How to Find Calendar IDs

**Option 1: From Frontend Console**
1. Open your app in the browser
2. Open DevTools (F12)
3. Select a calendar in the calendar selector
4. Look in console for: `selectedCalendarId: "AAMkADgw..."`
5. Copy that ID

**Option 2: From MongoDB Compass**
1. Open `templeEvents__Events` collection
2. Find any event from that calendar
3. Look for the `calendarId` field
4. Copy that value

**Option 3: From Frontend Code**
Look at the `availableCalendars` array in your console logs - each calendar has an `id` property.

## Example

```bash
# Put CSV in the imports folder
cp Downloads/Rsched_Export1.csv backend/csv-imports/

# Import to "Temple Emanu-El Sandbox" calendar
node quick-csv-import.js "Temple Emanu-El Sandbox"

# Clean up
rm csv-imports/*.csv
```

## Troubleshooting

**Calendar not found?**
```
❌ Error: Calendar "My Calendar" not found in calendar-config.json

Available calendars in config:
  - Temple Emanu-El Sandbox
```
→ Add your calendar to `calendar-config.json`

**No CSV file?**
```
❌ Error: No CSV file found in csv-imports folder
```
→ Copy your CSV file to `backend/csv-imports/`

**Multiple CSV files?**
```
❌ Error: Multiple CSV files found
```
→ Keep only one CSV file in the folder at a time
