/**
 * Quick CSV Import Script
 * Run with: node quick-csv-import.js <calendarName>
 * Example: node quick-csv-import.js "Temple Emanu-El Sandbox"
 */

const fs = require('fs');
const csv = require('csv-parser');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Get command-line arguments
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('❌ Error: Missing required calendar name');
  console.log('\nUsage: node quick-csv-import.js <calendarName>');
  console.log('Example: node quick-csv-import.js "Temple Emanu-El Sandbox"');
  process.exit(1);
}

const TARGET_CALENDAR_NAME = args[0];

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
function findCSVFile() {
  if (!fs.existsSync(CSV_IMPORT_FOLDER)) {
    console.error(`❌ Error: Folder not found: ${CSV_IMPORT_FOLDER}`);
    console.log('\nPlease create the folder:');
    console.log(`  mkdir ${CSV_IMPORT_FOLDER}`);
    process.exit(1);
  }

  const files = fs.readdirSync(CSV_IMPORT_FOLDER);
  const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));

  if (csvFiles.length === 0) {
    console.error(`❌ Error: No CSV file found in ${CSV_IMPORT_FOLDER}`);
    console.log('\nPlease add a CSV file to the csv-imports folder');
    process.exit(1);
  }

  if (csvFiles.length > 1) {
    console.error(`❌ Error: Multiple CSV files found in ${CSV_IMPORT_FOLDER}`);
    console.log('\nFound files:');
    csvFiles.forEach(f => console.log(`  - ${f}`));
    console.log('\nPlease keep only one CSV file in the folder');
    process.exit(1);
  }

  return path.join(CSV_IMPORT_FOLDER, csvFiles[0]);
}

// Your user ID
const USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';

async function importCSV() {
  const CSV_FILE_PATH = findCSVFile();

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

          // Create event object matching your MongoDB structure
          const event = {
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

    // Insert into MongoDB
    console.log('Inserting events into MongoDB...');
    const result = await collection.insertMany(events);

    console.log(`\n✅ SUCCESS! Inserted ${result.insertedCount} events`);
    console.log('Event IDs:', Object.values(result.insertedIds).map(id => id.toString()));

  } catch (error) {
    console.error('❌ Error during import:', error);
  } finally {
    await client.close();
    console.log('\nMongoDB connection closed');
  }
}

// Run the import
importCSV().catch(console.error);
