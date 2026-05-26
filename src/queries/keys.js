// src/queries/keys.js
//
// Query key factory for TanStack Query. Centralizing key construction here
// makes prefix-based invalidation natural and prevents the silent shape drift
// that happens when keys are constructed inline at each call site.
//
// Convention
// ──────────
// Keys are arrays. The first element is the resource name. Subsequent
// elements are scope discriminators in order of decreasing specificity:
//
//   ['<resource>', '<sub-resource-or-action>', <scope params>]
//
// Examples:
//   ['events']                            ← all events queries (broad invalidate)
//   ['events', 'list']                    ← all events.list queries
//   ['events', 'list', { view: '...' }]   ← a specific list query
//   ['events', 'detail', eventId]         ← a single event detail
//
// Selective invalidation
// ──────────────────────
// TanStack Query treats matching as a prefix check by default, so:
//
//   queryClient.invalidateQueries({ queryKey: keys.events.all() })
//     → invalidates every events.* key
//
//   queryClient.invalidateQueries({ queryKey: keys.events.list() })
//     → invalidates every events.list.* key
//
//   queryClient.invalidateQueries({ queryKey: keys.events.detail(id) })
//     → invalidates exactly one detail entry
//
// New resources
// ─────────────
// Extend the factory rather than constructing keys inline. Inline keys
// silently drift over time and break selective invalidation.

/**
 * Build a list-key. If `scope` is provided it is appended; otherwise the key
 * is the bare list prefix so it matches every list under the resource.
 */
const listKey = (resource, scope) =>
  scope === undefined ? [resource, 'list'] : [resource, 'list', scope];

const countsKey = (resource, scope) =>
  scope === undefined ? [resource, 'counts'] : [resource, 'counts', scope];

export const keys = {
  // ─── Reference data ────────────────────────────────────────────────────
  baseCategories: {
    all: () => ['baseCategories'],
  },
  // Distinct category strings actually present on events (union of
  // calendarData.categories, top-level categories, graphData.categories).
  // Used to populate the search filter dropdown so every category in use
  // is selectable, not just the registered ones.
  distinctEventCategories: {
    all: () => ['distinctEventCategories'],
  },
  outlookCategories: {
    all: () => ['outlookCategories'],
    byUser: (userId) => ['outlookCategories', userId],
  },
  locations: {
    all: () => ['locations'],
    detail: (id) => ['locations', 'detail', id],
  },

  // ─── Events ────────────────────────────────────────────────────────────
  events: {
    all: () => ['events'],
    list: (scope) => listKey('events', scope),
    counts: (scope) => countsKey('events', scope),
    detail: (eventId) => ['events', 'detail', eventId],
    /**
     * EventSearch full-text/criteria query. Distinct from list to keep search
     * results addressable independently — but still under the `events` prefix
     * so a cross-cutting `keys.events.all()` invalidation reaches them.
     */
    search: (params) => ['events', 'search', params],
  },

  // ─── Reservations ──────────────────────────────────────────────────────
  // Today, "reservations" share the templeEvents__Events collection with
  // events (roomReservationData lives nested inside an event document).
  // Only `all()` is exposed for the SSE restart bridge's belt-and-suspenders
  // cross-cutting invalidate — list/counts/detail keys would have no
  // consumers in the current data model. Add them back when reservations
  // genuinely diverge from events as a separate resource.
  reservations: {
    all: () => ['reservations'],
  },
};

// ─── Back-compat re-exports ────────────────────────────────────────────────
// Existing call sites import these constants directly from the per-resource
// hook files. Re-exporting via the factory keeps a single source of truth
// while existing imports continue to work unchanged.
export const BASE_CATEGORIES_QUERY_KEY = keys.baseCategories.all();
export const OUTLOOK_CATEGORIES_QUERY_KEY = keys.outlookCategories.all();
export const LOCATIONS_QUERY_KEY = keys.locations.all();

export default keys;
