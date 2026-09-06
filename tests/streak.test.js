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
    //
    // The guarantee now comes from the ledger rather than from the client's
    // word, which is strictly stronger: a reinstalled client does not have to
    // remember what it owns, and — unlike before — a client that LIES about
    // owning something gets nothing.
    deps.db.raw(
      "INSERT INTO vc_transactions (idempotency_key, app_user_id, delta, reason, rc_status, created_at) VALUES ('unlock:" +
        USER +
        ":quarry', '" +
        USER +
        "', -1200, 'lake_unlock', 200, 1)",
    );
    const res = await playerSync(
      postJson('/player/sync', { app_user_id: USER, unlocked_lakes: ['willow', 'reeds'] }),
      deps,
    );
    expect((await res.json()).unlocked_lakes).toContain('quarry');
    const [row] = deps.db.raw('SELECT unlocked_lakes FROM players');
    expect(row.unlocked_lakes).toContain('quarry');
  });

  it('adds an entitlement lake once the verified webhook says so', async () => {
    // Deep Sea is the Angler's Pass lake. It used to appear simply because the
    // client said so. It now appears only when the HMAC-verified webhook ledger
    // holds a live purchase for the entitlement.
    await playerSync(postJson('/player/sync', { app_user_id: USER }), deps);
    let res = await playerSync(
      postJson('/player/sync', { app_user_id: USER, unlocked_lakes: ['deepsea'] }),
      deps,
    );
    expect((await res.json()).unlocked_lakes).not.toContain('deepsea');

    deps.db.raw(
      "INSERT INTO purchase_events (event_id, app_user_id, product_id, event_type, revenue_usd, verified_at) VALUES ('e1', '" +
        USER +
        "', 'anglers_pass', 'INITIAL_PURCHASE', 4.99, 10)",
    );
    res = await playerSync(postJson('/player/sync', { app_user_id: USER }), deps);
    const lakes = (await res.json()).unlocked_lakes;
    expect(lakes).toContain('deepsea');
    expect(lakes).toContain('willow');
  });

  it('revokes an entitlement lake when the subscription expires', async () => {
    deps.db.raw(
      "INSERT INTO purchase_events (event_id, app_user_id, product_id, event_type, revenue_usd, verified_at) VALUES ('e1', '" +
        USER +
        "', 'anglers_pass', 'INITIAL_PURCHASE', 4.99, 10)",
    );
    deps.db.raw(
      "INSERT INTO purchase_events (event_id, app_user_id, product_id, event_type, revenue_usd, verified_at) VALUES ('e2', '" +
        USER +
        "', 'anglers_pass', 'EXPIRATION', 0, 20)",
    );
    const res = await playerSync(postJson('/player/sync', { app_user_id: USER }), deps);
    expect((await res.json()).unlocked_lakes).not.toContain('deepsea');
  });

  it('a sync with no current_lake keeps the one on file', async () => {
    // Boot sends no lake. It used to send a hardcoded 'willow', which reset a
    // subscriber's Deep Sea selection on every launch — the paid feature
    // un-selling itself once a day, and the cron resuming free-lake bites.
    deps.db.raw(
      "INSERT INTO vc_transactions (idempotency_key, app_user_id, delta, reason, rc_status, created_at) VALUES ('unlock:" +
        USER +
        ":quarry', '" +
        USER +
        "', -1200, 'lake_unlock', 200, 1)",
    );
    await playerSync(postJson('/player/sync', { app_user_id: USER, current_lake: 'quarry' }), deps);
    const res = await playerSync(postJson('/player/sync', { app_user_id: USER }), deps);
    expect((await res.json()).current_lake).toBe('quarry');
  });

  it('will not let a player fish a lake they do not hold', async () => {
    // Otherwise the cron dispatches Deep Sea bites — the richest table in the
    // game — to anyone who names it. Same bypass, different door.
    const res = await playerSync(
      postJson('/player/sync', { app_user_id: USER, current_lake: 'deepsea' }),
      deps,
    );
    expect((await res.json()).current_lake).toBe('willow');
    const [row] = deps.db.raw('SELECT current_lake FROM players');
    expect(row.current_lake).toBe('willow');
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
    const raw = JSON.stringify({
      event: { id, type, app_user_id: USER, product_id: 'coins_500', price: 0.99 },
    });
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
