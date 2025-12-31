/**
 * Compare MongoDB events vs Calendar events for specific subjects
 */
require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const GRAPH_ACCESS_TOKEN = process.env.GRAPH_ACCESS_TOKEN;
const MONGODB_CONNECTION_STRING = process.env.MONGODB_CONNECTION_STRING;

// Load calendar config
const CALENDAR_CONFIG_PATH = path.join(__dirname, 'calendar-config.json');
const calendarConfig = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
const CALENDAR_ID = calendarConfig['TempleEventsSandbox@emanuelnyc.org'];
const USER_ID = '69fda879-0c61-4aa5-b02d-cad292c0777e';

const subjectsToCheck = [
  'Winter Recess',
  'CLOSED - Ramp railing construction'
];

function buildMatchingKey(eventData) {
  if (!eventData) return null;

  const subject = (eventData.subject || '').trim().toLowerCase();

  let startTime = eventData.start?.dateTime || '';
  if (startTime) {
    startTime = startTime.split('.')[0].replace('Z', '').replace(/[+-]\d{2}:\d{2}$/, '');

    // For all-day events, use only date
    if (eventData.isAllDay === true) {
      startTime = startTime.split('T')[0];
    }
  }

  const location = (eventData.location?.displayName || '').trim().toLowerCase();
  const categories = (eventData.categories || []).map(c => c.toLowerCase()).sort().join('|');

  return `${subject}|||${startTime}|||${location}|||${categories}`;
}

async function compareEvents() {
  console.log('Comparing MongoDB vs Calendar events...\n');

  // Connect to MongoDB
  const client = new MongoClient(MONGODB_CONNECTION_STRING);
  await client.connect();
  const db = client.db('emanuelnyc');
  const collection = db.collection('templeEvents__Events');

  for (const subject of subjectsToCheck) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Subject: "${subject}"`);
    console.log('='.repeat(80));

    // Get from MongoDB
    const mongoEvents = await collection.find({
      userId: USER_ID,
      calendarId: CALENDAR_ID,
      'graphData.subject': subject,
      'graphData.start.dateTime': {
        $gte: '2025-01-01T00:00:00',
        $lte: '2025-01-04T23:59:59'
      },
      isDeleted: { $ne: true }
    }).toArray();

    console.log(`\nMongoDB (${mongoEvents.length} events):`);
    mongoEvents.forEach((event, idx) => {
      console.log(`  ${idx + 1}. ${event.graphData.subject}`);
      console.log(`     Start: ${event.graphData.start.dateTime}`);
      console.log(`     Location: ${event.graphData.location?.displayName || 'N/A'}`);
      console.log(`     Categories: ${(event.graphData.categories || []).join(', ')}`);
      console.log(`     Key: ${buildMatchingKey(event.graphData)}`);
    });

    // Get from Calendar
    const url = `https://graph.microsoft.com/v1.0/me/calendars/${CALENDAR_ID}/events`;
    const params = new URLSearchParams({
      '$select': 'subject,start,location,categories',
      '$filter': `startswith(subject,'${subject}') and start/dateTime ge '2025-01-01T00:00:00' and start/dateTime le '2025-01-04T23:59:59'`,
      '$top': '10'
    });

    const response = await fetch(`${url}?${params}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${GRAPH_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.log(`\n❌ Calendar: Failed to fetch (${response.status})`);
      continue;
    }

    const data = await response.json();
    console.log(`\nCalendar (${data.value.length} events):`);
    data.value.forEach((event, idx) => {
      console.log(`  ${idx + 1}. ${event.subject}`);
      console.log(`     Start: ${event.start.dateTime}`);
      console.log(`     Location: ${event.location?.displayName || 'N/A'}`);
      console.log(`     Categories: ${(event.categories || []).join(', ')}`);
      console.log(`     Key: ${buildMatchingKey(event)}`);
    });
  }

  await client.close();
  console.log('\n');
}

compareEvents().catch(console.error);
