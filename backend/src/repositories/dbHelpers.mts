import { getDb } from '../db/connection.mts';

export function run(sql: string, params: any[] = []) {
  return getDb().prepare(sql).run(...params);
}

export function get<T = any>(sql: string, params: any[] = []): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

export function all<T = any>(sql: string, params: any[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Wraps a batch of writes in a single SQLite transaction.
 *
 * [PERF NOTE] Without an explicit transaction, SQLite auto-commits (and fsyncs) after
 * EVERY individual INSERT/UPDATE, which is fine for single-row API writes but is
 * disastrous for bulk operations (seed script, contact-tracing edge persistence,
 * CSV import) -- each fsync can cost 10s-100s of milliseconds depending on the
 * underlying filesystem. Wrapping a batch in BEGIN/COMMIT reduces that to a single
 * fsync for the whole batch. Any error rolls the whole batch back.
 */
// SQLite doesn't support true nested transactions -- track depth so that a
// transaction() call made from inside another transaction() just runs inline
// (participating in the outer, already-open transaction) instead of trying to
// issue a second BEGIN.
let txnDepth = 0;

export function transaction<T>(fn: () => T): T {
  const db = getDb();
  if (txnDepth > 0) {
    // Already inside an outer transaction -- just run inline.
    txnDepth++;
    try { return fn(); } finally { txnDepth--; }
  }
  db.exec('BEGIN');
  txnDepth = 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txnDepth = 0;
  }
}
