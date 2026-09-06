/**
 * POST /player/sync
 *
 * The app announces its targeting state: which lake is selected, what is
 * unlocked, whether push was actually granted, and the device's UTC offset.
 *
 * Added during Phase 1 alongside the `players` table. The scheduled dispatcher
 * has to answer "who is due a bite, in which lake, at what local hour", and
 * nothing in the original four-table contract could answer it.
 *
 * `push_enabled` is the OS-level permission state as the client observes it,
 * not our intention to send. When a player declines the Android 13+ prompt the
 * app says so plainly and this flag goes to 0 — we do not keep scheduling into
 * a void and call it engagement.
 */

import { getLake, LAKES } from '../../../shared/content.js';
import { nextStreak } from '../lib/streak.js';
import type { Deps } from '../types.js';
import { json, badRequest } from '../lib/http.js';

interface Body {
  app_user_id?: string;
  current_lake?: string;
  unlocked_lakes?: string[];
  push_enabled?: boolean;
  tz_offset_min?: number;
  /** Accepted for backward compatibility and deliberately IGNORED — the server
   *  computes the streak. A client-declared streak is a forged streak. */
  streak_days?: number;
}

export async function playerSync(req: Request, deps: Deps): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.app_user_id) return badRequest('app_user_id is required');

  // An ABSENT current_lake means "keep whatever you have on file", not "reset to
  // willow". The client used to send a hardcoded 'willow' on every boot, so a
  // subscriber who selected Deep Sea had it silently reset to the free lake on
  // their next launch — the paid feature un-selling itself once a day. The
  // client no longer sends the field at boot, so the default must not clobber.
  if (body.current_lake !== undefined && !getLake(body.current_lake)) {
    return badRequest(`unknown lake: ${body.current_lake}`);
  }

  // `body.unlocked_lakes` is deliberately NOT read.
  //
  // It used to be, filtered only for lake validity and then unioned into the
  // server record permanently. So a client could POST
  // `unlocked_lakes: ["willow","reeds","quarry","deepsea"]` and own the whole
  // map forever: Quarry without paying its 1,200 COIN, and Deep Sea — the
  // Angler's Pass lake — without a subscription. The entitlement was checked
  // only in the app (LakeMapScreen), which is not a place a paywall can live.
  //
  // Deep Sea also has the richest table in the game, so the bypass additionally
  // redirected the cron to dispatch legendary-tier bites.
  //
  // Unlocks are now derived from evidence the server holds. This also removes
  // the reason the union existed: a reinstalled client no longer needs to tell
  // us what it owns, because the ledger already knows.

  const tz = Number.isFinite(body.tz_offset_min) ? Math.trunc(body.tz_offset_min as number) : 0;
  if (tz < -1440 || tz > 1440) return badRequest('tz_offset_min out of range');

  const { db, now } = deps;
  const ts = now();

  const previous = await db
    .prepare(
      'SELECT streak_days, last_active_at, unlocked_lakes, current_lake FROM players WHERE app_user_id = ?',
    )
    .bind(body.app_user_id)
    .first<{
      streak_days: number;
      last_active_at: number | null;
      unlocked_lakes: string;
      current_lake: string | null;
    }>();

  const currentLake = body.current_lake ?? previous?.current_lake ?? 'willow';

  const streak = nextStreak(previous?.last_active_at ?? null, previous?.streak_days ?? 0, ts, tz);

  // Free lakes, plus every lake this player has a SETTLED coin unlock for.
  // Entitlement lakes are handled separately below, from the webhook ledger.
  const paid = await db
    .prepare(
      `SELECT idempotency_key FROM vc_transactions
       WHERE app_user_id = ? AND reason = 'lake_unlock' AND rc_status = 200`,
    )
    .bind(body.app_user_id)
    .all<{ idempotency_key: string }>();

  const purchased = (paid.results ?? [])
    // Keys are `unlock:<app_user_id>:<lake_id>` — the lake is the last segment.
    .map((r) => r.idempotency_key.split(':').pop())
    .filter((l): l is string => !!l && !!getLake(l));

  // Entitlement lakes come from the HMAC-verified webhook ledger, not from the
  // client and not from an extra RevenueCat round-trip. `purchase_events` is
  // written only by /webhooks/revenuecat after a signature check, so it is the
  // strongest evidence the Worker holds. The latest event for the product wins,
  // so an EXPIRATION or a cancellation revokes access the same way a purchase
  // grants it.
  //
  // NOTE: this makes Deep Sea depend on the RevenueCat webhook being configured
  // in the dashboard. Until it is, `purchase_events` stays empty and no player
  // is entitled — which is the correct failure direction, but it does mean the
  // webhook is now load-bearing for a paid feature, not just for the ledger
  // display on /verify.
  const entitled: string[] = [];
  for (const lake of LAKES) {
    // Narrowed by the guard rather than by a filter, so `entitlement` is typed.
    if (lake.unlock.type !== 'entitlement') continue;
    const product = lake.unlock.entitlement;
    // Match the ENTITLEMENT, not the SKU.
    //
    // This compared `product_id` — a store SKU — against the entitlement id
    // `anglers_pass`. Two different namespaces. On Google Play a subscription
    // SKU commonly carries a base-plan suffix, so the comparison would never
    // match and the paid lake would stay locked for every paying subscriber,
    // silently, even with the webhook correctly configured.
    //
    // entitlement_ids is a comma-joined list, so it is matched by membership.
    // product_id is kept as a fallback for events that predate the column and
    // for the case where the SKU genuinely is the entitlement id.
    const latest = await db
      .prepare(
        `SELECT event_type FROM purchase_events
         WHERE app_user_id = ?
           AND (
             product_id = ?
             OR ',' || COALESCE(entitlement_ids, '') || ',' LIKE '%,' || ? || ',%'
           )
         ORDER BY verified_at DESC LIMIT 1`,
      )
      .bind(body.app_user_id, product, product)
      .first<{ event_type: string }>();
    // EXPIRATION and REFUND end access. CANCELLATION does NOT: in RevenueCat it
    // means auto-renew was switched off, and the subscriber keeps the entitlement
    // until the period actually expires. Revoking on it took a paid lake away
    // from someone mid-period, and leaving REFUND out let a refunded subscriber
    // keep it — the two errors pointed in opposite directions.
    const revoked = !latest || latest.event_type === 'EXPIRATION' || latest.event_type === 'REFUND';
    if (!revoked) entitled.push(lake.id);
  }

  const free = LAKES.filter((l) => l.unlock.type === 'free').map((l) => l.id);
  const merged = Array.from(new Set([...free, ...purchased, ...entitled]));

  // The lake the player says they are fishing must be one they actually hold.
  // Otherwise the cron happily dispatches Deep Sea bites — the richest table in
  // the game — to anyone who names it, which is the same paywall bypass by a
  // different door.
  const effectiveLake = merged.includes(currentLake) ? currentLake : 'willow';

  await db
    .prepare(
      `INSERT INTO players (app_user_id, current_lake, unlocked_lakes, streak_days, push_enabled, tz_offset_min, last_active_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(app_user_id) DO UPDATE SET
         current_lake   = excluded.current_lake,
         unlocked_lakes = excluded.unlocked_lakes,
         streak_days    = excluded.streak_days,
         push_enabled   = excluded.push_enabled,
         tz_offset_min  = excluded.tz_offset_min,
         last_active_at = excluded.last_active_at`,
    )
    .bind(
      body.app_user_id,
      effectiveLake,
      merged.join(','),
      streak,
      body.push_enabled ? 1 : 0,
      tz,
      ts,
      ts,
    )
    .run();

  // The client renders the streak it is told, and tags OneSignal with it.
  return json({
    ok: true,
    app_user_id: body.app_user_id,
    current_lake: effectiveLake,
    unlocked_lakes: merged,
    streak_days: streak,
  });
}
