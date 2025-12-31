# CSV Import Folder

Drop your CSV file here for importing events.

## Usage

1. **Add your CSV file to this folder** (only one CSV file at a time)
2. **Run the import script:**
   ```bash
   cd backend
   node quick-csv-import.js "Temple Emanu-El Sandbox"
   ```

## Rules

- ✅ Only one CSV file should be in this folder at a time
- ✅ The script will automatically find and use the CSV file
- ✅ CSV files are ignored by git (won't be committed)

## Example

```bash
# Copy your CSV file here
cp /path/to/Rsched_Export1.csv csv-imports/

# Run the import (use calendar name from calendar-config.json)
node quick-csv-import.js "Temple Emanu-El Sandbox"

# Delete the CSV when done
rm csv-imports/*.csv
```

## Adding More Calendars

Edit `backend/calendar-config.json` to add calendar names and their IDs.

See `backend/CALENDAR_IMPORT_README.md` for detailed instructions.
