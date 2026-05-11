// Calendar-list deduplication.
//
// Graph's /users/{owner}/calendars enumerates every folder in a mailbox: the
// default calendar AND any secondary folders (e.g., a stray 'Untitled Calendar'
// that was created and never used). All of them carry the same owner.address,
// so the allowedDisplayCalendars filter passes every one of them through.
//
// The dropdown should show ONE option per mailbox — both because the events
// load is keyed on calendarOwner (so multiple rows with the same owner load
// identical data and only confuse the admin), and because the admin's
// 'Default Calendar' setting in CalendarConfigAdmin works at the mailbox
// level, not the folder level.
//
// Dedupe key: lowercased owner.address. Preference: isDefaultCalendar: true
// wins over isDefaultCalendar: false. Tiebreaker: first one seen. Using the
// owner address as the dedupe key (rather than filtering on isDefaultCalendar
// directly) keeps each mailbox visible even if Outlook momentarily lacks a
// default flag — a state that has been observed during mailbox migrations.
//
// Pure function: no side effects. Returns a new array; input is not mutated.

function ownerKeyOf(cal) {
  return cal?.owner?.address?.toLowerCase() || null;
}

export function dedupeCalendarsByOwner(calendars) {
  if (!Array.isArray(calendars)) return [];
  const byOwner = new Map();
  for (const cal of calendars) {
    const key = ownerKeyOf(cal);
    if (!key) continue;
    const existing = byOwner.get(key);
    if (!existing) {
      byOwner.set(key, cal);
    } else if (cal.isDefaultCalendar && !existing.isDefaultCalendar) {
      byOwner.set(key, cal);
    }
  }
  return Array.from(byOwner.values());
}
