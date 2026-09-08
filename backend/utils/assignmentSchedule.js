/**
 * Per-recipient assignment schedule: the chronological ORDER of one person's
 * posts and the single-column itinerary the schedule email renders them as.
 *
 * Pure and dependency-light (escape-html plus icsBuilder's time resolution)
 * so the admin Email Management preview can render a real sample itinerary
 * through the SAME code the send path uses — never a hand-written paraphrase
 * that drifts from the real email.
 */

const escapeAssignmentHtml = require('escape-html');
const { resolveEventWindow } = require('./icsBuilder');

/**
 * Chronological order for one person's entries (as produced by
 * extractDayAssignments in api-server.js): calendar date first, then the
 * moment the person is due, then column name and row label as stable
 * tie-breakers.
 *
 * "When the person is due" is resolved by icsBuilder.resolveEventWindow, so
 * the email body, the .ics attachment and My Assignments all agree on one
 * reading of the free-text cells: effective call time (person override, then
 * the column's Call Time row) -> Begins -> the linked event's start. An entry
 * with no resolvable time ('TBD', 'after Mincha' with no linked event, or
 * nothing at all) sorts AFTER every timed post on its day — it is real
 * content and must still be listed, but it cannot claim a slot on the clock.
 *
 * This replaced a date-then-COLUMN-NAME sort, under which a 5:00 PM dinner in
 * 'YP Dinner' printed below a 7:30 PM service in 'Erev Service'.
 */
function assignmentStartMs(entry) {
  const window = resolveEventWindow(entry);
  return window.allDay ? Number.POSITIVE_INFINITY : window.start.getTime();
}

function compareAssignments(a, b) {
  const byDate = String(a.date || '').localeCompare(String(b.date || ''));
  if (byDate) return byDate;
  const aMs = assignmentStartMs(a);
  const bMs = assignmentStartMs(b);
  if (aMs !== bMs) return aMs < bMs ? -1 : 1;
  return (
    String(a.columnName || '').localeCompare(String(b.columnName || '')) ||
    String(a.rowLabel || '').localeCompare(String(b.rowLabel || ''))
  );
}

/** A new array in chronological order; the input is not mutated. */
function sortAssignments(entries) {
  return [...entries].sort(compareAssignments);
}

/** 'Saturday, Sep 11' — or with the year, when a schedule spans two of them. */
function formatSheetDayHeading(dateStr, withYear) {
  try {
    return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {})
    });
  } catch {
    return dateStr;
  }
}


/** The calendar year of a YYYY-MM-DD sheet date. */
const sheetDateYear = (dateStr) => String(dateStr || '').slice(0, 4);

/**
 * Sheet times are FREE TEXT and are printed verbatim — they legitimately read
 * things like 'HD 4:30pm / Reg 4:45pm', so parsing them would lose content.
 * The one exception is a bare 24-hour HH:MM, which is exactly what a
 * per-person `callTimeOverride` stores (sheetCells.js validates it against
 * HHMM_RE). Left alone, a single email prints '17:30' immediately below
 * '5:00 PM' in the same position — two clocks in one message, for a reader
 * checking when they are due. Only that exact shape is converted; everything
 * else passes through untouched.
 *
 * Display-only, deliberately: `extractDayAssignments` still returns the raw
 * value, because GET /api/my-assignments has always returned the stored string
 * and its contract is not this change's business.
 */
function displaySheetClock(value) {
  const raw = String(value == null ? '' : value).trim();
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(raw);
  if (!m) return raw;
  const hour24 = Number(m[1]);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${m[2]} ${hour24 < 12 ? 'AM' : 'PM'}`;
}

/** 'three posts across two days' — the intro line's factual summary. */
function buildAssignmentSummary(entries) {
  const days = new Set(entries.map((e) => e.date)).size;
  const posts = entries.length;
  const years = [...new Set(entries.map((e) => sheetDateYear(e.date)))];
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const span = `${plural(posts, 'post')} across ${plural(days, 'day')}`;
  // The year is stated once here so it can stay off every day heading, which
  // is what keeps a heading to one unwrapped line. A schedule that straddles
  // New Year gets the year on each heading instead (see buildAssignmentsHtml).
  return years.length === 1 ? `${span}, all in ${years[0]}` : span;
}

/**
 * Render one recipient's assignments (already sorted) as a single-column
 * itinerary: a rule per day, then a block per post led by the call time.
 *
 * It replaced a six-column table that could not survive its own content. The
 * table gave the date a quarter of its width under `white-space: nowrap` for
 * the long 'Friday, September 11, 2026' form, forced Call time and the event
 * window to share one column (so a post with a call time printed no window at
 * all), and at 880px could not be read on a phone at any zoom. Email has no
 * responsive lever that both Outlook's Word engine and the Gmail app honour,
 * so the fix is structural: one column reflows everywhere by construction.
 */
function buildAssignmentsHtml(entries) {
  const esc = (v) => escapeAssignmentHtml(String(v));
  const withYear = new Set(entries.map((e) => sheetDateYear(e.date))).size > 1;

  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  const blocks = [...byDate.entries()].map(([date, dayEntries], dayIndex) => {
    const dayTitle = dayEntries.find((e) => e.dayTitle)?.dayTitle;
    const rule = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse;${dayIndex ? ' margin-top: 28px;' : ''}">
  <tr><td style="padding: 0 0 9px; border-bottom: 2px solid #1c2430;">
    <span style="color: #1c2430; font-size: 15px; font-weight: bold;">${esc(formatSheetDayHeading(date, withYear))}</span>${
      dayTitle ? `<span style="color: #6b7684; font-size: 13px;">&nbsp;&middot;&nbsp; ${esc(dayTitle)}</span>` : ''
    }
  </td></tr>
</table>`;

    const posts = dayEntries.map((e) => {
      const callTime = displaySheetClock(e.callTime);
      const window = [e.begins, e.ends]
        .filter(Boolean)
        .map((t) => esc(displaySheetClock(t)))
        .join(' &ndash; ');

      // Call time leads when there is one, because it is the only value the
      // recipient acts on; the event window is a caption beside it rather
      // than a competitor for the same slot. With no call time the window is
      // promoted to the lead so the block is never headed by nothing. With
      // neither, the time block is omitted entirely rather than printing an
      // em-dash that reads like recorded data.
      let lead = '';
      if (callTime) {
        const caption = window ? `call time &nbsp;&middot;&nbsp; event runs ${window}` : 'call time';
        lead = `<p style="margin: 0 0 3px; color: #3b6eb8; font-size: 19px; font-weight: bold;">${esc(callTime)}</p>
        <p style="margin: 0 0 7px; color: #6b7684; font-size: 12px;">${caption}</p>`;
      } else if (window) {
        lead = `<p style="margin: 0 0 3px; color: #3b6eb8; font-size: 19px; font-weight: bold;">${window}</p>
        <p style="margin: 0 0 7px; color: #6b7684; font-size: 12px;">event window &nbsp;&middot;&nbsp; no call time recorded</p>`;
      }

      // rowLabel is the post; columnName is the event it sits under. Either
      // can be absent on a hand-built sheet, so the title falls through. The
      // event line is dropped when the day heading already carries that exact
      // name — a one-event day otherwise prints 'Erev Rosh Hashanah' twice,
      // four lines apart.
      const title = e.rowLabel || e.columnName || 'Assignment';
      const sub = e.rowLabel && e.columnName && e.columnName !== dayTitle
        ? `<p style="margin: 0 0 8px; color: #4a5568; font-size: 14px;">${esc(e.columnName)}</p>`
        : '';

      const lines = (e.locationLines && e.locationLines.length
        ? e.locationLines
        : (e.location ? [e.location] : [])
      ).map(esc);
      const where = lines.length
        ? `<p style="margin: 0 0 ${e.note ? '8' : '0'}px; color: #4a5568; font-size: 14px; line-height: 1.5;">${lines.join('<br>')}</p>`
        : '';

      const note = e.note
        ? `<table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse: collapse;"><tr>
          <td style="background: #fdf8ec; border: 1px solid #e8d9b8; padding: 8px 12px; color: #6b5426; font-size: 13px; line-height: 1.5;">${esc(e.note)}</td>
        </tr></table>`
        : '';

      return `<tr><td style="padding: 16px 0 15px; border-bottom: 1px solid #e6e9ed;">
        ${lead}
        <p style="margin: 0 0 3px; color: #1c2430; font-size: 16px; font-weight: bold;">${esc(title)}</p>
        ${sub}${where}${note}
      </td></tr>`;
    });

    return `${rule}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width: 100%; border-collapse: collapse;">
${posts.join('\n')}
</table>`;
  });

  return blocks.join('\n');
}

module.exports = {
  compareAssignments,
  sortAssignments,
  formatSheetDayHeading,
  sheetDateYear,
  displaySheetClock,
  buildAssignmentSummary,
  buildAssignmentsHtml
};
