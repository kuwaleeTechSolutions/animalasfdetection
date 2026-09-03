// =====================================================================================
// Database connection wrapper.
//
// [DECIDE] Pilot storage engine: SQLite via Node's built-in `node:sqlite` module.
// Rationale (documented fully in README): the reference deployment target for this
// spec is PostgreSQL + PostGIS, but this pilot was built inside a sandboxed / air-gapped
// environment with no package-registry access -- a realistic proxy for many Government
// of Assam / NIC network environments. Rather than ship unverified code, we chose a
// zero-external-dependency stack (Node core only) so the ENTIRE pilot can be verified
// end-to-end with nothing more than `node` installed -- no `npm install`, no Docker
// registry pulls, no internet required at runtime. All geo/graph queries are isolated
// behind repository interfaces (see src/lib/geo.mts and src/repositories/*) so swapping
// the DatabaseSync driver for `pg` + PostGIS is a repository-implementation swap, not a
// redesign.
// =====================================================================================
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath = process.env.DB_PATH || join(__dirname, '..', '..', '..', 'data', 'assam_biosecurity.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function migrate(): void {
  const database = getDb();
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  database.exec(schema);
}

export function resetDb(): void {
  // Used only by test harness to get a clean in-memory database.
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
}
