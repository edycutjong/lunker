#!/usr/bin/env node
/**
 * Pre-submission gate.
 *
 * Fails if any ⟦FILL…⟧ token or placeholder URL survives anywhere that ships.
 * The point is that a half-finished landing page, a wrangler.toml with no
 * database id, or a README with an unfilled store link cannot ship quietly —
 * every one of those has to become a hard stop rather than something noticed
 * after submission closes.
 *
 *   node scripts/check-submission-readiness.mjs
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, relative, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.expo',
  'dist',
  'build',
  'coverage',
  'android',
  'ios',
  '.wrangler',
]);
const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.html',
  '.toml',
  '.yml',
  '.yaml',
  '.sql',
  '.sh',
]);

/** Files that are ALLOWED to mention the token, because they define the gate. */
const ALLOWLIST = new Set(['scripts/check-submission-readiness.mjs']);

const FILL = /⟦FILL[^⟧]*⟧/g;

const PLACEHOLDERS = [
  { re: /https?:\/\/example\.com/gi, why: 'example.com placeholder URL' },
  { re: /YOUR_APP_ID|YOUR_APP_API_KEY|YOUR_API_KEY/g, why: 'copy-pasted credential placeholder' },
  { re: /\bTODO\(blocker\)/g, why: 'unresolved blocker TODO' },
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // `.github/` ships and can carry placeholders too; only skip dot-junk.
    if (entry.name.startsWith('.') && !['.gitignore', '.github'].includes(entry.name)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (TEXT_EXT.has(extname(entry.name))) yield full;
  }
}

async function main() {
  const findings = [];
  let scanned = 0;

  for await (const file of walk(ROOT)) {
    const rel = relative(ROOT, file);
    if (ALLOWLIST.has(rel)) continue;

    const info = await stat(file);
    if (info.size > 2_000_000) continue;

    const text = await readFile(file, 'utf8');
    scanned++;

    for (const match of text.matchAll(FILL)) {
      findings.push({
        rel,
        line: lineOf(text, match.index),
        token: match[0],
        why: 'unfilled token',
      });
    }
    for (const p of PLACEHOLDERS) {
      for (const match of text.matchAll(p.re)) {
        findings.push({ rel, line: lineOf(text, match.index), token: match[0], why: p.why });
      }
    }
  }

  console.log(`scanned ${scanned} text files under ${ROOT}`);

  if (findings.length === 0) {
    console.log('\n  PASS — no unfilled tokens or placeholder URLs.');
    return 0;
  }

  console.log(`\n  FAIL — ${findings.length} unresolved item(s):\n`);
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.rel)) byFile.set(f.rel, []);
    byFile.get(f.rel).push(f);
  }
  for (const [rel, items] of [...byFile].sort()) {
    console.log(`  ${rel}`);
    for (const i of items) console.log(`    :${i.line}  ${i.token}   (${i.why})`);
  }
  console.log('\nEvery one of these must be a real value before submission.');
  return 1;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

main().then((code) => process.exit(code));
