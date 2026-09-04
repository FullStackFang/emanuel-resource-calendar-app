## Why

The `@` people picker on scheduling sheets reads only `templeEvents__Users`, which is
just-in-time provisioned: a person appears there only after they have signed into this
app at least once, or after an admin hand-creates them. Holiday staffing schedules
custodians, security staff, ushers, and volunteers who never open a calendar app, so
they are simply absent from the picker. Today the workaround is the manual
'add an outsider' escape hatch, where the scheduler retypes a name and email by hand
for every such person, every sheet.

Microsoft Entra ID already holds every one of these people with a verified mailbox.
The backend already authenticates to Graph app-only, and `graphApiService.searchUsers()`
already exists but has never had a production caller.

## What Changes

- Add an Entra ID directory tier to `GET /api/scheduling-sheets/user-lookup`, merged
  with the existing app-user tier rather than replacing it.
- Cache the directory snapshot server-side on the established stale-while-error TTL
  cache, so the picker makes no per-keystroke Graph call.
- Exclude room and resource mailboxes, disabled accounts, guests, and accounts with no
  deliverable address from directory results.
- Degrade honestly to app-users-only, labelled, when Graph is unavailable, rather than
  failing the request or silently returning a short list.
- Distinguish directory-sourced people from app users in the picker.
- Keep the existing gate, the prefetch-and-filter-client-side interaction model, the
  stored cell segment shape, and every downstream email join unchanged.

## Capabilities

### New Capabilities
- `scheduling-people-directory-lookup`: Covers the people source, merge, exclusion, and
  degraded-mode behavior of the scheduling sheet `@` picker.

### Modified Capabilities

## Impact

- Backend lookup endpoint and new directory cache: `backend/api-server.js`.
- Graph directory read: `backend/services/graphApiService.js` (`searchUsers` gains
  filtering and paging; first production caller).
- Picker presentation: `src/components/scheduling/CellSuggestionList.jsx`,
  `src/components/scheduling/useMentionPicker.js`.
- Data layer: `src/hooks/useSchedulingSheets.js` (degraded flag only; query key,
  `staleTime`, and fetch shape unchanged).
- Azure app registration: requires `User.Read.All` (Application) with admin consent.
- No database schema change, no migration, no query-key change, and no change to the
  stored person segment shape.
