// src/components/scheduling/assignmentSubject.js
//
// The schedule email's subject line, resolved for a given day selection.
//
// Every recipient of one send shares a subject, and it used to be the WORKBOOK
// name for anything wider than a single day — so a Friday-only send and a
// whole-workbook send landed in an inbox looking identical, and a follow-up send
// was indistinguishable from the first. These rules name the dates instead.
//
// WHY THIS IS CLIENT-SIDE, and not shared with the server: the panel prefills an
// editable field, and whatever is in that field is sent explicitly as `subject`.
// So the client is the only place that needs to compose a default. The server
// keeps its own simpler rule purely as the fallback for a request that carries
// no subject at all (an older client, a replayed body), which means these rules
// exist in exactly one place and cannot drift from a backend copy.
//
// Pure and dependency-free, like sheetEventUtils.js. Its own file rather than an
// addition to that one, which is being edited elsewhere.

/** 'Saturday, September 11, 2027' — the long form a one-day send has always used. */
function longDayLabel(dateStr) {
  try {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/** 'Sep 11' — short enough that several fit in one subject line. */
function shortDate(dateStr) {
  try {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/** 'a, b & c' — an inbox subject reads better with the conjunction than a bare list. */
function joinDates(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`;
}

// Past three dates the list stops fitting in the width an inbox actually shows,
// and a subject truncated mid-date is worse than a summarized one.
const MAX_LISTED_DATES = 3;

/**
 * Describe the selected days for a subject line.
 *
 * One day is named by its own full date; the whole workbook is named by the
 * workbook alone (both unchanged from previous behavior); a subset names the
 * workbook and then its dates, collapsing to a count and a span past three.
 *
 * @param {object} args
 * @param {string} args.sheetName
 * @param {Array<{_id:any,date:string}>} args.allDays every day in the workbook
 * @param {string[]} args.selectedDayIds
 * @returns {string}
 */
export function buildScopeLabel({ sheetName, allDays = [], selectedDayIds = [] }) {
  const wanted = new Set((selectedDayIds || []).map(String));
  const selected = (allDays || [])
    .filter((d) => wanted.has(String(d._id)))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  // Nothing selected: sending is disabled, but the field is still on screen.
  if (!selected.length) return sheetName || '';
  if (selected.length === 1) return longDayLabel(selected[0].date);
  // Every day in the workbook IS the workbook, however many days that is.
  if (selected.length === (allDays || []).length) return sheetName || '';

  const dates = selected.map((d) => shortDate(d.date));
  if (dates.length <= MAX_LISTED_DATES) {
    return `${sheetName} — ${joinDates(dates)}`;
  }
  return `${sheetName} — ${dates.length} days, ${dates[0]}-${dates[dates.length - 1]}`;
}

/**
 * Resolve a subject template against a day selection. The template comes from
 * the server so that a subject customized in Email Management is respected;
 * a template with no placeholder is returned as written, because that wording
 * was somebody's deliberate choice.
 */
export function buildAssignmentSubject({ subjectTemplate, sheetName, allDays, selectedDayIds }) {
  const scopeLabel = buildScopeLabel({ sheetName, allDays, selectedDayIds });
  const template = String(subjectTemplate == null ? '' : subjectTemplate).trim();
  // No template at all still has to yield something sendable.
  if (!template) return scopeLabel;
  return template.replace(/\{\{\s*scopeLabel\s*\}\}/g, scopeLabel);
}
