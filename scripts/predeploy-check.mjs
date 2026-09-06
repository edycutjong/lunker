#!/usr/bin/env node
/**
 * Run BEFORE `wrangler deploy`.
 *
 * WHY THIS EXISTS
 *
 * On 2026-09-06 a deploy shipped code that queried `purchase_events.entitlement_ids`
 * while the migration adding that column had failed with an authorization error
 * moments earlier. `wrangler deploy` succeeded, reported success, and put a
 * Worker into production that returned HTTP 500 on /player/sync — the route the
 * app calls on every launch. Nothing in the deploy path noticed: the migration
 * and the deploy are separate commands, and only one of them failed.
 *
 * The live smoke test at the end is the part that matters. A deploy that
 * "succeeded" is not the same as a Worker that works, and the gap between those
 * two facts was a broken production for several minutes.
 *
 *   node scripts/predeploy-check.mjs            # before deploying
 *   node scripts/predeploy-check.mjs --live     # after, to verify the deploy
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const live = process.argv.includes('--live');
const WORKER = 'https://lunker.edycu.workers.dev';
let bad = 0;
const say = (ok, label, detail) => {
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (detail) console.log(`       ${detail}`);
  if (!ok) bad++;
};

if (!live) {
  // Every column the Worker SELECTs or INSERTs must exist in some migration.
  // This is a coarse check — it greps identifiers rather than parsing SQL — but
  // it is aimed squarely at the failure that actually happened: shipping a
  // reference to a column no migration had created remotely yet.
  const migDir = resolve('worker/migrations');
  const schema = readdirSync(migDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(resolve(migDir, f), 'utf8'))
    .join('\n');

  const declared = new Set();
  for (const m of schema.matchAll(/^\s*([a-z_]+)\s+(TEXT|INTEGER|REAL|BLOB)/gim))
    declared.add(m[1]);
  for (const m of schema.matchAll(/ADD COLUMN\s+([a-z_]+)/gi)) declared.add(m[1]);

  const src = readdirSync(resolve('worker/src'), { recursive: true })
    .filter((f) => String(f).endsWith('.ts'))
    .map((f) => readFileSync(resolve('worker/src', String(f)), 'utf8'))
    .join('\n');

  // Column names this codebase uses that look like schema identifiers.
  const used = new Set();
  for (const m of src.matchAll(
    /\b(entitlement_ids|rc_status|idempotency_key|roll_seed|opened_at|sent_at|app_user_id|product_id|event_type|revenue_usd|verified_at|unlocked_lakes|current_lake|streak_days|push_enabled|tz_offset_min|last_active_at|last_bite_at|notification_id|lake_id|latency_ms)\b/g,
  ))
    used.add(m[1]);

  const missing = [...used].filter((c) => !declared.has(c));
  say(
    missing.length === 0,
    'every column the Worker references exists in a migration',
    missing.length ? `missing: ${missing.join(', ')}` : `${used.size} checked`,
  );

  console.log(
    '\n  Reminder: `wrangler deploy` does NOT apply migrations.\n' +
      '  Run `npx wrangler d1 migrations apply lunker --remote` first, and read its output —\n' +
      '  it can fail with an auth error while the deploy that follows succeeds.\n',
  );
} else {
  // A deploy is only real if the routes answer.
  for (const [path, expect] of [
    ['/health', 200],
    ['/verify', 200],
    ['/', 200],
  ]) {
    const code = execFileSync(
      'curl',
      ['-s', '-o', '/dev/null', '-w', '%{http_code}', WORKER + path],
      {
        encoding: 'utf8',
      },
    );
    say(Number(code) === expect, `GET ${path} → ${code}`);
  }
  // The route that broke: it touches the newest schema.
  const out = execFileSync(
    'curl',
    [
      '-s',
      '-w',
      '\n%{http_code}',
      '-X',
      'POST',
      WORKER + '/player/sync',
      '-H',
      'content-type: application/json',
      '-d',
      '{"app_user_id":"angler_predeploy-probe","push_enabled":false,"tz_offset_min":0}',
    ],
    { encoding: 'utf8' },
  );
  const code = out.trim().split('\n').pop();
  say(code === '200', `POST /player/sync → ${code}`, 'exercises the newest columns');
}

console.log(bad === 0 ? '\n  PASS\n' : `\n  FAIL — ${bad} problem(s).\n`);
process.exit(bad === 0 ? 0 : 1);
