'use strict';

/**
 * Resource Scheduler (rsched) Import Service.
 *
 * Pure-ish service module shared by the admin API endpoints and the
 * `import-rssched.js` CLI. Owns:
 *   - CSV parsing (with BOM tolerance, comma/semicolon multi-key split,
 *     US date format, all-day detection, Note1 sentinel handling).
 *   - Location resolution against templeEvents__Locations.rsKey.
 *   - Staging-row to event-document construction.
 *   - The upsert algorithm at commit time (insert / no-op / update /
 *     human-edit-conflict / skip).
 *   - Validate-time conflict and removal detection.
 *   - Outlook publish via graphApiService (app-only auth).
 *
 * No Express coupling, no req/res handling. Endpoint code in api-server.js
 * does HTTP plumbing and calls into here.
 */

const csv = require('csv-parser');
const { Readable } = require('stream');
const { ObjectId } = require('mongodb');
const ApiError = require('../utils/ApiError');
const { retryWithBackoff } = require('../utils/retryWithBackoff');
const { createExceptionDocument } = require('../utils/exceptionDocumentService');
const { conditionalUpdate: _conditionalUpdate } = require('../utils/concurrencyUtils');

const RSCHED_SOURCE = 'rsSched';
const NOTE_RSKEY_SENTINELS = new Set(['Note1', 'Note2', 'Note3']);
const STAGING_COLLECTION = 'templeEvents__RschedImportStaging';
const EVENTS_COLLECTION = 'templeEvents__Events';
const LOCATIONS_COLLECTION = 'templeEvents__Locations';
const AUDIT_COLLECTION = 'templeEvents__EventAuditHistory';

const STAGING_STATUS = Object.freeze({
  STAGED: 'staged',
  CONFLICT: 'conflict',
  UNMATCHED_LOCATION: 'unmatched_location',
  HUMAN_EDIT_CONFLICT: 'human_edit_conflict',
  SKIPPED: 'skipped',
  APPLIED: 'applied',
  FAILED: 'failed',
});

const APPLY_OUTCOME = Object.freeze({
  INSERTED: 'inserted',
  UPDATED: 'updated',
  NO_OP: 'no_op',
  SKIPPED: 'skipped',
  HUMAN_EDIT_CONFLICT: 'human_edit_conflict',
  FAILED: 'failed',
});

const MATERIAL_FIELDS = Object.freeze([
  'eventTitle',
  'eventDescription',
  'startDateTime',
  'endDateTime',
  'isAllDay',
  'locations',
  'categories',
]);

// Drift classification — populated on staging rows during validate.
// 'create'                CSV row, no Mongo match
// 'update'                CSV row, Mongo match, material diffs present
// 'no_op'                 CSV row, Mongo match, zero material diffs
// 'human_edit_conflict'   Mongo event has been edited by a human (or any non-import process)
const DRIFT_TYPE = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  NO_OP: 'no_op',
  HUMAN_EDIT_CONFLICT: 'human_edit_conflict',
});

// Truncation cap for persisted materialDiffs values. Cosmos DB has a 2MB
// per-document size limit; without a cap, a 10KB description × 80k rows
// could blow the staging document. The full diff value is re-derived at
// drift-report time from the live event + the staging row's rawCsv.
const MAX_DIFF_VALUE_LENGTH = 1000;

// =============================================================================
// CSV parsing
// =============================================================================

/**
 * Parse a CSV buffer into an array of normalized row objects.
 * Strips UTF-8 BOM, trims headers, parses dates/times, splits multi-key rsKeys.
 *
 * @param {Buffer|string} input
 * @returns {Promise<{rows: Array, parseErrors: Array}>}
 */
async function parseCsv(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const stream = Readable.from(buffer.toString('utf8'));
  const rawRows = [];

  await new Promise((resolve, reject) => {
    stream
      .pipe(csv({ mapHeaders: ({ header }) => header.replace(/^﻿/, '').trim() }))
      .on('data', (row) => rawRows.push(row))
      .on('end', resolve)
      .on('error', reject);
  });

  const rows = [];
  const parseErrors = [];

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 2; // +1 for header, +1 for 1-based numbering

    if (raw.Deleted === '1' || raw.Deleted === 1) {
      // Skipped at parse time — these rows never enter staging.
      return;
    }

    const rsId = raw.rsId ?? raw.RsId ?? raw.RSID;
    if (!rsId) {
      parseErrors.push({ rowNumber, reason: 'Missing rsId' });
      return;
    }

    const startDate = parseRschedDate(raw.StartDate);
    const endDate = parseRschedDate(raw.EndDate);
    const startTime = parseRschedTime(raw.StartTime);
    const endTime = parseRschedTime(raw.EndTime);

    if (!startDate || !endDate || !startTime || !endTime) {
      parseErrors.push({
        rowNumber,
        rsId,
        reason: `Invalid date/time (start=${raw.StartDate} ${raw.StartTime}, end=${raw.EndDate} ${raw.EndTime})`,
      });
      return;
    }

    const isAllDay = raw.AllDayEvent === '1' || raw.AllDayEvent === 1;
    const startDateTime = `${startDate}T${startTime}:00`;
    const endDateTime = `${endDate}T${endTime}:00`;
    const rsKeyRaw = (raw.rsKey ?? raw.RsKey ?? raw.locationCode ?? '').toString();
    const rsKeys = splitRsKeys(rsKeyRaw);

    rows.push({
      rsId: parseInt(rsId, 10),
      rowNumber,
      eventTitle: (raw.Subject || '').trim(),
      eventDescription: (raw.Description || '').trim(),
      categories: parseCategories(raw.Categories),
      startDate,
      endDate,
      startTime,
      endTime,
      startDateTime,
      endDateTime,
      isAllDay,
      rsKeyRaw,
      rsKeys,
      requesterEmail: (raw.AttendeeEmails || '').split(',')[0].trim(),
      requesterName: (raw.AttendeeNames || '').split(',')[0].trim(),
      rawCsv: raw,
    });
  });

  return { rows, parseErrors };
}

function parseRschedDate(value) {
  if (!value) return null;
  // Accept both M/D/YYYY (US) and YYYY-MM-DD.
  const us = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const iso = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  return null;
}

function parseRschedTime(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  // 9:00:00 AM / 12:00 PM / 13:45 / 09:00:00
  const ampm = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const m = parseInt(ampm[2], 10);
    const period = ampm[4].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const military = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (military) {
    return `${String(military[1]).padStart(2, '0')}:${military[2]}`;
  }
  return null;
}

function splitRsKeys(raw) {
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

function parseCategories(value) {
  if (!value) return [];
  return String(value)
    .split(/[,;]/)
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

// =============================================================================
// Location resolution
// =============================================================================

/**
 * Annotate parsed rows with location ObjectIds.
 *
 * @param {Array} rows - parsed rows from parseCsv
 * @param {Collection} locationsCollection
 * @returns {Promise<{rows: Array, unmatchedKeys: Set<string>}>}
 */
async function resolveLocations(rows, locationsCollection) {
  // Collect every unique non-sentinel rsKey across all rows.
  const uniqueKeys = new Set();
  for (const row of rows) {
    for (const key of row.rsKeys) {
      if (!NOTE_RSKEY_SENTINELS.has(key)) uniqueKeys.add(key);
    }
  }

  // Single batched lookup.
  const locationDocs = uniqueKeys.size
    ? await locationsCollection
        .find({ active: { $ne: false }, rsKey: { $in: [...uniqueKeys] } })
        .toArray()
    : [];

  const byKey = new Map();
  for (const loc of locationDocs) {
    if (loc.rsKey) {
      byKey.set(String(loc.rsKey), {
        _id: loc._id,
        displayName: loc.displayName || loc.name || String(loc.rsKey),
      });
    }
  }

  const unmatchedKeys = new Set();

  for (const row of rows) {
    const matched = [];
    let hasUnmatched = false;
    let isNoteOnly = row.rsKeys.length > 0 && row.rsKeys.every((k) => NOTE_RSKEY_SENTINELS.has(k));

    for (const key of row.rsKeys) {
      if (NOTE_RSKEY_SENTINELS.has(key)) continue;
      const loc = byKey.get(key);
      if (loc) {
        matched.push(loc);
      } else {
        hasUnmatched = true;
        unmatchedKeys.add(key);
      }
    }

    row.locationIds = matched.map((l) => l._id);
    row.locationDisplayNames = matched.map((l) => l.displayName).join('; ');

    if (row.rsKeys.length === 0) {
      // No location code at all — flag for review.
      row.locationStatus = 'missing';
    } else if (isNoteOnly) {
      // All keys are Note1/Note2/Note3 — informational, valid as-is.
      row.locationStatus = 'note_only';
    } else if (hasUnmatched && matched.length === 0) {
      // Only unmatched keys.
      row.locationStatus = 'unmatched';
    } else if (hasUnmatched) {
      // Mixed — partial match. Treat as matched (admin can review).
      row.locationStatus = 'partial';
    } else {
      row.locationStatus = 'matched';
    }
  }

  return { rows, unmatchedKeys };
}

// =============================================================================
// Staging row construction
// =============================================================================

/**
 * Build a staging document from a parsed+resolved row.
 *
 * @param {Object} parsed - row after parseCsv + resolveLocations
 * @param {Object} ctx - { sessionId, uploadedBy, uploadedAt, calendarOwner, calendarId, csvFilename, dateRangeStart, dateRangeEnd }
 * @returns {Object} staging document ready for insertOne
 */
function buildStagingDoc(parsed, ctx) {
  const status =
    parsed.locationStatus === 'unmatched' || parsed.locationStatus === 'missing'
      ? STAGING_STATUS.UNMATCHED_LOCATION
      : STAGING_STATUS.STAGED;

  return {
    sessionId: ctx.sessionId,
    uploadedBy: ctx.uploadedBy,
    uploadedAt: ctx.uploadedAt,
    calendarOwner: (ctx.calendarOwner || '').toLowerCase(),
    calendarId: ctx.calendarId || null,
    csvFilename: ctx.csvFilename || null,
    dateRangeStart: ctx.dateRangeStart || null,
    dateRangeEnd: ctx.dateRangeEnd || null,

    rsId: parsed.rsId,
    rowNumber: parsed.rowNumber,
    rawCsv: parsed.rawCsv,

    // Editable fields (initialized from parsed CSV).
    eventTitle: parsed.eventTitle,
    eventDescription: parsed.eventDescription,
    categories: parsed.categories,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    startDateTime: parsed.startDateTime,
    endDateTime: parsed.endDateTime,
    isAllDay: parsed.isAllDay,
    rsKey: parsed.rsKeyRaw,
    rsKeys: parsed.rsKeys,
    locationIds: parsed.locationIds || [],
    locationDisplayNames: parsed.locationDisplayNames || '',
    locationStatus: parsed.locationStatus,
    requesterEmail: parsed.requesterEmail || '',
    requesterName: parsed.requesterName || '',

    status,
    conflictReason: null,
    conflictDetails: null,
    forceApply: false,

    appliedEventId: null,
    appliedAt: null,
    applyError: null,

    editedAt: null,
    editedBy: null,
  };
}

// =============================================================================
// Staging persistence
// =============================================================================

/**
 * Insert staging documents in batches with retry-aware Cosmos protection.
 *
 * Single insertMany() of 80k+ rows is rate-limit suicide on Cosmos DB —
 * Error 16500 (RequestRateTooLarge) trips before the operation completes.
 * Batching at 500 rows/page with a small inter-batch pause and the shared
 * retryWithBackoff utility keeps RU consumption bounded and survives
 * transient throttling.
 *
 * Pure function: takes the collection as a parameter so unit tests can pass
 * a fake { insertMany } object and assert call counts directly.
 *
 * @param {Object} stagingCollection - any object with .insertMany(docs, opts)
 * @param {Array<Object>} docs - staging documents from buildStagingDoc()
 * @param {Object} [options]
 * @param {number} [options.batchSize=500] - rows per insertMany call
 * @param {number} [options.delayMs=250] - pause between batches (skipped on last)
 * @param {Object} [options.retryOptions] - passed through to retryWithBackoff
 * @returns {Promise<number>} count of inserted documents
 */
async function batchInsertStagingDocs(stagingCollection, docs, options = {}) {
  const {
    batchSize = 500,
    delayMs = 250,
    retryOptions = { maxAttempts: 5, initialDelayMs: 500 },
  } = options;

  if (!Array.isArray(docs) || docs.length === 0) return 0;

  let inserted = 0;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    await retryWithBackoff(
      () => stagingCollection.insertMany(batch, { ordered: false }),
      retryOptions,
    );
    inserted += batch.length;
    if (i + batchSize < docs.length && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return inserted;
}

/**
 * Build a full event document for insert into templeEvents__Events.
 * Populates BOTH top-level fields AND calendarData — calendarData remains
 * the source of truth for room conflict queries.
 *
 * @param {Object} stagingRow - staging document (post-edit)
 * @param {Object} ctx - { calendarOwner, calendarId, importUserId, importUserEmail, sessionId }
 * @returns {Object} event document ready for insertOne
 */
function buildEventDocFromStaging(stagingRow, ctx) {
  const now = new Date();
  const calendarOwner = (ctx.calendarOwner || stagingRow.calendarOwner || '').toLowerCase();
  const calendarId = ctx.calendarId || stagingRow.calendarId || null;
  const importUserId = ctx.importUserId;
  const locationObjectIds = (stagingRow.locationIds || []).map(toObjectId).filter(Boolean);

  const requestedBy = {
    name: stagingRow.requesterName || '',
    email: (stagingRow.requesterEmail || '').toLowerCase() || null,
    department: '',
    phone: '',
    userId: null,
  };

  const calendarData = {
    eventTitle: stagingRow.eventTitle,
    eventDescription: stagingRow.eventDescription,
    startDateTime: stagingRow.startDateTime,
    endDateTime: stagingRow.endDateTime,
    startDate: stagingRow.startDate,
    endDate: stagingRow.endDate,
    startTime: stagingRow.startTime,
    endTime: stagingRow.endTime,
    isAllDay: stagingRow.isAllDay,
    locations: locationObjectIds,
    locationDisplayNames: stagingRow.locationDisplayNames || '',
    categories: stagingRow.categories || [],
    services: [],
    assignedTo: '',
    setupTimeMinutes: 0,
    teardownTimeMinutes: 0,
    reservationStartMinutes: 0,
    reservationEndMinutes: 0,
  };

  return {
    eventId: `rssched-${stagingRow.rsId}`,
    userId: importUserId,
    source: RSCHED_SOURCE,
    isDeleted: false,

    // Top-level fields.
    eventTitle: stagingRow.eventTitle,
    eventDescription: stagingRow.eventDescription,
    startDateTime: stagingRow.startDateTime,
    endDateTime: stagingRow.endDateTime,
    startDate: stagingRow.startDate,
    endDate: stagingRow.endDate,
    startTime: stagingRow.startTime,
    endTime: stagingRow.endTime,
    setupTime: stagingRow.startTime,
    doorOpenTime: stagingRow.startTime,
    doorCloseTime: stagingRow.endTime,
    teardownTime: '',
    setupTimeMinutes: 0,
    teardownTimeMinutes: 0,
    isAllDayEvent: stagingRow.isAllDay,
    locations: locationObjectIds,
    locationDisplayNames: stagingRow.locationDisplayNames || '',
    categories: stagingRow.categories || [],
    eventType: 'singleInstance',

    // Nested structures.
    graphData: null,
    calendarData,
    roomReservationData: {
      requestedBy,
      contactPerson: requestedBy,
      submittedAt: now,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: '',
      createdGraphEventIds: [],
    },
    rschedData: {
      rsId: stagingRow.rsId,
      rowNumber: stagingRow.rowNumber,
      rsKey: stagingRow.rsKey || '',
      rawCsv: stagingRow.rawCsv,
      importedAt: now,
      importSessionId: stagingRow.sessionId,
    },

    // Versioning + history.
    status: 'published',
    _version: 1,
    statusHistory: [
      {
        status: 'published',
        changedAt: now,
        changedBy: importUserId,
        reason: 'Imported from Resource Scheduler',
      },
    ],

    // Metadata.
    calendarOwner,
    calendarId,
    sourceCalendars: calendarId ? [calendarId] : [],
    createdAt: now,
    createdBy: importUserId,
    createdByEmail: ctx.importUserEmail || null,
    createdSource: 'rsched-import',
    lastModifiedDateTime: now,
    lastModifiedBy: importUserId,
    lastSyncedAt: now,
  };
}

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof ObjectId) return value;
  if (typeof value === 'string' && ObjectId.isValid(value)) return new ObjectId(value);
  return null;
}

// =============================================================================
// Material-field comparison
// =============================================================================

/**
 * Compare a freshly-built rsched event payload against an existing event doc
 * for material differences. Used for idempotency: if no material fields
 * differ, the upsert is a no-op.
 */
function detectMaterialDifferences(candidate, existing) {
  const diffs = [];
  for (const field of MATERIAL_FIELDS) {
    if (!fieldsEqual(field, candidate, existing)) {
      diffs.push({
        field,
        candidate: getMaterialField(field, candidate),
        existing: getMaterialField(field, existing),
      });
    }
  }
  return diffs;
}

function getMaterialField(field, doc) {
  if (!doc) return undefined;
  if (field === 'isAllDay') {
    return doc.isAllDayEvent ?? doc.calendarData?.isAllDay ?? false;
  }
  if (field === 'locations') {
    const locs = doc.locations ?? doc.calendarData?.locations ?? [];
    return [...locs].map((id) => String(id)).sort();
  }
  if (field === 'categories') {
    const cats = doc.categories ?? doc.calendarData?.categories ?? [];
    return [...cats].map((c) => String(c)).sort();
  }
  if (field === 'startDateTime' || field === 'endDateTime') {
    return doc[field] ?? doc.calendarData?.[field] ?? null;
  }
  if (field === 'eventTitle' || field === 'eventDescription') {
    return doc[field] ?? doc.calendarData?.[field] ?? '';
  }
  return doc[field];
}

function fieldsEqual(field, a, b) {
  const va = getMaterialField(field, a);
  const vb = getMaterialField(field, b);
  if (Array.isArray(va) && Array.isArray(vb)) {
    if (va.length !== vb.length) return false;
    return va.every((v, i) => v === vb[i]);
  }
  return va === vb;
}

// =============================================================================
// Human-edit detection
// =============================================================================

/**
 * Determine whether an existing event has been touched by a human (or any
 * non-rsched-import process) since it was last imported.
 *
 * @param {Object} existing - existing event document
 * @param {Db} db - mongo Db
 * @param {string} importUserId - the service account id used by the importer
 * @returns {Promise<boolean>}
 */
async function hasHumanEdits(existing, db, importUserId) {
  if (!existing) return false;

  // Cheap check: lastModifiedBy differs from import service account.
  const lastModBy = existing.lastModifiedBy;
  if (lastModBy && lastModBy !== importUserId) return true;

  // Audit-history check: any non-import audit entry?
  const auditCollection = db.collection(AUDIT_COLLECTION);
  const nonImportEntry = await auditCollection.findOne({
    eventId: existing.eventId,
    changeType: { $nin: ['rsched-import-create', 'rsched-import-update'] },
  });
  return Boolean(nonImportEntry);
}

// =============================================================================
// Drift detection (validate-time, bulk-prefetched)
// =============================================================================

/**
 * Truncate a value for persisted materialDiffs storage.
 *
 * @param {*} value
 * @returns {{ value: string, truncated: boolean }}
 */
function truncateDiffValue(value) {
  let str;
  if (value == null) str = '';
  else if (typeof value === 'string') str = value;
  else if (Array.isArray(value)) str = JSON.stringify(value);
  else str = String(value);

  if (str.length <= MAX_DIFF_VALUE_LENGTH) {
    return { value: str, truncated: false };
  }
  return {
    value: str.slice(0, MAX_DIFF_VALUE_LENGTH) + '…(truncated)',
    truncated: true,
  };
}

function toPersistableDiff(diff) {
  const prev = truncateDiffValue(diff.existing);
  const csv = truncateDiffValue(diff.candidate);
  return {
    field: diff.field,
    previous: prev.value,
    csv: csv.value,
    truncated: prev.truncated || csv.truncated,
  };
}

/**
 * Classify a single staging row's drift against an in-memory existing event
 * (or null if no match). Pure function — no DB calls.
 *
 * @param {Object} stagingRow
 * @param {Object|null} existing - existing event document, or null
 * @param {Set<string>} eventsWithHumanEdits - eventIds known to have human edits
 * @param {Object} ctx - { calendarOwner, calendarId, importUserId }
 * @returns {{ driftType: string, materialDiffs: Array|null }}
 */
function computeStagingRowDrift(stagingRow, existing, eventsWithHumanEdits, ctx) {
  if (!existing) {
    return { driftType: DRIFT_TYPE.CREATE, materialDiffs: null };
  }
  const candidate = buildEventDocFromStaging(stagingRow, ctx);
  const diffs = detectMaterialDifferences(candidate, existing);
  const persistableDiffs = diffs.map(toPersistableDiff);

  if (eventsWithHumanEdits.has(existing.eventId)) {
    return {
      driftType: DRIFT_TYPE.HUMAN_EDIT_CONFLICT,
      materialDiffs: persistableDiffs,
    };
  }
  if (diffs.length === 0) {
    return { driftType: DRIFT_TYPE.NO_OP, materialDiffs: [] };
  }
  return { driftType: DRIFT_TYPE.UPDATE, materialDiffs: persistableDiffs };
}

/**
 * Bulk-prefetch existing events + audit hits, then classify drift for every
 * staging row in memory. One find() against events + one find() against audit,
 * regardless of staging row count.
 *
 * Per-row lookups inside a validate loop would be 80k × 2 Cosmos reads on a
 * full-history reconcile — guaranteed timeout. This function keeps it at 2.
 *
 * @param {Db} db
 * @param {Array<Object>} stagingRows
 * @param {Object} ctx - { calendarOwner, calendarId, importUserId }
 * @returns {Promise<Array<{stagingRowId, driftType, materialDiffs}>>}
 */
async function bulkComputeDrift(db, stagingRows, ctx) {
  if (!Array.isArray(stagingRows) || stagingRows.length === 0) return [];
  const eventsCollection = db.collection(EVENTS_COLLECTION);
  const auditCollection = db.collection(AUDIT_COLLECTION);
  const calendarOwner = (ctx.calendarOwner || '').toLowerCase();

  const candidateEventIds = stagingRows
    .filter((r) => r.rsId != null)
    .map((r) => `rssched-${r.rsId}`);

  if (candidateEventIds.length === 0) {
    return stagingRows.map((r) => ({
      stagingRowId: r._id,
      driftType: null,
      materialDiffs: null,
    }));
  }

  // Bulk-fetch existing events by candidate eventIds.
  const existingEvents = await eventsCollection
    .find({ eventId: { $in: candidateEventIds }, calendarOwner })
    .toArray();
  const existingByEventId = new Map(existingEvents.map((e) => [e.eventId, e]));

  // Bulk-fetch audit hits to detect human edits. Augment with the cheaper
  // lastModifiedBy check that hasHumanEdits() does as its first branch — when
  // the existing event's lastModifiedBy differs from the import user, count
  // it as human-edited even without an audit entry.
  const eventsWithHumanEdits = new Set();
  if (existingEvents.length > 0) {
    const auditHits = await auditCollection
      .find({
        eventId: { $in: existingEvents.map((e) => e.eventId) },
        changeType: { $nin: ['rsched-import-create', 'rsched-import-update'] },
      })
      .project({ eventId: 1 })
      .toArray();
    for (const hit of auditHits) eventsWithHumanEdits.add(hit.eventId);

    if (ctx.importUserId) {
      for (const ev of existingEvents) {
        if (ev.lastModifiedBy && ev.lastModifiedBy !== ctx.importUserId) {
          eventsWithHumanEdits.add(ev.eventId);
        }
      }
    }
  }

  // Classify each row against the in-memory cache.
  return stagingRows.map((row) => {
    if (row.rsId == null) {
      return { stagingRowId: row._id, driftType: null, materialDiffs: null };
    }
    const existing = existingByEventId.get(`rssched-${row.rsId}`);
    const drift = computeStagingRowDrift(row, existing, eventsWithHumanEdits, ctx);
    return {
      stagingRowId: row._id,
      driftType: drift.driftType,
      materialDiffs: drift.materialDiffs,
    };
  });
}

/**
 * Persist drift classification onto staging rows via batched bulkWrite.
 *
 * @param {Object} stagingCollection - any collection with .bulkWrite
 * @param {Array<{stagingRowId, driftType, materialDiffs}>} driftResults
 * @param {Object} [options]
 * @returns {Promise<number>} updated count
 */
async function persistDriftResults(stagingCollection, driftResults, options = {}) {
  const {
    batchSize = 500,
    retryOptions = { maxAttempts: 5, initialDelayMs: 500 },
  } = options;
  if (!Array.isArray(driftResults) || driftResults.length === 0) return 0;

  const now = new Date();
  const ops = driftResults.map((r) => ({
    updateOne: {
      filter: { _id: r.stagingRowId },
      update: {
        $set: {
          driftType: r.driftType,
          materialDiffs: r.materialDiffs,
          driftComputedAt: now,
        },
      },
    },
  }));

  let updated = 0;
  for (let i = 0; i < ops.length; i += batchSize) {
    const batch = ops.slice(i, i + batchSize);
    const result = await retryWithBackoff(
      () => stagingCollection.bulkWrite(batch, { ordered: false }),
      retryOptions,
    );
    updated += (result?.modifiedCount ?? 0) + (result?.upsertedCount ?? 0);
  }
  return updated;
}

// =============================================================================
// Apply (upsert) algorithm
// =============================================================================

/**
 * Apply a single staging row: insert / update / no-op / record human-edit
 * conflict / fail.
 *
 * @param {Db} db
 * @param {Object} stagingRow - the staging document
 * @param {Object} ctx - { importUserId, importUserEmail, sessionId, calendarOwner, calendarId, broadcast }
 * @returns {Promise<{outcome: string, eventId: string, error?: string, conflictDetails?: Object}>}
 */
async function applyStagingRow(db, stagingRow, ctx) {
  const eventsCollection = db.collection(EVENTS_COLLECTION);
  const auditCollection = db.collection(AUDIT_COLLECTION);

  if (stagingRow.status === STAGING_STATUS.SKIPPED) {
    return { outcome: APPLY_OUTCOME.SKIPPED, eventId: `rssched-${stagingRow.rsId}` };
  }

  if (stagingRow.status === STAGING_STATUS.CONFLICT && !stagingRow.forceApply) {
    return {
      outcome: APPLY_OUTCOME.SKIPPED,
      eventId: `rssched-${stagingRow.rsId}`,
      reason: 'unforced_conflict',
    };
  }

  const candidate = buildEventDocFromStaging(stagingRow, ctx);
  const filter = { eventId: candidate.eventId, calendarOwner: candidate.calendarOwner };

  const existing = await eventsCollection.findOne(filter);

  // Branch 1: not found → insert.
  if (!existing) {
    try {
      await eventsCollection.insertOne(candidate);
      await auditCollection.insertOne({
        eventId: candidate.eventId,
        userId: ctx.importUserId,
        changeType: 'rsched-import-create',
        source: 'rsSched Import',
        timestamp: new Date(),
        metadata: { importSessionId: ctx.sessionId, rsId: stagingRow.rsId },
      });
      return { outcome: APPLY_OUTCOME.INSERTED, eventId: candidate.eventId };
    } catch (err) {
      return {
        outcome: APPLY_OUTCOME.FAILED,
        eventId: candidate.eventId,
        error: err.message,
      };
    }
  }

  // Branch 2: human edits present → never overwrite.
  const humanEdited = await hasHumanEdits(existing, db, ctx.importUserId);
  if (humanEdited) {
    const diffs = detectMaterialDifferences(candidate, existing);
    return {
      outcome: APPLY_OUTCOME.HUMAN_EDIT_CONFLICT,
      eventId: candidate.eventId,
      conflictDetails: { diffs, lastModifiedBy: existing.lastModifiedBy || null },
    };
  }

  // Branch 3: no human edits — compare material fields.
  const diffs = detectMaterialDifferences(candidate, existing);
  if (diffs.length === 0) {
    return { outcome: APPLY_OUTCOME.NO_OP, eventId: candidate.eventId };
  }

  // Branch 4: update via conditionalUpdate (OCC).
  const { conditionalUpdate } = require('../utils/concurrencyUtils');
  const updateOps = {
    $set: {
      eventTitle: candidate.eventTitle,
      eventDescription: candidate.eventDescription,
      startDateTime: candidate.startDateTime,
      endDateTime: candidate.endDateTime,
      startDate: candidate.startDate,
      endDate: candidate.endDate,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      isAllDayEvent: candidate.isAllDayEvent,
      locations: candidate.locations,
      locationDisplayNames: candidate.locationDisplayNames,
      categories: candidate.categories,
      'calendarData.eventTitle': candidate.calendarData.eventTitle,
      'calendarData.eventDescription': candidate.calendarData.eventDescription,
      'calendarData.startDateTime': candidate.calendarData.startDateTime,
      'calendarData.endDateTime': candidate.calendarData.endDateTime,
      'calendarData.locations': candidate.calendarData.locations,
      'calendarData.locationDisplayNames': candidate.calendarData.locationDisplayNames,
      'calendarData.categories': candidate.calendarData.categories,
      'calendarData.isAllDay': candidate.calendarData.isAllDay,
      'rschedData.rawCsv': candidate.rschedData.rawCsv,
      'rschedData.importSessionId': ctx.sessionId,
      'rschedData.importedAt': new Date(),
    },
    $push: {
      statusHistory: {
        status: existing.status || 'published',
        changedAt: new Date(),
        changedBy: ctx.importUserId,
        reason: 'rsched re-import refreshed material fields',
      },
    },
  };

  try {
    await conditionalUpdate(eventsCollection, { _id: existing._id }, updateOps, {
      expectedVersion: existing._version ?? null,
      modifiedBy: ctx.importUserId,
    });
    await auditCollection.insertOne({
      eventId: candidate.eventId,
      userId: ctx.importUserId,
      changeType: 'rsched-import-update',
      source: 'rsSched Import',
      timestamp: new Date(),
      metadata: { importSessionId: ctx.sessionId, rsId: stagingRow.rsId },
      changes: diffs.map((d) => ({ field: d.field, oldValue: d.existing, newValue: d.candidate })),
    });
    return { outcome: APPLY_OUTCOME.UPDATED, eventId: candidate.eventId, diffs };
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 409) {
      return {
        outcome: APPLY_OUTCOME.FAILED,
        eventId: candidate.eventId,
        error: 'VERSION_CONFLICT',
        conflictDetails: err.details,
      };
    }
    return { outcome: APPLY_OUTCOME.FAILED, eventId: candidate.eventId, error: err.message };
  }
}

// =============================================================================
// Recurrence-aware apply helpers (used by commit when admin approved
// detected recurrence candidates for this session)
// =============================================================================

/**
 * Build an event document with seriesMaster shape — extends buildEventDocFromStaging
 * with recurrence + eventType + initialized exclusions/additions arrays. Pure.
 *
 * @param {Object} stagingRow
 * @param {Object} candidate - approved CandidateSeries
 * @param {Object} ctx
 * @returns {Object}
 */
function buildSeriesMasterDoc(stagingRow, candidate, ctx) {
  const recurrence = {
    pattern: candidate.detectedPattern,
    range: {
      ...candidate.detectedRange,
      // Default to Eastern (rsched is NYC) — buildGraphRecurrence will translate
      // to Windows tz on Graph publish. recurrenceTimeZone is internal-only here.
      recurrenceTimeZone: candidate.detectedRange.recurrenceTimeZone || 'Eastern Standard Time',
    },
    // ALWAYS initialize exclusions and additions arrays — downstream consumers
    // (buildGraphRecurrence, expandAllOccurrences, occurrence delete handler)
    // iterate them and break on undefined.
    exclusions: Array.isArray(candidate.outlierDatesInRange) ? [...candidate.outlierDatesInRange] : [],
    additions: [],
  };

  const doc = buildEventDocFromStaging(stagingRow, ctx);
  doc.eventType = 'seriesMaster';
  doc.recurrence = recurrence;
  if (doc.calendarData) {
    doc.calendarData.recurrence = recurrence; // mirrored copy for legacy reads
  }
  return doc;
}

/**
 * Apply an approved candidate's master row → create / upgrade / refresh a
 * seriesMaster document.
 *
 * Three branches because conditionalUpdate is NOT an upsert:
 *   A. Not found → insertOne (eventId unique index protects from races)
 *   B. Already a seriesMaster → conditionalUpdate to refresh material fields + recurrence
 *   C. Exists as singleInstance → upgrade in place (flip eventType, add recurrence)
 *
 * Without these branches, re-running detect+commit would silently produce
 * duplicate seriesMasters via plain insertOne, then trip the unique eventId
 * index and get swallowed as APPLY_OUTCOME.FAILED.
 */
async function applyAsMaster(db, stagingRow, candidate, ctx) {
  const eventsCollection = db.collection(EVENTS_COLLECTION);
  const auditCollection = db.collection(AUDIT_COLLECTION);
  const eventId = `rssched-${stagingRow.rsId}`;
  const calendarOwner = (ctx.calendarOwner || stagingRow.calendarOwner || '').toLowerCase();

  const candidateDoc = buildSeriesMasterDoc(stagingRow, candidate, ctx);
  const existing = await eventsCollection.findOne({ eventId, calendarOwner });

  if (!existing) {
    // Branch A: brand-new seriesMaster.
    await eventsCollection.insertOne(candidateDoc);
    await auditCollection.insertOne({
      eventId,
      userId: ctx.importUserId,
      changeType: 'rsched-import-create-series',
      source: 'rsSched Import',
      timestamp: new Date(),
      metadata: {
        importSessionId: ctx.sessionId,
        candidateId: candidate.candidateId,
        rsId: stagingRow.rsId,
      },
    });
    return { outcome: APPLY_OUTCOME.INSERTED, eventId, eventType: 'seriesMaster' };
  }

  if (existing.eventType === 'seriesMaster') {
    // Branch B: refresh existing seriesMaster fields + recurrence.
    const updateOps = {
      $set: {
        eventTitle: candidateDoc.eventTitle,
        eventDescription: candidateDoc.eventDescription,
        startDateTime: candidateDoc.startDateTime,
        endDateTime: candidateDoc.endDateTime,
        locations: candidateDoc.locations,
        categories: candidateDoc.categories,
        recurrence: candidateDoc.recurrence,
        'calendarData.recurrence': candidateDoc.recurrence,
        'rschedData.importSessionId': ctx.sessionId,
        'rschedData.importedAt': new Date(),
      },
      $push: {
        statusHistory: {
          status: existing.status,
          changedAt: new Date(),
          changedBy: ctx.importUserId,
          reason: 'rsched re-import refreshed series master',
        },
      },
    };
    try {
      await _conditionalUpdate(eventsCollection, { _id: existing._id }, updateOps, {
        expectedVersion: existing._version ?? null,
        modifiedBy: ctx.importUserId,
      });
      await auditCollection.insertOne({
        eventId,
        userId: ctx.importUserId,
        changeType: 'rsched-import-update-series',
        source: 'rsSched Import',
        timestamp: new Date(),
        metadata: { importSessionId: ctx.sessionId, candidateId: candidate.candidateId },
      });
      return { outcome: APPLY_OUTCOME.UPDATED, eventId, eventType: 'seriesMaster' };
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        return { outcome: APPLY_OUTCOME.FAILED, eventId, error: 'VERSION_CONFLICT' };
      }
      return { outcome: APPLY_OUTCOME.FAILED, eventId, error: err.message };
    }
  }

  // Branch C: exists as singleInstance — upgrade in place.
  const upgradeOps = {
    $set: {
      eventType: 'seriesMaster',
      recurrence: candidateDoc.recurrence,
      'calendarData.recurrence': candidateDoc.recurrence,
      eventTitle: candidateDoc.eventTitle,
      eventDescription: candidateDoc.eventDescription,
      startDateTime: candidateDoc.startDateTime,
      endDateTime: candidateDoc.endDateTime,
      locations: candidateDoc.locations,
      categories: candidateDoc.categories,
      'rschedData.importSessionId': ctx.sessionId,
      'rschedData.importedAt': new Date(),
    },
    $push: {
      statusHistory: {
        status: existing.status,
        changedAt: new Date(),
        changedBy: ctx.importUserId,
        reason: 'rsched detect-recurrence promoted singleInstance to seriesMaster',
      },
    },
  };
  try {
    await _conditionalUpdate(eventsCollection, { _id: existing._id }, upgradeOps, {
      expectedVersion: existing._version ?? null,
      modifiedBy: ctx.importUserId,
    });
    await auditCollection.insertOne({
      eventId,
      userId: ctx.importUserId,
      changeType: 'rsched-import-promote-to-series',
      source: 'rsSched Import',
      timestamp: new Date(),
      metadata: { importSessionId: ctx.sessionId, candidateId: candidate.candidateId, upgradedFrom: 'singleInstance' },
    });
    return { outcome: APPLY_OUTCOME.UPDATED, eventId, eventType: 'seriesMaster', upgradedFrom: 'singleInstance' };
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 409) {
      return { outcome: APPLY_OUTCOME.FAILED, eventId, error: 'VERSION_CONFLICT' };
    }
    return { outcome: APPLY_OUTCOME.FAILED, eventId, error: err.message };
  }
}

/**
 * Apply an approved candidate's occurrence_override row → create an exception
 * document via the existing createExceptionDocument helper.
 *
 * The master must already exist (Pass 1 ran first). If not, throws so the
 * caller's per-row try/catch records the failure without aborting Pass 2.
 */
async function applyAsException(db, stagingRow, candidate, member, ctx) {
  const eventsCollection = db.collection(EVENTS_COLLECTION);
  const auditCollection = db.collection(AUDIT_COLLECTION);

  const masterMember = candidate.members.find((m) => m.role === 'master');
  if (!masterMember) {
    throw new Error(`applyAsException: candidate ${candidate.candidateId} has no master member`);
  }
  const masterEventId = `rssched-${masterMember.rsId}`;
  const calendarOwner = (ctx.calendarOwner || '').toLowerCase();
  const master = await eventsCollection.findOne({ eventId: masterEventId, calendarOwner });
  if (!master) {
    throw new Error(`applyAsException: master ${masterEventId} not found — Pass 1 may have failed`);
  }

  const occurrenceDate = stagingRow.startDate; // YYYY-MM-DD
  const overrides = member.overrides || {};
  const result = await createExceptionDocument(
    eventsCollection,
    master,
    occurrenceDate,
    overrides,
    { modifiedBy: ctx.importUserId },
  );
  await auditCollection.insertOne({
    eventId: result.eventId,
    userId: ctx.importUserId,
    changeType: 'rsched-import-create-exception',
    source: 'rsSched Import',
    timestamp: new Date(),
    metadata: {
      importSessionId: ctx.sessionId,
      candidateId: candidate.candidateId,
      rsId: stagingRow.rsId,
      seriesMasterEventId: masterEventId,
      occurrenceDate,
    },
  });
  return { outcome: APPLY_OUTCOME.INSERTED, eventId: result.eventId, eventType: 'exception' };
}

// =============================================================================
// Validate-time helpers
// =============================================================================

/**
 * Find all events with `source: 'rsSched'` for this calendar owner whose start
 * falls inside the staging date range but whose rsId is NOT in the supplied set.
 * These are candidates for "removed upstream" deletion at commit time.
 */
async function detectRemovedRsIds(db, ctx, presentRsIds) {
  const eventsCollection = db.collection(EVENTS_COLLECTION);
  const presentSet = new Set(presentRsIds.map(Number));

  // All-time mode: ctx.dateRangeStart/End are null and no date filter applies.
  // Otherwise filter on top-level startDateTime (the authoritative field per
  // CLAUDE.md). Older code filtered on calendarData.startDateTime which can
  // be stale on migrated documents.
  const isAllTime = !ctx.dateRangeStart || !ctx.dateRangeEnd;
  const filter = {
    source: RSCHED_SOURCE,
    calendarOwner: (ctx.calendarOwner || '').toLowerCase(),
    isDeleted: { $ne: true },
  };
  if (!isAllTime) {
    const startStr = `${ctx.dateRangeStart}T00:00:00`;
    const endStr = `${ctx.dateRangeEnd}T23:59:59`;
    filter.startDateTime = { $gte: startStr, $lte: endStr };
  }

  // Tight projection — without it the cursor returns full event documents
  // including graphData blobs (potentially KBs each). At 80k+ rsched events
  // that scaled to >100MB unnecessary read traffic on Cosmos.
  const cursor = eventsCollection
    .find(filter, {
      projection: {
        eventId: 1,
        'rschedData.rsId': 1,
        eventTitle: 1,
        startDateTime: 1,
        'calendarData.eventTitle': 1,
        'calendarData.startDateTime': 1,
      },
    })
    .batchSize(500);

  const removed = [];
  for await (const ev of cursor) {
    const rsId = ev.rschedData?.rsId ?? parseRsIdFromEventId(ev.eventId);
    if (rsId == null) continue;
    if (!presentSet.has(rsId)) {
      removed.push({
        rsId,
        eventId: ev.eventId,
        _id: ev._id,
        eventTitle: ev.eventTitle || ev.calendarData?.eventTitle,
        startDateTime: ev.startDateTime || ev.calendarData?.startDateTime,
      });
    }
  }
  return removed;
}

function parseRsIdFromEventId(eventId) {
  if (!eventId || typeof eventId !== 'string') return null;
  const m = eventId.match(/^rssched-(-?\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Build a single visual snapshot of what's in the calendar within the
 * staging context's date range, the staging row breakdown, and the
 * resulting planned actions a commit would produce.
 *
 * Designed for the "visual preview" UI — one read, all counts.
 *
 * @param {Db} db
 * @param {{ sessionId: string, calendarOwner: string, dateRangeStart: string|null, dateRangeEnd: string|null }} ctx
 *   When dateRangeStart/dateRangeEnd are both null/empty, runs in all-time
 *   mode — no date filter on the existing-events scan or removal detection.
 */
async function computePreview(db, ctx) {
  const eventsCollection = db.collection(EVENTS_COLLECTION);
  const stagingCollection = db.collection(STAGING_COLLECTION);

  const isAllTime = !ctx.dateRangeStart || !ctx.dateRangeEnd;
  const calendarOwner = (ctx.calendarOwner || '').toLowerCase();

  // Existing events scan filter. In all-time mode skip the date predicate.
  // Switch from 'calendarData.startDateTime' to top-level 'startDateTime' —
  // the authoritative field per CLAUDE.md (calendarData can be stale on
  // older migrated docs).
  const existingFilter = {
    calendarOwner,
    isDeleted: { $ne: true },
  };
  if (!isAllTime) {
    const startStr = `${ctx.dateRangeStart}T00:00:00`;
    const endStr = `${ctx.dateRangeEnd}T23:59:59`;
    existingFilter.startDateTime = { $gte: startStr, $lte: endStr };
  }

  // batchSize(500) keeps each Cosmos page request bounded — without it,
  // all-time scope would request a single ~80k-doc page and exceed RU caps.
  const existingCursor = eventsCollection
    .find(existingFilter, {
      projection: { source: 1, eventId: 1, 'rschedData.rsId': 1 },
    })
    .batchSize(500);

  let existingTotal = 0;
  let existingFromRsched = 0;
  const existingRsIds = new Set();
  for await (const ev of existingCursor) {
    existingTotal++;
    if (ev.source === RSCHED_SOURCE) {
      existingFromRsched++;
      const rsId = ev.rschedData?.rsId ?? parseRsIdFromEventId(ev.eventId);
      if (rsId != null) existingRsIds.add(Number(rsId));
    }
  }

  // Staging breakdown by status — single aggregate.
  const breakdownAgg = await stagingCollection
    .aggregate([
      { $match: { sessionId: ctx.sessionId } },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ])
    .toArray();
  const byStatus = Object.fromEntries(
    Object.values(STAGING_STATUS).map((s) => [s, 0]),
  );
  for (const b of breakdownAgg) byStatus[b._id] = b.n;

  // Drift breakdown — populated after validate has classified rows.
  // Pre-validate, every row's driftType is null and these counts are 0.
  const driftAgg = await stagingCollection
    .aggregate([
      { $match: { sessionId: ctx.sessionId, status: { $ne: STAGING_STATUS.SKIPPED } } },
      { $group: { _id: '$driftType', n: { $sum: 1 } } },
    ])
    .toArray();
  const byDrift = Object.fromEntries(
    Object.values(DRIFT_TYPE).map((t) => [t, 0]),
  );
  for (const b of driftAgg) {
    if (b._id) byDrift[b._id] = b.n;
  }

  // Match split: which staged rsIds correspond to existing rsched events?
  const stagedRsIds = await stagingCollection
    .find(
      { sessionId: ctx.sessionId, status: { $ne: STAGING_STATUS.SKIPPED } },
      { projection: { rsId: 1 } },
    )
    .toArray();
  let willMatchExisting = 0;
  let willCreate = 0;
  for (const r of stagedRsIds) {
    if (existingRsIds.has(Number(r.rsId))) willMatchExisting++;
    else willCreate++;
  }

  // Removal candidates — reuse existing helper.
  const removalCandidates = await detectRemovedRsIds(
    db,
    {
      calendarOwner,
      dateRangeStart: ctx.dateRangeStart,
      dateRangeEnd: ctx.dateRangeEnd,
    },
    stagedRsIds.map((r) => r.rsId),
  );

  // dateRange summary. In all-time mode return { allTime: true } — without
  // an explicit guard the days computation below would produce NaN from
  // null inputs (Date.parse('nullT00:00:00') = NaN).
  const dateRange = isAllTime
    ? { allTime: true, start: null, end: null, days: null }
    : (() => {
        const days = Math.max(
          1,
          Math.round(
            (Date.parse(`${ctx.dateRangeEnd}T00:00:00`) -
              Date.parse(`${ctx.dateRangeStart}T00:00:00`)) /
              (1000 * 60 * 60 * 24),
          ) + 1,
        );
        return {
          allTime: false,
          start: ctx.dateRangeStart,
          end: ctx.dateRangeEnd,
          days,
        };
      })();

  const stagingTotal = (byStatus[STAGING_STATUS.STAGED] || 0)
    + (byStatus[STAGING_STATUS.CONFLICT] || 0)
    + (byStatus[STAGING_STATUS.UNMATCHED_LOCATION] || 0)
    + (byStatus[STAGING_STATUS.HUMAN_EDIT_CONFLICT] || 0);

  return {
    dateRange,
    existingInRange: {
      total: existingTotal,
      fromRsched: existingFromRsched,
      manual: existingTotal - existingFromRsched,
    },
    csvStaging: {
      total: stagingTotal,
      byStatus,
    },
    plannedActions: {
      willCreate,
      willMatchExisting,                                                 // legacy alias
      willUpdate: byDrift[DRIFT_TYPE.UPDATE] || 0,                       // matched + diffs
      willStayUnchanged: byDrift[DRIFT_TYPE.NO_OP] || 0,                 // matched + no diffs
      willConflictHumanEdit: byDrift[DRIFT_TYPE.HUMAN_EDIT_CONFLICT] || 0,
      willRemove: removalCandidates.length,
      willSkipConflict: byStatus[STAGING_STATUS.CONFLICT] || 0,
      willSkipUnmatched: byStatus[STAGING_STATUS.UNMATCHED_LOCATION] || 0,
    },
    driftBreakdown: byDrift,
    removalCandidates,
  };
}

// =============================================================================
// Drift report (downloadable JSON / CSV)
// =============================================================================

/**
 * Serialize a material-diff value for the report. Unlike truncateDiffValue
 * (which caps for persistence), this returns the full string so admins see
 * complete diff context in their downloaded report.
 */
function serializeDiffValueFull(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return JSON.stringify(value);
  return String(value);
}

/**
 * Build the full drift report for a session: create / update / no_op /
 * human_edit_conflict / removed / errors. Recomputes diffs from live events +
 * staging rawCsv so report values are NOT truncated (UI uses persisted
 * truncated diffs; the report should be exhaustive).
 *
 * @param {Db} db
 * @param {string} sessionId
 * @param {Object} sample - any staging row from the session (for ctx)
 * @returns {Promise<Object>} drift report shape (see endpoint docstring)
 */
async function buildDriftReport(db, sessionId, sample) {
  const stagingCollection = db.collection(STAGING_COLLECTION);
  const eventsCollection = db.collection(EVENTS_COLLECTION);

  // Stream staging rows page-by-page via batchSize cursor. For 80k rows this
  // is materialized via .toArray() but each Cosmos page request is bounded.
  const stagingRows = await stagingCollection
    .find({ sessionId })
    .batchSize(500)
    .toArray();

  const buckets = {
    [DRIFT_TYPE.CREATE]: [],
    [DRIFT_TYPE.UPDATE]: [],
    [DRIFT_TYPE.NO_OP]: [],
    [DRIFT_TYPE.HUMAN_EDIT_CONFLICT]: [],
    unclassified: [],
    errors: [],
  };
  for (const row of stagingRows) {
    if (row.applyError) {
      buckets.errors.push(row);
      continue;
    }
    const t = row.driftType;
    if (t && buckets[t]) buckets[t].push(row);
    else buckets.unclassified.push(row);
  }

  // Re-fetch full event docs for update + human-edit-conflict rows so we can
  // recompute diffs with full (untruncated) values. detectMaterialDifferences
  // is reused unchanged.
  const eventIdsToFetch = [...buckets[DRIFT_TYPE.UPDATE], ...buckets[DRIFT_TYPE.HUMAN_EDIT_CONFLICT]]
    .map((r) => `rssched-${r.rsId}`);
  let liveEventByEventId = new Map();
  if (eventIdsToFetch.length > 0) {
    const liveEvents = await eventsCollection
      .find({ eventId: { $in: eventIdsToFetch } })
      .batchSize(500)
      .toArray();
    liveEventByEventId = new Map(liveEvents.map((e) => [e.eventId, e]));
  }

  function rehydrateDiffs(row) {
    const eventId = `rssched-${row.rsId}`;
    const live = liveEventByEventId.get(eventId);
    if (!live) return row.materialDiffs || [];
    const candidate = buildEventDocFromStaging(row, {
      calendarOwner: sample.calendarOwner,
      calendarId: sample.calendarId,
      importUserId: row.uploadedBy,
    });
    const diffs = detectMaterialDifferences(candidate, live);
    return diffs.map((d) => ({
      field: d.field,
      previous: serializeDiffValueFull(d.existing),
      csv: serializeDiffValueFull(d.candidate),
    }));
  }

  // Removal candidates — events present in Mongo but absent from this CSV.
  const removalCandidates = await detectRemovedRsIds(
    db,
    {
      calendarOwner: sample.calendarOwner,
      dateRangeStart: sample.dateRangeStart,
      dateRangeEnd: sample.dateRangeEnd,
    },
    stagingRows
      .filter((r) => r.status !== STAGING_STATUS.SKIPPED)
      .map((r) => r.rsId),
  );

  return {
    sessionId,
    calendarOwner: sample.calendarOwner,
    generatedAt: new Date().toISOString(),
    summary: {
      willCreate: buckets[DRIFT_TYPE.CREATE].length,
      willUpdate: buckets[DRIFT_TYPE.UPDATE].length,
      willStayUnchanged: buckets[DRIFT_TYPE.NO_OP].length,
      willConflictHumanEdit: buckets[DRIFT_TYPE.HUMAN_EDIT_CONFLICT].length,
      willRemove: removalCandidates.length,
      errors: buckets.errors.length,
      unclassified: buckets.unclassified.length,
    },
    created: buckets[DRIFT_TYPE.CREATE].map((r) => ({
      rsId: r.rsId,
      eventTitle: r.eventTitle,
      startDateTime: r.startDateTime,
      endDateTime: r.endDateTime,
      locationDisplayNames: r.locationDisplayNames,
    })),
    updated: buckets[DRIFT_TYPE.UPDATE].map((r) => ({
      rsId: r.rsId,
      eventId: `rssched-${r.rsId}`,
      eventTitle: r.eventTitle,
      materialDiffs: rehydrateDiffs(r),
    })),
    removed: removalCandidates.map((c) => ({
      rsId: c.rsId,
      eventId: c.eventId,
      eventTitle: c.eventTitle,
      startDateTime: c.startDateTime,
    })),
    humanEditConflicts: buckets[DRIFT_TYPE.HUMAN_EDIT_CONFLICT].map((r) => {
      const live = liveEventByEventId.get(`rssched-${r.rsId}`);
      return {
        rsId: r.rsId,
        eventId: `rssched-${r.rsId}`,
        eventTitle: r.eventTitle,
        lastModifiedBy: live?.lastModifiedBy || null,
        materialDiffs: rehydrateDiffs(r),
      };
    }),
    errors: buckets.errors.map((r) => ({
      rsId: r.rsId,
      rowNumber: r.rowNumber,
      reason: r.applyError || 'unknown',
    })),
    streamError: null,
  };
}

/**
 * Render a drift report as long-format CSV. One row per drift entry; each
 * "update" emits one row per field that differs.
 *
 * Header: rsId,kind,eventTitle,fieldName,previousValue,csvValue
 */
function renderDriftReportCsv(report) {
  const lines = ['rsId,kind,eventTitle,fieldName,previousValue,csvValue'];
  const escape = (val) => {
    if (val == null) return '';
    const s = String(val);
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const emitRow = (rsId, kind, eventTitle, fieldName, previousValue, csvValue) => {
    lines.push(
      [rsId, kind, escape(eventTitle), escape(fieldName), escape(previousValue), escape(csvValue)].join(','),
    );
  };

  for (const r of report.created) {
    emitRow(r.rsId, 'create', r.eventTitle, '', '', '');
  }
  for (const r of report.updated) {
    if (r.materialDiffs.length === 0) {
      emitRow(r.rsId, 'update', r.eventTitle, '', '', '');
    } else {
      for (const d of r.materialDiffs) {
        emitRow(r.rsId, 'update', r.eventTitle, d.field, d.previous, d.csv);
      }
    }
  }
  for (const r of report.removed) {
    emitRow(r.rsId, 'removed', r.eventTitle, '', '', '');
  }
  for (const r of report.humanEditConflicts) {
    if (r.materialDiffs.length === 0) {
      emitRow(r.rsId, 'human_edit_conflict', r.eventTitle, '', '', '');
    } else {
      for (const d of r.materialDiffs) {
        emitRow(r.rsId, 'human_edit_conflict', r.eventTitle, d.field, d.previous, d.csv);
      }
    }
  }
  for (const r of report.errors) {
    emitRow(r.rsId, 'error', '', 'reason', '', r.reason);
  }
  return lines.join('\n') + '\n';
}

// =============================================================================
// Outlook publish
// =============================================================================

/**
 * Build the Graph payload from an event document.
 */
function buildGraphPayload(eventDoc, fallbackTimeZone = 'America/New_York') {
  const isAllDay = Boolean(eventDoc.isAllDayEvent);
  const startSrc = eventDoc.startDateTime || eventDoc.calendarData?.startDateTime;
  const endSrc = eventDoc.endDateTime || eventDoc.calendarData?.endDateTime;

  let start;
  let end;
  if (isAllDay) {
    start = { dateTime: String(startSrc).split('T')[0], timeZone: fallbackTimeZone };
    end = { dateTime: String(endSrc).split('T')[0], timeZone: fallbackTimeZone };
  } else {
    start = { dateTime: String(startSrc), timeZone: fallbackTimeZone };
    end = { dateTime: String(endSrc), timeZone: fallbackTimeZone };
  }

  const locationDisplay = eventDoc.locationDisplayNames || eventDoc.calendarData?.locationDisplayNames || '';

  return {
    subject: eventDoc.eventTitle || eventDoc.calendarData?.eventTitle || '(No title)',
    start,
    end,
    location: { displayName: locationDisplay },
    body: {
      contentType: 'text',
      content: eventDoc.eventDescription || eventDoc.calendarData?.eventDescription || '',
    },
    categories: eventDoc.categories || eventDoc.calendarData?.categories || [],
    isAllDay,
    showAs: 'busy',
    importance: 'normal',
  };
}

/**
 * Publish or update an event in Outlook via app-only Graph auth.
 *
 * @param {Db} db
 * @param {Object} eventDoc - the persisted event document
 * @param {Object} ctx - { graphApiService } - injected for testability
 * @returns {Promise<{outcome: 'published'|'updated'|'skipped', graphEventId?: string, error?: string}>}
 */
async function publishOrUpdateOutlookEvent(db, eventDoc, ctx) {
  const eventsCollection = db.collection(EVENTS_COLLECTION);
  const { graphApiService } = ctx;
  if (!graphApiService) {
    return { outcome: 'skipped', error: 'graphApiService not provided' };
  }

  const calendarOwner = eventDoc.calendarOwner;
  const calendarId = eventDoc.calendarId || null;
  const payload = buildGraphPayload(eventDoc);

  try {
    if (eventDoc.graphData?.id) {
      const updated = await graphApiService.updateCalendarEvent(
        calendarOwner,
        calendarId,
        eventDoc.graphData.id,
        payload,
      );
      await eventsCollection.updateOne(
        { _id: eventDoc._id },
        {
          $set: {
            graphData: { ...(eventDoc.graphData || {}), ...updated },
            lastSyncedAt: new Date(),
          },
        },
      );
      return { outcome: 'updated', graphEventId: updated.id };
    }
    const created = await graphApiService.createCalendarEvent(calendarOwner, calendarId, payload);
    await eventsCollection.updateOne(
      { _id: eventDoc._id },
      {
        $set: {
          graphData: created,
          publishedAt: new Date(),
          lastSyncedAt: new Date(),
        },
      },
    );
    return { outcome: 'published', graphEventId: created.id };
  } catch (err) {
    return { outcome: 'failed', error: err.message };
  }
}

module.exports = {
  // Constants
  RSCHED_SOURCE,
  STAGING_COLLECTION,
  EVENTS_COLLECTION,
  LOCATIONS_COLLECTION,
  AUDIT_COLLECTION,
  STAGING_STATUS,
  APPLY_OUTCOME,
  DRIFT_TYPE,
  MATERIAL_FIELDS,
  MAX_DIFF_VALUE_LENGTH,
  NOTE_RSKEY_SENTINELS,

  // Pure helpers (exported for tests)
  parseCsv,
  parseRschedDate,
  parseRschedTime,
  splitRsKeys,
  parseCategories,
  resolveLocations,
  buildStagingDoc,
  batchInsertStagingDocs,
  buildEventDocFromStaging,
  buildGraphPayload,
  detectMaterialDifferences,
  hasHumanEdits,
  parseRsIdFromEventId,
  computeStagingRowDrift,
  truncateDiffValue,

  // Workflow operations
  applyStagingRow,
  applyAsMaster,
  applyAsException,
  buildSeriesMasterDoc,
  detectRemovedRsIds,
  computePreview,
  bulkComputeDrift,
  persistDriftResults,
  buildDriftReport,
  renderDriftReportCsv,
  publishOrUpdateOutlookEvent,
};
