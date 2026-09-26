#!/usr/bin/env node
/**
 * Render the static site that GitHub Pages publishes at https://lunker.edycu.dev.
 *
 *   node scripts/build-site.mjs          write site/index.html + site/privacy.html
 *   node scripts/build-site.mjs --check  exit 1 if either file is stale (CI)
 *
 * The landing page and privacy policy are authored in TypeScript next to the
 * Worker (worker/src/landing.ts, worker/src/routes/privacy.ts) because the
 * bite-times card is generated from the same schedule code the cron runs. This
 * script bundles those two modules with the esbuild that ships with wrangler and
 * writes their output, so the committed HTML can never drift from the code.
 * site/assets/ and site/pitch/ are hand-maintained files and are not touched.
 */
import { build } from '../worker/node_modules/esbuild/lib/main.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const dir = mkdtempSync(join(tmpdir(), 'lunker-site-'));
const entry = join(dir, 'entry.ts');
const out = join(dir, 'entry.mjs');
writeFileSync(
  entry,
  `export { renderLanding } from ${JSON.stringify(join(ROOT, 'worker/src/landing.ts'))};\n` +
    `export { PRIVACY_HTML } from ${JSON.stringify(join(ROOT, 'worker/src/routes/privacy.ts'))};\n`,
);

try {
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'error',
  });
  const { renderLanding, PRIVACY_HTML } = await import(pathToFileURL(out).href);

  const files = { 'site/index.html': renderLanding(), 'site/privacy.html': PRIVACY_HTML };
  const stale = [];
  for (const [rel, body] of Object.entries(files)) {
    const path = join(ROOT, rel);
    let current = null;
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      /* missing counts as stale */
    }
    if (current === body) continue;
    if (check) stale.push(rel);
    else {
      writeFileSync(path, body);
      console.log(`wrote ${rel} (${body.length} bytes)`);
    }
  }
  if (check && stale.length) {
    console.error(`stale: ${stale.join(', ')} — run: node scripts/build-site.mjs`);
    process.exitCode = 1;
  } else if (check) {
    console.log('site/ is up to date');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
