/**
 * POST /catch-resolved
 *
 * The client posts that it WON. It does not post what it caught.
 *
 * The server rolls the fish against the lake's committed weight table, seeded
 * from `sent.roll_seed` (written before the push left), grants COIN through the
 * RevenueCat VC REST API, and returns the catch. A modified APK cannot mint
 * itself Legendaries because it never had a say in the roll.
 */

import { rollCatch } from '../../../shared/roll.js';
import { getLake } from '../../../shared/content.js';
import { RevenueCatClient } from '../lib/revenuecat.js';
import { OneSignalClient } from '../lib/onesignal.js';
import type { Deps } from '../types.js';
import { json, badRequest } from '../lib/http.js';

/**
 * How long after SEND a bite can still be claimed.
 *
 * Not 60 seconds: the push's own 60s window runs from send, but Android
 * delivery latency is real and is exactly what the killer number measures, so a
 * player whose push arrived 40 seconds late would be robbed of a fish they
 * legitimately landed. Not unbounded either — without a ceiling, a modified
 * client can sit on any notification id it ever received and cash it in hours
 * later. Fifteen minutes covers the worst Doze delivery we can plausibly see
 * plus a full minigame, and closes the replay window.
 */
const MAX_CLAIM_MS = 15 * 60 * 1000;

interface Body {
  app_user_id?: string;
  lake_id?: string;
  notification_id?: string;
  outcome?: 'win' | 'loss';
  idempotency_key?: string;
}

export async function catchResolved(req: Request, deps: Deps): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return badRequest('malformed json');

  const { app_user_id, lake_id, notification_id, outcome, idempotency_key } = body;
  if (!app_user_id || !lake_id || !notification_id || !outcome) {
    return badRequest('app_user_id, lake_id, notification_id and outcome are required');
  }
  if (outcome !== 'win' && outcome !== 'loss') {
    return badRequest('outcome must be "win" or "loss"');
  }
  if (!getLake(lake_id)) return badRequest(`unknown lake: ${lake_id}`);

  const { db, env, now } = deps;

  // The bite must be one we actually sent. This is the same validity gate the
  // telemetry route enforces: an id we have no record of sending cannot have
  // been answered, and it certainly cannot be paid out.
  const sent = await db
    .prepare(
      'SELECT notification_id, app_user_id, lake_id, roll_seed, sent_at FROM sent WHERE notification_id = ?',
    )
    .bind(notification_id)
    .first<{ app_user_id: string; lake_id: string; roll_seed: string; sent_at: number }>();

  if (!sent) return json({ error: 'unknown notification_id' }, 404);
  if (sent.app_user_id !== app_user_id) {
    // Answering someone else's bite. Never a real client.
    return json({ error: 'notification does not belong to this player' }, 403);
  }

  if (now() - sent.sent_at > MAX_CLAIM_MS) {
    // The fish is long gone. Record the escape so the bite still counts in the
    // denominator, then refuse to pay for it.
    await db
      .prepare(
        "UPDATE bite_telemetry SET resolved = COALESCE(resolved, 'escaped') WHERE notification_id = ?",
      )
      .bind(notification_id)
      .run();
    return json({ outcome: 'escaped', catch: null, balance: null, reason: 'expired' }, 410);
  }

  await db
    .prepare('UPDATE bite_telemetry SET resolved = ? WHERE notification_id = ?')
    .bind(outcome === 'win' ? 'landed' : 'escaped', notification_id)
    .run();

  if (outcome === 'loss') {
    // The loss state is designed, not an afterthought: no coins, no shame, and
    // the streak survives to the next bite.
    return json({ outcome: 'escaped', catch: null, balance: null });
  }

  const key = idempotency_key || `catch:${notification_id}`;

  // Replaying a landed catch must never grant twice. The client retries once on
  // network failure by design, so this path is exercised in normal operation,
  // not just under attack.
  const existing = await db
    .prepare('SELECT delta, rc_status FROM vc_transactions WHERE idempotency_key = ?')
    .bind(key)
    .first<{ delta: number; rc_status: number }>();

  const result = rollCatch(sent.lake_id, sent.roll_seed);

  if (existing) {
    return json({ outcome: 'landed', catch: result, balance: null, replayed: true });
  }

  const rc = new RevenueCatClient(env.REVENUECAT_SECRET_KEY, env.REVENUECAT_PROJECT_ID);
  const vc = await rc.grantCoins(app_user_id, result.coins);

  await db
    .prepare(
      'INSERT OR IGNORE INTO vc_transactions (idempotency_key, app_user_id, delta, reason, rc_status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(key, app_user_id, result.coins, 'catch', vc.status, now())
    .run();

  if (vc.status !== 200) {
    // Be honest upward rather than reporting a catch whose currency never
    // settled. The client renders a retry, not a silent success.
    return json({ outcome: 'landed', catch: result, balance: null, settled: false }, 502);
  }

  // A first Rare is a Journey entry event, not a push we compose here — the
  // Journey owns cadence and quiet hours.
  if (result.rarity === 'rare' || result.rarity === 'legendary') {
    const os = new OneSignalClient(env.ONESIGNAL_REST_API_KEY, env.ONESIGNAL_APP_ID);
    await os
      .trackEvent(app_user_id, 'rare_landed', {
        fish_id: result.fish_id,
        fish_name: result.name,
        rarity: result.rarity,
        lake_id: sent.lake_id,
      })
      .catch(() => {
        // A milestone Journey that fails to trigger must never fail the catch
        // the player just earned.
      });
  }

  return json({ outcome: 'landed', catch: result, balance: vc.balance, settled: true });
}
