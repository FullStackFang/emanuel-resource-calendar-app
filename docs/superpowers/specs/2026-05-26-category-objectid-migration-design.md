# Category ObjectId Migration — Design

**Date:** 2026-05-26
**Status:** Approved (design), pending implementation plan
**Author:** Stephen Fang + Claude

## Problem

Event search and export return wrong results for category filtering, and category
renames silently orphan events.

Root causes, confirmed in Phase 1 investigation:

1. **Categories are stored as raw name strings.** Events store
   `calendarData.categories: ["Skirball"]` — a denormalized name with no link to
   the canonical `templeEvents__Categories` collection.
2. **Rename does not propagate.** `PUT /api/categories/:id` (api-server.js ~19126)
   updates only the category document. Every event still carries the old string,
   so filtering by the new name returns 0.
3. **Matching is brittle vs. locations.** The category filter uses exact
   `calendarData.categories: { $in: [names] }` (case/whitespace sensitive), while
   the location filter uses forgiving `calendarData.locationDisplayNames: { $regex, $options: 'i' }`.
   A stored `"skirball"` or `"Skirball "` fails the category filter but the
   equivalent location would still match.

Note: the location ObjectId array (`calendarData.locations`) is **not used by
search at all** — the location filter also matches the denormalized display
string. So "make categories ObjectIds" only fixes search if we also rewire the
filter, dropdown, and export. This spec does all of that.

## Goal

Make categories reference `templeEvents__Categories` by `_id`, exactly mirroring
the location model, so that:

- Filtering keys off a stable reference (`categoryIds`), immune to rename and casing.
- A rename in Category Management reflects everywhere.
- Every category in use maps to a canonical record.

## Non-Goals

- Removing the denormalized `categories` name array (it stays as the display field,
  analogous to `locationDisplayNames`).
- Refactoring all 18 category write sites into a single shared write layer (we add a
  small shared resolver helper and call it at entry points; the full write-layer
  extraction tracked in `project_shared_write_layer` is out of scope here).
- Read-time display derivation (considered and rejected for this pass — see
  Decisions).

## Data Model (additive)

Each event's `calendarData` gains one field, mirroring locations:

```
calendarData.categories:   ["Skirball", "Adult Ed"]   // KEPT  — denormalized display (= locationDisplayNames analog)
calendarData.categoryIds:  [ObjectId, ObjectId]        // NEW   — stable references (= locations analog)
```

- `templeEvents__Categories` is the canonical source.
- `categoryIds` is **authoritative for filtering**.
- `categories` (names) remains for **display** and as the transition-period
  fallback for events not yet backfilled.
- `"Uncategorized"` is **not** a record — it is the absence of `categoryIds`
  (empty / missing / null), exactly as today.

## Category Reconciliation (guaranteed mapping)

**Invariant:** every in-use category name MUST map to an existing
`templeEvents__Categories` record. There are no permanent name-only categories.
This is enforced at two points: a reviewed migration (below) and runtime
auto-create-on-miss (Phase 2).

The migration uses a **two-step, human-in-the-loop** reconciliation so that
near-duplicates and typos merge into the correct existing record instead of
spawning junk:

1. **Report step** (`--report`): scan all events, compute the distinct set of
   in-use category names with occurrence counts. For each name, propose a mapping:
   - **MATCH** — case-insensitive trimmed match to an existing record
     (`name.trim().toLowerCase()`), e.g. `"skirball "` → existing `"Skirball"`.
   - **NEW** — no match found; would create a new record.
   Write this to an editable mapping file (`category-mapping.json`):
   `[{ name, count, action: "map"|"create"|"skip", targetId|newName }]`.
2. **Confirm step** — the user reviews/edits the mapping file: merge names into
   existing records, approve new ones, or skip (`"Uncategorized"`/empty).
3. **Apply step** (`--apply --mapping category-mapping.json`): create the approved
   NEW records, then backfill `categoryIds` per the confirmed mapping. The script
   **asserts 100% coverage** — if any in-use name is unmapped after apply, it fails
   loudly rather than leaving a name-only event.

Newly created records carry `{ active: true, displayOrder: <max+N>,
autoCreated: true, createdAt }`. `"Uncategorized"` and empty strings are never
records (they mean "no categoryIds").

## Migration Phases (each independently verifiable)

### Phase 1 — Backfill script (standalone, isolated)
A new `backend/migrate-backfill-category-ids.js` that edits **no file the
api-server loads** (per one-off-script isolation rule). It implements the
two-step reconciliation from "Category Reconciliation":
- `--report` — emit `category-mapping.json` (distinct names + counts + proposed
  MATCH/NEW action). No writes.
- `--apply --mapping <file>` — create approved NEW records, backfill
  `calendarData.categoryIds` per the confirmed mapping, **assert 100% coverage**.
- `--verify` — report coverage (events with/without `categoryIds`, any unmapped names).
- Batch processing with a `\r` progress bar, `withCosmosRetry`/`batchDelete`-style
  bounded retries, idempotent.
- Output rules: config summary, counts, progress bar, final summary. No per-doc
  logging except in `--report`.

### Phase 2 — Dual-write (auto-create-on-miss to hold the invariant)
Add a shared helper `resolveCategoryIds(names) -> [ObjectId]` that reads the
in-memory category cache (the one invalidated by `invalidateCategoryCache`),
maps names case-insensitively, and **auto-creates a record on miss** (flagged
`autoCreated: true`, then invalidates the cache). This maintains the "every
category maps to a record" invariant for category names that first appear via
live Graph sync after the migration — no event is ever left name-only. The
`autoCreated` flag surfaces these in the admin review list so junk from Outlook
typos can be merged later. Call the helper at the real entry points so anything
setting `calendarData.categories` also sets `calendarData.categoryIds`:

Entry points (confirmed write sites):
- `upsertUnifiedEvent` (graph sync) — api-server.js ~4831
- Admin save / audit-update graph field merge — ~8208, ~8369
- Event request / draft create paths
- Delta-sync upsert path — ~6615 / ~11869
- `reconcile-rsched-source-of-truth.js` (315/327/393) and
  `services/rschedImportService.js` (~896)
- `backend/utils/graphEventBuilder.js` (~77) reads `cd.categories` to build Graph
  events — unchanged (Graph still gets names), but documented.

### Phase 3 — Rewire filter (search + export + MCP)
`GET /api/events/list?view=search` and the export path accept a `categoryIds`
param. Filter becomes:
```
calendarData.categoryIds: { $in: [ObjectId...] }
```
with a **transitional name-match fallback** OR-ed in for events not yet
backfilled:
```
$or: [ { categoryIds: { $in: ids } }, { 'calendarData.categories': { $in: names } } ]
```
The fallback is only needed during the rollout window; once backfill completes
and the runtime invariant holds (Phase 2), every event has `categoryIds` and the
fallback can be removed in Phase 5.
`"Uncategorized"` keeps its existing empty/missing/null branch.
`services/mcpTools.js:24` updated to the same predicate.

### Phase 4 — Rename propagation
In `PUT /api/categories/:id`, when `name` changes: batched `updateMany` refreshes
the denormalized `categories` strings on all events whose `categoryIds` contains
that `_id`. Because the join key is the stable `_id`, this is reliable. Batched +
`withCosmosRetry` for Cosmos rate limits.

### Phase 5 — Cleanup (later)
- Dropdown sources purely from `templeEvents__Categories` (every in-use name is now
  registered), superseding the uncommitted `useDistinctEventCategoriesQuery` union.
- Optionally reconcile stray top-level `categories` / `graphData.categories`.

## Frontend Wire Protocol

- `MultiSelect` keeps showing **names** (low UI churn).
- `EventSearch` / `EventSearchExport` map selected names → `categoryIds` using the
  category collection (name→id map) before calling the API, sending `categoryIds`
  (and, during transition, `categories` names too so the backend fallback works).
- `"Uncategorized"` maps to the empty-categoryIds condition.
- Dropdown options come from `baseCategories` (complete after backfill).

## Testing

Backend (extend `categoryFilterRepro.test.js` + new files):
- Match by `categoryIds` returns the event.
- Name-fallback returns an event that has `categories` but no `categoryIds` yet.
- `"Uncategorized"` matches empty `categoryIds`.
- Rename propagation: rename a category → events previously tagged with the old
  name return under the new name (and old name no longer matches).
- Backfill script unit test: report proposes MATCH/NEW correctly; apply backfills
  per mapping; case-insensitive dedup; idempotency; **coverage assertion fails when
  a name is left unmapped**.
- Runtime `resolveCategoryIds` auto-creates on miss and reuses existing on match.

Frontend:
- Name→id mapping in the search filter (selected "Skirball" → its ObjectId on the wire).
- Export sends `categoryIds`.

## Decisions (defended)

- **Additive, not replacement.** Keeping `categories` strings mirrors locations
  (`locations` + `locationDisplayNames` both persist) and gives a non-destructive
  rollback: stop using `categoryIds` and names still work. No destructive step
  before Phase 5.
- **Write-time rename propagation over read-time derivation.** Read-time derivation
  from a cached id→name map is always-correct on rename and needs no propagation
  job, but requires rewiring every reader of `cd.categories` (15+ sites). Write-time
  `updateMany` keyed on the stable `_id` keeps all existing readers correct with a
  single touch point. Read-time derivation remains a viable future optimization.
- **Guaranteed mapping via reviewed reconciliation.** Product owner requirement:
  every in-use category maps to an existing record — no permanent name-only
  categories. The two-step report → confirm → apply flow lets a human merge
  near-duplicates into existing records (so dupes/typos don't spawn junk), and the
  apply step asserts 100% coverage. Runtime auto-create-on-miss maintains the
  invariant for names that first appear via live sync afterward. End state: a
  complete canonical set, every event resolves to ids, dropdown = the collection.

## Risks / Rollback

- **Rollback:** additive design — disabling `categoryIds` reads reverts to name
  matching. Safe until Phase 5.
- **Cosmos rate limits** on backfill and rename `updateMany` → batch + `withCosmosRetry`.
- **Junk-record proliferation** → reviewed `--report`/confirm step merges
  near-duplicates before any write; runtime auto-creates carry `autoCreated: true`
  for periodic admin review/merge.
- **Partial backfill coverage** during rollout → transitional name-fallback in the
  filter keeps results correct for un-backfilled events; removed in Phase 5 once
  coverage is complete.
- **Apply-step coverage assertion** is the backstop: the migration fails loudly
  rather than silently leaving an event with a name that maps to nothing.
