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

## Auto-Create Normalization (one-time, in the backfill script)

For every distinct in-use category name across all events:

1. **Trim** surrounding whitespace.
2. **Case-insensitive dedup** against existing registered categories: a stray
   `"skirball"` links to the existing `"Skirball"` record rather than creating a
   duplicate. Matching is `name.trim().toLowerCase()`.
3. Names with no match → create a record:
   `{ name: <first-seen trimmed casing>, active: true, displayOrder: <max+N>, autoCreated: true, createdAt }`.
   The `autoCreated: true` flag lets an admin review/merge later.
4. `"Uncategorized"` and empty strings are skipped (never become records).

## Migration Phases (each independently verifiable)

### Phase 1 — Backfill script (standalone, isolated)
A new `backend/migrate-backfill-category-ids.js` that edits **no file the
api-server loads** (per one-off-script isolation rule). It:
- Scans distinct in-use names, auto-creates missing categories (rules above).
- Adds `calendarData.categoryIds` to every event by resolving
  `calendarData.categories` names → `_id` via a case-insensitive map.
- Supports `--dry-run` (reports unregistered names that would be created + before/after
  counts, no writes), `--verify` (reports coverage), batch processing with a `\r`
  progress bar, `withCosmosRetry`/batchDelete-style bounded retries, idempotent.
- Output rules: config summary, counts, progress bar, final summary. No per-doc logging
  except in `--dry-run`.

### Phase 2 — Dual-write
Add a shared helper `resolveCategoryIds(names) -> [ObjectId]` that reads the
in-memory category cache (the one invalidated by `invalidateCategoryCache`) and
maps names case-insensitively, auto-creating on miss is NOT done here (writes only
link to existing records; unregistered names left unlinked until next backfill or
a dedicated create flow). Call the helper at the real entry points so anything
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
with a **name-match fallback** OR-ed in for events not yet backfilled:
```
$or: [ { categoryIds: { $in: ids } }, { 'calendarData.categories': { $in: names } } ]
```
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
- Backfill script unit test: resolve + case-insensitive dedup + auto-create + idempotency.

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
- **Auto-create over hybrid/manual.** Chosen by product owner: yields a complete
  canonical set, every event resolves to ids, and the dropdown becomes just the
  collection. Dedup + `autoCreated` flag mitigate proliferation.

## Risks / Rollback

- **Rollback:** additive design — disabling `categoryIds` reads reverts to name
  matching. Safe until Phase 5.
- **Cosmos rate limits** on backfill and rename `updateMany` → batch + `withCosmosRetry`.
- **Auto-create proliferation** → case-insensitive dedup + `autoCreated` review flag;
  `--dry-run` surfaces the create list before any write.
- **Partial backfill coverage** during rollout → name-fallback in the filter keeps
  results correct for un-backfilled events.
