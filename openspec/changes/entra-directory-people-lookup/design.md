## Context

`GET /api/scheduling-sheets/user-lookup` (api-server.js ~20529) reads the whole
`templeEvents__Users` collection, projects `displayName`/`email`, and returns every
row when no `q` is supplied. The client (`useSheetUserLookup`) fetches that once with
`staleTime: 5 * 60 * 1000` and filters per keystroke in memory.

That collection is JIT-provisioned. `PUT /api/users/current` creates a record on a
user's first preference save; admins can also create one by hand. Nothing else writes
it. So the picker's population is 'people who have used this app', which is not the
population a holiday staffing sheet schedules.

The person chip already tolerates a non-app person. `externalPersonSegment` writes
`userId: null` and everything downstream still works, because **email is the only join
key**: `extractTaggedEmails` (backend/utils/sheetCells.js), the double-booking sweep
(`sheetEventUtils.js`), the `tagged_emails_date` index, `GET /api/my-assignments`, and
the schedule-email fan-out all key on `seg.email`. The stored `userId` is sanitized and
persisted but never joined on.

## Goals / Non-Goals

**Goals:**
- Make every mailbox-holding staff member findable in the `@` picker.
- Keep the picker's existing interaction and loading model exactly as-is.
- Keep the Graph dependency off the request-latency and circuit-breaker hot path.
- Fail visibly and partially, never silently or totally.
- Keep the stored cell contract byte-identical, so no migration and no test churn.

**Non-Goals:**
- Replacing `templeEvents__Users` as the app's user store, or syncing Entra into it.
- Provisioning app accounts, roles, or permissions from directory results.
- Changing who may call the lookup endpoint.
- Extending the directory tier to any other picker (reassign owner, clergy, approvers).
- Removing the manual 'add an outsider' escape hatch, which still serves genuine
  non-tenant people such as outside vendors.

## Decisions

### Merge tiers; do not replace the source

App users stay tier 1 and win on collision; directory entries fill in behind them.

Tier 1 rows carry a real `userId`, which is what makes their `/my-assignments` view and
their in-app identity resolvable. Replacing the source would flatten every app user to
a directory record and throw that away for no gain. Merging is also the only option
that degrades: if Graph is down, tier 1 alone is still a useful picker.

Dedupe on lowercased email, matching the lowercase-on-write rule already established
for `requestedBy.email` (a mixed-case write there hides events from both users' lists).

Alternative considered: replace `templeEvents__Users` with Entra entirely. Rejected -
it discards resolvable app identity and introduces a hard external dependency on a path
that currently has none.

### Cache the directory snapshot; do not search Graph per keystroke

Load the filtered directory once per TTL into `createStaleWhileErrorCache`, the same
primitive already used for categories, calendar markers, users, and calendar settings -
all at a 5-minute TTL. The endpoint then filters in memory exactly as it does today.

Two reasons, and the second is the stronger one:

1. **Breaker blast radius.** Every production Graph call wraps in `withGraphRetry` at
   the call site; `graphApiService` does not self-wrap. That breaker is shared with
   event publish, delta sync, and sync-health/reconcile. A picker firing Graph calls at
   typing speed could trip it and degrade the calendar's write path. One call per five
   minutes cannot.
2. **The frontend loading contract.** Typed server search puts the search term in the
   query key, so every keystroke is a fresh cache entry in `isPending`, and the picker
   flashes 'no matches' between keystrokes - indistinguishable, in a search UI, from a
   real answer. That is exactly the first-paint-blank-flash class the repo standardizes
   against with `deriveListLoadingState`. Caching server-side keeps the single-prefetch
   model and leaves the loading contract untouched.

Alternative considered: debounced `$search` per keystroke with `ConsistencyLevel:
eventual`. Better substring matching (`startswith` cannot match a surname), but it buys
that by importing the whole loading standard into a component that currently sidesteps
it, and by putting Graph on the breaker's hot path. Substring matching is recovered for
free anyway, because the client already filters the prefetched list with `includes()`.

### Serve stale, then degrade labelled

`createStaleWhileErrorCache` serves the last good value when a refresh fails, so a
transient Graph blip is invisible. On a cold miss with no last-good value, the endpoint
returns tier 1 only plus `degraded: true`, and the picker says the directory is
unavailable.

This follows the failure-isolation convention already used for
`reconcileMarkerGraphState` ('a Graph error is logged and surfaced via `graphSyncError`,
never thrown'), the `recurringConflictCheckError` marker, and the conflict report's
`degraded[]` banner. Returning a short list with no signal is the specific failure this
codebase designs against: the picker would look like it worked, and the custodian would
just be missing.

Alternative considered: 500 on Graph failure. Rejected - it breaks a picker that worked
fine before this change, for the sake of a tier that is strictly additive.

### Exclusions are our job, not Graph's

`/users` returns room and equipment mailboxes, shared mailboxes, disabled accounts,
guests, and service accounts. Filter server-side on
`accountEnabled eq true and userType eq 'Member'`, then drop any address matching a
mailbox in `templeEvents__Locations`.

Without the location exclusion the picker offers to staff a room to itself - '@Sanctuary'
would appear as a person, which is both nonsense and a real mis-send risk, since the
schedule email would go to the room mailbox.

An entry with no `mail` is dropped rather than falling back to `userPrincipalName`. A
UPN is a login, not necessarily a deliverable address, and this feature's entire payoff
is emailing people their assignments. A wrong address is a schedule that silently never
arrives.

### The gate is unchanged, but record the scope change

`requireAssignmentManager` stays. It re-fetches via `findUserByIdentity` and never trusts
JWT claims. The lookup deliberately does not use `GET /api/users`, which is
`canManageUsers`-gated and would 403 the Events-department requesters this feature admits.

Note honestly that the authorization *surface* widens: today an Events-department member
sees people who use this app; afterwards they see the staff directory. Low risk - it is
their own colleague directory, name and work email only - but it is a real change and is
recorded here rather than shipped as a side effect.

### Provenance travels with the row

Each match carries `source: 'app' | 'directory'`. The picker marks directory rows so a
scheduler can tell that a person has no app account, which explains why that person will
receive an email but has no My Assignments view to check.

## Risks / Trade-offs

- **Consent is a hard gate.** Without `User.Read.All` (Application) the directory tier
  cannot load at all, and every request runs degraded. The degraded path makes that
  visible rather than mysterious, and the 403 case is explicitly tested.
- **Directory size.** The prefetch grows from app users to filtered tenant members. If
  the filtered set ever gets large enough to make the single prefetch heavy, the
  mitigation is server-side paging into the cache, not per-keystroke search - the
  caching decision above still holds.
- **Staleness.** A person added to Entra is invisible for up to the TTL. Acceptable:
  the same 5-minute window already governs categories and calendar markers, and sheet
  building is not a same-minute-onboarding workflow.

## Migration Plan

None. No schema change, no backfill, no query-key change. Person chips written before
and after this change are byte-identical in shape. The change is inert until
`User.Read.All` is consented; before that it runs permanently degraded, which is the
same behavior as today plus a banner.

## Open Questions

- Should directory-sourced people be auto-provisioned into `templeEvents__Users` the
  first time they are tagged, so they gain a resolvable `userId` and a My Assignments
  view? Deliberately out of scope here: it converts a read feature into a write feature
  and needs its own decision about role defaults.
