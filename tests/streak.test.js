/**
 * Streak accounting, and the two player-sync invariants that protect a paid
 * unlock.
 *
 * Before this existed, `streak_days` was a column nothing ever incremented
 * while four documents claimed Journeys branched on it — a phantom integration
 * surface. These tests are what make the claim true.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeD1, makeDeps, postJson } from './helpers/d1.js';
import { nextStreak, localDayIndex } from '../worker/src/lib/streak.js';
import { playerSync } from '../worker/src/routes/player-sync.js';
import { verify } from '../worker/src/routes/verify.js';
import { revenuecatWebhook } from '../worker/src/routes/revenuecat-webhook.js';
import { hmacSha256Hex } from '../worker/src/lib/webhook.js';

const DAY = 86_400_000;
const NOON_UTC = 1_756_512_000_000;
const USER = 'angler-1';

describe('localDayIndex', () => {
  it('uses the player local calendar, not UTC', () => {
    // 23:00 UTC is already the next day at UTC+7. Scoring streaks in UTC would
    // silently break them for most of the world.
    const at23UTC = Math.floor(NOON_UTC / DAY) * DAY + 23 * 3_600_000;
    expect(localDayIndex(at23UTC, 7 * 60)).toBe(localDayIndex(at23UTC, 0) + 1);
  });

  it('is stable within a local day', () => {
    const base = Math.floor(NOON_UTC / DAY) * DAY;
    expect(localDayIndex(base + 3_600_000, 0)).toBe(localDayIndex(base + 8 * 3_600_000, 0));
  });
});

describe('nextStreak', () => {
  it('starts a first-ever session at 1, not 0', () => {
    expect(nextStreak(null, 0, NOON_UTC, 0)).toBe(1);
  });

  it('increments on a consecutive local day', () => {
    expect(nextStreak(NOON_UTC, 3, NOON_UTC + DAY, 0)).toBe(4);
  });

  it('does not increment twice in the same day', () => {
    expect(nextStreak(NOON_UTC, 3, NOON_UTC + 3_600_000, 0)).toBe(3);
  });

  it('restarts at 1 after a missed day, so a returning player is not told they have nothing', () => {
    expect(nextStreak(NOON_UTC, 9, NOON_UTC + 3 * DAY, 0)).toBe(1);
  });

  it('heals a legacy stored 0 rather than leaving a player stuck there', () => {
    expect(nextStreak(NOON_UTC, 0, NOON_UTC + 3_600_000, 0)).toBe(1);
    expect(nextStreak(NOON_UTC, 0, NOON_UTC + DAY, 0)).toBe(1 + 1);
  });

  it('never goes negative or fractional', () => {
    for (const gap of [0, 1, 2, 7, 400]) {
      const v = nextStreak(NOON_UTC, 5, NOON_UTC + gap * DAY, -480);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });
});

describe('POST /player/sync', () => {
  let deps;
  beforeEach(() => {
    deps = makeDeps({ db: new FakeD1(), now: () => NOON_UTC });
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('computes the streak server-side and returns it', async () => {
    const res = await playerSync(postJson('/player/sync', { app_user_id: USER }), deps);
    expect((await res.json()).streak_days).toBe(1);
  });

  it('ignores a client-declared streak', async () => {
    // A client-declared streak is a forged streak.
    const res = await playerSync(
      postJson('/player/sync', { app_user_id: USER, streak_days: 9999 }),
      deps,
    );
    expect((await res.json()).streak_days).toBe(1);
    const [row] = deps.db.raw('SELECT streak_days FROM players');
    expect(row.streak_days).toBe(1);
  });

  it('advances the streak across a real calendar day', async () => {
    await playerSync(postJson('/player/sync', { app_user_id: USER }), deps);
    const tomorrow = makeDeps({ db: deps.db, now: () => NOON_UTC + DAY });
    const res = await playerSync(postJson('/player/sync', { app_user_id: USER }), tomorrow);
    expect((await res.json()).streak_days).toBe(2);
  });

  it('NEVER erases a paid unlock when a reinstalled client reports only free lakes', async () => {
    // The bug this replaces: a relaunch pushed ['willow','reeds'] and the player
    // who had paid 1,200 COIN for Quarry saw it locked and priced again.
    await playerSync(
      postJson('/player/sync', { app_user_id: USER, unlocked_lakes: ['willow', 'reeds', 'quarry'] }),
      deps,
    );
    const res = await playerSync(
      postJson('/player/sync', { app_user_id: USER, unlocked_lakes: ['willow', 'reeds'] }),
      deps,
    );
    expect((await res.json()).unlocked_lakes).toContain('quarry');
    const [row] = deps.db.raw('SELECT unlocked_lakes FROM players');
    expect(row.unlocked_lakes).toContain('quarry');
  });

  it('still adds newly unlocked lakes to the merged set', async () => {
    await playerSync(postJson('/player/sync', { app_user_id: USER }), deps);
    const res = await playerSync(
      postJson('/player/sync', { app_user_id: USER, unlocked_lakes: ['deepsea'] }),
      deps,
    );
    const lakes = (await res.json()).unlocked_lakes;
    expect(lakes).toContain('deepsea');
    expect(lakes).toContain('willow');
  });
});

describe('GET /verify — the purchase counter', () => {
  let deps;
  beforeEach(() => {
    deps = makeDeps({ db: new FakeD1(), now: () => NOON_UTC });
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
  });
  afterEach(() => vi.unstubAllGlobals());

  async function signedEvent(id, type) {
    const raw = JSON.stringify({ event: { id, type, app_user_id: USER, product_id: 'coins_500', price: 0.99 } });
    return new Request('https://lunker.test/webhooks/revenuecat', {
      method: 'POST',
      headers: { 'x-revenuecat-signature': await hmacSha256Hex(raw, 'whsec_test') },
      body: raw,
    });
  }

  it('counts only events where money moved toward us', async () => {
    await revenuecatWebhook(await signedEvent('e1', 'INITIAL_PURCHASE'), deps);
    await revenuecatWebhook(await signedEvent('e2', 'NON_RENEWING_PURCHASE'), deps);
    await revenuecatWebhook(await signedEvent('e3', 'RENEWAL'), deps);
    // These are stored (the win-back Journey branches on EXPIRATION) but must
    // not inflate a figure labelled "HMAC-verified purchases" on the one page
    // we invite a judge to audit.
    await revenuecatWebhook(await signedEvent('e4', 'EXPIRATION'), deps);
    await revenuecatWebhook(await signedEvent('e5', 'CANCELLATION'), deps);
    await revenuecatWebhook(await signedEvent('e6', 'REFUND'), deps);

    expect(deps.db.raw('SELECT * FROM purchase_events')).toHaveLength(6);

    const res = await verify(new Request('https://lunker.test/verify?format=json'), deps);
    expect((await res.json()).purchase_events).toBe(3);
  });

  it('reports zero rather than a refund count when there are no purchases', async () => {
    await revenuecatWebhook(await signedEvent('e1', 'REFUND'), deps);
    const res = await verify(new Request('https://lunker.test/verify?format=json'), deps);
    expect((await res.json()).purchase_events).toBe(0);
  });
});
