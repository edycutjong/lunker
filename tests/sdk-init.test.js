/**
 * Two defects found on 2026-09-01, each pinned by the tests named for it.
 *
 * Both lived in the primary award's path, and neither was reachable by the rest
 * of the suite: `GameContext.tsx` and `onesignal.ts` import the React Native
 * runtime, so they cannot be imported into vitest. They are asserted as SOURCE
 * here — the same approach `deeplink.test.js` takes for `App.tsx`, and for the
 * same reason.
 *
 * A source assertion is weaker than a behavioural one and is not pretended to
 * be otherwise. It pins ORDER and DEPENDENCE, which is exactly what both
 * defects were about, and it fails loudly if someone reintroduces either shape.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gameContext = readFileSync(resolve(ROOT, 'app/src/state/GameContext.tsx'), 'utf8');
const onesignal = readFileSync(resolve(ROOT, 'app/src/lib/onesignal.ts'), 'utf8');

describe('defect: a RevenueCat failure silently killed OneSignal init', () => {
  // Was: `await RC.configurePurchases(...)` then `await RC.loginPurchases(...)`
  // then `OS.initOneSignal(...)`, in one IIFE with no `.catch()`. An unset key,
  // an outage or a cold offline launch rejected on the logIn line, the effect
  // died, and OneSignal never initialised — so that player never received a
  // bite again. Push is the product; it cannot sit downstream of billing.

  it('initialises OneSignal before any RevenueCat call', () => {
    const os = gameContext.indexOf('OS.initOneSignal(');
    const configure = gameContext.indexOf('RC.configurePurchases(');
    const login = gameContext.indexOf('RC.loginPurchases(');

    expect(os).toBeGreaterThan(-1);
    expect(configure).toBeGreaterThan(-1);
    expect(login).toBeGreaterThan(-1);
    expect(os).toBeLessThan(configure);
    expect(os).toBeLessThan(login);
  });

  it('never leaves a RevenueCat boot call unguarded', () => {
    // Every awaited RC call in the boot effect carries its own `.catch`, so a
    // rejection cannot abort the effect before later work runs.
    for (const call of ['RC.configurePurchases(', 'RC.loginPurchases(']) {
      const at = gameContext.indexOf(call);
      const tail = gameContext.slice(at, at + 400);
      expect(tail, `${call} must be guarded by .catch`).toMatch(/\.catch\(/);
    }
  });

  it('tolerates a null CustomerInfo, so a failed logIn is a degraded HUD not a crash', () => {
    expect(gameContext).toMatch(/customerInfo:\s*CustomerInfo\s*\|\s*null/);
    expect(onesignal).not.toMatch(/customerInfo!/);
  });
});

describe('defect: the permission prime fired the native prompt alongside itself', () => {
  // Was: `triggerPermissionPrime()` immediately followed by
  // `await requestPushPermission()`. The OS dialog appeared at the same moment
  // as the in-app prime, which is two prompts at once, not priming. The code
  // comment claimed the native prompt came from the message's click handler.
  // It did not. An in-app "no" is recoverable; a native "no" is not.

  it('requests the native permission only from the in-app message click handler', () => {
    const request = onesignal.indexOf('Notifications.requestPermission(');
    expect(request).toBeGreaterThan(-1);

    // The one call site sits inside `finish`, which is reached from the click
    // listener, the dismiss listener or the never-displayed timeout.
    const enclosing = onesignal.slice(0, request);
    expect(enclosing).toMatch(/const finish = async \(accepted: boolean\)/);
    expect(onesignal.slice(request - 120, request)).toMatch(/accepted\s*\?/);
  });

  it('does not fire the native prompt when the prime is dismissed', () => {
    // onDidDismiss resolves false — it must never pass `true` into finish.
    const at = onesignal.indexOf('const onDidDismiss');
    expect(at).toBeGreaterThan(-1);
    expect(onesignal.slice(at, at + 200)).toMatch(/finish\(false\)/);
  });

  it('falls back to the native prompt only when the prime never displayed', () => {
    // No message authored in the dashboard means no willDisplay ever arrives.
    // Never asking at all is worse than asking unprimed.
    const at = onesignal.indexOf('timer = setTimeout(');
    expect(at).toBeGreaterThan(-1);
    expect(onesignal.slice(at, at + 300)).toMatch(/if \(!displayed\) void finish\(true\)/);
  });

  it('keeps the accept action id and trigger key exported, so the dashboard can match them', () => {
    expect(onesignal).toMatch(/export const PRIME_TRIGGER = 'prime_push'/);
    expect(onesignal).toMatch(/export const PRIME_ACCEPT_ACTION_ID = 'prime_accept'/);
  });

  it('leaves no orphaned permission helper behind', () => {
    // A `requestPushPermission` export with no call site would read as an
    // integration surface while being dead code — the phantom this file's own
    // closing note exists to prevent.
    expect(onesignal).not.toMatch(/export async function requestPushPermission/);
    expect(gameContext).not.toMatch(/OS\.triggerPermissionPrime\(/);
  });
});
