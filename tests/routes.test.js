/**
 * Worker route contracts, against a real SQLite database running the real
 * migration — not a mock that would agree with a bug.
 *
 * These assert external side effects (rows written, upstream calls made with
 * the right body), never merely that a handler returned 200.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { FakeD1, makeDeps, postJson } from './helpers/d1.js';
import { catchResolved } from '../worker/src/routes/catch-resolved.js';
import { spendCoin } from '../worker/src/routes/spend-coin.js';
import { biteOpened } from '../worker/src/routes/bite-opened.js';
import { revenuecatWebhook } from '../worker/src/routes/revenuecat-webhook.js';
import { verify } from '../worker/src/routes/verify.js';
import { playerSync } from '../worker/src/routes/player-sync.js';
import { devCast } from '../worker/src/routes/dev-cast.js';
import { hmacSha256Hex } from '../worker/src/lib/webhook.js';
import { deriveRollSeed } from '../shared/roll.js';

const NOW = 1_756_512_000_000;
const USER = 'angler-1';
const NID = 'bite-abc';

let deps;
let calls;

/** Record every upstream call and reply with a scripted status. */
function stubFetch(plan = {}) {
  calls = [];
  vi.stubGlobal('fetch', async (url, init) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers });
    if (u.includes('api.revenuecat.com')) {
      const status = plan.rcStatus ?? 200;
      return new Response(JSON.stringify(plan.rcBody ?? { balance: 960 }), { status });
    }
    return new Response(JSON.stringify({ id: 'os-1' }), { status: 200 });
  });
}

async function seedBite(
  db,
  { nid = NID, user = USER, lake = 'willow', sentAt = NOW - 30_000 } = {},
) {
  const seed = await deriveRollSeed(nid, 'roll_secret_test');
  await db.prepare('INSERT INTO sent VALUES (?,?,?,?,?)').bind(nid, user, lake, seed, sentAt).run();
  await db.prepare('INSERT INTO bite_telemetry VALUES (?,NULL,NULL,0,NULL)').bind(nid).run();
  return seed;
}

beforeEach(() => {
  deps = makeDeps({ db: new FakeD1(), now: () => NOW });
  stubFetch();
});
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------

describe('POST /catch-resolved', () => {
  it('rejects a body with no notification_id', async () => {
    const res = await catchResolved(
      postJson('/catch-resolved', { app_user_id: USER, lake_id: 'willow', outcome: 'win' }),
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('404s a notification we have no record of sending', async () => {
    const res = await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: 'never-sent',
        outcome: 'win',
      }),
      deps,
    );
    expect(res.status).toBe(404);
  });

  it('403s an attempt to answer another player bite', async () => {
    await seedBite(deps.db);
    const res = await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: 'someone-else',
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'win',
      }),
      deps,
    );
    expect(res.status).toBe(403);
  });

  it('ignores a client-supplied fish entirely — the server rolls', async () => {
    await seedBite(deps.db);
    const res = await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'win',
        fish: 'the_lunker',
        rarity: 'legendary',
        coins: 999999,
      }),
      deps,
    );
    const body = await res.json();
    expect(body.catch.coins).not.toBe(999999);
    expect(body.catch.rarity).not.toBe('legendary'); // Willow has no legendaries
    const rcCall = calls.find((c) => c.url.includes('revenuecat'));
    expect(rcCall.body.adjustments.COIN).toBe(body.catch.coins);
  });

  it('grants COIN through the RevenueCat VC REST API, server-side', async () => {
    await seedBite(deps.db);
    const res = await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'win',
      }),
      deps,
    );
    const body = await res.json();
    expect(body.settled).toBe(true);
    expect(body.balance).toBe(960);

    const rcCall = calls.find((c) => c.url.includes('revenuecat'));
    expect(rcCall.url).toContain(`/customers/${USER}/virtual_currencies/transactions`);
    expect(rcCall.headers.authorization).toBe('Bearer sk_test');
    expect(rcCall.body.adjustments.COIN).toBeGreaterThan(0);
  });

  it('records the outcome as landed in telemetry', async () => {
    await seedBite(deps.db);
    await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'win',
      }),
      deps,
    );
    const [row] = deps.db.raw('SELECT resolved FROM bite_telemetry WHERE notification_id = ?', NID);
    expect(row.resolved).toBe('landed');
  });

  it('grants nothing on a loss but still records the escape', async () => {
    await seedBite(deps.db);
    const res = await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'loss',
      }),
      deps,
    );
    const body = await res.json();
    expect(body.outcome).toBe('escaped');
    expect(body.catch).toBeNull();
    expect(calls.filter((c) => c.url.includes('revenuecat'))).toHaveLength(0);
    const [row] = deps.db.raw('SELECT resolved FROM bite_telemetry WHERE notification_id = ?', NID);
    expect(row.resolved).toBe('escaped');
  });

  it('is idempotent: a replayed win never grants twice', async () => {
    await seedBite(deps.db);
    const req = () =>
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'win',
      });
    await catchResolved(req(), deps);
    const second = await catchResolved(req(), deps);
    const body = await second.json();

    expect(body.replayed).toBe(true);
    expect(calls.filter((c) => c.url.includes('revenuecat'))).toHaveLength(1);
    expect(deps.db.raw('SELECT * FROM vc_transactions')).toHaveLength(1);
  });

  it('returns the same fish on replay, not a fresh roll', async () => {
    await seedBite(deps.db);
    const req = () =>
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'win',
      });
    const a = await (await catchResolved(req(), deps)).json();
    const b = await (await catchResolved(req(), deps)).json();
    expect(b.catch).toEqual(a.catch);
  });

  it('reports settled:false rather than faking success when RevenueCat errors', async () => {
    stubFetch({ rcStatus: 500 });
    await seedBite(deps.db);
    const res = await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'win',
      }),
      deps,
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.settled).toBe(false);
  });

  it('rejects an unknown lake', async () => {
    const res = await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'atlantis',
        notification_id: NID,
        outcome: 'win',
      }),
      deps,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe('POST /spend-coin', () => {
  it('debits the committed 1,200 COIN for Quarry Pool', async () => {
    const res = await spendCoin(
      postJson('/spend-coin', { app_user_id: USER, lake_id: 'quarry' }),
      deps,
    );
    expect(res.status).toBe(200);
    const rcCall = calls.find((c) => c.url.includes('revenuecat'));
    expect(rcCall.body.adjustments.COIN).toBe(-1200);
  });

  it('surfaces a 422 as the honest "cannot afford" state, not a dead tap', async () => {
    stubFetch({ rcStatus: 422, rcBody: { balance: 840 } });
    const res = await spendCoin(
      postJson('/spend-coin', { app_user_id: USER, lake_id: 'quarry' }),
      deps,
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.reason).toBe('insufficient_coin');
    expect(body.cost).toBe(1200);
    expect(body.balance).toBe(840);
  });

  it('refuses to sell an entitlement-gated lake for COIN', async () => {
    // Two prices on one thing would quietly undercut the paywall.
    const res = await spendCoin(
      postJson('/spend-coin', { app_user_id: USER, lake_id: 'deepsea' }),
      deps,
    );
    expect(res.status).toBe(400);
    expect(calls.filter((c) => c.url.includes('revenuecat'))).toHaveLength(0);
  });

  it('refuses to charge for a free lake', async () => {
    const res = await spendCoin(
      postJson('/spend-coin', { app_user_id: USER, lake_id: 'willow' }),
      deps,
    );
    expect(res.status).toBe(400);
  });

  it('never double-charges on a retry', async () => {
    const req = () => postJson('/spend-coin', { app_user_id: USER, lake_id: 'quarry' });
    await spendCoin(req(), deps);
    const second = await spendCoin(req(), deps);
    expect((await second.json()).replayed).toBe(true);
    expect(calls.filter((c) => c.url.includes('revenuecat'))).toHaveLength(1);
  });

  it('mirrors the movement into the ledger with its RC status', async () => {
    await spendCoin(postJson('/spend-coin', { app_user_id: USER, lake_id: 'quarry' }), deps);
    const [row] = deps.db.raw('SELECT * FROM vc_transactions');
    expect(row.delta).toBe(-1200);
    expect(row.reason).toBe('lake_unlock');
    expect(row.rc_status).toBe(200);
  });

  it('records a failed 422 spend too, so /verify shows refusals', async () => {
    stubFetch({ rcStatus: 422 });
    await spendCoin(postJson('/spend-coin', { app_user_id: USER, lake_id: 'quarry' }), deps);
    const [row] = deps.db.raw('SELECT * FROM vc_transactions');
    expect(row.rc_status).toBe(422);
  });
});

// ---------------------------------------------------------------------------

describe('POST /bite-opened', () => {
  it('404s a notification id that was never sent', async () => {
    const res = await biteOpened(
      postJson('/bite-opened', { notification_id: 'fabricated', opened_at: NOW }),
      deps,
    );
    expect(res.status).toBe(404);
    expect(deps.db.raw('SELECT * FROM bite_telemetry')).toHaveLength(0);
  });

  it('records latency measured from send', async () => {
    await seedBite(deps.db, { sentAt: NOW - 12_000 });
    const res = await biteOpened(
      postJson('/bite-opened', { notification_id: NID, opened_at: NOW }),
      deps,
    );
    expect((await res.json()).latency_ms).toBe(12_000);
  });

  it('flags clock skew instead of clamping a negative latency to zero', async () => {
    await seedBite(deps.db, { sentAt: NOW });
    const res = await biteOpened(
      postJson('/bite-opened', { notification_id: NID, opened_at: NOW - 5_000 }),
      deps,
    );
    const body = await res.json();
    expect(body.clock_skew).toBe(true);
    expect(body.latency_ms).toBeNull();
    const [row] = deps.db.raw('SELECT * FROM bite_telemetry WHERE notification_id = ?', NID);
    expect(row.clock_skew).toBe(1);
    expect(row.latency_ms).toBeNull();
  });

  it('keeps the first open when Android redelivers the same notification', async () => {
    await seedBite(deps.db, { sentAt: NOW - 60_000 });
    await biteOpened(
      postJson('/bite-opened', { notification_id: NID, opened_at: NOW - 55_000 }),
      deps,
    );
    await biteOpened(postJson('/bite-opened', { notification_id: NID, opened_at: NOW }), deps);
    const [row] = deps.db.raw('SELECT * FROM bite_telemetry WHERE notification_id = ?', NID);
    expect(row.latency_ms).toBe(5_000);
  });

  it('rejects a non-numeric opened_at', async () => {
    await seedBite(deps.db);
    const res = await biteOpened(
      postJson('/bite-opened', { notification_id: NID, opened_at: 'now' }),
      deps,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe('POST /webhooks/revenuecat', () => {
  const event = {
    event: {
      id: 'evt-1',
      type: 'INITIAL_PURCHASE',
      app_user_id: USER,
      product_id: 'coins_1600',
      price: 2.99,
    },
  };

  async function signed(body, secret = 'whsec_test') {
    const raw = JSON.stringify(body);
    const sig = await hmacSha256Hex(raw, secret);
    return new Request('https://lunker.test/webhooks/revenuecat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-revenuecat-signature': sig },
      body: raw,
    });
  }

  it('401s an unsigned request', async () => {
    const res = await revenuecatWebhook(postJson('/webhooks/revenuecat', event), deps);
    expect(res.status).toBe(401);
    expect(deps.db.raw('SELECT * FROM purchase_events')).toHaveLength(0);
  });

  it('401s a request signed with the wrong secret', async () => {
    const res = await revenuecatWebhook(await signed(event, 'wrong'), deps);
    expect(res.status).toBe(401);
  });

  it('appends a verified purchase to the ledger', async () => {
    const res = await revenuecatWebhook(await signed(event), deps);
    expect(res.status).toBe(200);
    const [row] = deps.db.raw('SELECT * FROM purchase_events');
    expect(row).toMatchObject({
      event_id: 'evt-1',
      product_id: 'coins_1600',
      event_type: 'INITIAL_PURCHASE',
      revenue_usd: 2.99,
    });
  });

  it('is idempotent on RevenueCat retries', async () => {
    await revenuecatWebhook(await signed(event), deps);
    await revenuecatWebhook(await signed(event), deps);
    expect(deps.db.raw('SELECT * FROM purchase_events')).toHaveLength(1);
  });

  it('accepts a sha256= prefixed signature', async () => {
    const raw = JSON.stringify(event);
    const sig = await hmacSha256Hex(raw, 'whsec_test');
    const req = new Request('https://lunker.test/webhooks/revenuecat', {
      method: 'POST',
      headers: { 'x-revenuecat-signature': `sha256=${sig}` },
      body: raw,
    });
    expect((await revenuecatWebhook(req, deps)).status).toBe(200);
  });

  it('200s and ignores an unknown event type so retries are not burned', async () => {
    const res = await revenuecatWebhook(
      await signed({ event: { id: 'evt-9', type: 'SOME_FUTURE_EVENT' } }),
      deps,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).ignored).toBe('SOME_FUTURE_EVENT');
    expect(deps.db.raw('SELECT * FROM purchase_events')).toHaveLength(0);
  });

  it('records an EXPIRATION, which is what the win-back Journey branches on', async () => {
    await revenuecatWebhook(
      await signed({
        event: { id: 'evt-2', type: 'EXPIRATION', app_user_id: USER, product_id: 'anglers_pass' },
      }),
      deps,
    );
    const [row] = deps.db.raw('SELECT * FROM purchase_events');
    expect(row.event_type).toBe('EXPIRATION');
  });
});

// ---------------------------------------------------------------------------

describe('GET /verify', () => {
  it('serves JSON that matches the CLI computation', async () => {
    await seedBite(deps.db, { nid: 'b1', sentAt: NOW - 10_000 });
    await biteOpened(postJson('/bite-opened', { notification_id: 'b1', opened_at: NOW }), deps);
    await seedBite(deps.db, { nid: 'b2', sentAt: NOW - 10_000 });

    const res = await verify(new Request('https://lunker.test/verify?format=json'), deps);
    const body = await res.json();
    expect(body.bench.denominator).toBe(2);
    expect(body.bench.answered).toBe(1);
    expect(body.bench.neverOpened).toBe(1);
    expect(body.bench.answeredPct).toBe(50);
  });

  it('renders HTML for a judge with no install', async () => {
    const res = await verify(new Request('https://lunker.test/verify'), deps);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('Read-only, anonymized');
    expect(text).toContain('measured <strong>from send</strong>');
  });

  it('says "no data" rather than 0% when nothing has been sent', async () => {
    const res = await verify(new Request('https://lunker.test/verify?format=json'), deps);
    expect((await res.json()).bench.answeredPct).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('POST /player/sync', () => {
  it('upserts targeting state', async () => {
    await playerSync(
      postJson('/player/sync', {
        app_user_id: USER,
        current_lake: 'quarry',
        unlocked_lakes: ['willow', 'quarry'],
        push_enabled: true,
        tz_offset_min: 420,
      }),
      deps,
    );
    const [row] = deps.db.raw('SELECT * FROM players');
    expect(row).toMatchObject({
      app_user_id: USER,
      current_lake: 'quarry',
      push_enabled: 1,
      tz_offset_min: 420,
    });
  });

  it('records a declined push permission as push_enabled = 0', async () => {
    await playerSync(postJson('/player/sync', { app_user_id: USER, push_enabled: false }), deps);
    const [row] = deps.db.raw('SELECT push_enabled FROM players');
    expect(row.push_enabled).toBe(0);
  });

  it('drops lake ids that do not exist', async () => {
    const res = await playerSync(
      postJson('/player/sync', { app_user_id: USER, unlocked_lakes: ['willow', 'atlantis'] }),
      deps,
    );
    expect((await res.json()).unlocked_lakes).toEqual(['willow']);
  });

  it('rejects an absurd timezone offset', async () => {
    const res = await playerSync(
      postJson('/player/sync', { app_user_id: USER, tz_offset_min: 99999 }),
      deps,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe('POST /dev/cast', () => {
  it('is 404 in production, where DEV_CAST_ENABLED is 0', async () => {
    const res = await devCast(postJson('/dev/cast', { app_user_id: USER }), deps);
    expect(res.status).toBe(404);
  });

  it('creates a real sent row and a null-open telemetry row when enabled', async () => {
    const d = makeDeps({ db: new FakeD1(), now: () => NOW, env: { DEV_CAST_ENABLED: '1' } });
    await d.db
      .prepare('INSERT INTO players (app_user_id, created_at) VALUES (?, ?)')
      .bind(USER, NOW)
      .run();

    const res = await devCast(postJson('/dev/cast', { app_user_id: USER, lake_id: 'willow' }), d);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(d.db.raw('SELECT * FROM sent')).toHaveLength(1);
    const [tel] = d.db.raw('SELECT * FROM bite_telemetry');
    expect(tel.opened_at).toBeNull();
    expect(body.disclosure).toMatch(/TIMING triggered manually/);
  });

  it('discloses that only the timing was triggered, never the roll', async () => {
    const d = makeDeps({ db: new FakeD1(), now: () => NOW, env: { DEV_CAST_ENABLED: '1' } });
    await d.db
      .prepare('INSERT INTO players (app_user_id, created_at) VALUES (?, ?)')
      .bind(USER, NOW)
      .run();
    const body = await (await devCast(postJson('/dev/cast', { app_user_id: USER }), d)).json();
    expect(body.disclosure).toContain('live server-side roll');
  });
});

describe('POST /catch-resolved — the claim window', () => {
  it('refuses to pay for a bite claimed long after it was sent', async () => {
    // Without a ceiling, a modified client can sit on any notification id it
    // ever received and cash it in hours later.
    await seedBite(deps.db, { sentAt: NOW - 60 * 60 * 1000 });
    const res = await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'win',
      }),
      deps,
    );
    expect(res.status).toBe(410);
    expect((await res.json()).reason).toBe('expired');
    expect(calls.filter((c) => c.url.includes('revenuecat'))).toHaveLength(0);
  });

  it('still records the expired bite as escaped, keeping it in the denominator', async () => {
    await seedBite(deps.db, { sentAt: NOW - 60 * 60 * 1000 });
    await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'win',
      }),
      deps,
    );
    const [row] = deps.db.raw('SELECT resolved FROM bite_telemetry WHERE notification_id = ?', NID);
    expect(row.resolved).toBe('escaped');
  });

  it('allows a claim inside the delivery-latency grace window', async () => {
    // A push that arrived 90s late must not rob a player of a fish they landed.
    await seedBite(deps.db, { sentAt: NOW - 150_000 });
    const res = await catchResolved(
      postJson('/catch-resolved', {
        app_user_id: USER,
        lake_id: 'willow',
        notification_id: NID,
        outcome: 'win',
      }),
      deps,
    );
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('landed');
  });
});

describe('defect: the live landing page served dead placeholder links', () => {
  // Found 2026-09-01, minutes after the first deploy. The page goes public the
  // moment the Worker does — weeks before the store listings, video and repo
  // exist — and the template's unfilled tokens rendered as literal
  // href="<token>". Every CTA on the page was a dead link to anyone who
  // opened the URL.
  //
  // The token is assembled at runtime rather than written out, so this file
  // never itself trips `scripts/check-submission-readiness.mjs`.
  const TOKEN_HEAD = String.fromCharCode(0x27e6) + 'FILL:';
  const TOKEN_TAIL = String.fromCharCode(0x27e7);

  it('renders no unfilled token inside an href', async () => {
    const { renderLanding } = await import('../worker/src/landing.js');
    expect(renderLanding()).not.toContain('href="' + TOKEN_HEAD);
  });

  it('keeps the raw tokens in the template so the readiness gate still fails', async () => {
    const { LANDING_HTML } = await import('../worker/src/landing.js');
    expect(LANDING_HTML).toContain('href="' + TOKEN_HEAD + 'PLAY_URL' + TOKEN_TAIL + '"');
  });

  it('degrades an unresolved CTA to an inert element that keeps its label', async () => {
    const { renderLanding } = await import('../worker/src/landing.js');
    expect(renderLanding()).toContain(
      '<span class="btn primary pending" aria-disabled="true">Get it on Google Play</span>',
    );
  });

  it('leaves real links untouched', async () => {
    const { renderLanding } = await import('../worker/src/landing.js');
    const out = renderLanding();
    expect(out).toContain('href="/verify"');
    expect(out).toContain('href="#how"');
  });
});
