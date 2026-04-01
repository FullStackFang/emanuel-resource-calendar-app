/**
 * Diagnostic script to check what extended properties exist in calendar events
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const GRAPH_ACCESS_TOKEN = process.env.GRAPH_ACCESS_TOKEN;

// Load calendar config
const CALENDAR_CONFIG_PATH = path.join(__dirname, 'calendar-config.json');
const calendarConfig = JSON.parse(fs.readFileSync(CALENDAR_CONFIG_PATH, 'utf8'));
const CALENDAR_ID = calendarConfig['TempleEventsSandbox@emanuelnyc.org'];

async function checkCalendarProperties() {
  console.log('Checking calendar events for extended properties...\n');

  const url = `https://graph.microsoft.com/v1.0/me/calendars/${CALENDAR_ID}/events`;
  const params = new URLSearchParams({
    '$select': 'subject,start,singleValueExtendedProperties',
    '$expand': 'singleValueExtendedProperties',
    '$top': '10', // Just check first 10 events
    '$filter': 'start/dateTime ge \'2025-01-01T00:00:00Z\' and start/dateTime le \'2025-01-05T23:59:59Z\''
  });

  const response = await fetch(`${url}?${params}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${GRAPH_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    console.error(`Error: ${response.status} ${response.statusText}`);
    const text = await response.text();
    console.error(text);
    return;
  }

  const data = await response.json();

  console.log(`Found ${data.value.length} events in January 1-5:\n`);

  data.value.forEach((event, idx) => {
    console.log(`${idx + 1}. ${event.subject}`);
    console.log(`   Start: ${event.start.dateTime}`);

    if (event.singleValueExtendedProperties && event.singleValueExtendedProperties.length > 0) {
      console.log(`   Extended Properties:`);
      event.singleValueExtendedProperties.forEach(prop => {
        console.log(`      ${prop.id}: ${prop.value}`);
      });
    } else {
      console.log(`   ❌ NO EXTENDED PROPERTIES FOUND`);
    }
    console.log('');
  });
}

checkCalendarProperties().catch(console.error);
