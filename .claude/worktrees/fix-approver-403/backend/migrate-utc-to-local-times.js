/**
 * Migration Script: Convert UTC times to America/New_York local times
 *
 * Fixes ALL time fields including setupTime, doorOpenTime, doorCloseTime, teardownTime
 *
 * Usage:
 *   node migrate-utc-to-local-times.js --dry-run   # Preview changes
 *   node migrate-utc-to-local-times.js             # Apply changes
 *   node migrate-utc-to-local-times.js --limit 10  # Process only 10 records
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

const DRY_RUN = process.argv.includes('--dry-run');

let LIMIT = null;
const limitIndex = process.argv.indexOf('--limit');
if (limitIndex !== -1 && process.argv[limitIndex + 1]) {
  LIMIT = parseInt(process.argv[limitIndex + 1], 10);
  if (isNaN(LIMIT) || LIMIT <= 0) {
    console.error('Error: --limit must be a positive number');
    process.exit(1);
  }
}

const MONGODB_URI = process.env.MONGODB_CONNECTION_STRING || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DATABASE_NAME || process.env.DB_NAME || 'templeEventsDB';

// Progress bar helper
function progressBar(current, total, width = 40) {
  const percent = current / total;
  const filled = Math.round(width * percent);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  process.stdout.write(`\r[${bar}] ${current}/${total} (${Math.round(percent * 100)}%)`);
}

// Convert UTC datetime to America/New_York local time
function convertUtcToLocal(utcDateTimeStr) {
  if (!utcDateTimeStr) return null;
  if (!utcDateTimeStr.endsWith('Z') && !utcDateTimeStr.includes('+')) return null;

  try {
    const utcDate = new Date(utcDateTimeStr);
    if (isNaN(utcDate.getTime())) return null;

    const options = {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    };

    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const parts = formatter.formatToParts(utcDate);
    const get = (type) => parts.find(p => p.type === type)?.value || '00';

    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
  } catch (err) {
    return null;
  }
}

// Convert HH:MM time from UTC to America/New_York using a reference date
function convertTimeOnly(timeStr, referenceDate) {
  if (!timeStr || !timeStr.includes(':')) return null;

  try {
    // Use the reference date to get correct DST offset
    const dateStr = referenceDate || '2026-01-15';
    const utcDateTime = `${dateStr}T${timeStr}:00Z`;
    const utcDate = new Date(utcDateTime);
    if (isNaN(utcDate.getTime())) return null;

    const options = {
      timeZone: 'America/New_York',
      hour: '2-digit', minute: '2-digit',
      hour12: false
    };

    const formatter = new Intl.DateTimeFormat('en-US', options);
    const parts = formatter.formatToParts(utcDate);
    const get = (type) => parts.find(p => p.type === type)?.value || '00';

    return `${get('hour')}:${get('minute')}`;
  } catch (err) {
    return null;
  }
}

// Extract time (HH:MM) from datetime string
function extractTime(dateTimeStr) {
  if (!dateTimeStr) return '';
  const cleanStr = dateTimeStr.replace(/Z$/, '').replace(/\.\d{3}$/, '');
  const timePart = cleanStr.split('T')[1];
  return timePart ? timePart.substring(0, 5) : '';
}

// Extract date (YYYY-MM-DD) from datetime string
function extractDate(dateTimeStr) {
  if (!dateTimeStr) return '';
  const cleanStr = dateTimeStr.replace(/Z$/, '').replace(/\.\d{3}$/, '');
  return cleanStr.split('T')[0] || '';
}

async function migrate() {
  console.log('━'.repeat(50));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  if (LIMIT) console.log(`Limit: ${LIMIT} records`);
  console.log('━'.repeat(50));

  if (!MONGODB_URI) {
    console.error('Error: MONGODB_URI not defined');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  const db = client.db(DB_NAME);
  const collection = db.collection('templeEvents__Events');

  // Find events with UTC times OR illogical time sequences (setup/door after start)
  const query = {
    $or: [
      // UTC indicators
      { startDateTime: { $regex: /Z$/ } },
      { 'graphData.start.dateTime': { $regex: /Z$/ } },
      { startTimeZone: 'UTC' },
      { 'graphData.start.timeZone': 'UTC' },
      // Illogical times: setupTime or doorOpenTime is AFTER startTime
      // (comparing as strings works for HH:MM format)
      {
        $expr: {
          $and: [
            { $ne: ['$setupTime', null] },
            { $ne: ['$setupTime', ''] },
            { $ne: ['$startTime', null] },
            { $ne: ['$startTime', ''] },
            { $gt: ['$setupTime', '$startTime'] }
          ]
        }
      },
      {
        $expr: {
          $and: [
            { $ne: ['$doorOpenTime', null] },
            { $ne: ['$doorOpenTime', ''] },
            { $ne: ['$startTime', null] },
            { $ne: ['$startTime', ''] },
            { $gt: ['$doorOpenTime', '$startTime'] }
          ]
        }
      }
    ]
  };

  let cursor = collection.find(query);
  if (LIMIT) cursor = cursor.limit(LIMIT);

  const events = await cursor.toArray();
  const total = events.length;

  console.log(`\nFound ${total} events to process\n`);

  if (total === 0) {
    console.log('No events need migration.');
    await client.close();
    return;
  }

  let updated = 0, skipped = 0, errors = 0;

  for (let i = 0; i < events.length; i++) {
    progressBar(i + 1, total);

    const event = events[i];
    const updateFields = {};

    // Check if event is marked as UTC
    const isUtcEvent = event.startTimeZone === 'UTC' ||
                       event.graphData?.start?.timeZone === 'UTC' ||
                       (event.startDateTime && event.startDateTime.endsWith('Z'));

    // Check if event has illogical times (setup/door AFTER start)
    const hasIllogicalTimes = (event.setupTime && event.startTime && event.setupTime > event.startTime) ||
                              (event.doorOpenTime && event.startTime && event.doorOpenTime > event.startTime);

    // Get reference date for time-only conversions (use event's date)
    const refDate = event.startDate || extractDate(event.startDateTime) || '2026-01-15';

    // Convert main datetime fields (if they have Z suffix)
    const newStartDateTime = convertUtcToLocal(event.startDateTime);
    const newEndDateTime = convertUtcToLocal(event.endDateTime);
    const newGraphStart = convertUtcToLocal(event.graphData?.start?.dateTime);
    const newGraphEnd = convertUtcToLocal(event.graphData?.end?.dateTime);

    if (newStartDateTime) {
      updateFields.startDateTime = newStartDateTime;
      updateFields.startDate = extractDate(newStartDateTime);
      updateFields.startTime = extractTime(newStartDateTime);
      updateFields.startTimeZone = 'America/New_York';
    }

    if (newEndDateTime) {
      updateFields.endDateTime = newEndDateTime;
      updateFields.endDate = extractDate(newEndDateTime);
      updateFields.endTime = extractTime(newEndDateTime);
      updateFields.endTimeZone = 'America/New_York';
    }

    if (newGraphStart) {
      updateFields['graphData.start.dateTime'] = newGraphStart;
      updateFields['graphData.start.timeZone'] = 'America/New_York';
    }

    if (newGraphEnd) {
      updateFields['graphData.end.dateTime'] = newGraphEnd;
      updateFields['graphData.end.timeZone'] = 'America/New_York';
    }

    // Convert standalone time fields if:
    // 1. Event is marked as UTC, OR
    // 2. Event has illogical times (setup/door after start - indicates unconverted UTC times)
    if (isUtcEvent || hasIllogicalTimes) {
      const timeFields = ['setupTime', 'doorOpenTime', 'doorCloseTime', 'teardownTime'];
      for (const field of timeFields) {
        if (event[field] && event[field].includes(':')) {
          const converted = convertTimeOnly(event[field], refDate);
          if (converted && converted !== event[field]) {
            updateFields[field] = converted;
          }
        }
      }
    }

    if (Object.keys(updateFields).length === 0) {
      skipped++;
      continue;
    }

    updateFields.migratedToLocalTime = true;
    updateFields.migratedAt = new Date();

    if (!DRY_RUN) {
      try {
        await collection.updateOne({ _id: event._id }, { $set: updateFields });
        updated++;
      } catch (err) {
        errors++;
      }
    } else {
      updated++;
    }
  }

  console.log('\n\n━'.repeat(50));
  console.log('SUMMARY');
  console.log('━'.repeat(50));
  console.log(`Total:   ${total}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors:  ${errors}`);
  if (DRY_RUN) console.log('\n*** DRY RUN - No changes made ***');
  console.log('━'.repeat(50));

  await client.close();
}

migrate().catch(console.error);
