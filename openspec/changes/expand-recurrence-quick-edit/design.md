## Context

The recurrence tab's occurrence detail editor (`RecurrenceTabContent.jsx`) currently exposes 7 fields: eventTitle, start/end time, setup/teardown, door open/close. The backend already supports arbitrary fields in `occurrenceOverrides[]`, so this is purely a frontend change.

The component receives `formData` and `reservation` props which contain the master event's categories and locations. It already has `getEffectiveValue()` for fallback logic and `handleOccurrenceFieldChange()` for editing. Categories is already wired in `getEffectiveValue` but has no UI.

## Goals / Non-Goals

**Goals:**
- Add description, categories, and locations editing to the occurrence detail view
- Reuse existing modal pickers (CategorySelector, room selection) for consistency
- Follow the same override pattern: show master value by default, store overrides in `occurrenceOverrides[]`

**Non-Goals:**
- No backend API changes
- No new components -- reuse existing pickers
- No full room availability checking per-occurrence (would require significant scope expansion)
- No services, attendeeCount, or other internal-only fields

## Decisions

### 1. Description field: inline textarea
Description is a simple text field. Use a `<textarea>` with 2-3 rows, placed directly after the title input. No modal needed.

**Why:** Matches the compact inline style of the existing fields. A textarea is the natural input for multi-line text.

### 2. Categories: inline chips + existing CategorySelector modal
Display current categories as removable chips. Add an "Add" button that opens the same `CategorySelector` modal used in the full form.

**Why over simple dropdown:** CategorySelector supports the full category/subcategory hierarchy and is already battle-tested. Chips provide clear visual feedback of what's selected. This is consistent with how categories work elsewhere in the app.

**Alternative considered:** Simple `<select multiple>` -- rejected because categories have subcategories and the existing modal handles this well.

### 3. Locations: inline chips + simplified room picker
Display current locations as removable chips. Add an "Add" button that opens a room selection UI.

**Why:** Locations use ObjectId references and display names. The existing room selection flow in `RoomReservationFormBase` is tightly coupled to the full form (availability checking, capacity filtering by attendeeCount). For per-occurrence overrides, a simpler approach is better -- just let users pick from the available rooms list without full availability re-checking.

**Alternative considered:** Full `AvailableRoomsSection` with conflict checking -- rejected as over-engineered for per-occurrence swaps. The series-level conflict checker already runs on save.

### 4. Field layout in detail view

```
┌─────────────────────────────────────────────┐
│ ← Back to list           Sat, Mar 21, 2026  │
├─────────────────────────────────────────────┤
│ Title    [________________________]          │
│                                              │
│ Description                                  │
│ [______________________________________]     │
│ [______________________________________]     │
│                                              │
│ Start [10:00]        End [11:00]             │
│ Setup [     ]        Teardown [     ]        │
│ Door Open [ ]        Door Close [   ]        │
│                                              │
│ Categories                                   │
│ [Worship ×] [Education ×]  [+ Add]           │
│                                              │
│ Locations                                    │
│ [Greenwald Hall ×]         [+ Add]           │
└─────────────────────────────────────────────┘
```

Description goes after title (content fields grouped together). Categories and locations go after times (organizational fields grouped together).

### 5. Master value indication
When a field shows the master value (no override), display it with reduced opacity or a subtle "inherited" visual cue. When overridden, show at full opacity. This reuses the existing `isCustomized` badge pattern already in the occurrence list.

### 6. Data flow through getEffectiveValue

Add `eventDescription`, `locations`, and `locationDisplayNames` to `masterSources` in `getEffectiveValue()`. Add these fields to the `handleOpenOccurrenceDetail` pre-population loop. No changes to `handleBackToList` -- it already spreads all `occurrenceEdits` into the override.

## Risks / Trade-offs

- **Room picker simplification**: Per-occurrence room selection won't check availability against other events. Mitigation: the series-level conflict checker runs on save/publish and catches conflicts.
- **CategorySelector modal coupling**: Need to verify CategorySelector can work standalone (outside RoomReservationFormBase). Risk is low -- it likely just needs a value and onChange callback.
- **Locations as ObjectIds vs display names**: Need to store both `locations` (ObjectId array) and `locationDisplayNames` (string) in the override, matching the full form pattern. The room picker must provide both.
