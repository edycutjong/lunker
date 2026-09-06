#!/usr/bin/env node
/**
 * The stated test count must equal the real one.
 *
 * This number has now drifted four separate times — 207, 215, 219, 223 — and on
 * two of those occasions the DEPLOYED landing page was serving a figure that no
 * longer matched the suite. It is the single easiest claim in the whole
 * submission for a judge to falsify: clone, `npm test`, compare to the README.
 *
 * Every previous fix was "update the number everywhere", and every one of them
 * decayed within days, because the number lives in eight files and nothing
 * connected them. So this reads the real count from vitest and fails if any
 * surface disagrees. Correcting it by hand is no longer a thing anyone has to
 * remember.
 *
 *   node scripts/check-test-count.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const SURFACES = [
  'README.md',
  'DEMO.md',
  '.github/CONTRIBUTING.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  '.github/workflows/ci.yml',
  'worker/src/landing.ts',
];

// Ask vitest, rather than trusting anything written down.
const out = execFileSync('npx', ['vitest', 'run', '--reporter=json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'ignore'],
});
const report = JSON.parse(out.slice(out.indexOf('{')));
const actual = report.numTotalTests;

console.log(`\n  real test count: ${actual}\n`);

// Any 3-digit number immediately followed by "tests", or sitting in the landing
// page's tests stat, is a claim about this value.
const CLAIM = /(\d{3})\s*tests|id="tests">(\d{3})</g;

let bad = 0;
for (const f of SURFACES) {
  if (!existsSync(f)) continue;
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(CLAIM)) {
    const claimed = Number(m[1] ?? m[2]);
    const line = text.slice(0, m.index).split('\n').length;
    if (claimed !== actual) {
      console.log(`  ❌ ${f}:${line} claims ${claimed}`);
      bad++;
    }
  }
}

console.log(
  bad === 0
    ? `  ✅ every surface agrees on ${actual}.\n`
    : `\n  FAIL — ${bad} stale claim(s). Set them all to ${actual}.\n`,
);
process.exit(bad === 0 ? 0 : 1);
