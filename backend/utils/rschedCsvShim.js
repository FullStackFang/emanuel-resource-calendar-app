'use strict';

/**
 * Compatibility shim for Rsched CSV exports that ship without a header row.
 *
 * The existing rschedImportService.parseCsv() uses csv-parser, which always
 * treats the first line as the header row. Some Rsched exports (notably
 * rsched_all_asof_5_8_2026.csv) start directly with data — passing such a
 * file in causes every row to be parsed with garbage column names and the
 * importer rejects all of them with "Missing rsId".
 *
 * ensureCsvHeader() inspects the first line of a buffer and, if it does not
 * look like a header, prepends the canonical 16-column Rsched header.
 *
 * Columns (in order, matches the schema produced by other Rsched exports):
 *   rsId, Subject, StartDate, StartTime, StartDateTime, EndDate, EndTime,
 *   EndDateTime, AllDayEvent, rsKey, Location, Description, Categories,
 *   Deleted, AttendeeEmails, AttendeeNames
 */

const CANONICAL_RSCHED_HEADER =
  'rsId,Subject,StartDate,StartTime,StartDateTime,EndDate,EndTime,EndDateTime,AllDayEvent,rsKey,Location,Description,Categories,Deleted,AttendeeEmails,AttendeeNames';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function stripBom(buf) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3);
  }
  return buf;
}

function firstLine(buf) {
  const nl = buf.indexOf(0x0a); // LF
  const cr = buf.indexOf(0x0d); // CR — Windows line endings
  let end;
  if (nl === -1 && cr === -1) end = buf.length;
  else if (nl === -1) end = cr;
  else if (cr === -1) end = nl;
  else end = Math.min(nl, cr);
  return buf.slice(0, end).toString('utf8').trim();
}

function looksLikeHeader(line) {
  // Loose match: an Rsched header contains a non-numeric rsId column name.
  // A data row starts with a signed integer, so checking that the first
  // field is a word is enough.
  if (!line) return false;
  const firstField = line.split(',')[0].trim();
  if (/^-?\d+$/.test(firstField)) return false; // leading integer = data row
  if (/^rsid$/i.test(firstField)) return true;
  // Fall-through: anything alphabetic-looking is probably a header.
  return /^[A-Za-z]/.test(firstField);
}

/**
 * Map known column-name aliases to what rschedImportService.parseCsv reads.
 *
 * parseCsv looks up these fields on each row: rsId/RsId/RSID, Subject,
 * StartDate/EndDate, StartTime/EndTime, AllDayEvent, rsKey/RsKey/locationCode,
 * Description, Categories, Deleted, AttendeeEmails, AttendeeNames.
 *
 * Some Rsched exports use slightly different column names — e.g.
 * `LocationCode` (PascalCase) instead of `rsKey`. parseCsv would read
 * undefined and silently produce empty rsKeys for every row. Normalize
 * these aliases on the HEADER line so parseCsv works without modification.
 */
const HEADER_ALIASES = {
  LocationCode: 'rsKey',
  locationcode: 'rsKey',
  Locationcode: 'rsKey',
  locationCode: 'rsKey', // already supported by parseCsv but normalize anyway
};

function normalizeHeader(headerLine) {
  // Split on comma, trim each cell (handles header BOM/whitespace), rename
  // any cell matching an alias, then rejoin. Preserves quoted commas (which
  // are very unusual in Rsched headers but handled by leaving them intact
  // for the parser — we only rename whole-field exact matches).
  const fields = headerLine.split(',').map((f) => f.trim());
  let renamed = false;
  const out = fields.map((f) => {
    if (HEADER_ALIASES[f]) {
      renamed = true;
      return HEADER_ALIASES[f];
    }
    return f;
  });
  return { line: out.join(','), renamed };
}

/**
 * Return a Buffer that is guaranteed to start with a usable CSV header
 * row. Strips BOM, prepends the canonical header if header-less, and
 * normalizes known column-name aliases (e.g. LocationCode → rsKey).
 *
 * @param {Buffer} input
 * @returns {{ buffer: Buffer, headerInjected: boolean, headerNormalized: boolean, originalHadBom: boolean }}
 */
function ensureCsvHeader(input) {
  const originalHadBom = input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf;
  const stripped = stripBom(input);
  const first = firstLine(stripped);

  if (!looksLikeHeader(first)) {
    // Header-less file → prepend canonical.
    const headerBuf = Buffer.from(CANONICAL_RSCHED_HEADER + '\n', 'utf8');
    return {
      buffer: Buffer.concat([headerBuf, stripped]),
      headerInjected: true,
      headerNormalized: false,
      originalHadBom,
    };
  }

  // Header is present. Check if any column names need normalizing.
  const { line: normalized, renamed } = normalizeHeader(first);
  if (!renamed) {
    return { buffer: stripped, headerInjected: false, headerNormalized: false, originalHadBom };
  }

  // Splice the normalized header back into the buffer in place of the
  // original first line. Find the first newline; replace bytes [0, nl)
  // with the normalized header bytes.
  const nl = stripped.indexOf(0x0a);
  // CRLF handling: if the byte before LF is CR, treat the CR as part of
  // the line terminator that we keep intact after splicing.
  const restStart = nl === -1 ? stripped.length : nl; // keep LF (and preceding CR if any)
  const rest = nl === -1 ? Buffer.alloc(0) : stripped.slice(restStart);
  return {
    buffer: Buffer.concat([Buffer.from(normalized, 'utf8'), rest]),
    headerInjected: false,
    headerNormalized: true,
    originalHadBom,
  };
}

module.exports = {
  CANONICAL_RSCHED_HEADER,
  ensureCsvHeader,
  // exported for unit tests
  _internal: { stripBom, firstLine, looksLikeHeader },
};
