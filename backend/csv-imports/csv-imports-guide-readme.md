# Rsched CSV → Mongo → Outlook Sync — Quick Reference

A set of CLI scripts for bulk reconciling a Resource Scheduler CSV export with the app's MongoDB collection and the templeevents/templeeventssandbox Outlook calendars. Run these for one-off reconciliations (e.g. annual reset). For routine ongoing imports, use the admin UI's 'Resource Scheduler Import' page instead — these scripts are aggressive and assume the script is the single authoritative writer for the duration of the run.

---

## Scripts

| Script | Purpose | Read/Write |
|---|---|---|
| `audit-rsched-reconcile.js` | Read-only preview of what a reconcile would do | Reads Mongo + Outlook + CSV. No writes. |
| `reconcile-rsched-source-of-truth.js` | Mongo writes: insert new, update matched, soft-delete unmatched, optionally link to Outlook and push changes | Reads CSV + Mongo + Outlook. Writes Mongo. With `--publish`, also writes Outlook. |
| `link-mongo-to-graph.js` | Standalone Outlook linker: finds existing Outlook events and populates `graphData.id` on Mongo docs that lack it | Reads Outlook. Writes Mongo. |
| `diagnose-mongo-events.js` | Inspector for schema/owner/title questions | Reads Mongo. No writes. |

---

## Algorithm in one paragraph

The reconcile script matches CSV rows to Mongo docs by **content** (title + start minute + end minute), not by rsId — Rsched re-issues rsIds between exports, so they are unreliable. Multi-matches tie-break first by shared location ObjectId, then by rsId equality. Unmatched Mongo docs are classified into five buckets (test-user, recurring-in-Outlook, single-in-Outlook, Outlook-deleted, uncertain) and the first three are soft-deleted. The `--link` flag also queries Outlook's calendarView and populates `graphData.id` + `calendarId` on each touched Mongo doc by content match against existing Outlook events.

---

## Common workflows

### 1. Audit before any writes

```powershell
cd backend
node audit-rsched-reconcile.js --owner=templeeventssandbox@emanuelnyc.org --from=2026-05-01 --to=2026-05-31
```

Output shows: CSV rows in scope, Mongo docs in scope, projected creates/updates/ambiguous, bucket A-E counts for soft-delete, and sample listings. Nothing is written.

### 2. Reconcile a single date window with Outlook linking

```powershell
node reconcile-rsched-source-of-truth.js --owner=templeevents@emanuelnyc.org --from=2026-05-11 --to=2026-05-11 --link
```

Inserts new docs from CSV, updates matched docs, soft-deletes unmatched, then links each touched doc to its existing Outlook event by content match. Does NOT create new Outlook events.

### 3. Reconcile a full year, chunked by month

```powershell
node reconcile-rsched-source-of-truth.js --owner=templeevents@emanuelnyc.org --from=2026-05-01 --to=2027-04-30 --link --chunk-by=month
```

Single command; internally processes one month at a time. Each chunk is independent — if one fails, the loop continues and lists failed windows in the aggregate summary at the end.

### 4. Bootstrap sandbox where Outlook is empty (create new Outlook events)

```powershell
node reconcile-rsched-source-of-truth.js --owner=templeeventssandbox@emanuelnyc.org --from=2026-05-01 --to=2026-05-31 --link --publish
```

`--link` finds and connects existing Outlook events; `--publish` then creates new Outlook events for anything not already linked. Use this when Outlook needs the events created from scratch. **Don't** use `--publish` on production if events already exist there — risks duplicates.

### 5. Repair a window where Outlook links got cleared

```powershell
node link-mongo-to-graph.js --owner=templeevents@emanuelnyc.org --from=2026-05-01 --to=2026-05-31 --dry-run
node link-mongo-to-graph.js --owner=templeevents@emanuelnyc.org --from=2026-05-01 --to=2026-05-31
```

Standalone link, no reconcile pass. Useful if some other operation cleared `graphData.id` on a set of docs.

### 6. Backfill `calendarData.isAllDayEvent` canonical key (one-off data hygiene)

```powershell
node migrate-backfill-isAllDayEvent.js --dry-run
node migrate-backfill-isAllDayEvent.js
node migrate-backfill-isAllDayEvent.js --verify
```

The Rsched importer historically writes the all-day flag under the wrong key — `calendarData.isAllDay` instead of the canonical `calendarData.isAllDayEvent`. The calendar's rendering pipeline now tolerates either key, but backend operations (conflict detection, audit projection, future syncs) read only the canonical name. Run this once after a fresh Rsched bulk import to normalize the data so all consumers see the same flag.

The dry-run output breaks the affected count into two source variants: rSched-style (`calendarData.isAllDay: true`) and Graph-style (`graphData.isAllDay: true` with calendarData missing the projection). Both are corrected in the apply pass. Idempotent — safe to re-run.

---

## Flag reference (reconcile script)

```
--owner=<email>            REQUIRED. Calendar owner email (templeevents or templeeventssandbox).
--from=YYYY-MM-DD          REQUIRED. Window start (inclusive).
--to=YYYY-MM-DD            REQUIRED. Window end (inclusive).
--file=<csv>               CSV filename in backend/csv-imports/. Default: rsched_all_asof_5_8_2026.csv
--dry-run                  Print the plan, exit before any writes.
--no-soft-delete           Skip the soft-delete pass (buckets A/C/D stay alive).
--link                     After Mongo writes, populate graphData.id by Outlook content match.
--publish                  After --link, create new Outlook events for unlinked docs + push material-changed updates.
--chunk-by=month|week      Split the from/to range into per-month or per-week chunks. Recommended for windows > 1 month.
```

---

## Key data conventions (what these scripts assume)

- CSV file is `backend/csv-imports/rsched_all_asof_5_8_2026.csv` or similar. **No header row required** — a shim auto-injects the canonical header if absent. Header column aliases like `LocationCode` are normalized to `rsKey`.
- Mongo `templeEvents__Events` docs may have date/title fields at top level OR only under `calendarData.*`. The scripts use accessors that try top-level first, then fall back to calendarData.
- Each calendar owner has its real default-calendar id fetched once via Graph at startup. Used as `calendarId` on every written doc. The values in `calendar-config.json` point at non-existent calendars and are bypassed.
- The `eventId` field uses the pattern `rssched-{rsId}`. The composite unique index `(userId, calendarId, eventId)` allows the same eventId across different owners because they have different calendarIds.
- Test users are recognized by email: `testuser1@`, `test.user1@`, `stephen.fang@`, `rrogers@` at `emanuelnyc.org`, plus any `*@test.com`. Their docs go to bucket A and get soft-deleted.

---

## Troubleshooting

**`E11000 duplicate key error`** — should not happen anymore. The applyInsert flow does a pre-check by `(eventId, calendarOwner)` and routes to update on collision (rsId-reuse scenario).

**`This event was modified by another user`** — OCC version mismatch. Reconcile now passes `expectedVersion: null` so this only fires when something OUTSIDE the script writes during the run. Don't edit events in the app while reconcile is running on that window.

**Cosmos `429 TooManyRequests` / Error 16500** — RU rate limit. Re-run the affected chunk; idempotency means it's safe. If it keeps happening, tune the batch throttle (BATCH_SIZE / BATCH_PAUSE_MS constants near the top of the script).

**Outlook `404 ErrorItemNotFound`** — calendar-config.json points at a calendar that doesn't exist on the mailbox. The scripts fall back to the user's default calendar via `/users/{owner}/calendar?$select=id` at startup. Verify the "Resolved default calendar id" log line shows up.

**`ambiguous (multi-match)`** in link output — N Mongo docs matched multiple Outlook events at the same title + time. Usually means an Outlook recurring series has occurrences at exactly the same time as another event. Those docs are in Mongo but not linked; admin edits on them won't push to Outlook. Manual review needed.

**Aggregate summary shows all zeros at end of chunked run** — cosmetic bug, per-chunk console output is accurate.

**`would-create` very high on a re-run** — usually means the CSV's eventId scheme changed (rsId reuse). Check the audit's `would-relink rsId` count; if non-zero, the script is correctly rebuilding the rsId index.

---

## Recovery from a failed run

1. Look at the aggregate summary at the end of the run — it lists failed chunks with their `--from` and `--to` values.
2. Re-run each failed window individually with the same command, dropping `--chunk-by` (single window is fine for a one-month re-run).
3. If a re-run still fails on the same docs, run `audit-rsched-reconcile.js` for that window to see what state Mongo is actually in.
4. Spot-check 2-3 affected docs in Mongo Compass to confirm whether the reconcile achieved the intended state despite the error message.

All operations are idempotent. Already-reconciled docs no-op on subsequent runs.

---

## What this does NOT do

- **Does not create Mongo `seriesMaster` docs** for Outlook recurring series. If the calendar has true recurring series, this is left for a follow-up migration. Individual occurrences are still linked correctly via content match.
- **Does not soft-delete on the admin UI's import flow.** The CLI reconcile is destructive (CSV is truth); the admin UI is additive. They serve different operational needs and are intentionally separate.
- **Does not retry on Cosmos 429.** The graphApiService has built-in retry-on-429 for Graph calls, but Mongo 429s currently propagate as failures. Re-running the affected chunk is the recovery path.
