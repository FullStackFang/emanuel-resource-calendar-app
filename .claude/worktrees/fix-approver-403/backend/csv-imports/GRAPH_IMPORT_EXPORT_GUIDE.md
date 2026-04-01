# MongoDB Event Import/Export Guide

This guide covers how to manually import events from CSV files into MongoDB and export them to Microsoft 365 calendars.

---

## Table of Contents

1. [Part 1: CSV Import to MongoDB](#part-1-csv-import-to-mongodb)
2. [Part 2: Export MongoDB to Graph API](#part-2-export-mongodb-to-graph-api)
   - [Getting Your Delegated Token](#step-1-getting-your-delegated-token-detailed)
   - [Running Export Commands](#step-2-running-export-commands)
   - [Troubleshooting](#troubleshooting)

---

## Part 1: CSV Import to MongoDB

### Overview
The `quick-csv-import.js` script imports events from CSV files into the MongoDB `templeEvents__Events` collection.

### Basic Usage

```bash
cd backend
node quick-csv-import.js --file=your-file.csv
```

### Available Parameters

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `--file=NAME` | Specific CSV file to import | First .csv file found | `--file=events-2025.csv` |
| `--batch-size=N` | Records per batch | 500 | `--batch-size=100` |
| `--delay=N` | Milliseconds between batches | 0 | `--delay=2000` |

### Common Scenarios

#### Standard Import
```bash
node quick-csv-import.js --file=temple-events.csv
```

#### Rate Limiting Issues (Azure Cosmos DB)
If you get error 16500 (rate limiting):

```bash
# Smaller batches with delay
node quick-csv-import.js --file=temple-events.csv --batch-size=100 --delay=2000
```

#### Very Large Imports
```bash
# Conservative approach for 2000+ records
node quick-csv-import.js --file=large-import.csv --batch-size=50 --delay=3000
```

### What Gets Imported

The script creates events with:
- **eventId**: Auto-generated from CSV's `rsId` field
- **userId**: Your user ID (hardcoded in script)
- **calendarId**: Your calendar ID (from calendar-config.json)
- **graphData**: Event details (subject, start/end times, location, etc.)
- **internalData**: Custom enrichments (categories, setup times, staff assignments)

---

## Part 2: Export MongoDB to Graph API

### Overview

The `export-to-graph.js` script exports events from MongoDB (`templeEvents__Events`) to your Microsoft 365 calendars.

**Important:** This script uses a **delegated user token** (your personal Graph API token), NOT an application token. This means:
- ✅ Works with shared mailboxes and calendars you have access to
- ✅ Uses the exact same permissions as the UI
- ⏱️ Token expires after 1 hour (needs refresh for longer operations)

---

## Step 1: Getting Your Delegated Token (DETAILED)

### 1.1 Log Into Your App

Open your calendar app in a web browser:
```
https://localhost:5173
```

Log in with your Microsoft account if not already logged in.

### 1.2 Open Browser DevTools

**Windows/Linux:**
- Press `F12` or `Ctrl + Shift + I`

**Mac:**
- Press `Cmd + Option + I`

**Or:** Right-click anywhere → "Inspect" → Go to "Console" tab

### 1.3 Extract the Token (Copy/Paste These Commands)

In the Console tab, run these commands **one at a time**:

#### Command 1: Find Token Keys
```javascript
JSON.parse(sessionStorage.getItem('msal.token.keys.c2187009-796d-4fea-b58c-f83f7a89589e'))
```

**Output will look like:**
```javascript
{
  accessToken: ["69fda879-0c61-4aa5-b02d-cad292c0777e.fcc71126-2b16..."],
  idToken: [...],
  refreshToken: [...]
}
```

#### Command 2: Get the Graph API Token Key
```javascript
JSON.parse(sessionStorage.getItem('msal.token.keys.c2187009-796d-4fea-b58c-f83f7a89589e')).accessToken[0]
```

**Output will be a long key like:**
```
'69fda879-0c61-4aa5-b02d-cad292c0777e.fcc71126-2b16-4653-b639-0f1ef8332302-login.windows.net-accesstoken-c2187009-796d-4fea-b58c-f83f7a89589e-fcc71126-2b16-4653-b639-0f1ef8332302-calendars.read calendars.read.shared calendars.readbasic calendars.readwrite calendars.readwrite.shared directory.accessasuser.all user.read profile openid email--'
```

**COPY THIS ENTIRE KEY** (it's long!)

#### Command 3: Extract the Actual Token

Replace `PASTE_KEY_HERE` with the key you just copied:

```javascript
JSON.parse(sessionStorage.getItem('PASTE_KEY_HERE')).secret
```

**Output will be your token:**
```
'eyJ0eXAiOiJKV1QiLCJub25jZSI6IllGMjl0Z01hT3d5b01qS0JqOFZ4eHk1a3p5ZktPTmVKbGpraExPcVNZbjQi...'
```

**COPY THIS TOKEN** (very long string starting with `eyJ0...`)

### 1.4 Update Your .env File

Open `backend/.env` and update the `GRAPH_ACCESS_TOKEN` line:

```bash
GRAPH_ACCESS_TOKEN=eyJ0eXAiOiJKV1QiLCJub25jZSI6IllGMjl0Z01hT3d5b01qS0JqOFZ4eHk1a3p5ZktPTmVK...
```

**Important:**
- ❌ Don't add quotes around the token
- ❌ Don't add line breaks
- ✅ Just paste the token directly after the `=`

### 1.5 Token Lifespan

⏱️ **Tokens expire after 1 hour**

If your export takes longer than 1 hour or you get authentication errors, repeat steps 1.3-1.4 to get a fresh token.

---

## Step 2: Running Export Commands

### 2.1 Test with Dry-Run (Recommended First Step)

Always test first to see what will be exported without actually creating events:

```bash
cd backend
node export-to-graph.js "stephen.fang@emanuelnyc.org" --dry-run
```

**Output:**
```
Found 13 events to export

📦 Processing batch 1/1 (events 1-13)...
   1. Erev Sukkot (AAMkADgw...)
   2. Test Event (AAMkADgw...)
   ...
```

### 2.2 Test with 1 Event

Verify the export actually works by creating just 1 event:

```bash
node export-to-graph.js "stephen.fang@emanuelnyc.org" --limit=1
```

**Check your Outlook calendar** to confirm the event appears!

### 2.3 Export All Events

Once verified, export all events:

```bash
node export-to-graph.js "stephen.fang@emanuelnyc.org"
```

### 2.4 Export to Different Calendars

Use any calendar name from your `calendar-config.json`:

```bash
# Export to sandbox calendar
node export-to-graph.js "TempleEventsSandbox@emanuelnyc.org"

# Export to main temple calendar
node export-to-graph.js "TempleEvents@emanuelnyc.org"

# Export to registrations calendar
node export-to-graph.js "templeregistrations@emanuelnyc.org"
```

---

## Command Reference (Cheat Sheet)

### Common Commands

```bash
# 1. Test what will be exported (no changes)
node export-to-graph.js "CALENDAR_NAME" --dry-run

# 2. Export just 1 event (verify it works)
node export-to-graph.js "CALENDAR_NAME" --limit=1

# 3. Export first 5 events
node export-to-graph.js "CALENDAR_NAME" --limit=5

# 4. Export all events
node export-to-graph.js "CALENDAR_NAME"

# 5. Export with date range
node export-to-graph.js "CALENDAR_NAME" --start-date=2025-10-01 --end-date=2025-12-31

# 6. Export with smaller batches and delays (if rate limited)
node export-to-graph.js "CALENDAR_NAME" --batch-size=10 --delay=1000

# 7. Combine options
node export-to-graph.js "CALENDAR_NAME" --limit=10 --start-date=2025-11-01 --dry-run
```

### Available Parameters

| Parameter | Description | Default | Example |
|-----------|-------------|---------|---------|
| `--limit=N` | Max events to export | All events | `--limit=5` |
| `--batch-size=N` | Events per batch | 20 (max) | `--batch-size=10` |
| `--delay=N` | Milliseconds between batches | 500 | `--delay=1000` |
| `--start-date=DATE` | Only export events after date | None | `--start-date=2025-10-01` |
| `--end-date=DATE` | Only export events before date | None | `--end-date=2025-12-31` |
| `--dry-run` | Preview without creating events | false | `--dry-run` |
| `--access-token=TOKEN` | Use different token | From .env | `--access-token=eyJ0...` |

---

## Troubleshooting

### Problem: Token Expired

**Error:**
```
401 Unauthorized
```

**Solution:**
Your token expired (lasts 1 hour). Follow [Step 1](#step-1-getting-your-delegated-token-detailed) again to get a fresh token.

---

### Problem: No Events Found

**Output:**
```
Found 0 events to export
```

**Causes:**
1. **Wrong calendar name** - Check `calendar-config.json` for exact names
2. **Events in different calendar** - MongoDB events have a `calendarId` field that must match

**Solution:**

Check which calendar IDs have events in MongoDB:

```bash
node -e "
const { MongoClient } = require('mongodb');
require('dotenv').config();

(async () => {
  const client = new MongoClient(process.env.MONGODB_CONNECTION_STRING);
  await client.connect();
  const db = client.db('emanuelnyc');
  const collection = db.collection('templeEvents__Events');

  const counts = await collection.aggregate([
    { \$match: { userId: '69fda879-0c61-4aa5-b02d-cad292c0777e', isDeleted: { \$ne: true } } },
    { \$group: { _id: '\$calendarId', count: { \$sum: 1 } } },
    { \$sort: { count: -1 } }
  ]).toArray();

  console.log('Events by calendar ID:');
  counts.forEach(c => console.log(\`  \${c._id}: \${c.count} events\`));

  await client.close();
})();
"
```

Then match the calendar ID to names in `calendar-config.json`.

---

### Problem: All-Day Event Errors

**Error:**
```
ErrorInvalidRequest: The Event.Start property for an all-day event needs to be set to midnight.
```

**Status:** ✅ **FIXED** in current version

If you still see this error, make sure you're using the latest `export-to-graph.js` script.

---

### Problem: Wrong Calendar in Outlook

**Issue:** Events appear in the wrong calendar

**Cause:** The script uses `/me/calendars/{calendarId}` - it creates events in YOUR primary calendar by default, but with the specified calendarId.

**Check:**
1. Verify the calendar ID in `calendar-config.json` matches the Outlook calendar
2. Make sure you have write permissions to that calendar
3. Try exporting to a different calendar name

---

### Problem: Rate Limiting

**Error:**
```
429 Too Many Requests
```

**Solution:** Use smaller batches with delays:

```bash
node export-to-graph.js "CALENDAR_NAME" --batch-size=5 --delay=2000
```

---

## Example Workflows

### Workflow 1: Testing a New Calendar

```bash
# Step 1: Check what events exist
node export-to-graph.js "TempleEventsSandbox@emanuelnyc.org" --dry-run

# Step 2: Test with 1 event
node export-to-graph.js "TempleEventsSandbox@emanuelnyc.org" --limit=1

# Step 3: Check Outlook - verify event appears correctly

# Step 4: Export all events
node export-to-graph.js "TempleEventsSandbox@emanuelnyc.org"
```

### Workflow 2: Importing Specific Date Range

```bash
# Export only November 2025 events
node export-to-graph.js "stephen.fang@emanuelnyc.org" \
  --start-date=2025-11-01 \
  --end-date=2025-11-30
```

### Workflow 3: Large Import (Conservative)

```bash
# For 100+ events, use smaller batches
node export-to-graph.js "TempleEvents@emanuelnyc.org" \
  --batch-size=10 \
  --delay=1000
```

---

## Quick Reference: Calendar Names

From your `calendar-config.json`:

```
stephen.fang@emanuelnyc.org
TempleEvents@emanuelnyc.org
TempleEventsSandbox@emanuelnyc.org
vacations@emanuelnyc.org
RemoteWorkDays@emanuelnyc.org
templeregistrations@emanuelnyc.org
templeeventregistrationssandbox@emanuelnyc.org
templesandbox@emanuelnyc.org
```

---

## Notes

- **Duplicate Prevention:** Events include an extended property with the MongoDB `eventId` for duplicate detection
- **Batch Size:** Maximum 20 events per batch (Graph API limit)
- **Default Delay:** 500ms between batches to avoid rate limiting
- **Token Security:** Never commit your token to git. It's in `.env` which is gitignored.
- **Token Refresh:** Get a new token every time you need to run the export (they expire in 1 hour)

---

## Need Help?

1. Check the [Troubleshooting](#troubleshooting) section above
2. Run with `--dry-run` to see what will happen before making changes
3. Test with `--limit=1` before doing large exports
4. Check MongoDB Compass to verify event data structure
