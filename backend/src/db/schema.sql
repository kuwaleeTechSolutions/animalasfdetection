-- =====================================================================================
-- Assam Livestock Biosecurity & Disease Contact-Tracing Platform
-- Database schema (Pilot: SQLite via Node's built-in node:sqlite module)
--
-- [DECIDE] Production target is PostgreSQL + PostGIS (see README "Tech Stack Decision").
-- All geo-aware queries (radius search) are isolated behind
-- backend/src/lib/geoRepository.ts so that swapping the storage engine to
-- Postgres/PostGIS later is a config + repository-implementation change, not a rewrite.
-- Where a column would be a native PostGIS `geography(Point)` in production, we store
-- plain lat/lng REAL columns here and compute haversine distance in application code.
-- =====================================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- USERS & AUTH
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('field_officer','district_officer','state_admin','policymaker')),
  district        TEXT,               -- assigned district (nullable for state_admin/policymaker)
  block           TEXT,               -- assigned block/zone (nullable)
  contact         TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- PREMISES / FARM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS premises (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  owner_name            TEXT,
  owner_contact         TEXT,
  village               TEXT,
  block                 TEXT,
  district              TEXT NOT NULL,
  lat                   REAL NOT NULL,
  lng                   REAL NOT NULL,
  premises_type         TEXT NOT NULL CHECK (premises_type IN ('farm','market','slaughterhouse','vet_clinic','transport_hub')),
  registration_source   TEXT NOT NULL DEFAULT 'manual' CHECK (registration_source IN ('manual','bharat_pashudhan_import','inaph_import')),
  external_ref_id       TEXT,          -- [INTEGRATION POINT] Bharat Pashudhan / INAPH premises ID once wired up
  created_by            TEXT REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_premises_district ON premises(district);
CREATE INDEX IF NOT EXISTS idx_premises_type ON premises(premises_type);

-- ---------------------------------------------------------------------------
-- ANIMAL / BATCH
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS animals (
  id                  TEXT PRIMARY KEY,
  premises_id         TEXT NOT NULL REFERENCES premises(id),   -- current location
  species             TEXT NOT NULL DEFAULT 'pig' CHECK (species IN ('pig','cattle','goat','poultry','other')),
  tag_id              TEXT,               -- nullable: RFID/ear-tag id when available
  photo_url           TEXT,               -- fallback manual identification via photo
  batch_size          INTEGER NOT NULL DEFAULT 1,
  origin_premises_id  TEXT REFERENCES premises(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_animals_premises ON animals(premises_id);

-- ---------------------------------------------------------------------------
-- TRANSPORT VEHICLE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transport_vehicles (
  id                    TEXT PRIMARY KEY,
  registration_number   TEXT NOT NULL UNIQUE,
  owner_name            TEXT,
  driver_contact        TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- MOVEMENT EVENT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS movement_events (
  id                    TEXT PRIMARY KEY,
  animal_id             TEXT NOT NULL REFERENCES animals(id),
  from_premises_id      TEXT NOT NULL REFERENCES premises(id),
  to_premises_id        TEXT NOT NULL REFERENCES premises(id),
  event_date            TEXT NOT NULL,     -- ISO date
  vehicle_id            TEXT REFERENCES transport_vehicles(id),
  notes                 TEXT,
  recorded_by           TEXT REFERENCES users(id),
  recorded_via          TEXT NOT NULL DEFAULT 'field_app' CHECK (recorded_via IN ('field_app','import')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_move_from ON movement_events(from_premises_id);
CREATE INDEX IF NOT EXISTS idx_move_to ON movement_events(to_premises_id);
CREATE INDEX IF NOT EXISTS idx_move_vehicle ON movement_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_move_date ON movement_events(event_date);

-- ---------------------------------------------------------------------------
-- VET VISIT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vet_visits (
  id                TEXT PRIMARY KEY,
  premises_id       TEXT NOT NULL REFERENCES premises(id),
  veterinarian_id   TEXT NOT NULL REFERENCES users(id),
  visit_date        TEXT NOT NULL,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_vet_premises ON vet_visits(premises_id);
CREATE INDEX IF NOT EXISTS idx_vet_vet ON vet_visits(veterinarian_id);
CREATE INDEX IF NOT EXISTS idx_vet_date ON vet_visits(visit_date);

-- ---------------------------------------------------------------------------
-- DISEASE CASE
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS disease_cases (
  id                TEXT PRIMARY KEY,
  premises_id       TEXT NOT NULL REFERENCES premises(id),
  disease           TEXT NOT NULL DEFAULT 'ASF',   -- extensible: ASF | FMD | PPR | AI | ...
  status            TEXT NOT NULL CHECK (status IN ('suspected','lab_confirmed','ruled_out')) DEFAULT 'suspected',
  reported_date     TEXT NOT NULL,
  reported_by       TEXT REFERENCES users(id),
  lab_result_date   TEXT,
  clinical_notes    TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_case_premises ON disease_cases(premises_id);
CREATE INDEX IF NOT EXISTS idx_case_status ON disease_cases(status);

-- ---------------------------------------------------------------------------
-- CONTACT EDGE (computed by the contact-tracing engine, never entered manually)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_edges (
  id                    TEXT PRIMARY KEY,
  case_id               TEXT NOT NULL REFERENCES disease_cases(id),
  connected_premises_id TEXT NOT NULL REFERENCES premises(id),
  pathway               TEXT NOT NULL CHECK (pathway IN (
                            'animal_movement','transport_vehicle','market',
                            'veterinary_visit','nearby_farm','previous_farm','destination_farm')),
  hop_count             INTEGER NOT NULL DEFAULT 1,
  via_premises_id       TEXT REFERENCES premises(id),   -- the node this edge was discovered from (case premises or an intermediate hop)
  detected_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  details_json          TEXT
);
CREATE INDEX IF NOT EXISTS idx_edge_case ON contact_edges(case_id);
CREATE INDEX IF NOT EXISTS idx_edge_premises ON contact_edges(connected_premises_id);

-- ---------------------------------------------------------------------------
-- RISK SCORE  (one row per case+premises, aggregated across all pathways)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_scores (
  id            TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL REFERENCES disease_cases(id),
  premises_id   TEXT NOT NULL REFERENCES premises(id),
  level         TEXT NOT NULL CHECK (level IN ('High','Medium','Low')),
  score         REAL NOT NULL,
  rationale     TEXT,           -- human readable explanation of the weighted rule outcome
  computed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(case_id, premises_id)
);
CREATE INDEX IF NOT EXISTS idx_risk_case ON risk_scores(case_id);

-- ---------------------------------------------------------------------------
-- FIELD TASK
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS field_tasks (
  id                TEXT PRIMARY KEY,
  case_id           TEXT REFERENCES disease_cases(id),
  premises_id       TEXT NOT NULL REFERENCES premises(id),
  contact_edge_id   TEXT REFERENCES contact_edges(id),
  task_type         TEXT NOT NULL CHECK (task_type IN ('inspect','test','quarantine','restrict_movement')),
  assigned_to       TEXT REFERENCES users(id),
  status            TEXT NOT NULL CHECK (status IN ('open','in_progress','completed')) DEFAULT 'open',
  priority          TEXT NOT NULL CHECK (priority IN ('High','Medium','Low')) DEFAULT 'Medium',
  due_date          TEXT,
  completed_at      TEXT,
  notes             TEXT,
  photo_url         TEXT,
  created_by        TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_task_status ON field_tasks(status);
CREATE INDEX IF NOT EXISTS idx_task_assignee ON field_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_task_case ON field_tasks(case_id);

-- ---------------------------------------------------------------------------
-- COMPENSATION RECORD  (status tracking only -- no disbursement in pilot)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compensation_records (
  id                    TEXT PRIMARY KEY,
  premises_id           TEXT NOT NULL REFERENCES premises(id),
  case_id               TEXT REFERENCES disease_cases(id),
  animals_affected_count INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL CHECK (status IN ('reported','assessed','approved','disbursed')) DEFAULT 'reported',
  notes                 TEXT,
  created_by            TEXT REFERENCES users(id),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_comp_premises ON compensation_records(premises_id);

-- ---------------------------------------------------------------------------
-- AUDIT LOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id),
  action        TEXT NOT NULL,        -- e.g. 'create','update','delete','login','trace_run'
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  timestamp     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  details_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

-- ---------------------------------------------------------------------------
-- TRACE RUNS  (records the wall-clock performance of the contact-tracing engine
--              -- feeds the "contact-trace time" and "detection-to-alert time" metrics)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trace_runs (
  id                          TEXT PRIMARY KEY,
  case_id                     TEXT NOT NULL REFERENCES disease_cases(id),
  triggered_by                TEXT NOT NULL DEFAULT 'auto',  -- 'auto' (on case create / lab_confirmed) | 'manual_rerun'
  started_at                  TEXT NOT NULL,
  completed_at                TEXT NOT NULL,
  contact_trace_ms            INTEGER NOT NULL,
  detection_to_alert_seconds  REAL,
  premises_found_count        INTEGER NOT NULL DEFAULT 0,
  edges_found_count           INTEGER NOT NULL DEFAULT 0,
  high_risk_count             INTEGER NOT NULL DEFAULT 0,
  medium_risk_count           INTEGER NOT NULL DEFAULT 0,
  low_risk_count              INTEGER NOT NULL DEFAULT 0,
  tasks_generated_count       INTEGER NOT NULL DEFAULT 0,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_trace_case ON trace_runs(case_id);

-- ---------------------------------------------------------------------------
-- SETTINGS  (State Admin configurable -- NOT hardcoded constants)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL,   -- JSON-encoded value
  description   TEXT,
  updated_by    TEXT REFERENCES users(id),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
