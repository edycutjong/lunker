/**
 * A D1-shaped adapter over node:sqlite.
 *
 * Deliberately a real database rather than a mock. The route tests exercise the
 * actual migration file, the actual ON CONFLICT clauses, and the actual
 * INSERT OR IGNORE idempotency — the three places where a hand-written mock
 * would happily agree with a bug.
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Loaded through createRequire rather than a static import: Vite's builtin list
// does not yet recognise `node:sqlite` and rewrites it to a bare `sqlite`
// specifier that resolves to nothing.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');

class Stmt {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    const s = new Stmt(this.db, this.sql);
    // D1 has no null/undefined distinction on bind; node:sqlite rejects undefined.
    s.params = params.map((p) => (p === undefined ? null : p));
    return s;
  }

  async first(_col) {
    const row = this.db.prepare(this.sql).get(...this.params);
    return row === undefined ? null : { ...row };
  }

  async all() {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return { results: rows.map((r) => ({ ...r })), success: true };
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes ?? 0) } };
  }
}

export class FakeD1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec('PRAGMA foreign_keys = ON');
    // EVERY migration, in order — not just 0001.
    //
    // This hardcoded 0001_init.sql, so the moment a second migration existed the
    // suite was testing a schema the Worker no longer runs against. Adding
    // `entitlement_ids` in 0002 failed 40 tests with "no such column", which was
    // the harness being wrong rather than the code.
    const dir = resolve(ROOT, 'worker/migrations');
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.sql')) continue;
      this.db.exec(readFileSync(resolve(dir, file), 'utf8'));
    }
  }

  prepare(sql) {
    return new Stmt(this.db, sql);
  }

  async batch(stmts) {
    // D1 batches run in a single implicit transaction. Mirroring that matters
    // here: `sent` and its null-open `bite_telemetry` row must land together or
    // not at all, or an unanswered bite escapes the denominator.
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Test-only escape hatch for asserting on state directly. */
  raw(sql, ...params) {
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => ({ ...r }));
  }
}

/** A Deps object wired to an in-memory D1 and a frozen clock. */
export function makeDeps(overrides = {}) {
  const db = overrides.db ?? new FakeD1();
  const now = overrides.now ?? (() => 1_756_512_000_000);
  const env = {
    DB: db,
    REVENUECAT_SECRET_KEY: 'sk_test',
    REVENUECAT_PROJECT_ID: 'proj_test',
    REVENUECAT_WEBHOOK_SECRET: 'whsec_test',
    ONESIGNAL_REST_API_KEY: 'os_key_test',
    ONESIGNAL_APP_ID: 'os_app_test',
    ROLL_SERVER_SECRET: 'roll_secret_test',
    DEV_CAST_ENABLED: '0',
    ...overrides.env,
  };
  return { db, env, now };
}

/** Build a POST Request with a JSON body. */
export function postJson(path, body, headers = {}) {
  return new Request(`https://lunker.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
