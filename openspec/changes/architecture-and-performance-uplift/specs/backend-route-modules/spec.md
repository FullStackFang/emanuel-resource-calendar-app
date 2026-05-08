## ADDED Requirements

### Requirement: Express handlers are organized into route modules under backend/routes/

The backend SHALL organize its Express route handlers into per-domain modules under `backend/routes/`. Each module SHALL export an `express.Router()` (or a function `(deps) => router`) that `backend/api-server.js` mounts at the appropriate path. The bootstrap file `backend/api-server.js` SHALL contain only middleware wiring, route mounting, error handlers, and process bootstrap — no handler bodies.

#### Scenario: api-server.js shrinks below the orchestration ceiling

- **WHEN** the route extraction is complete
- **THEN** `backend/api-server.js` is at most 1,500 lines and contains zero `app.get|post|put|delete|patch` handler implementations — only mounts (`app.use('/api/...', router)`) and middleware

#### Scenario: Each route module owns one cohesive surface

- **WHEN** a developer searches for the implementation of `GET /api/events/list`
- **THEN** they find it in `backend/routes/eventsList.js` (or `backend/routes/events.js`), not in the bootstrap file

### Requirement: Route extraction does not change handler logic

When a handler moves from `api-server.js` into a `routes/*.js` module, its logic SHALL be functionally identical pre- and post-move. Behavior changes (e.g., adding parallelism, adding OCC, adding projection) MAY be applied in the same change but SHALL be reviewable as separate concerns within the same PR (clearly marked diff sections or separate commits).

#### Scenario: Tests pass identically before and after a pure move

- **WHEN** a route is extracted with no logic change
- **THEN** the targeted backend test suite for that route passes with no test modifications required

#### Scenario: A bundled logic fix is identifiable in the PR

- **WHEN** the eventsList extraction PR includes parallelism and projection fixes
- **THEN** the PR description (or commit history) clearly attributes the logic fixes separately from the move, so reviewers can audit each independently

### Requirement: Required initial route modules

The change SHALL produce the following route modules at minimum, each mounted from `backend/api-server.js`:

- `backend/routes/graphProxy.js` — Microsoft Graph API proxy endpoints (formerly lines ~3497–4212).
- `backend/routes/events.js` — Authenticated event creation and update endpoints (formerly lines ~6226–8316 less the list endpoint).
- `backend/routes/eventsList.js` — `POST /api/events/load`, `GET /api/events/list`, `GET /api/events/list/counts`.
- `backend/routes/reservations.js` — Reservation owner endpoints (formerly lines ~14690–17009).
- `backend/routes/adminEvents.js` — Admin write endpoints (publish, reject, restore, edit, audit-update).
- `backend/routes/locations.js` — Location and capability reference data.
- `backend/routes/sse.js` — SSE connection endpoint.
- `backend/routes/ai.js` — AI/MCP-tool endpoints.
- `backend/routes/users.js` — User profile endpoints.

#### Scenario: Each required module exists with at least one route

- **WHEN** the change is archive-ready
- **THEN** every module in the list above exists at the specified path and exports a router with at least one mounted handler

#### Scenario: api-server.js mounts every module

- **WHEN** reading `backend/api-server.js`
- **THEN** every required module appears in a single `app.use(...)` call (or equivalent mount) so the bootstrap file is the authoritative source for what HTTP surface the server exposes

### Requirement: Middleware stays in the bootstrap, not duplicated across modules

Cross-cutting middleware (auth, CORS, body parsing, error handlers, request logging, rate limiting) SHALL remain in `backend/api-server.js` or in dedicated `backend/middleware/*.js` files. Route modules SHALL NOT register their own middleware versions of these concerns. Module-local middleware (e.g., a route-specific input validator) MAY live alongside the route module.

#### Scenario: No duplicate auth middleware

- **WHEN** the route extraction is complete
- **THEN** `git grep "verifyToken\|authenticateUser"` finds the auth middleware defined in exactly one place and applied either globally in api-server.js or per-mount, never re-implemented in route files

### Requirement: Route module shape is consistent

Each route module SHALL follow the same export shape: either `module.exports = router` (when no construction-time dependencies are needed) or `module.exports = (deps) => router` (when the module needs `db`, `graphApiService`, etc., injected). The shape choice SHALL be consistent within the codebase.

#### Scenario: Modules with dependencies use factory shape

- **WHEN** a route module needs the MongoDB collections handle
- **THEN** the module exports a factory function that accepts the dependencies and returns a router, and `api-server.js` calls it with the constructed dependencies at mount time
