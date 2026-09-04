## 1. Tenant Prerequisite

- [ ] 1.1 Grant `User.Read.All` (Application) to the app registration and record admin
      consent. Do not grant `Directory.Read.All`; it is broader than this change needs.
- [ ] 1.2 Verify app-only directory access from the backend with a one-off script before
      writing endpoint code, so a consent problem is not diagnosed through the picker.

## 2. Directory Read

- [ ] 2.1 Add tests for the directory filter builder: enabled members only, guests
      excluded, and the OData term escaped.
- [ ] 2.2 Extend `graphApiService.searchUsers()` (or add a sibling `listDirectoryPeople`)
      to select `id,displayName,mail,accountEnabled,userType`, filter to enabled members,
      and follow `@odata.nextLink` paging to completion.
- [ ] 2.3 Add tests proving the caller wraps the directory read in `withGraphRetry`, using
      `graphApiMock.graphError()` / `graphNetworkError()` to build failures. Do not
      hand-roll Graph errors.

## 3. Exclusions And Merge

- [ ] 3.1 Add unit tests for the merge helper: app tier wins on collision, dedupe is
      case-insensitive on email, entries without an email are dropped, and each row
      carries its `source`.
- [ ] 3.2 Add unit tests for the location-mailbox exclusion, including a room whose
      mailbox differs from the app user list only by case.
- [ ] 3.3 Implement the pure merge and exclusion helper in `backend/utils/`, dependency
      free, alongside the existing sheet helpers.

## 4. Cached Directory Tier

- [ ] 4.1 Add a `createStaleWhileErrorCache` directory cache next to the category and
      marker caches, on the same 5-minute TTL.
- [ ] 4.2 Wire the cache into `GET /api/scheduling-sheets/user-lookup` behind the existing
      `requireAssignmentManager` gate, merging tier 1 and tier 2 before the existing
      in-memory filter and 25-cap-on-typed-query behavior.
- [ ] 4.3 Add `degraded` to the response when the directory tier is unavailable on a cold
      cache; leave `matches` and `total` shaped as they are today.
- [ ] 4.4 Add integration tests: merged results, dedupe, room-mailbox exclusion, 403
      no-consent degrades rather than errors, 429 degrades rather than errors, stale
      snapshot served on a failed refresh, and the gate still refusing non-managers.

## 5. Picker Presentation

- [ ] 5.1 Add component tests for a directory-sourced row being visually distinguished and
      for the degraded banner rendering.
- [ ] 5.2 Surface `degraded` through `useSheetUserLookup` without changing the query key,
      `staleTime`, or the single-prefetch model.
- [ ] 5.3 Mark directory-only rows in `CellSuggestionList` and show a directory-unavailable
      note when the response is degraded.
- [ ] 5.4 Confirm `personSegment` is unchanged and that a directory-sourced chip stores
      `userId: null` without breaking tagged-email extraction.

## 6. Verification

- [ ] 6.1 Run the scheduling sheet backend suites (`schedulingSheets`, `sheetCells`,
      `schedulingSheetEmail`) and confirm counts match the documented baseline.
- [ ] 6.2 Run the scheduling sheet frontend suites and confirm the full-suite failure count
      still matches the documented pre-existing baseline.
- [ ] 6.3 Lint every touched file.
- [ ] 6.4 Manual end-to-end on dev with a live MSAL session: tag a staff member who has
      never signed into the app, confirm the chip stores their real address, send a
      day-scoped schedule email to a test mailbox, and confirm the room mailboxes do not
      appear as people.
- [ ] 6.5 Manual degraded check: revoke or simulate loss of directory access and confirm
      the picker still lists app users and says the directory is unavailable.
