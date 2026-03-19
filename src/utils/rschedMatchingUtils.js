// src/utils/rschedMatchingUtils.js
/**
 * Pure matching utilities for RSched CSV location/category mapping.
 * No React dependencies — independently testable.
 */

/**
 * Normalize a string for comparison: lowercase, strip non-alphanumeric.
 */
export function normalize(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Dice coefficient similarity on character bigrams.
 * Returns 0..1 where 1 = identical.
 */
export function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;

  const bigrams = (s) => {
    const set = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bi = s.slice(i, i + 2);
      set.set(bi, (set.get(bi) || 0) + 1);
    }
    return set;
  };

  const bg1 = bigrams(na);
  const bg2 = bigrams(nb);
  let intersection = 0;
  for (const [bi, count] of bg1) {
    if (bg2.has(bi)) {
      intersection += Math.min(count, bg2.get(bi));
    }
  }
  return (2 * intersection) / (na.length - 1 + nb.length - 1);
}

/**
 * Hardcoded RSched location name → rsKey map.
 * Fallback when DB aliases[] don't cover legacy RSched names.
 */
export const RSCHED_ALIASES = {
  // Chapels
  'Beth-El Chapel': 'CPL',
  'Greenwald Chapel': 'CPL',
  'Chapel': 'CPL',

  // Sanctuary
  'Sanctuary': 'SNC',
  'Main Sanctuary': 'SNC',

  // Meeting rooms
  'Board of Trustees Room': '800',
  'Board Room': '800',
  'Trustee Room': '800',

  // Lounges
  '6th Floor Lounge - 602': '602',
  '6th Floor Lounge': '602',
  'Sixth Floor Lounge': '602',

  // Halls
  'Blumenthal Hall': 'BLU',
  'Greenwald Hall': 'GRN',
  'Skirball Hall': 'SKR',

  // Religious School / Nursery
  'Nursery School': 'N/S',
  'Religious School': 'R/S',

  // Museum
  'Museum': 'MUS',
  'Herbert & Eileen Bernard Museum': 'MUS',

  // Other
  'Levy Center': 'LEV',
  'Library': 'LIB',
  'Kitchen': 'KIT',
  'Lobby': 'LOB',

  // Notes (non-room locations in RSched)
  'Note1': 'NOTE',
  'Note2': 'NOTE',
  'Archive': 'ARC',
};

/**
 * Build a preprocessed location index for fast lookups.
 * @param {Array} locations - DB locations with _id, name, rsKey, aliases[]
 * @returns {{ byRsKey: Map, byAlias: Map, byName: Map, list: Array }}
 */
export function buildLocationIndex(locations) {
  const byRsKey = new Map();
  const byAlias = new Map();
  const byName = new Map();

  for (const loc of locations) {
    // Index by rsKey
    if (loc.rsKey) {
      byRsKey.set(normalize(loc.rsKey), loc);
    }

    // Index by name
    if (loc.name) {
      byName.set(normalize(loc.name), loc);
    }

    // Index by DB aliases
    if (loc.aliases && Array.isArray(loc.aliases)) {
      for (const alias of loc.aliases) {
        if (alias) {
          byAlias.set(normalize(alias), loc);
        }
      }
    }
  }

  // Index hardcoded RSCHED_ALIASES → location (by rsKey)
  // These go into a separate map so DB aliases take priority
  const byHardcodedAlias = new Map();
  for (const [aliasName, rsKey] of Object.entries(RSCHED_ALIASES)) {
    const loc = byRsKey.get(normalize(rsKey));
    if (loc) {
      byHardcodedAlias.set(normalize(aliasName), loc);
    }
  }

  return { byRsKey, byAlias, byName, byHardcodedAlias, list: locations };
}

/**
 * Find the best matching location for a CSV token.
 * Priority: rsKey exact → name exact → DB alias → hardcoded alias → fuzzy >= 0.5 → null
 * @param {string} token - raw location string from CSV
 * @param {object} locationIndex - from buildLocationIndex()
 * @returns {{ location: object, score: number, method: string } | null}
 */
export function findBestLocationMatch(token, locationIndex) {
  if (!token || !locationIndex) return null;
  const norm = normalize(token);
  if (!norm) return null;

  const { byRsKey, byAlias, byName, byHardcodedAlias, list } = locationIndex;

  // 1. Exact rsKey match
  if (byRsKey.has(norm)) {
    return { location: byRsKey.get(norm), score: 1.0, method: 'exact' };
  }

  // 2. Exact name match
  if (byName.has(norm)) {
    return { location: byName.get(norm), score: 1.0, method: 'exact' };
  }

  // 3. DB alias match
  if (byAlias.has(norm)) {
    return { location: byAlias.get(norm), score: 0.95, method: 'alias' };
  }

  // 4. Hardcoded alias match
  if (byHardcodedAlias.has(norm)) {
    return { location: byHardcodedAlias.get(norm), score: 0.9, method: 'alias' };
  }

  // 5. Fuzzy match against all location names (threshold 0.5)
  let best = null;
  let bestScore = 0;
  for (const loc of list) {
    const nameScore = similarity(token, loc.name || '');
    if (nameScore > bestScore) {
      bestScore = nameScore;
      best = loc;
    }
    // Also try displayName if different
    if (loc.displayName && loc.displayName !== loc.name) {
      const dispScore = similarity(token, loc.displayName);
      if (dispScore > bestScore) {
        bestScore = dispScore;
        best = loc;
      }
    }
  }

  if (best && bestScore >= 0.5) {
    return { location: best, score: bestScore, method: 'fuzzy' };
  }

  return null;
}

/**
 * Find the best matching category for a CSV token.
 * Priority: exact name → fuzzy >= 0.4 → null
 * @param {string} token - raw category string from CSV
 * @param {Array} categories - DB categories with _id, name
 * @returns {{ category: object, score: number, method: string } | null}
 */
export function findBestCategoryMatch(token, categories) {
  if (!token || !categories || !categories.length) return null;
  const norm = normalize(token);
  if (!norm) return null;

  // 1. Exact name match
  for (const cat of categories) {
    if (normalize(cat.name) === norm) {
      return { category: cat, score: 1.0, method: 'exact' };
    }
  }

  // 2. Fuzzy match (threshold 0.4)
  let best = null;
  let bestScore = 0;
  for (const cat of categories) {
    const score = similarity(token, cat.name || '');
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }

  if (best && bestScore >= 0.4) {
    return { category: best, score: bestScore, method: 'fuzzy' };
  }

  return null;
}

/**
 * Parse an RSched CSV export (header-aware, RFC 4180 quoted fields, BOM stripping).
 * Skips rows where Deleted === '1'.
 * @param {string} csvText - raw CSV file content
 * @returns {{ headers: string[], rows: object[], uniqueLocationTokens: string[], uniqueCategoryTokens: string[] }}
 */
export function parseRSchedCSV(csvText) {
  if (!csvText) return { headers: [], rows: [], uniqueLocationTokens: [], uniqueCategoryTokens: [] };

  // Strip BOM
  let text = csvText;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const lines = parseCSVLines(text);
  if (lines.length === 0) {
    return { headers: [], rows: [], uniqueLocationTokens: [], uniqueCategoryTokens: [] };
  }

  const headers = lines[0];
  const rows = [];
  const locationSet = new Set();
  const categorySet = new Set();

  for (let i = 1; i < lines.length; i++) {
    const fields = lines[i];
    if (fields.length === 0 || (fields.length === 1 && !fields[0])) continue;

    // Build row object from header names
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = j < fields.length ? fields[j] : '';
    }

    // Skip deleted rows
    if (row.Deleted === '1') continue;

    rows.push(row);

    // Collect unique tokens
    const loc = (row.Location || '').trim();
    if (loc) locationSet.add(loc);

    const cat = (row.Categories || '').trim();
    if (cat) categorySet.add(cat);
  }

  return {
    headers,
    rows,
    uniqueLocationTokens: [...locationSet].sort(),
    uniqueCategoryTokens: [...categorySet].sort(),
  };
}

/**
 * Parse CSV text into array of field arrays, handling RFC 4180 quoted fields.
 */
function parseCSVLines(text) {
  const results = [];
  let current = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        current.push(field);
        field = '';
        i++;
      } else if (ch === '\r') {
        // Handle \r\n or lone \r
        current.push(field);
        field = '';
        results.push(current);
        current = [];
        i++;
        if (i < text.length && text[i] === '\n') i++;
      } else if (ch === '\n') {
        current.push(field);
        field = '';
        results.push(current);
        current = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Last field/row
  if (field || current.length > 0) {
    current.push(field);
    results.push(current);
  }

  return results;
}

/**
 * Escape a value for CSV output (RFC 4180).
 */
export function escapeCSV(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Build mapped CSV preserving all original columns, inserting rsKey after AllDayEvent.
 * @param {string[]} headers - original CSV headers
 * @param {object[]} rows - parsed row objects
 * @param {object} locationMappings - { [token]: { location, score, method } | null }
 * @param {object} categoryMappings - { [token]: { category, score, method } | null }
 * @returns {string} CSV text
 */
export function buildMappedCSV(headers, rows, locationMappings, categoryMappings) {
  // Insert rsKey column after AllDayEvent
  const allDayIdx = headers.indexOf('AllDayEvent');
  const insertIdx = allDayIdx >= 0 ? allDayIdx + 1 : headers.length;

  const outputHeaders = [...headers];
  // Only insert if rsKey not already present
  if (!outputHeaders.includes('rsKey')) {
    outputHeaders.splice(insertIdx, 0, 'rsKey');
  }

  const csvLines = [outputHeaders.map(escapeCSV).join(',')];

  for (const row of rows) {
    const locToken = (row.Location || '').trim();
    const catToken = (row.Categories || '').trim();

    // Resolve rsKey from location mapping
    const locMatch = locToken ? locationMappings[locToken] : null;
    const rsKey = locMatch?.location?.rsKey || '';

    // Resolve category from category mapping
    const catMatch = catToken ? categoryMappings[catToken] : null;
    const resolvedCategory = catMatch?.category?.name || row.Categories || '';

    const line = outputHeaders.map(h => {
      if (h === 'rsKey') return escapeCSV(rsKey);
      if (h === 'Categories') return escapeCSV(resolvedCategory);
      return escapeCSV(row[h] || '');
    });

    csvLines.push(line.join(','));
  }

  return csvLines.join('\r\n');
}
