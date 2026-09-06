/**
 * POST /spend-coin
 *
 * Atomic COIN debit for a coin-gated lake unlock (Quarry Pool, 1,200 COIN).
 *
 * The 422 path is a first-class outcome, not an error to swallow: RevenueCat
 * refuses the transaction and deducts nothing, and the app renders the honest
 * state — "1,200 COIN — you have 840." A silently dead tap is the version of
 * this screen that makes the whole economy feel fake.
 */

import { getLake } from '../../../shared/content.js';
import { RevenueCatClient } from '../lib/revenuecat.js';
import { OneSignalClient } from '../lib/onesignal.js';
import type { Deps } from '../types.js';
import { json, badRequest } from '../lib/http.js';

interface Body {
  app_user_id?: string;
  lake_id?: string;
  // `idempotency_key` is deliberately NOT accepted. The key is derived from the
  // player and the lake below; honouring a client-supplied one was a free-unlock
  // bug. Clients may still send it — it is ignored.
}

export async function spendCoin(req: Request, deps: Deps): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return badRequest('malformed json');

  const { app_user_id, lake_id } = body;
  if (!app_user_id || !lake_id) {
    return badRequest('app_user_id and lake_id are required');
  }

  const lake = getLake(lake_id);
  if (!lake) return badRequest(`unknown lake: ${lake_id}`);
  if (lake.unlock.type !== 'coin') {
    // Deep Sea is an entitlement gate. Letting COIN buy it would put two prices
    // on one thing and quietly undercut the paywall.
    return badRequest(`${lake_id} is not coin-gated`);
  }

  const cost = lake.unlock.cost;
  const { db, env, now } = deps;
  // Derived here, never taken from the body. A client-chosen key turns this
  // lookup into a free unlock: the query matched on the key ALONE, so sending
  // the key of any row that already settled — a catch the player legitimately
  // landed, for instance — returned `unlocked: true` without RevenueCat ever
  // being asked to move a single COIN.
  const key = `unlock:${app_user_id}:${lake_id}`;

  // RESERVE BEFORE SPENDING. The primary key is the lock.
  //
  // Scoping the guard to settled rows closed the free unlock and the permanent
  // lockout, but not the race: SELECT -> await spendCoins() -> INSERT is
  // check-then-act across two awaits, so five simultaneous requests all saw no
  // settled row, all called RevenueCat, and INSERT OR IGNORE dropped four.
  // That charged the player 6,000 COIN for one 1,200 COIN lake and showed a
  // single -1,200 row on /verify. A double-tap on a flaky connection is enough,
  // and this is on the demo path.
  //
  // Claiming the row first makes the database the arbiter: exactly one request
  // wins the INSERT, and only the winner may move currency.
  const reservation = await db
    .prepare(
      'INSERT OR IGNORE INTO vc_transactions (idempotency_key, app_user_id, delta, reason, rc_status, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    )
    .bind(key, app_user_id, -cost, 'lake_unlock', now())
    .run();

  if (reservation.meta.changes === 0) {
    const held = await db
      .prepare(
        "SELECT rc_status FROM vc_transactions WHERE idempotency_key = ? AND app_user_id = ? AND reason = 'lake_unlock'",
      )
      .bind(key, app_user_id)
      .first<{ rc_status: number }>();

    // A settled row is a genuine replay — re-charging on a retry is the failure
    // that turns a network blip into a support ticket about stolen currency.
    if (held?.rc_status === 200) {
      return json({ unlocked: true, lake_id, cost, balance: null, replayed: true });
    }
    // In flight. Answering "unlocked" here would promise a spend that may fail.
    return json({ unlocked: false, lake_id, cost, reason: 'in_flight' }, 409);
  }

  const rc = new RevenueCatClient(env.REVENUECAT_SECRET_KEY, env.REVENUECAT_PROJECT_ID);
  const vc = await rc.spendCoins(app_user_id, cost);

  if (vc.status === 200) {
    await db
      .prepare('UPDATE vc_transactions SET rc_status = ?, created_at = ? WHERE idempotency_key = ?')
      .bind(vc.status, now(), key)
      .run();
  } else {
    // Release the reservation so a retry can settle. The refusal is kept as
    // evidence under a RANDOM suffix, not now(): two refusals inside one
    // millisecond collided under a timestamp and INSERT OR IGNORE dropped one
    // silently, under-reporting failures on the surface meant to show them.
    await db.prepare('DELETE FROM vc_transactions WHERE idempotency_key = ?').bind(key).run();
    await db
      .prepare(
        'INSERT OR IGNORE INTO vc_transactions (idempotency_key, app_user_id, delta, reason, rc_status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .bind(
        `${key}:attempt:${crypto.randomUUID()}`,
        app_user_id,
        -cost,
        'lake_unlock',
        vc.status,
        now(),
      )
      .run();
  }

  if (vc.status === 422) {
    return json(
      { unlocked: false, lake_id, cost, balance: vc.balance, reason: 'insufficient_coin' },
      422,
    );
  }
  if (vc.status !== 200) {
    return json({ unlocked: false, lake_id, cost, reason: 'upstream_error' }, 502);
  }

  const os = new OneSignalClient(env.ONESIGNAL_REST_API_KEY, env.ONESIGNAL_APP_ID);
  await os.trackEvent(app_user_id, 'lake_unlocked', { lake_id, cost, method: 'coin' }).catch(() => {
    // The unlock is already paid for and settled; a Journey trigger failure
    // must not roll it back.
  });

  return json({ unlocked: true, lake_id, cost, balance: vc.balance });
}
