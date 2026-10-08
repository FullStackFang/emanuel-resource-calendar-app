## ADDED Requirements

### Requirement: Sync health check runs on a leased schedule
The server SHALL start a scheduler from `startServer` (never at module load, never under `NODE_ENV === 'test'`) that every `SYNC_HEALTH_INTERVAL_MINUTES` minutes (default 360; `0` disables), and once about 60 seconds after boot, attempts to acquire a lease by `findOneAndUpdate` on the `templeEvents__SystemSettings` document `_id: 'sync-health-latest'` where `nextRunAt` is absent or not later than now, setting `nextRunAt` to now plus the interval. Only the acquiring instance SHALL run `runSyncHealthCheck` over `resolveWindow()` for all calendars. The timer SHALL be `unref()`'d and a throwing tick SHALL NOT stop later ticks.

#### Scenario: Boot tick runs when the lease is free
- **WHEN** the scheduler starts with fake timers, `jest.setSystemTime`, and an empty store, and time advances 60 seconds
- **THEN** the injected `runCheck` is called once with the default window and `calendarOwner: null`, and the store document has `nextRunAt` = now + interval

#### Scenario: Lease held elsewhere skips the run
- **WHEN** the store document's `nextRunAt` is in the future
- **THEN** a tick does not call `runCheck`

#### Scenario: Disabled by env
- **WHEN** `SYNC_HEALTH_INTERVAL_MINUTES` is `0`
- **THEN** `start()` returns without creating a timer and `runCheck` is never called

#### Scenario: Failing tick keeps the last good counts
- **WHEN** a previous tick persisted `counts` and the next `runCheck` rejects
- **THEN** the store document has `error: true`, `errorAt`, `errorMessage`, and the previous `counts` and `ranAt` unchanged, and the following tick still runs

#### Scenario: No handle leak in tests
- **WHEN** `createAppForTest` builds the app
- **THEN** no scheduler timer exists

### Requirement: Latest summary is persisted and readable
Each successful tick SHALL `$set` on `_id: 'sync-health-latest'`: `ranAt`, `window`, per-category `counts` (`missingFromOutlook`, `shouldNotBeInOutlook`, `untracked`, `untethered`, `failedDeletion`), `degraded`, `durationMs`, `error: false`. `GET /api/admin/reports/sync-health/latest` SHALL return that document, gated by the same admin-or-approver check as the report endpoint, and SHALL return `{ latest: null }` when no run has completed.

#### Scenario: Summary written
- **WHEN** a tick completes with two `shouldNotBeInOutlook` findings
- **THEN** the persisted document has `counts.shouldNotBeInOutlook === 2`, `error === false`, and `ranAt` within the tick

#### Scenario: Endpoint gated
- **WHEN** a requester calls the latest endpoint
- **THEN** the response is 403

#### Scenario: Nothing yet
- **WHEN** an admin calls the latest endpoint before any tick has run
- **THEN** the response is 200 with `latest: null`

### Requirement: Admin UI badges actionable findings
The Sync Health nav link SHALL show a count badge equal to `missingFromOutlook + shouldNotBeInOutlook + failedDeletion` from the latest summary when that sum is greater than zero, for every user who can see the link. `untracked` and `untethered` SHALL NOT count toward the badge. The query SHALL use a `staleTime` of 5 minutes and a `refetchInterval` of 15 minutes. `SyncHealthReport.jsx` SHALL show the last automatic run time above the summary bar, "No automatic run yet" when `latest` is null, and an error line when `error` is true.

#### Scenario: Badge renders on actionable counts
- **WHEN** the latest endpoint returns `counts: { missingFromOutlook: 1, shouldNotBeInOutlook: 2, untracked: 40, untethered: 3, failedDeletion: 0 }`
- **THEN** the Sync Health nav link renders a badge with text `3`

#### Scenario: No badge when only chronic categories are non-zero
- **WHEN** the latest endpoint returns counts with only `untracked` non-zero
- **THEN** no badge is rendered

#### Scenario: Last-run and error lines
- **WHEN** the report page mounts and the latest endpoint returns `ranAt` and `error: true`
- **THEN** the page shows "Last automatic run" with that time in the user's locale and an error line
