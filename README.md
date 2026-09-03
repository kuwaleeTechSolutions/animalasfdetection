# Assam Livestock Biosecurity & Disease Contact-Tracing Platform
### Phase 1 Pilot &mdash; African Swine Fever (ASF), Animal Husbandry & Veterinary Department, Government of Assam

A digital intelligence and emergency-response layer sitting **on top of** Bharat Pashudhan / INAPH
(not replacing them), built to compress ASF contact-tracing from days/weeks of manual phone calls
and paper registers down to **seconds**.

---

## 1. Quick Start

```bash
# 1. Install nothing -- this pilot has ZERO external npm/CDN dependencies (see §2 below).
#    You only need Node.js 22+ (for the built-in node:sqlite module).

# 2. Seed the database with synthetic demo data (idempotent -- safe to re-run).
node backend/scripts/seed.mts

# 3. Start the server (serves both the API and the web frontend on one port).
node backend/src/server.mts
# -> Assam Livestock Biosecurity & Disease Contact-Tracing Platform
# -> Backend + frontend serving on http://localhost:4000

# 4. Open http://localhost:4000 in a browser and log in with:
#    state.admin@ahvet.assam.gov.in / password123   (State/Directorate Admin)
#    do.dibrugarh@ahvet.assam.gov.in / password123  (District AH Officer, Dibrugarh)
#    fo1.dibrugarh@ahvet.assam.gov.in / password123 (Field Veterinary Officer, Dibrugarh)
#    secretary@ahvet.assam.gov.in / password123     (Policymaker, read-only)
```

Or via `npm` scripts (`package.json` — still zero installed dependencies, `npm install` is a no-op):
```bash
npm run seed
npm start
npm test    # runs the backend test suite (contact-tracing engine + risk scoring)
```

### Docker

```bash
docker compose up --build
```
See `docker-compose.yml` and `Dockerfile` for the pilot topology (single `app` container +
embedded SQLite volume, with a commented-out PostGIS service ready for the production
migration). **Note:** Docker was not available in this build sandbox, so the Compose/Dockerfile
setup could not be build-tested end-to-end here — please verify on first use.

### Demo scenario (pre-loaded)

The seed script creates ~57-60 synthetic premises across the 3 pilot districts (Dibrugarh,
Tinsukia, Charaideo) and **one pre-loaded `lab_confirmed` ASF case** at "Rajgarh Piggery 1"
in Dibrugarh. Contact tracing has already been run on it during seeding, so on first login you
can go straight to **Command Dashboard → View Trace** (or **Contact-Trace Results** for that
case) and see ~20-25 connected premises across all 7 pathways, risk-scored and colour-coded,
with field tasks already auto-generated — demonstrating the full "one confirmed case → dozens of
potentially connected farms in seconds" scenario from the source proposal.

---

## 2. Tech Stack Decisions & Sandbox Constraints — read this first

The brief specifies React+TS+Vite+Tailwind+react-leaflet, Node+Express+TS, PostgreSQL+PostGIS,
and Docker Compose. This pilot was built inside a **fully air-gapped sandbox**: no npm registry
access, no CDN access (unpkg/cdnjs/OSM tile servers all return `403`), and no bundler
(webpack/esbuild/vite/rollup) available locally. Rather than ship unverified/untested code
against a spec that couldn't actually be run in this environment, every substitution below
keeps the **same architecture, route map, data model, and screens**, and is documented so a
follow-on developer can swap each piece back to the originally-specified technology with a
**mechanical, low-risk change** — not a redesign.

| Spec asked for | This pilot uses instead | Why | Migration path |
|---|---|---|---|
| PostgreSQL + PostGIS | Node's built-in `node:sqlite` (`DatabaseSync`) | No `pg` driver installable; PostGIS unavailable. All geo math is isolated in `backend/src/lib/geo.mts` (haversine) and all DB access goes through `backend/src/repositories/*.mts`. | Swap `connection.mts` for a `pg` pool + rewrite `geo.mts`'s `withinRadiusKm` to use `ST_DWithin`. Repository function signatures don't need to change. |
| Express (or Fastify) | A ~150-line hand-rolled router (`backend/src/lib/http.mts`) with Express-compatible handler signatures `(req, res, next)` | `express` package not installable (no registry access). | Add `express` to `package.json`, delete `http.mts`, keep every route file (`backend/src/routes/*.mts`) as-is — they already use `app.get/post/patch(...)` and `req.params/req.query/req.body`. |
| JWT (`jsonwebtoken`) + bcrypt | Hand-rolled HMAC-SHA256 signed token (`backend/src/lib/auth.mts`) with identical header.payload.sig structure, + Node's built-in `scrypt` (same security class as bcrypt) | Neither package installable offline. | Swap `signToken`/`verifyToken` for `jsonwebtoken`, and `hashPassword`/`verifyPassword` for `bcrypt`. Everything downstream (middleware, routes) is unaffected. |
| React + TypeScript + Vite + Tailwind + react-leaflet (OSM tiles) | Dependency-free vanilla JS ES modules (`frontend/public/src/**`), hand-written utility CSS (`styles.css`), and a custom SVG scatter-plot map (`frontend/public/src/lib/map.js`) | No CDN access for React/Leaflet UMD builds, no bundler for a real Vite build, and **no live internet access to OpenStreetMap tile servers even at runtime** in this sandbox. | Pages are already structured as pure functions (state in → HTML out) with the same route map as the brief's §7 screen list — porting to React function components + JSX is a mechanical lift. Swap `map.js`'s `renderMap()` internals for `react-leaflet`'s `<MapContainer>` + `<TileLayer>`; every call site is unchanged. |
| Docker Compose (db + backend + frontend) | Single `app` service (backend also serves the static frontend) + SQLite volume; a commented-out `postgis/postgis` service is included for the future | Reflects the single-process pilot architecture above; no Docker daemon was available to build-test this in the sandbox. | Uncomment the `postgres` service in `docker-compose.yml` once the Postgres migration (row above) is done. |

**Everything else in the brief is implemented as specified**: the data model (§4), the 7-pathway
contact-tracing engine (§5), RBAC (§6), all 12 screens (§7), the seed scenario (§8), the
explicit out-of-scope items (§9), and the non-functional requirements (§10) — including
parameterised queries (no string-concatenated SQL — the `node:sqlite` `prepare().run()/get()/all()`
API is used everywhere), hashed passwords, and a full audit log.

---

## 3. Running the test suite

```bash
node backend/tests/run-all.mts
```
This runs two suites against an **in-memory SQLite database** (never touches your seeded data):

- `backend/tests/contactTracing.test.mts` — builds a hand-crafted scenario connecting a case
  premises to other premises through **all 7 pathways simultaneously** (including a premises
  discovered via multiple pathways at once, and one deliberately unrelated premises that must
  **not** be discovered), then asserts: every pathway is represented, risk levels stack sensibly,
  tasks are auto-generated only for High/Medium risk, wall-clock trace time stays well under 5
  seconds, and re-running the trace is idempotent (no duplicate rows). **34 assertions, all passing.**
- `backend/tests/riskScoring.test.mts` — isolates the weighted risk-scoring threshold math with
  hand-crafted `ContactEdge` fixtures (bypassing the BFS engine) to verify High/Medium/Low
  classification and task-type mapping in isolation, and confirms thresholds are genuinely
  **configurable at runtime** (not hardcoded) by changing a setting and re-scoring.
  **12 assertions, all passing.**

There is also a frontend smoke-test harness (`frontend/test-harness/`) that executes every page's
render function against a real running backend instance using a minimal fake-DOM shim (no jsdom
was available in the build sandbox), including full form-submission interaction tests:
```bash
node backend/scripts/seed.mts
node backend/src/server.mts &
node frontend/test-harness/smoke.mjs http://localhost:4000
```
**17/17 checks passing** (initial render of all 12+ screens, plus 3 end-to-end interaction
tests: Quick Movement Log submission, Quick Case Report submission, and a field officer
task-status update).

---

## 4. Data Model

See `backend/src/db/schema.sql` for the full DDL (heavily commented). Summary of entities,
matching brief §4:

| Entity | Notes |
|---|---|
| `premises` | Farm / market / slaughterhouse / vet_clinic / transport_hub. `registration_source` distinguishes `manual` vs `bharat_pashudhan_import` vs `inaph_import`; `external_ref_id` holds the future Bharat Pashudhan/INAPH ID. |
| `animals` | Species is `pig` first but the enum includes `cattle`/`goat`/`poultry`/`other` for the Phase-2 extension. `tag_id` is nullable with a `photo_url` fallback for untagged animals (spec requirement — many Assam farmers won't have RFID tags). |
| `transport_vehicles` | Links farms that shared a vehicle without any direct animal-to-animal link. |
| `movement_events` | animal/batch + from/to premises + date + optional vehicle. Updates the animal's current `premises_id` on insert. |
| `vet_visits` | premises + veterinarian + date — links farms visited by the same vet in an overlapping window. |
| `disease_cases` | `disease` is a free string defaulting to `ASF` (never hardcoded as an enum-locked single value) so FMD/PPR/AI plug in without a schema change. `status`: `suspected` → `lab_confirmed` → `ruled_out`. |
| `contact_edges` | **Computed only** — never manually entered. One row per (case, connected premises, pathway, hop) — a premises can and does appear multiple times if discovered via multiple pathways, and **all** are surfaced in the UI. |
| `risk_scores` | One row per (case, premises), aggregating all of that premises's edges into a single weighted score + High/Medium/Low level + human-readable rationale string. |
| `field_tasks` | `task_type`: inspect / test / quarantine / restrict_movement. Auto-generated for High (→ quarantine) and Medium (→ inspect) risk premises only; Low-risk premises are **not** auto-tasked (flagged for officer review, per spec). |
| `compensation_records` | Status tracking only (`reported → assessed → approved → disbursed`) — **no disbursement logic**, exactly as scoped. |
| `users` | Role + district/block assignment. |
| `audit_logs` | Every create/update/delete/import/login/trace_run writes a row here. |
| `trace_runs` | One row per contact-tracing run — feeds the dashboard's "contact-trace time" and "detection-to-alert time" metrics (see §7 below), which are **named success metrics from the source proposal** and are genuinely measured, not implied. |
| `settings` | Key-value store for all `[DECIDE]` thresholds below — editable by State Admin via the UI, never hardcoded constants. |

---

## 5. Contact-Tracing Algorithm (the core differentiator)

Implemented in `backend/src/services/contactTracing.mts`. Runs as an **in-memory BFS**
(per spec: "no need for a dedicated graph database at pilot scale"), triggered automatically
whenever a `DiseaseCase` is created, or its status transitions to `lab_confirmed`.

**Algorithm**:
1. Reference date = `case.lab_result_date ?? case.reported_date`.
2. Starting from the case's premises (hop 0), for each node in the current BFS frontier, check
   **all 7 pathways simultaneously**:
   1. **Animal Movement** — any `movement_event` touching this premises within the lookback window.
   2. **Transport Vehicle** — any *other* premises whose movement used the same vehicle within the window.
   3. **Market** — any *other* premises whose animal passed through the same market premises within the window.
   4. **Veterinary Visit** — any *other* premises visited by the same veterinarian within the window.
   5. **Nearby Farm** — any premises within the configurable radius (haversine distance; would be `ST_DWithin` in PostGIS).
   6. **Previous Farm (trace-back)** — the origin premises of an animal that moved *into* the case premises (only tagged this way at hop 1, from the actual case premises).
   7. **Destination Farm (trace-forward)** — a premises that received an animal that moved *out of* the case premises (same hop-1-only tagging rule as #6).
3. Repeat for up to `maxHops` (default 2) rounds of BFS, re-running the same 7 checks from each
   newly-discovered premises. Beyond hop 1, animal-movement discoveries are tagged with the
   generic `animal_movement` pathway (trace-back/forward are specifically about the *original*
   case premises' own animals).
4. **Every** `(premises, pathway, hop)` combination is persisted as its own `ContactEdge` row — a
   premises discovered via 3 different pathways gets 3 rows, and the UI surfaces all 3 pathway
   chips, not just the first match (explicit spec requirement).
5. Risk scoring runs immediately after tracing completes (see §6).
6. `FieldTask`s are auto-generated for newly-discovered High/Medium risk premises only.
7. A `trace_runs` row records wall-clock duration and feeds the dashboard's "contact-trace time"
   metric.

**Configurable parameters** (all in the `settings` table, editable via **Admin → Users & Settings**
by a State Admin — never hardcoded):

| Parameter | Default | Spec reference |
|---|---|---|
| `lookbackWindowDays` | **21** | "§5 ...within a configurable lookback window (default 21 days, configurable)" |
| `proximityRadiusKm` | **2** | "§5 ...within a configurable radius (default 2 km, using PostGIS ST_DWithin or haversine fallback)" |
| `maxHops` | **2** | "§5 ...up to 2 hops by default (configurable)" |
| `pilotDistricts` | **Dibrugarh, Tinsukia, Charaideo** | "§1 ...illustratively Dibrugarh, Tinsukia, Charaideo — make this configurable, not hardcoded" |

## 6. Risk-Scoring Rule

Implemented in `backend/src/services/riskScoring.mts`. A simple weighted rule, exactly as the
spec suggests documenting: every `ContactEdge` for a premises contributes
`pathwayWeights[pathway]` points (defaults below), decayed by `hopDecayFactor ^ (hop - 1)` for
edges discovered beyond hop 1. The summed score is thresholded into High/Medium/Low.

| Pathway | Default weight | Rationale |
|---|---|---|
| `animal_movement` / `previous_farm` / `destination_farm` | **10** | Direct animal movement is the strongest, most certain transmission risk → High on its own. |
| `transport_vehicle` / `market` | **6** | A shared vehicle or market is a real but slightly less direct exposure → Medium on its own. |
| `veterinary_visit` | **3** | Possible fomite transmission via a shared vet → Low on its own, but stacks with other pathways. |
| `nearby_farm` | **2** | Geographic proximity alone is the weakest signal → Low on its own. |

Default thresholds: **High ≥ 10, Medium ≥ 5** (`riskThresholds` setting). All weights and
thresholds are State-Admin-configurable at runtime via **Admin → Users & Settings**, and a
`riskScoring.test.mts` unit test confirms changing a threshold live reclassifies premises
accordingly (not hardcoded).

---

## 7. Success Metrics (measured, not implied)

Per the source proposal, two named metrics are visibly measured and surfaced on the **Command
Dashboard**:

- **Contact-trace time** — wall-clock milliseconds from BFS start to trace completion (incl. risk
  scoring + task generation), logged per run in `trace_runs.contact_trace_ms`, averaged on the
  dashboard. In this pilot's seeded 50-60-premises dataset, this consistently runs in **10-100ms**
  — i.e., the spec's "days/weeks → hours" goal is not just met but exceeded at pilot scale.
- **Detection-to-alert time** — seconds from case creation to contact-trace completion for
  `lab_confirmed` cases, in `trace_runs.detection_to_alert_seconds`.

---

## 8. Roles & Permissions (§6)

| Role (`users.role`) | Enforced via |
|---|---|
| `field_officer` (Field Veterinary Officer) | Scoped to their own district for premises/registry views; can report cases, log movements/vet-visits, update **their own assigned tasks**; can view contact-trace results **only for cases where they have an assigned task**. |
| `district_officer` (District AH Officer) | Everything a field officer can do, district-wide; can reassign tasks; approves compensation status changes. |
| `state_admin` (State/Directorate Admin) | Full access; manages users; configures all `[DECIDE]` thresholds via **Admin → Settings**. |
| `policymaker` (Read-only) | Blocked from every write route by the `blockReadOnly` middleware (`backend/src/middleware/auth.mts`) — dashboard/reports access only. |

Every write route passes through `backend/src/repositories/adminRepo.mts`'s `AuditRepo.log(...)`,
satisfying §10's "every create/update/delete on the entities in §4 writes an AuditLog row" — visible
in-app at **Audit Log** (State Admin / District Officer only).

---

## 9. `[INTEGRATION POINT]` stubs — what the next developer needs to wire up

Grep the codebase for `[INTEGRATION POINT]` to find these exact locations:

1. **Bharat Pashudhan / INAPH sync** — `backend/src/routes/registryRoutes.mts`,
   `POST /api/import/premises-csv`. Currently a CSV-upload stub (also exposed in the UI at
   **Premises Registry → Import from Bharat Pashudhan/INAPH**). The `premises.registration_source`
   and `premises.external_ref_id` columns already exist for this — replace the CSV parser with a
   scheduled job or webhook calling the real Bharat Pashudhan/INAPH REST API and upserting by
   `external_ref_id`.
2. **Assam SSO / State Data Centre auth** — `backend/src/lib/auth.mts` and
   `backend/src/routes/authRoutes.mts`. Currently local email+password with `scrypt` hashing.
   Replace `POST /api/auth/login` with a redirect to the State SSO provider and verify its
   assertion/token instead of a local password check — the downstream RBAC middleware and
   session-claims shape (`{ sub, role, district, name }`) are already SSO-shaped and don't need
   to change.

---

## 10. Explicitly Out of Scope (§9 — noted, not built)

- Real Bharat Pashudhan/INAPH API integration (CSV stub only, see §9 above).
- Real SSO/State Data Centre authentication (local password auth stub only).
- Offline-first mobile app with local sync — the mobile task-update screens
  (`/my-tasks`, `/tasks/:id`, `/quick-case`, `/quick-movement`) are plain responsive views;
  making them installable PWAs with a service worker + local sync queue is Phase 2.
- Actual compensation fund disbursement / DBT integration — `compensation_records.status` only
  tracks `reported → assessed → approved → disbursed`; no money moves.
- SMS/IVR gateway integration for alerts.
- Multi-disease production hardening beyond the extensible schema — `disease_cases.disease` is a
  free string (not an ASF-only hardcoded enum) so FMD/PPR/AI plug in without a migration, but only
  ASF is exercised in the pilot's seed data and UI copy.

---

## 11. Repository Layout

```
backend/
  src/
    db/               schema.sql (DDL) + connection.mts (SQLite wrapper, swap point for Postgres)
    lib/               http.mts (router), auth.mts (hashing/tokens), geo.mts (haversine, swap point for PostGIS), ids.mts
    middleware/        auth.mts (attachUser / requireAuth / requireRole / blockReadOnly)
    repositories/       one file per entity group -- coreRepo, caseRepo, opsRepo, adminRepo (all parameterised queries)
    services/           contactTracing.mts (the engine), riskScoring.mts, taskGeneration.mts
    routes/             authRoutes, registryRoutes, caseRoutes, dashboardRoutes, opsRoutes, adminRoutes
    server.mts          entrypoint -- migrates DB, wires routes, serves the static frontend
  scripts/seed.mts      idempotent synthetic demo-data generator (see §1)
  tests/                contactTracing.test.mts, riskScoring.test.mts, run-all.mts
frontend/
  public/
    index.html, styles.css
    src/
      lib/              api.js (fetch wrapper), dom.js (helpers), map.js (SVG GIS map)
      router.js          tiny hash-based router
      layout.js           shared nav shell
      pages/              one file per screen (12 screens, matching spec §7)
      main.js             route table / app entrypoint
  test-harness/          fakedom.mjs + smoke.mjs (frontend runtime smoke tests, see §3)
docker-compose.yml / Dockerfile
package.json
```

---

## 12. Known Limitations of This Pilot (beyond the §9 out-of-scope list)

- The GIS map is a custom SVG scatter-plot, **not** real OpenStreetMap tiles (see §2 — no live
  tile-server access in the build sandbox). It correctly projects lat/lng and colour-codes risk,
  but has no street/terrain basemap. Swapping in `react-leaflet` once deployed to an
  internet-connected environment is a single-file change (`frontend/public/src/lib/map.js`).
- Photo attachment on field tasks accepts a filename/URL string for the pilot rather than a real
  file upload widget (spec explicitly allows this: "file upload is fine for pilot; camera capture
  is a nice-to-have").
- SQLite (not PostgreSQL+PostGIS) backs the pilot; see the migration path table in §2. Note this
  is very unlikely to be a constraint of Assam's actual IT environment — it was purely a
  constraint of this specific build sandbox.
