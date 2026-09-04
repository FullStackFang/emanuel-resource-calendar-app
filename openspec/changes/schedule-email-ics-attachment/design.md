## Context

`POST /api/scheduling-sheets/:id/email` sends one message per tagged person, covering all their assignments in the chosen scope (one day, or the whole workbook). Each message already carries the workbook PDF, rendered client-side by `generateSchedulingSheetPdf` and uploaded as `attachment: { fileName, contentBase64 }`. That attachment is a *picture of the grid* — useful to read, useless to a calendar.

The pieces needed to do better are already in place:

- **`extractDayAssignments(day)`** (api-server.js ~21003) yields one entry per person-chip occurrence with `date`, `callTime` (person `callTimeOverride` already beating the column Call Time row), `begins`, `ends`, `location`, `locationLines`, `columnName`, `dayTitle`, `rowLabel`, and `note`. The send endpoint already groups these by recipient.
- **`emailService.sendEmail`** takes `attachments: [{ name, contentType, contentBase64 }]` with a **per-attachment** content type and maps them to Graph `fileAttachment` resources. No change needed there.
- **`normalizeLinkedEvent`** stores an immutable link-time `snapshot { title, startDateTime, endDateTime, locationNames }` on any column linked to a published event.

The constraint that shapes everything: **Begins, Ends and Call Time are free-text cells.** `cellDisplayParts()` joins location-chip names and raw text segments into a display string. '5:30', '6:00 PM', '17:30', 'TBD', 'after Mincha', and empty are all legal, real content. The registered memory that offsite venues live in the Location row as plain text is the same lesson in a different row: these cells are prose, and a calendar generator must cope rather than legislate.

## Goals / Non-Goals

**Goals:**
- A recipient can add their entire in-scope schedule to their own calendar in one action from the email.
- Every assignment reaches the file. A cell nobody could parse becomes an all-day entry, not a silent omission.
- A calendar entry covers the person's actual commitment — from their call time to the end of the event.
- Re-sending an edited sheet updates existing entries rather than duplicating them, as far as each client honors that.
- A broken or oversized attachment never withholds the schedule, matching the placeholder and PDF precedents on this endpoint.

**Non-Goals:**
- Retracting entries when an assignment is deleted (`METHOD:CANCEL`). It only works on entries the recipient added from a matching `UID`, so it is an all-or-nothing commitment and belongs in its own change.
- A subscribable `webcal://` assignments feed. Strictly better for staleness, materially more surface (token issuance, public endpoint, revocation), and orthogonal to this change.
- Calendar attachments on approval / publish / event-updated emails. Those carry real ISO datetimes and need none of the parsing machinery here; a separate, simpler change.
- A toggle for the workbook PDF. It ships unconditionally today and stays that way; adding a second control is scope this change did not ask for.
- Writing anything to Outlook, Graph, or `templeEvents__Events`. Scheduling sheets are an artifact builder and remain one.

## Decisions

### D1 — One multi-VEVENT file per recipient, built inside the fan-out

A `VCALENDAR` holds `1..N` `VEVENT` components, so one file carrying a person's whole season is ordinary iCalendar, not a trick.

This creates the one structural difference from the PDF. The PDF is a single blob built **once, outside** the `Promise.allSettled` map, and attached identically to all 31 messages. The calendar file **differs per recipient**, so it must be built **inside** the per-recipient callback, from that recipient's own `entries` array — the array the send loop already sorts chronologically.

*Alternative rejected:* one file per assignment. It multiplies attachments, and a person with nine shifts gets nine files to open one at a time.

### D2 — METHOD:PUBLISH, never METHOD:REQUEST

`REQUEST` makes the file a meeting invitation. Exchange would render Accept/Decline, treat the sending mailbox as **organizer** of a 31-attendee meeting, and accrue RSVP tracking on every send. `PUBLISH` means 'here is an event, add it if you like' — no RSVP, no organizer relationship, no server-side meeting object.

The `METHOD:PUBLISH` line lives in the file body. The attachment content type is `text/calendar; charset=utf-8; method=PUBLISH` — the parameter is what prompts several clients to offer an inline 'Add to Calendar' affordance rather than a bare download.

### D3 — The entry spans effective call time to end

A staff member called at 4:30 for a 6:00 service needs 4:30 blocked, not 6:00. `DTSTART` therefore resolves in order:

1. `entry.callTime` — which `extractDayAssignments` already resolves as person `callTimeOverride` over the column's Call Time row.
2. `entry.begins`.
3. The column's `linkedEvent.snapshot.startDateTime`.
4. Otherwise: all-day (D5).

`DTEND` resolves `entry.ends` then `snapshot.endDateTime` then `DTSTART + 2h`. A resolved end earlier than the start is read as crossing midnight and rolled to the next day; without that rule a 10:00 PM call ending at 1:00 AM produces a negative-duration event that clients reject outright.

The two-hour default is a stated fallback, not a claim — the `DESCRIPTION` always carries the literal cell text, so the recipient can see what the sheet actually said.

### D4 — Time parsing: conservative, with one documented ambiguity rule

The parser accepts `H:MM` and `H` with an optional meridiem, and 24-hour `HH:MM`. Everything else fails to D5.

Bare times with no meridiem are genuinely ambiguous, and refusing them would push the common case ('5:30', which is what people actually type) into all-day and gut the feature. The rule: **hour 12 and hours 1 through 6 resolve to PM; hours 7 through 11 resolve to AM.** That is the reading a human already applies to a temple schedule, and the raw text rides along in `DESCRIPTION` so a wrong guess is visible rather than silent.

*Alternative considered:* use a linked column's snapshot to disambiguate — pick whichever reading sits closer to the real event time. Genuinely better where a link exists, but it makes the resolution order conditional on link state and harder to reason about, and it helps only linked columns. Deferred; the snapshot stays a plain fallback (D3) rather than a disambiguator.

### D5 — Unparseable means all-day, never omitted

An assignment whose times cannot be resolved becomes an all-day `VEVENT`: `DTSTART;VALUE=DATE:20260921` with an **exclusive** `DTEND;VALUE=DATE:20260922`, the same exclusive-end convention `buildGraphMarkerEventData` already uses for all-day markers. The summary names the assignment, the description carries the raw cell text and points at the schedule.

This is the placeholder decision applied to a second surface: one unparseable cell is a reason to tell someone their calendar entry has no time, not a reason to leave the shift off their calendar entirely.

### D6 — Identity: stable UID, SEQUENCE from the day _version

Whether a re-send updates or duplicates is decided entirely by `UID` and `SEQUENCE`.

`UID` is composed from identifiers that are stable across every edit that is not a deletion:

```
<dayId>-<rowId>-<colId>-<sanitized email>@emanuelnyc.org
```

`dayId` is a Mongo ObjectId; `rowId` and `colId` are UUIDs assigned at creation. Crucially, the drag-reorder feature moves array **positions**, never ids — so reordering columns or custom rows does not re-identify anybody's calendar entries. The email is included because one cell can hold several person chips, and is sanitized to `[a-z0-9-]`. Two distinct addresses could in principle sanitize alike, but they would also have to share one cell; the consequence is a single merged entry, and the tradeoff buys a genuinely dependency-free builder with no hashing.

`SEQUENCE` takes the day document's `_version`, which is already `$inc`'d on every structural and cell write. Note the honest consequence: editing *anyone's* cell bumps the day version, so unrelated recipients get a higher `SEQUENCE` with byte-identical content on the next send. Clients treat that as a no-op update, so it costs nothing.

*Alternative rejected:* a content hash as `SEQUENCE`. `SEQUENCE` must be monotonically increasing per RFC 5545; a hash is not ordered, and a decrease makes clients discard the update.

### D7 — UTC instants, computed DST-correctly, with no VTIMEZONE

Sheet dates are plain `YYYY-MM-DD` and cell times are local wall-clock in `America/New_York` — the timezone already hard-coded across `emailTemplates.js` and `api-server.js`.

The builder converts wall-clock to a UTC instant using `Intl.DateTimeFormat` to read the zone's offset **at that specific date** (guess-then-correct, with one refinement pass to handle a DST boundary), and emits `DTSTART:20260911T203000Z`. Node ships full ICU, so the zone resolves without a dependency.

*Alternative rejected:* `DTSTART;TZID=America/New_York:20260911T163000` plus a hand-written `VTIMEZONE` block. More faithful in principle, but a `TZID` without an accompanying `VTIMEZONE` is technically invalid, and hand-maintaining DST rules to stay valid is a liability with no payoff for events whose instants are fixed. UTC also matches the app's existing storage discipline and the codebase's standing lesson about `Z` suffixes.

### D8 — icsBuilder.js is pure and backend-side

A new `backend/utils/icsBuilder.js`, dependency-free and free of server imports — the stance `sheetCells.js`, `concurrencyRules.js` and `conflictDelta.js` already establish, so format conformance is unit-testable with no database and no mail service.

It goes on the **server**, and this is the deliberate opposite of the PDF decision. The PDF had to render client-side because jsPDF and its embedded DM Sans faces exist only in the frontend bundle, and a server copy would be a second drifting implementation of a 900-line layout. An iCalendar file has no such constraint: it is string assembly over data the server already holds. Building it client-side would mean shipping the recipient grouping to the browser for no reason.

### D9 — Format mechanics that are usually the bug

- **CRLF** line endings throughout, including the final line.
- **Line folding at 75 octets**, counted in **UTF-8 bytes, not characters** — a name with an accent is two bytes, and folding on character count produces files that fail validation only for the people whose names have accents.
- **TEXT escaping**: backslash, then `;`, `,`, and newline to a literal `\n`, in `SUMMARY`, `DESCRIPTION` and `LOCATION`.
- `DTSTAMP` on every component, set to send time. `PRODID`, `VERSION:2.0`, `CALSCALE:GREGORIAN` on the calendar.
- `LOCATION` takes `entry.locationLines` joined — the memory that offsite venues are free text in the Location row means this field must pass prose through untouched rather than expect chips.

### D10 — Failure isolation and the size budget

A calendar file that throws during construction warns via a new `calendarWarning` and the send proceeds — the `ASSIGNMENT_SCHEDULE` body is self-contained by design, which is exactly why the PDF is already allowed to fail this way.

The file shares the existing Graph message budget with the PDF rather than sitting outside it. A `VEVENT` is roughly 300 bytes, so a 40-shift season is around 12KB against a 3MB guard — but the check is made rather than assumed, with a dedicated cap; an implausibly large file is dropped with a warning, never sent.

### D11 — Panel toggle, defaulting on

`EmailSchedulesPanel` already owns the request body it hands to `onSend`, so the toggle is local state plus one field: `includeCalendar`, default `true`. No prop threading through `SchedulingSheets.jsx`, which passes `body` straight through.

Default on because the feature is worthless if nobody remembers it; a toggle at all because Outlook-on-the-web's handling of a multi-event attachment is the one behavior that cannot be established from this repository, and a sender who hits a bad client needs a way to turn it off without a deploy.

### D12 — extractDayAssignments gains two fields, additively

The entry shape grows `sequence` (the day `_version`) and `linkedSnapshot` (the column's `linkedEvent.snapshot`, or null). The function is shared with `GET /api/my-assignments`, which selects the fields it renders; both additions are purely additive and that consumer must be verified untouched.

## Risks / Trade-offs

- **Outlook on the web may handle a multi-VEVENT attachment poorly** → The single unknown that code cannot answer. Mitigated by D11's toggle and by a required manual verification task covering OWA, Outlook desktop, iOS Mail and Gmail before this is announced to staff.
- **Exchange may transform a message carrying a text/calendar part** → `METHOD:PUBLISH` (D2) is specifically the method that is not an invitation, which should prevent it. Verified in the manual task; if it misbehaves, dropping the `method=` content-type parameter is the first lever.
- **Outlook honors PUBLISH + UID replacement inconsistently**, so a re-send may duplicate entries there even though Apple and Google update in place → No client-side lever exists. D6's stable `UID` is the best available, and the re-send case is an explicit manual test so the real behavior is known rather than assumed.
- **A bare time is guessed wrong** ('5:30' read as PM when a 5:30 AM call was meant) → D4's rule is documented and the raw cell text is carried in `DESCRIPTION`, so the recipient sees what the sheet said. The email body stays authoritative.
- **The calendar file is a snapshot and goes stale** the moment the sheet is edited — the same property that made the `emailLog` staleness pill necessary → Inherent to attachments; the stale-recipient indicator already surfaces it, and re-sending updates entries where the client cooperates. A subscription feed is the real fix and is named as a non-goal, not forgotten.
- **Deleting an assignment leaves an orphaned calendar entry** → Documented limitation, out of scope by the non-goals above. The recipient deletes it manually; the next send does not resurrect it.

## Migration Plan

Purely additive. No schema change, no migration script, no index, no new collection, and no change to any stored document shape — `sequence` and `linkedSnapshot` are derived at read time inside `extractDayAssignments`.

Rollback is the toggle: `includeCalendar: false` reproduces today's behavior exactly, and the server treats a missing field as opt-out-safe by reading it explicitly rather than defaulting on.

## Open Questions

- Does Outlook on the web import all events from a multi-VEVENT attachment, only the first, or require a download? Determines whether D1 survives as one file per recipient or has to become one file per day.
- Should the workbook PDF gain a matching toggle? Out of scope here, but once one attachment control exists in the panel the asymmetry will be visible.
- Is `METHOD:CANCEL` on assignment deletion worth the coupling it implies (tracking which UIDs were ever sent to whom)? Revisit once real re-send behavior across clients is known.
