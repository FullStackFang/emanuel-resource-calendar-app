## Context

A scheduling sheet cell is `{ segments: [...], note }`, where a segment is a
text, person or location chip (`backend/utils/sheetCells.js`). Two editors
build cells — the in-cell `InlineCellEditor` and the expanded
`SheetCellEditor` — and both get their input semantics from ONE hook,
`useMentionPicker`, so they cannot drift.

Today the hook classifies the WHOLE input box: `value.startsWith('@')` means
mention mode and the rest of the box is the search term. Picking a suggestion
appends a chip and clears the box, so a cell can already hold
`Stephen · 6:15 PM · Greenwald`, but as unrelated siblings. Typing the line in
one go (`@Stephen @615pm @Greenwald @Task`) searches for a person named
"Stephen @615pm @Greenwald @Task", finds nobody, and Enter commits the entire
line as one text chip — Stephen is no longer tagged, so he gets no email and no
My Assignments entry.

The server normalizes every cell through `validateCell`, which rebuilds each
segment from an explicit field list — any unknown field is DROPPED. That is
the right default and means `details` needs an explicit server rule, or it
disappears on the first save.

`useSchedulingSheet(sheetId)` loads the whole workbook (every day doc), so the
client already holds every cell of the sheet.

## Goals / Non-Goals

**Goals:**
- Attach times, rooms and free-text duties to the person they describe, as one
  chip, typed on one line.
- Typing an `@` line never silently loses a tagged person again.
- The person sees their own details wherever they read their schedule.
- Consistent wording of free-text duties across a sheet, with no list to
  maintain.

**Non-Goals:**
- Details never feed call time, `.ics` DTSTART/DTEND, the double-booking
  warning, `taggedEmails`, or ordering. They are labels.
- No managed task catalogue (a collection, admin screen or permission). Can be
  added later as another source of detail suggestions.
- No people inside details (`@Stephen @Dana` is two groups, never Dana nested
  under Stephen).
- No editing a detail in place; remove and re-add it.
- The `#` location-only shortcut and plain-text input are unchanged.

## Decisions

### D1. `details` is a nested array on the person segment, not a new segment type

```js
{ type: 'person', userId, name, email, placeholder, callTimeOverride,
  details: [ { type: 'text', text }, { type: 'location', locationId, name } ] }
```

Every consumer that already iterates `cell.segments` and switches on
`seg.type` — `extractTaggedEmails`, `extractDayAssignments`, the double-booking
warning, `cellDisplayParts`, copy-a-day, the clipboard — keeps working
unchanged, and a consumer that does not know about `details` degrades to
exactly today's rendering rather than breaking.

*Alternatives:* a `group` segment wrapping `[person, ...details]` would make
every one of those loops need a recursion step, and `extractTaggedEmails`
missing it would silently drop the person from My Assignments. A `groupId` tag
on sibling segments keeps the storage flat but makes ownership a convention
every renderer has to re-derive, and a reorder can orphan it.

Detail entries reuse the text and location segment shapes and go through the
SAME per-type normalization as top-level segments. `validateCell` rejects a
`person` inside `details`, caps `details` at 10 entries, and counts them
toward the existing 50-segment cell cap so nesting cannot bypass it. An absent
or empty `details` normalizes to NO field (not `[]`), so cells written before
this change round-trip byte-for-byte and existing tests that compare whole
segments keep passing.

### D2. The open group is the preview (refines the "preview under the input" idea)

Picking a person appends their chip as today AND makes it the **open group**.
While a group is open, each further `@` token is a **detail** and lands INSIDE
that chip, visibly — the chip itself is the live preview. There is no separate
preview widget to keep consistent with what will be saved.

The group closes when the cell commits, or when another person is picked (who
becomes the new open group). Plain text typed WITHOUT `@` still becomes a
top-level text chip, exactly as today — the escape hatch for a note that is
about the post, not the person. Backspace on an empty input removes the open
group's last detail, then the person, preserving today's "Backspace eats the
last chip" feel. The expanded editor's existing per-chip controls (call time,
remove) are unchanged; each detail gets its own remove ×.

*Alternative considered:* keep the whole line as text and parse it on commit,
with a rendered preview. It needs caret-position token tracking and a memory
of which tokens were picked (names are not unique), and it shows the grouping
in a second place that can disagree with the saved chip. Rejected.

### D3. Typing ` @` finalizes the current token

So the line can be typed without stopping, a space followed by `@` applies the
current token's DEFAULT choice (the same row Enter would pick) and starts the
next token. Pasting a multi-token line runs the same step per token. This keeps
"only explicit choices resolve to people/rooms" (D4) true: the default choice
is always the one visibly highlighted.

The split is on ` @` (space-at), never on spaces, so `@after kiddush` is one
token. A literal `@` inside a word (`a@b.com`) is not preceded by a space and
does not split.

### D4. Token position decides the picker's behavior

`useMentionPicker` gains a `detailMode` input (true while a group is open).

| | Lookup token (no open group) | Detail token (group open) |
|---|---|---|
| Default highlighted row | first match, as today | **"Add '<term>' as text"** |
| Time | Time row | folded into the text row (normalized: `615pm` → "6:15 PM") |
| Locations | Locations group | Locations group, pick-only |
| People | people | people, pick-only (starts a new group) |
| Placeholder / outsider rows | shown | **never** |
| Sheet detail suggestions | — | listed above "Add as text" |

A detail's text is normalized with the existing `parseTimeToken`, the same
rule plain text already follows, so `@615pm` is stored as "6:15 PM" without a
separate time row. Because the text row is the default, typed text never turns
into a person or room without the user choosing one — the answer to "`@Al`
meant as a word must not become Alan".

### D5. Detail suggestions are derived, not stored

A pure `collectDetailVocabulary(sheet)` walks every day's cells, collects the
TEXT details on person segments, deduplicates case-insensitively (keeping the
most frequent spelling, then the first seen), and returns them sorted by use
count. The hook filters that list by the term (`includes`, case-insensitive),
applies the existing 5-row cap with its honest overflow count, and hides an
exact match of the typed term (the text row already offers it). Location
details are excluded: rooms already have their own authoritative list.

Computed with `useMemo` on the sheet query data, so it follows edits made by
anyone, over the same data the grid already renders.

### D6. Recipient surfaces read `details` through ONE formatter

`extractDayAssignments` adds `details: seg.details || []` to each entry.
A shared pure `formatDetails(details)` in `assignmentSchedule.js` returns the
display string (`6:15 PM · Greenwald · Usher`; location names as-is) and is
used by:

- the email itinerary (`buildAssignmentsHtml`), as one line on the person's
  post, escaped like every other value there;
- the `.ics` DESCRIPTION, as one line after the existing cell text. DTSTART
  and DTEND are computed exactly as before.
- My Assignments, which renders the array it receives (the frontend mirrors
  the formatter, since it cannot import backend code).

`GET /api/my-assignments` explicitly keeps `details`. SE-25 locks the entry's
key set measured before any change, so it is UPDATED to 15 keys on purpose,
with a comment naming this change. The projection that strips `rowId`,
`colId`, `sequence` and `linkedSnapshot` is unchanged.

### D7. PDF and print

`schedulingSheetPdf.js` appends the details to the person block as a
secondary-style run after the name (and after the call-time run), so a group
wraps as one block instead of scattering into separate cells. Print CSS
already prints the grid DOM, so the grid's chip rendering covers it.

## Risks / Trade-offs

- [A person under two addresses on one sheet gets two separate detail sets] →
  By design; details belong to the chip, the same way call time does.
- [Vocabulary grows messy ("Usher" vs "Ushers")] → Case-only duplicates merge;
  real variants stay visible in suggestions, which nudges people to reuse. A
  managed list can later be added as another suggestion source (Non-Goal).
- [Space-@ finalizes to the highlighted row, which for a LOOKUP token may be a
  person the user did not mean] → The same row Enter picks today, visibly
  highlighted; the open chip shows the result immediately and Backspace undoes
  it.
- [An old client re-saves a cell and drops `details`] → Only clients that
  predate this deploy; the frontend and backend ship together. Accepted.
- [Wider My Assignments response] → Additive field; SE-25 updated
  deliberately rather than loosened.

## Migration Plan

No data migration. Absent `details` is the stored form of "no details".
Deploy backend first (accepts and preserves `details`), then frontend; a
rollback of the frontend alone leaves stored details intact and invisible,
and rolling back the backend strips them on the next write of that cell.

## Open Questions

None blocking. Whether a managed task list is ever wanted is deferred until the
derived vocabulary has been used on a real holiday sheet.
