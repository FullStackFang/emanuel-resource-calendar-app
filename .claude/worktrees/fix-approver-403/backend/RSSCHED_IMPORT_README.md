# Resource Scheduler Import Script

Import events from Resource Scheduler (rsSched) CSV exports into MongoDB with automatic location matching.

## Quick Start

```bash
cd backend

# Test import (10 records)
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --file=Rsched_All_with_LocationCode_v2.csv --test

# Clear test records
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --clear-test

# Full import
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --file=Rsched_All_with_LocationCode_v2.csv
```

## Commands

### Import Events

```bash
node import-rssched.js "<CalendarName>" --file=<filename.csv> [options]
```

### Clear All Events for Calendar

```bash
node import-rssched.js "<CalendarName>" --clear
```

Deletes all events matching the calendar ID. Uses batched deletion to avoid Cosmos DB rate limits.

### Clear Test Records Only

```bash
node import-rssched.js "<CalendarName>" --clear-test
```

Deletes only events with `isTest: true` marker.

## Options

| Option | Description |
|--------|-------------|
| `--file=<name>` | CSV file in `csv-imports/` folder |
| `--clear` | Clear all events for this calendar (standalone or before import) |
| `--clear-test` | Clear only test records |
| `--test` | Test mode: import limited records with `isTest: true` marker |
| `--test-limit=N` | Number of test records (default: 10) |
| `--dry-run` | Preview without making changes |
| `--batch-size=N` | Records per MongoDB batch (default: 500) |
| `--delay=N` | Milliseconds between MongoDB batches (default: 0) |

### Publish to Outlook Options

| Option | Description |
|--------|-------------|
| `--publish` | Publish events to Outlook after MongoDB import |
| `--publish-only` | Publish existing MongoDB events (no CSV import needed) |
| `--unpublish` | Delete published events from Outlook (keeps MongoDB records) |
| `--publish-limit=N` | Limit how many events to publish (for incremental testing) |
| `--access-token=TOKEN` | Graph API token (or set `GRAPH_ACCESS_TOKEN` in .env) |
| `--graph-batch-size=N` | Events per Graph API batch (default: 20, max: 20) |
| `--graph-delay=N` | Milliseconds between Graph batches (default: 500) |

## Available Calendars

Calendars are configured in `backend/calendar-config.json`:

- `TempleEvents@emanuelnyc.org` - Production calendar
- `TempleEventsSandbox@emanuelnyc.org` - Sandbox for testing
- `stephen.fang@emanuelnyc.org` - Personal calendar
- Others as configured

## CSV Format

The CSV should include these columns from Resource Scheduler:

| Column | Description |
|--------|-------------|
| `rsId` | Resource Scheduler event ID |
| `Subject` | Event title |
| `StartDateTime` | Start date/time |
| `EndDateTime` | End date/time |
| `rsKey` | Location code (matches `rsKey` in templeEvents__Locations) |
| `Location` | Location display name |
| `Categories` | Event category |
| `Description` | Event description |
| `AllDayEvent` | 1 = all day, 0 = timed |
| `Deleted` | 1 = deleted (skipped during import) |
| `AttendeeEmails` | Comma-separated attendee emails |
| `AttendeeNames` | Comma-separated attendee names |

Place CSV files in `backend/csv-imports/` folder.

## Data Structure

Imported events have this structure:

```javascript
{
  eventId: "rssched-{rsId}",
  source: "rsSched",
  isTest: true,  // Only if --test flag used
  calendarId: "AAMkADgw...",  // Graph calendar ID
  calendarName: "TempleEventsSandbox@emanuelnyc.org",  // Human-readable calendar name

  // Matched location ObjectIds
  locations: [ObjectId("...")],
  locationDisplayNames: "Room Name",

  // All rsSched data preserved
  rschedData: {
    rsId: -1999899938,
    subject: "Event Title",
    rsKey: "CPL",
    location: "Beth-El Chapel",
    categories: "Services",
    // ... all other fields
  },

  // Graph-compatible structure for UI
  graphData: {
    id: "AAMkAGI2...",  // Outlook event ID (set after publish)
    subject: "Event Title",
    start: { dateTime: "...", timeZone: "UTC" },
    end: { dateTime: "...", timeZone: "UTC" },
    // ...
  },

  // Publish tracking
  publishedAt: "2025-12-20T10:30:00.000Z"  // When event was published to Outlook
}
```

## Location Matching

The script matches `rsKey` from CSV to `rsKey` in `templeEvents__Locations`:

- `CPL` → Beth-El Chapel
- `402` → Room 402 - Leventritt
- `MAIN` → Main Sanctuary

Unmatched location codes are reported in the import summary.

## Examples

### Test Workflow

```bash
# 1. Dry run to preview
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --file=data.csv --test --dry-run

# 2. Import 10 test records
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --file=data.csv --test

# 3. Verify in the app

# 4. Clear test records
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --clear-test

# 5. Full import
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --file=data.csv
```

### Production Import (Two-Step)

Recommended approach: import to MongoDB first, then publish to Outlook separately.

```bash
# Step 1: Clear any existing events for this calendar
node import-rssched.js "TempleEvents@emanuelnyc.org" --clear

# Step 2: Import all events to MongoDB (with rate limiting for Cosmos DB)
node import-rssched.js "TempleEvents@emanuelnyc.org" --file=data.csv --batch-size=100 --delay=500

# Step 3: Publish to Outlook (requires fresh Graph token for target calendar)
node import-rssched.js "TempleEvents@emanuelnyc.org" --publish-only --graph-delay=1000
```

**Recommended rate limits for large imports (80K+ records):**
- `--batch-size=100` - 100 records per MongoDB batch
- `--delay=500` - 500ms between MongoDB batches
- `--graph-delay=1000` - 1000ms between Graph API batches
- For 82K records: ~14 minutes MongoDB import, ~70 minutes Outlook publish

If still hitting rate limits, use more conservative settings:
- `--batch-size=50 --delay=1000`

This approach allows you to:
- Verify MongoDB data before publishing
- Retry publishing if token expires (just run `--publish-only` again)
- Resume publishing if interrupted (already-published events are skipped)

### Production Import (One-Step)

If you prefer to do it all at once:

```bash
# Clear, import, and publish in one command
node import-rssched.js "TempleEvents@emanuelnyc.org" --file=data.csv --clear --publish --batch-size=100 --delay=500 --graph-delay=1000
```

### Publish to Outlook

```bash
# Test: Import 10 records and publish to Outlook
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --file=data.csv --test --publish

# Full import with publish (82K events = ~70 minutes)
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --file=data.csv --publish --graph-delay=1000

# With slower rate to avoid throttling
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --file=data.csv --publish --graph-delay=2000
```

### Publish Existing Events (No Re-import)

```bash
# Publish events already in MongoDB that haven't been published yet
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --publish-only

# Publish only test records
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --publish-only --test

# Dry run to see what would be published
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --publish-only --dry-run
```

### Incremental Publishing (Safe Testing)

Publish in small batches to test before committing to a full run:

```bash
# Step 1: Publish first 10 events
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --publish-only --publish-limit=10

# Step 2: Verify in Outlook, then publish next 20
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --publish-only --publish-limit=20

# Step 3: Publish next 100
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --publish-only --publish-limit=100

# Step 4: When confident, publish all remaining
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --publish-only --graph-delay=1000
```

Already-published events are automatically skipped, so you can safely run multiple times.

### Unpublish (Delete from Outlook)

```bash
# Delete all published events from Outlook (keeps MongoDB records)
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --unpublish

# Unpublish only test records
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --unpublish --test

# Dry run to see what would be deleted
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --unpublish --dry-run
```

Events deleted via `--unpublish` have their `graphData.id` cleared, so they can be re-published later with `--publish-only`.

### Full Cleanup (Outlook + MongoDB)

**Important:** Always unpublish from Outlook first, then clear MongoDB.

```bash
# Step 1: Delete from Outlook (needs graphData.id from MongoDB)
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --unpublish

# Step 2: Clear from MongoDB
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --clear
```

For test records only:

```bash
# Step 1: Delete test records from Outlook
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --unpublish --test

# Step 2: Clear test records from MongoDB
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --clear-test
```

If you clear MongoDB first, you lose the `graphData.id` references and cannot unpublish - events will be orphaned in Outlook.

## Getting a Graph API Token

The `--publish` option requires a delegated Graph API token.

**IMPORTANT:** The Graph token MUST match the calendar you're publishing to. The script uses `/me/calendar/events` which targets whoever's token is authenticated.

- Publishing to `TempleEventsSandbox@emanuelnyc.org`? Log in as TempleEventsSandbox
- Publishing to `stephen.fang@emanuelnyc.org`? Log in as stephen.fang

### How to Get the Token

1. Log into the app at `https://localhost:5173` **as the calendar owner**
2. Open browser DevTools (F12)
3. Go to **Application** > **Session Storage**
4. Find the MSAL token entry for `graph.microsoft.com`
5. Copy the `accessToken` value

Either:
- Add to `.env`: `GRAPH_ACCESS_TOKEN=eyJ0...`
- Or pass via command line: `--access-token=eyJ0...`

**Note:** Tokens expire after ~1 hour. For large imports, you may need to refresh.

### Import More Test Records

```bash
node import-rssched.js "TempleEventsSandbox@emanuelnyc.org" --file=data.csv --test --test-limit=50
```

## Troubleshooting

### Rate Limit Errors (16500)

Cosmos DB has RU/s limits. Use smaller batches and delays:

```bash
# Recommended for large imports
node import-rssched.js "Calendar" --file=data.csv --batch-size=100 --delay=500

# More conservative if still hitting limits
node import-rssched.js "Calendar" --file=data.csv --batch-size=50 --delay=1000
```

**Note:** If you see "Partial - X inserted, some failed" with rate limit messages, stop the import (Ctrl+C), clear the partial data with `--clear`, then restart with slower settings.

### Graph API Rate Limits (429 - MailboxConcurrency)

If you see "Application is over its MailboxConcurrency limit":

```bash
# Stop current run (Ctrl+C) and restart with longer delays
node import-rssched.js "Calendar" --publish-only --graph-delay=1000

# For very large imports, use even longer delays
node import-rssched.js "Calendar" --publish-only --graph-delay=2000
```

Already-published events are automatically skipped, so you can safely resume where you left off.

### BOM in CSV

The script automatically strips UTF-8 BOM from CSV headers.

### Missing rsKey Matches

Check that locations have `rsKey` field populated in `templeEvents__Locations` collection.
