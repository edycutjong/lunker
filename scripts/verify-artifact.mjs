#!/usr/bin/env node
/**
 * Pre-upload artifact gate.
 *
 * WHY THIS EXISTS
 *
 * On 2026-09-06 a release build was produced after the RevenueCat public key was
 * finally issued and written into `app/.env`. Gradle reported BUILD SUCCESSFUL,
 * signed the APK with the real upload key, and produced a perfectly installable
 * 82 MB artifact — whose JS bundle still contained an EMPTY RevenueCat key.
 *
 * The cause: `EXPO_PUBLIC_*` values are inlined into the JS bundle at bundle
 * time, but `app/.env` is not one of Gradle's tracked inputs for
 * `createBundleReleaseJsAndAssets`. No JS source had changed, so the task was
 * considered up-to-date and the stale bundle was packaged verbatim.
 *
 * Nothing about the resulting file looks wrong. It installs, it launches, it is
 * correctly signed. It simply cannot talk to RevenueCat. Discovering that after
 * a store review round-trip costs days we do not have.
 *
 * So: never upload an artifact that has not passed this.
 *
 *   node scripts/verify-artifact.mjs <path-to-apk-or-aab>
 *
 * Reads expected values from the environment, so the real secrets stay in
 * ~/.config/lunker/secrets.env and never touch this repo:
 *
 *   set -a; . ~/.config/lunker/secrets.env; set +a
 *   node scripts/verify-artifact.mjs app/android/app/build/outputs/apk/release/app-release.apk
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

const target = process.argv[2];
if (!target) {
  console.error('usage: node scripts/verify-artifact.mjs <apk|aab>');
  process.exit(2);
}
if (!existsSync(target)) {
  console.error(`no such artifact: ${target}`);
  process.exit(2);
}

const isAab = target.endsWith('.aab');
// An AAB nests the bundle under base/; an APK keeps it at assets/.
const bundlePath = isAab ? 'base/assets/index.android.bundle' : 'assets/index.android.bundle';

function readBundle() {
  try {
    // -p streams the member to stdout without unpacking to disk. The bundle is
    // ~2 MB, so buffering it is fine; raise maxBuffer well past that anyway.
    return execFileSync('unzip', ['-p', target, bundlePath], {
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'latin1',
    });
  } catch {
    return null;
  }
}

const checks = [];
const add = (ok, label, detail) => checks.push({ ok, label, detail });

// ── 1. The JS bundle must be present at all ────────────────────────────────
// A debug APK has no embedded bundle (it loads from Metro), so this also
// catches "you built the wrong variant" — which looks identical in a file
// listing.
const bundle = readBundle();
add(
  bundle !== null && bundle.length > 0,
  'JS bundle embedded',
  bundle
    ? `${(bundle.length / 1e6).toFixed(2)} MB at ${bundlePath}`
    : `missing ${bundlePath} — is this a debug build?`,
);

// ── 2. The values that are inlined at bundle time ──────────────────────────
// This is the check the 2026-09-06 stale bundle would have failed.
const inlined = [
  ['EXPO_PUBLIC_RC_ANDROID_KEY', process.env.REVENUECAT_PUBLIC_ANDROID_KEY, 'goog_'],
  ['EXPO_PUBLIC_ONESIGNAL_APP_ID', process.env.ONESIGNAL_APP_ID, ''],
];
for (const [name, expected, prefix] of inlined) {
  if (!expected) {
    add(
      false,
      `${name} available to check`,
      'not set in env — source ~/.config/lunker/secrets.env first',
    );
    continue;
  }
  if (prefix && !expected.startsWith(prefix)) {
    add(false, `${name} looks like the right kind of key`, `expected prefix "${prefix}"`);
    continue;
  }
  add(
    bundle !== null && bundle.includes(expected),
    `${name} baked into the bundle`,
    bundle === null
      ? 'no bundle to search'
      : `looking for ${expected.slice(0, 5)}… (${expected.length} chars)`,
  );
}

// ── 3. Never ship debug signing ────────────────────────────────────────────
// The Expo template points buildTypes.release at signingConfigs.debug, and a
// debug-signed release APK installs and runs perfectly. Play and the Galaxy
// Store both reject it — at upload, which is the expensive place to find out.
try {
  const certs = execFileSync('jarsigner', ['-verify', '-verbose:summary', '-certs', target], {
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const debugSigned = /CN=Android Debug/i.test(certs);
  add(
    !debugSigned,
    'signed with a real upload key',
    debugSigned
      ? 'CN=Android Debug — stores will reject this'
      : 'not the Android debug certificate',
  );
} catch {
  add(false, 'signature readable', 'jarsigner could not verify the artifact');
}

// ── report ─────────────────────────────────────────────────────────────────
const sizeMb = (statSync(target).size / 1e6).toFixed(1);
console.log(`\n  ${target}  (${sizeMb} MB)\n`);
let failed = 0;
for (const c of checks) {
  console.log(`  ${c.ok ? '✅' : '❌'} ${c.label}`);
  if (c.detail) console.log(`       ${c.detail}`);
  if (!c.ok) failed++;
}
console.log(
  failed === 0
    ? '\n  PASS — safe to upload.\n'
    : `\n  FAIL — ${failed} check(s). Do NOT upload this artifact.\n`,
);
process.exit(failed === 0 ? 0 : 1);
