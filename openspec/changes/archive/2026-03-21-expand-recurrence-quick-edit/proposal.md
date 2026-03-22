## Why

The recurrence tab's per-occurrence quick editor only exposes time-related fields (title, start/end, setup/teardown, door open/close). In practice, individual occurrences often need different rooms, categories, or descriptions -- the same fields visible in Outlook/Graph. Users currently have no way to override these per-occurrence without editing the full event, which defeats the purpose of the quick editor.

## What Changes

- **Add description field** to the recurrence occurrence detail editor (textarea)
- **Add categories selector** with inline chips and the existing CategorySelector modal picker
- **Add locations selector** with inline chips and the existing room selection modal picker
- These fields follow the same override pattern as existing fields: show master value by default, store overrides in `occurrenceOverrides[]`
- No backend changes required -- the API already accepts arbitrary fields in occurrence overrides

## Capabilities

### New Capabilities
- `occurrence-quick-edit-fields`: Expand the recurrence tab occurrence detail editor with description, categories, and locations fields using existing modal pickers

### Modified Capabilities

## Impact

- **Frontend only**: `RecurrenceTabContent.jsx` and its CSS
- **Existing modals reused**: CategorySelector and room selection components
- **Data flow unchanged**: `occurrenceOverrides[]` already supports these fields; `getEffectiveValue()` already handles categories
- **No API changes**: Backend `PUT /api/admin/events/:id` with `editScope: 'thisEvent'` already persists these fields
