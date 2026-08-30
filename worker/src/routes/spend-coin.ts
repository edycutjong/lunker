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
  idempotency_key?: string;
}

export async function spendCoin(req: Request, deps: Deps): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return badRequest('malformed json');

  const { app_user_id, lake_id, idempotency_key } = body;
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
  const key = idempotency_key || `unlock:${app_user_id}:${lake_id}`;

  const existing = await db
    .prepare('SELECT delta, rc_status FROM vc_transactions WHERE idempotency_key = ?')
    .bind(key)
    .first<{ delta: number; rc_status: number }>();

  if (existing) {
    // Already paid for. Re-charging on a retry is the failure mode that turns a
    // network blip into a support ticket about stolen currency.
    if (existing.rc_status === 200) {
      return json({ unlocked: true, lake_id, cost, balance: null, replayed: true });
    }
    return json({ unlocked: false, lake_id, cost, reason: 'insufficient_coin', replayed: true }, 422);
  }

  const rc = new RevenueCatClient(env.REVENUECAT_SECRET_KEY, env.REVENUECAT_PROJECT_ID);
  const vc = await rc.spendCoins(app_user_id, cost);

  await db
    .prepare(
      'INSERT OR IGNORE INTO vc_transactions (idempotency_key, app_user_id, delta, reason, rc_status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(key, app_user_id, -cost, 'lake_unlock', vc.status, now())
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
  await os
    .trackEvent(app_user_id, 'lake_unlocked', { lake_id, cost, method: 'coin' })
    .catch(() => {
      // The unlock is already paid for and settled; a Journey trigger failure
      // must not roll it back.
    });

  return json({ unlocked: true, lake_id, cost, balance: vc.balance });
}
