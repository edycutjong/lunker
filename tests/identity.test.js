import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The app_user_id is a bearer credential, not a display handle.
 *
 * The Worker accepts it as the only credential on /spend-coin, /catch-resolved
 * and /player/sync — no signature, no session — so anyone who can produce
 * another player's id can spend that player's COIN.
 *
 * It was originally built from Date.now() plus two Math.random() slices, which
 * CodeQL flagged (js/insecure-randomness) on 2026-09-04. These tests assert the
 * source rather than the runtime because generating the id needs the native
 * module: the vitest suite runs on Node against real SQLite, with no React
 * Native runtime to load expo-crypto or AsyncStorage from.
 *
 * Asserting on source text is weaker than asserting behaviour and is used here
 * deliberately, because the failure being prevented is someone reintroducing
 * the cheap generator — which is a source-level event.
 */
const raw = readFileSync(new URL('../app/src/lib/identity.ts', import.meta.url), 'utf8');

/**
 * Strip comments before matching.
 *
 * The file's header documents the defect being prevented, and names
 * `Math.random()` and `Date.now().toString(36)` while doing so. Matching raw
 * source would therefore fail on the very explanation that keeps the fix from
 * being undone by someone who did not know why it was there — which would push
 * whoever hit it toward deleting the comment. The guard has to read code only.
 */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('app_user_id is unguessable', () => {
  it('does not derive the id from Math.random', () => {
    // The defect: `Math.random().toString(36).slice(2, 10)`, twice.
    expect(src).not.toMatch(/Math\s*\.\s*random\s*\(/);
  });

  it('does not put a readable clock in the id', () => {
    // Date.now().toString(36) is just the first-launch time, so it removed
    // most of the search space before Math.random even contributed.
    expect(src).not.toMatch(/Date\s*\.\s*now\s*\(\)\s*\.\s*toString/);
  });

  it('uses the platform CSPRNG', () => {
    expect(src).toMatch(/from\s+'expo-crypto'/);
    expect(src).toMatch(/Crypto\s*\.\s*randomUUID\s*\(\)/);
  });

  it('still namespaces the id, so ledger rows stay readable', () => {
    // The `angler_` prefix is load-bearing for anyone reading vc_transactions
    // by hand; a bare UUID there is unreadable during an incident.
    expect(src).toMatch(/`angler_\$\{/);
  });
});
