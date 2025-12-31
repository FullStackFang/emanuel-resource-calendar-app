/**
 * Quick CSV Import Script
 * Run with: node quick-csv-import.js <calendarName> [--file=filename.csv] [--batch-size=N] [--delay=N]
 *
 * Examples:
 *   node quick-csv-import.js "target_calendar@emanuelnyc.org"
 *   node quick-csv-import.js "target_calendar@emanuelnyc.org" --file=events-2025.csv
 *   node quick-csv-import.js "target_calendar@emanuelnyc.org" --file=import.csv --batch-size=1000
 *   node quick-csv-import.js "target_calendar@emanuelnyc.org" --batch-size=100 --delay=500
 *   node quick-csv-import.js "target_calendar@emanuelnyc.org" --file=data.csv --batch-size=50 --delay=1000
 *
 * Options:
 *   --file=filename   Specific CSV file to import from csv-imports folder (optional)
 *   --batch-size=N    Number of records per batch (default: 500, max: 10000)
 *   --delay=N         Milliseconds to wait between batches (helps avoid rate limits)
 */

const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Get command-line arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('❌ Error: Missing required calendar name');
  console.log('\nUsage: node quick-csv-import.js <calendarName> [--batch-size=N]');
  console.log('\nExamples:');
  console.log('  node quick-csv-import.js "Temple Emanu-El Sandbox"');
  console.log('  node quick-csv-import.js "Temple Events" --batch-size=1000');
  console.log('\nOptions:');
  console.log('  --batch-size=N    Number of records per batch (default: 500, max: 10000)');
  process.exit(1);
}

const TARGET_CALENDAR_NAME = args[0];

// Parse file name from command-line arguments
let SPECIFIED_FILE = null;
const fileArg = args.find(arg => arg.startsWith('--file='));
if (fileArg) {
  SPECIFIED_FILE = fileArg.split('=')[1];
  if (!SPECIFIED_FILE || SPECIFIED_FILE.trim() === '') {
    console.error('❌ Error: Invalid file name. Please provide a valid CSV file name.');
    process.exit(1);
  }
  console.log(`Using specified file: ${SPECIFIED_FILE}`);
}

// Parse batch size from command-line arguments
let BATCH_SIZE = 500; // Default batch size
const batchSizeArg = args.find(arg => arg.startsWith('--batch-size='));
if (batchSizeArg) {
  const parsedSize = parseInt(batchSizeArg.split('=')[1]);
  if (isNaN(parsedSize) || parsedSize < 1) {
    console.error('❌ Error: Invalid batch size. Must be a positive integer.');
    process.exit(1);
  }
  if (parsedSize > 10000) {
    console.error('❌ Error: Batch size too large. Maximum is 10,000 records per batch.');
    process.exit(1);
  }
  BATCH_SIZE = parsedSize;
  console.log(`Using batch size: ${BATCH_SIZE} records per batch`);
}

// Parse delay from command-line arguments
let DELAY_BETWEEN_BATCHES = 0; // Default: no delay
const delayArg = args.find(arg => arg.startsWith('--delay='));
if (delayArg) {
  const parsedDelay = parseInt(delayArg.split('=')[1]);
  if (isNaN(parsedDelay) || parsedDelay < 0) {
    console.error('❌ Error: Invalid delay. Must be a non-negative integer (milliseconds).');
    process.exit(1);
  }
  DELAY_BETWEEN_BATCHES = parsedDelay;
  console.log(`Using delay between batches: ${DELAY_BETWEEN_BATCHES}ms`);
}

// Load calendar config
const CALENDAR_CONFIG_PATH = require('path').join(__dirname, 'calendar-config.json');
let calendarConfig = {};

try {
  calendarConfig = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
} catch (error) {
  console.error('❌ Error: Could not read calendar-config.json');
  console.log('\nPlease create backend/calendar-config.json with your calendar mappings');
  process.exit(1);
}

const path = require('path');
const CSV_IMPORT_FOLDER = path.join(__dirname, 'csv-imports');
const MONGODB_CONNECTION_STRING = process.env.MONGODB_CONNECTION_STRING;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || 'emanuelnyc';

// Find CSV file in the csv-imports folder
function findCSVFile(specifiedFile = null) {
  if (!fs.existsSync(CSV_IMPORT_FOLDER)) {
    console.error(`❌ Error: Folder not found: ${CSV_IMPORT_FOLDER}`);
    console.log('\nPlease create the folder:');
    console.log(`  mkdir ${CSV_IMPORT_FOLDER}`);
    process.exit(1);
  }

  // If a specific file is specified, use that
  if (specifiedFile) {
    const filePath = path.join(CSV_IMPORT_FOLDER, specifiedFile);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Error: Specified file not found: ${specifiedFile}`);
      console.log(`\nLooked in: ${CSV_IMPORT_FOLDER}`);

      // Show available files
      const files = fs.readdirSync(CSV_IMPORT_FOLDER);
      const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));
      if (csvFiles.length > 0) {
        console.log('\nAvailable CSV files:');
        csvFiles.forEach(f => console.log(`  - ${f}`));
      } else {
        console.log('\nNo CSV files found in the folder.');
      }
      process.exit(1);
    }
    return filePath;
  }

  // Otherwise, auto-detect (original behavior)
  const files = fs.readdirSync(CSV_IMPORT_FOLDER);
  const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));

  if (csvFiles.length === 0) {
    console.error(`❌ Error: No CSV file found in ${CSV_IMPORT_FOLDER}`);
    console.log('\nPlease add a CSV file to the csv-imports folder');
    console.log('Or specify a file with --file=filename.csv');
    process.exit(1);
  }

  if (csvFiles.length > 1) {
    console.error(`❌ Error: Multiple CSV files found in ${CSV_IMPORT_FOLDER}`);
    console.log('\nFound files:');
    csvFiles.forEach(f => console.log(`  - ${f}`));
    console.log('\nPlease either:');
    console.log('  1. Keep only one CSV file in the folder, OR');
    console.log('  2. Specify which file to import with --file=filename.csv');
    process.exit(1);
  }

  return path.join(CSV_IMPORT_FOLDER, csvFiles[0]);
}

// Your user ID
const USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';

// Helper function to sleep/delay
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function importCSV() {
  const CSV_FILE_PATH = findCSVFile(SPECIFIED_FILE);

  console.log('Starting CSV import...');
  console.log('CSV file:', CSV_FILE_PATH);
  console.log('Target calendar:', TARGET_CALENDAR_NAME);

  // Look up calendar ID from config
  const TARGET_CALENDAR_ID = calendarConfig[TARGET_CALENDAR_NAME];

  if (!TARGET_CALENDAR_ID) {
    console.error(`\n❌ Error: Calendar "${TARGET_CALENDAR_NAME}" not found in calendar-config.json`);
    console.log('\nAvailable calendars in config:');
    Object.keys(calendarConfig)
      .filter(key => !key.startsWith('_'))
      .forEach(name => console.log(`  - ${name}`));
    console.log('\nTo add a new calendar:');
    console.log('  1. Open backend/calendar-config.json');
    console.log('  2. Add: "Your Calendar Name": "AAMkADgw..."');
    console.log('  3. Get the calendar ID from MongoDB Compass or the frontend console');
    process.exit(1);
  }

  console.log(`✓ Found calendar ID: ${TARGET_CALENDAR_ID.substring(0, 20)}...`);

  if (!MONGODB_CONNECTION_STRING) {
    console.error('❌ Error: MONGODB_CONNECTION_STRING not found in .env file');
    console.log('\nPlease check that backend/.env has:');
    console.log('  MONGODB_CONNECTION_STRING=your_connection_string');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_CONNECTION_STRING);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(DB_NAME);
    const collection = db.collection('templeEvents__Events');

    const events = [];

    // Read and parse CSV
    await new Promise((resolve, reject) => {
      fs.createReadStream(CSV_FILE_PATH)
        .pipe(csv())
        .on('data', (row) => {
          console.log('Processing row:', row.Subject || row.subject);

          // Parse dates
          const startDateTime = new Date(row.StartDateTime);
          const endDateTime = new Date(row.EndDateTime);

          // Generate unique eventId from rsId (or fallback to timestamp + random)
          const eventId = row.rsId
            ? `csv-import-rsId-${row.rsId}`
            : `csv-import-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // Create event object matching your MongoDB structure
          const event = {
            eventId: eventId,
            userId: USER_ID,
            source: 'Resource Scheduler Import',
            isDeleted: row.Deleted === '1' || row.Deleted === 1,
            graphData: {
              subject: row.Subject,
              start: {
                dateTime: startDateTime.toISOString(),
                timeZone: 'UTC'
              },
              end: {
                dateTime: endDateTime.toISOString(),
                timeZone: 'UTC'
              },
              location: row.Location ? {
                displayName: row.Location,
                locationType: 'default'
              } : undefined,
              categories: row.Categories ? [row.Categories] : [],
              bodyPreview: row.Description || '',
              isAllDay: row.AllDayEvent === '1' || row.AllDayEvent === 1,
              importance: 'normal',
              showAs: 'busy',
              sensitivity: 'normal',
              organizer: {
                emailAddress: {
                  name: 'Resource Scheduler Import',
                  address: 'import@system.local'
                }
              },
              attendees: [],
              extensions: [],
              singleValueExtendedProperties: []
            },
            internalData: {
              rsId: row.rsId ? row.rsId.toString() : null,
              mecCategories: [],
              setupMinutes: 0,
              teardownMinutes: 0,
              registrationNotes: '',
              assignedTo: '',
              staffAssignments: [],
              internalNotes: '',
              setupStatus: 'pending',
              estimatedCost: null,
              actualCost: null,
              customFields: {},
              createRegistrationEvent: null,
              isCSVImport: true,
              isRegistrationEvent: false,
              linkedMainEventId: null,
              importedAt: new Date()
            },
            lastModifiedDateTime: new Date(),
            lastSyncedAt: new Date(),
            calendarId: TARGET_CALENDAR_ID,
            sourceCalendars: [{
              calendarId: TARGET_CALENDAR_ID,
              calendarName: TARGET_CALENDAR_NAME,
              role: 'primary'
            }],
            cachedAt: new Date(),
            lastAccessedAt: new Date()
          };

          // Skip deleted events
          if (!event.isDeleted) {
            events.push(event);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`\nParsed ${events.length} events from CSV`);

    if (events.length === 0) {
      console.log('No events to import');
      return;
    }

    // Insert into MongoDB using batched processing
    console.log(`Inserting events into MongoDB (batch size: ${BATCH_SIZE})...`);

    const totalBatches = Math.ceil(events.length / BATCH_SIZE);
    let totalInserted = 0;
    let totalFailed = 0;
    const batchErrors = [];
    const startTime = Date.now();

    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = events.slice(i, i + BATCH_SIZE);
      const batchStart = i + 1;
      const batchEnd = Math.min(i + BATCH_SIZE, events.length);

      console.log(`\n📦 Processing batch ${batchNum}/${totalBatches} (records ${batchStart}-${batchEnd})...`);

      // Retry logic for rate limiting
      const MAX_RETRIES = 3;
      let retryCount = 0;
      let retryDelay = 1000; // Start with 1 second
      let batchSuccess = false;

      while (retryCount <= MAX_RETRIES && !batchSuccess) {
        try {
          const batchStartTime = Date.now();
          const result = await collection.insertMany(batch, { ordered: false });
          const batchDuration = Date.now() - batchStartTime;

          totalInserted += result.insertedCount;
          console.log(`   ✅ Inserted ${result.insertedCount} events in ${batchDuration}ms`);
          console.log(`   📊 Progress: ${totalInserted}/${events.length} events (${Math.round(totalInserted/events.length*100)}%)`);
          batchSuccess = true;

        } catch (error) {
          // Detect Cosmos DB rate limiting (Error 16500)
          const isRateLimitError = error.code === 16500 ||
                                   error.message.includes('16500') ||
                                   error.message.includes('Request rate is large');

          // insertMany with ordered:false will insert valid documents even if some fail
          const insertedCount = error.result?.insertedCount || 0;
          const failedCount = batch.length - insertedCount;

          totalInserted += insertedCount;
          totalFailed += failedCount;

          // If rate limited and retries remaining, retry after delay
          if (isRateLimitError && retryCount < MAX_RETRIES) {
            retryCount++;
            console.log(`   ⚠️  RATE LIMIT HIT: Azure Cosmos DB throttled this batch`);
            console.log(`   🔄 Retry ${retryCount}/${MAX_RETRIES} after ${retryDelay}ms...`);
            await sleep(retryDelay);
            retryDelay *= 2; // Exponential backoff

            // Reset counters for retry
            totalInserted -= insertedCount;
            totalFailed -= failedCount;
            continue; // Retry the batch
          }

          // Max retries reached or different error
          batchErrors.push({
            batch: batchNum,
            range: `${batchStart}-${batchEnd}`,
            inserted: insertedCount,
            failed: failedCount,
            error: error.message,
            isRateLimit: isRateLimitError
          });

          console.log(`   ⚠️  Batch ${batchNum} partial failure: ${insertedCount} inserted, ${failedCount} failed`);

          if (isRateLimitError) {
            console.log(`   💡 Rate limit error detected. Try using:`);
            console.log(`      - Smaller batch size: --batch-size=100 or --batch-size=50`);
            console.log(`      - Add delay: --delay=500 or --delay=1000`);
          }

          console.log(`   📊 Progress: ${totalInserted}/${events.length} events (${Math.round(totalInserted/events.length*100)}%)`);
          batchSuccess = true; // Exit retry loop
        }
      }

      // Add delay between batches if specified (and not the last batch)
      if (DELAY_BETWEEN_BATCHES > 0 && i + BATCH_SIZE < events.length) {
        console.log(`   ⏱️  Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
        await sleep(DELAY_BETWEEN_BATCHES);
      }
    }

    const totalDuration = Date.now() - startTime;
    const avgPerRecord = Math.round(totalDuration / events.length);

    console.log('\n' + '='.repeat(60));
    console.log('📋 IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total records parsed:    ${events.length}`);
    console.log(`Successfully inserted:   ${totalInserted} ✅`);
    console.log(`Failed:                  ${totalFailed} ❌`);
    console.log(`Total batches:           ${totalBatches}`);
    console.log(`Batch size:              ${BATCH_SIZE}`);
    console.log(`Total time:              ${(totalDuration/1000).toFixed(2)}s`);
    console.log(`Avg time per record:     ${avgPerRecord}ms`);
    console.log('='.repeat(60));

    if (batchErrors.length > 0) {
      console.log('\n⚠️  BATCH ERRORS:');
      batchErrors.forEach(err => {
        const errorType = err.isRateLimit ? '[RATE LIMIT]' : '[ERROR]';
        console.log(`   ${errorType} Batch ${err.batch} (records ${err.range}): ${err.failed} failed - ${err.error}`);
      });

      const rateLimitErrors = batchErrors.filter(e => e.isRateLimit).length;
      if (rateLimitErrors > 0) {
        console.log('\n💡 RATE LIMIT RECOMMENDATIONS:');
        console.log('   Your Azure Cosmos DB is throttling requests due to RU/s limits.');
        console.log('   Try re-running with these settings:');
        console.log('   - node quick-csv-import.js "Calendar Name" --batch-size=100 --delay=500');
        console.log('   - node quick-csv-import.js "Calendar Name" --batch-size=50 --delay=1000');
        console.log('   Or increase your Cosmos DB provisioned throughput in Azure Portal.');
      }
    }

    if (totalInserted > 0) {
      console.log(`\n✅ SUCCESS! Inserted ${totalInserted} events into MongoDB`);
    }

    if (totalFailed > 0) {
      console.log(`\n⚠️  WARNING: ${totalFailed} events failed to import. Check errors above.`);
    }

  } catch (error) {
    console.error('❌ Error during import:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('\nMongoDB connection closed');
  }
}

// Run the import
importCSV().catch(console.error);
