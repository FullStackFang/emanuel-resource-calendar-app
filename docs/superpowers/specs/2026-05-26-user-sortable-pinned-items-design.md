# User-Sortable Pinned Items

**Date:** 2026-05-26
**Status:** Approved
**Scope:** Locations and Categories MultiSelect dropdowns

## Problem

Pinned (favorite) locations and categories are currently displayed in alphabetical order regardless of the order the user pinned them. The stored array order in MongoDB is silently discarded by a `localeCompare` sort in `MultiSelect.jsx`. Users have no way to control which pinned items appear at the top.

## Goal

Let users reorder their pinned items with up/down arrow buttons. Sort order persists per user in MongoDB.

## Design

### Interaction

- Up (↑) and down (↓) arrow buttons appear **on hover** on each pinned item row
- First item: ↑ button is disabled
- Last pinned item: ↓ button is disabled
- One pinned item: both buttons are disabled
- Applies to **both** the Locations and Categories MultiSelect dropdowns

### Data Model — No Changes

`favoriteLocations` and `favoriteCategories` are already stored as plain string arrays in the `preferences` object on each user's `templeEvents__Users` document. **Array index = display order.** No new fields, no schema migration needed.

```javascript
// In templeEvents__Users.preferences
{
  favoriteLocations: ["Ballroom", "Chapel", "Library"],  // order is preserved
  favoriteCategories: ["Shabbat", "Holiday", "Education"]
}
```

The existing `PATCH /api/users/current/preferences` endpoint and debounce logic in `Calendar.jsx` already handle persisting array changes. No backend changes required.

### Behavior

| Scenario | Result |
|---|---|
| Click ↑ on item at index `i` | Swaps item at `i` with item at `i-1`, saves |
| Click ↓ on item at index `i` | Swaps item at `i` with item at `i+1`, saves |
| Pin a new item | Appended to end of favorites array |
| Unpin an item | Spliced from array; remaining order preserved |
| Single pin | Both ↑ and ↓ disabled |

### Per-User Isolation

Each user's `favoriteLocations` and `favoriteCategories` live inside their own document in `templeEvents__Users`, keyed by `userId`. Sort order is completely independent per user.

## Implementation

### Files Changed

**`src/components/MultiSelect.jsx` — only file that changes**

Three targeted edits:

1. **Remove alphabetical sort on favorites** (lines ~105–114): Delete the `sort((a, b) => a.localeCompare(b))` call applied to the favorites section. Unpinned items keep their alphabetical sort.

2. **Add `handleMovePin(index, direction)` function**: Clones the favorites array, swaps element at `index` with neighbor in the given direction (`'up'` | `'down'`), calls `onFavoritesChange(newArray)`.

3. **Render ↑/↓ buttons on pinned rows**: Inside the pinned items render loop, add two small icon buttons. Show them via CSS `:hover` on the row (no extra React state). Disable ↑ when `index === 0`, disable ↓ when `index === favorites.length - 1`.

### CSS

Arrow buttons use `visibility: hidden` on the row, flipping to `visibility: visible` on row `:hover`. This preserves layout (no reflow when hovering) compared to `display: none`.

```css
.multiselect-pin-row .reorder-btn { visibility: hidden; }
.multiselect-pin-row:hover .reorder-btn { visibility: visible; }
.reorder-btn:disabled { opacity: 0.35; cursor: default; }
```

### No Backend Changes

The existing `onFavoritesChange` prop callback in `MultiSelect` already flows up to `Calendar.jsx` → `updateUserProfilePreferences()` → debounced `PATCH /api/users/current/preferences`. Swapping array elements triggers the same save path as pinning/unpinning.

## Out of Scope

- Drag-and-drop reordering (decided against — arrows are simpler and touch-friendly)
- Reordering unpinned items (alphabetical sort stays for non-pinned)
- Any other MultiSelect behavior changes
