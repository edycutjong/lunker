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

  // Only a SETTLED row short-circuits, and only this player's, for this reason.
  //
  // A row used to be written for failed spends too, and it was matched here.
  // That meant one attempt at 840 COIN against a 1,200 COIN lake wrote a 422
  // row under this exact key — and every later attempt matched it and returned
  // "insufficient_coin" without calling RevenueCat again. The player could
  // grind to 3,800 COIN and still never buy the lake. It was unrecoverable, and
  // it was on the demo path.
  const existing = await db
    .prepare(
      "SELECT delta, rc_status FROM vc_transactions WHERE idempotency_key = ? AND app_user_id = ? AND reason = 'lake_unlock' AND rc_status = 200",
    )
    .bind(key, app_user_id)
    .first<{ delta: number; rc_status: number }>();

  if (existing) {
    // Already paid for. Re-charging on a retry is the failure mode that turns a
    // network blip into a support ticket about stolen currency.
    return json({ unlocked: true, lake_id, cost, balance: null, replayed: true });
  }

  const rc = new RevenueCatClient(env.REVENUECAT_SECRET_KEY, env.REVENUECAT_PROJECT_ID);
  const vc = await rc.spendCoins(app_user_id, cost);

  // Refusals are still recorded — /verify showing them is a deliberate honesty
  // signal, and dropping them would hide real failures from the ledger. But
  // they are recorded under a DISTINCT per-attempt key, because writing them
  // under the settled key is what made one failed attempt permanent: the replay
  // guard matched the refusal and never asked RevenueCat again.
  const settled = vc.status === 200;
  await db
    .prepare(
      'INSERT OR IGNORE INTO vc_transactions (idempotency_key, app_user_id, delta, reason, rc_status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      settled ? key : `${key}:attempt:${now()}`,
      app_user_id,
      -cost,
      'lake_unlock',
      vc.status,
      now(),
    )
    .run();

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
