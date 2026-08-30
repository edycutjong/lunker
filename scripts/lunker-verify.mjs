#!/usr/bin/env node
/**
 * lunker-verify — the proof CLI.
 *
 *   bench           compute the killer number (fixture or live ledger)
 *   seed:anomalies  regenerate the telemetry validation fixture
 *   ledger:tail     print the last COIN movements from the live ledger
 *   vc:balance      read a customer's COIN balance from RevenueCat directly
 *   webhook:verify  recompute a RevenueCat webhook HMAC over a raw body
 *
 * `bench` imports computeBench from shared/bench.js — the same function the
 * Worker's GET /verify runs. The page and this output are one computation, not
 * two that happen to agree.
 *
 * Reproduce steps live in DEMO.md.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBench, formatBench } from '../shared/bench.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// --------------------------------------------------------------------------
// arg parsing
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

function die(msg, code = 1) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

// --------------------------------------------------------------------------
// bench
// --------------------------------------------------------------------------

async function cmdBench(args) {
  const windowMs = Number(args['window-sec'] ?? 60) * 1000;
  const source = args.source ?? 'fixture';

  let sent;
  let pings;
  let label;
  let isFixture;

  if (source === 'fixture') {
    const file = args.file ?? 'seed/telemetry-anomalies.json';
    const path = resolve(ROOT, file);
    const data = JSON.parse(await readFile(path, 'utf8'));
    sent = data.sent;
    pings = data.pings;
    label = `fixture ${file}`;
    isFixture = true;
  } else if (source === 'remote') {
    const url = args.url ?? process.env.LUNKER_WORKER_URL;
    if (!url) die('--url or LUNKER_WORKER_URL is required for --source remote');
    const res = await fetch(`${url.replace(/\/$/, '')}/verify?format=json&window_ms=${windowMs}`);
    if (!res.ok) die(`ledger returned ${res.status}`);
    const data = await res.json();
    // The Worker already ran the identical computation. Print it verbatim
    // rather than recomputing from a summary we cannot re-derive.
    console.log(
      formatBench(data.bench, { sourceLabel: `live ledger ${url}`, fixture: false }),
    );
    console.log(`Distinct testers:           ${data.testers}`);
    console.log(`HMAC-verified purchases:    ${data.purchase_events}`);
    return 0;
  } else {
    die(`unknown --source: ${source} (expected "fixture" or "remote")`);
  }

  const result = computeBench(sent, pings, { windowMs });
  console.log(formatBench(result, { sourceLabel: label, fixture: isFixture }));
  return 0;
}

// --------------------------------------------------------------------------
// seed:anomalies
// --------------------------------------------------------------------------

/**
 * The validation fixture. Every value here is fixed, never random, because the
 * whole point is that the right answer is known in advance and can be checked
 * by hand:
 *
 *   45 rows ingested · 3 fabricated rejected · 39 unique ids in `sent`
 *   17 answered within 60s -> 43.6%
 *   23 latency-bearing rows -> p50 9,000  p95 104,000  max 118,000
 *
 * This dataset validates the arithmetic. It NEVER supplies a number for
 * README.md, DEMO.md, the Devpost description, or the video.
 */
export function buildAnomalyFixture() {
  const BASE = 1_756_512_000_000; // fixed epoch so the file is byte-stable
  const sent = [];
  const pings = [];

  const addSent = (id, offset) =>
    sent.push({
      notification_id: id,
      app_user_id: `tester-${(sent.length % 12) + 1}`,
      lake_id: ['willow', 'reeds', 'quarry', 'deepsea'][sent.length % 4],
      sent_at: BASE + offset * 60_000,
    });

  // --- 20 ordinary rows: 14 answered in-window, 6 answered late -------------
  const inWindow = [2000, 2500, 3500, 4200, 5000, 5800, 6500, 7200, 8600, 9000, 14000, 33000, 44000, 52000];
  const late = [64000, 71000, 83000, 95000, 104000, 118000];
  const ordinary = [...inWindow, ...late];

  ordinary.forEach((latency, i) => {
    const id = `ord-${String(i + 1).padStart(2, '0')}`;
    addSent(id, i);
    pings.push({ notification_id: id, opened_at: BASE + i * 60_000 + latency });
  });

  // --- E1: 3 ids, each posted twice (Android redelivery) --------------------
  // The second arrival is deliberately LATER, and for dup-03 it falls outside
  // the window — so "earliest open wins" is genuinely exercised rather than
  // trivially true.
  const dups = [
    { id: 'dup-01', first: 3000, second: 41000 },
    { id: 'dup-02', first: 8000, second: 52000 },
    { id: 'dup-03', first: 21000, second: 95000 },
  ];
  dups.forEach((d, i) => {
    const offset = 100 + i;
    addSent(d.id, offset);
    pings.push({ notification_id: d.id, opened_at: BASE + offset * 60_000 + d.first });
    pings.push({ notification_id: d.id, opened_at: BASE + offset * 60_000 + d.second });
  });

  // --- E2: 4 ids where the device clock is behind the server ---------------
  // Flagged, excluded from numerator and latency, RETAINED in the denominator.
  // Never clamped: clamping a negative latency to 0 would silently move the row
  // into the numerator.
  [1500, 4000, 12000, 30000].forEach((behind, i) => {
    const id = `skew-${String(i + 1).padStart(2, '0')}`;
    const offset = 200 + i;
    addSent(id, offset);
    pings.push({ notification_id: id, opened_at: BASE + offset * 60_000 - behind });
  });

  // --- E3: 12 ids never opened --------------------------------------------
  // Denominator only. Deleting these would turn 17/39 = 43.6% into 17/27 =
  // 63.0% — a 19-point free upgrade for throwing away inconvenient rows.
  for (let i = 0; i < 12; i++) {
    const id = `unopened-${String(i + 1).padStart(2, '0')}`;
    addSent(id, 300 + i);
    pings.push({ notification_id: id, opened_at: null });
  }

  // --- E4: 3 fabricated ids, absent from the `sent` log --------------------
  // Rejected outright: counted in neither numerator nor denominator.
  for (let i = 0; i < 3; i++) {
    const id = `fake-${String(i + 1).padStart(2, '0')}`;
    pings.push({ notification_id: id, opened_at: BASE + 400 * 60_000 + 5000 });
  }

  return {
    _meta: {
      purpose: 'VALIDATION DATA — NOT SUBMITTABLE',
      seed: 'lunker-2026',
      generated_by: 'scripts/lunker-verify.mjs seed:anomalies',
      description:
        'Telemetry anomaly fixtures E1-E4 plus 20 ordinary rows. Proves the bench arithmetic on cases whose correct answer is known in advance. Never a source for any published figure.',
      expected: {
        ingested: 45,
        denominator: 39,
        answered: 17,
        answered_pct: 43.6,
        p50: 9000,
        p95: 104000,
        max: 118000,
        latency_n: 23,
        duplicate_ids: 3,
        duplicate_rows: 6,
        clock_skew: 4,
        fabricated: 3,
        never_opened: 12,
      },
    },
    sent,
    pings,
  };
}

async function cmdSeedAnomalies(args) {
  const out = args.out ?? 'seed/telemetry-anomalies.json';
  const path = resolve(ROOT, out);
  const fixture = buildAnomalyFixture();
  await writeFile(path, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  console.log(`wrote ${out}`);
  console.log(`  sent rows:  ${fixture.sent.length}`);
  console.log(`  ping rows:  ${fixture.pings.length}`);
  console.log(`  expected:   ${fixture._meta.expected.answered}/${fixture._meta.expected.denominator} = ${fixture._meta.expected.answered_pct}%`);
  return 0;
}

// --------------------------------------------------------------------------
// ledger:tail
// --------------------------------------------------------------------------

async function cmdLedgerTail(args) {
  const url = args.url ?? process.env.LUNKER_WORKER_URL;
  if (!url) die('--url or LUNKER_WORKER_URL is required');
  const res = await fetch(`${url.replace(/\/$/, '')}/verify?format=json`);
  if (!res.ok) die(`ledger returned ${res.status}`);
  const data = await res.json();

  console.log(`COIN ledger — last ${data.ledger_tail.length} movements`);
  console.log('  delta      reason        rc    when');
  for (const t of data.ledger_tail) {
    const delta = `${t.delta >= 0 ? '+' : ''}${t.delta}`.padStart(8);
    const reason = String(t.reason).padEnd(12);
    const when = new Date(t.created_at).toISOString().replace('T', ' ').slice(0, 19);
    console.log(`  ${delta}   ${reason}  ${t.rc_status}   ${when}Z`);
  }
  return 0;
}

// --------------------------------------------------------------------------
// vc:balance
// --------------------------------------------------------------------------

async function cmdVcBalance(args) {
  const user = args.user;
  if (!user) die('--user <app_user_id> is required');
  const key = process.env.REVENUECAT_SECRET_KEY;
  const project = process.env.REVENUECAT_PROJECT_ID;
  if (!key || !project) {
    die('REVENUECAT_SECRET_KEY and REVENUECAT_PROJECT_ID must be set in the environment');
  }

  const url = `https://api.revenuecat.com/v2/projects/${encodeURIComponent(project)}/customers/${encodeURIComponent(user)}/virtual_currencies`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${key}` } });
  const body = await res.text();
  console.log(`GET ${url}`);
  console.log(`status: ${res.status}`);
  console.log(body);
  return res.ok ? 0 : 1;
}

// --------------------------------------------------------------------------
// webhook:verify
// --------------------------------------------------------------------------

async function cmdWebhookVerify(args) {
  const file = args.file;
  const signature = args.signature;
  if (!file) die('--file <raw-body.json> is required');
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) die('REVENUECAT_WEBHOOK_SECRET must be set in the environment');

  // Raw bytes, exactly as received. Parsing and re-serialising would change
  // whitespace and key order and break a signature that is actually valid.
  const raw = await readFile(resolve(process.cwd(), file), 'utf8');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(raw));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');

  console.log(`body bytes: ${enc.encode(raw).length}`);
  console.log(`computed:   ${hex}`);
  if (signature && typeof signature === 'string') {
    const provided = signature.trim().replace(/^sha256=/i, '').toLowerCase();
    console.log(`provided:   ${provided}`);
    const match = provided.length === hex.length && provided === hex;
    console.log(`match:      ${match ? 'YES' : 'NO'}`);
    return match ? 0 : 1;
  }
  return 0;
}

// --------------------------------------------------------------------------

const USAGE = `lunker-verify <command> [options]

  bench            --source fixture|remote [--file <path>] [--url <worker>] [--window-sec 60]
  seed:anomalies   [--out seed/telemetry-anomalies.json]
  ledger:tail      [--url <worker>]
  vc:balance       --user <app_user_id>
  webhook:verify   --file <raw-body.json> [--signature <hex>]

env: LUNKER_WORKER_URL, REVENUECAT_SECRET_KEY, REVENUECAT_PROJECT_ID, REVENUECAT_WEBHOOK_SECRET`;

async function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  switch (cmd) {
    case 'bench':          return cmdBench(args);
    case 'seed:anomalies': return cmdSeedAnomalies(args);
    case 'ledger:tail':    return cmdLedgerTail(args);
    case 'vc:balance':     return cmdVcBalance(args);
    case 'webhook:verify': return cmdWebhookVerify(args);
    case undefined:
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(USAGE);
      return 1;
  }
}

// Only run when invoked directly, so the fixture builder can be imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code ?? 0));
}
