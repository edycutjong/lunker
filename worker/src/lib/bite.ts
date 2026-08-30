/**
 * Bite dispatch — the one place a bite is created.
 *
 * The ordering here is the whole design and it is not negotiable:
 *
 *   1. mint a notification_id
 *   2. derive roll_seed = HMAC(notification_id, ROLL_SERVER_SECRET)
 *   3. write `sent` AND the null-open `bite_telemetry` row
 *   4. only then send the push
 *
 * Writing `sent` before the push leaves is what lets `/catch-resolved` accept a
 * body with no `fish` field. Writing the telemetry row at send time is what
 * keeps unanswered bites in the denominator of the killer number. Reversing
 * either step turns an honest metric into a flattering one.
 */

import { deriveRollSeed } from '../../../shared/roll.js';
import { getLake } from '../../../shared/content.js';
import { OneSignalClient } from './onesignal.js';
import type { Deps } from '../types.js';

export interface BiteRecord {
  notification_id: string;
  lake_id: string;
  sent_at: number;
  push_status: number | null;
}

/**
 * Cadence weighting. Willow is daytime-weighted, Deep Sea is night-weighted, and
 * a bite outside a lake's hours is simply not scheduled — a 3am push for a
 * daytime lake is how a game that promised "worth the interruption" loses the
 * argument in one night.
 */
export function isWithinCadence(lakeId: string, localHour: number): boolean {
  const lake = getLake(lakeId);
  if (!lake) return false;
  if (localHour < 8 || localHour >= 23) return false; // never while asleep, any lake
  if (lake.cadence_weighting === 'day') return localHour >= 8 && localHour < 19;
  if (lake.cadence_weighting === 'night') return localHour >= 18 || localHour < 2;
  return true;
}

/** Minimum gap between two bites for one player. Never two pushes in one hour. */
export const MIN_BITE_GAP_MS = 60 * 60 * 1000;

export interface Player {
  app_user_id: string;
  current_lake: string;
  unlocked_lakes: string;
  streak_days: number;
  push_enabled: number;
  tz_offset_min: number;
  last_bite_at: number | null;
}

/** @returns local hour 0-23 for a player's stored UTC offset */
export function localHourFor(player: Pick<Player, 'tz_offset_min'>, nowMs: number): number {
  return Math.floor(((nowMs + player.tz_offset_min * 60_000) / 3_600_000) % 24 + 24) % 24;
}

export function isDue(player: Player, nowMs: number): boolean {
  if (!player.push_enabled) return false;
  if (player.last_bite_at != null && nowMs - player.last_bite_at < MIN_BITE_GAP_MS) return false;
  return isWithinCadence(player.current_lake, localHourFor(player, nowMs));
}

/**
 * Create and send one bite. Returns the record even when the push itself fails,
 * because a bite we logged but could not deliver is data we need — silently
 * dropping it would quietly remove the hardest rows from the denominator.
 */
export async function dispatchBite(
  deps: Deps,
  appUserId: string,
  lakeId: string,
): Promise<BiteRecord> {
  const { db, env, now } = deps;
  const lake = getLake(lakeId);
  if (!lake) throw new Error(`unknown lake: ${lakeId}`);

  const notificationId = crypto.randomUUID();
  const rollSeed = await deriveRollSeed(notificationId, env.ROLL_SERVER_SECRET);
  const sentAt = now();

  await db.batch([
    db
      .prepare('INSERT INTO sent (notification_id, app_user_id, lake_id, roll_seed, sent_at) VALUES (?, ?, ?, ?, ?)')
      .bind(notificationId, appUserId, lakeId, rollSeed, sentAt),
    db
      .prepare('INSERT INTO bite_telemetry (notification_id, opened_at, latency_ms, clock_skew, resolved) VALUES (?, NULL, NULL, 0, NULL)')
      .bind(notificationId),
    db
      .prepare('UPDATE players SET last_bite_at = ? WHERE app_user_id = ?')
      .bind(sentAt, appUserId),
  ]);

  let pushStatus: number | null = null;
  try {
    const os = new OneSignalClient(env.ONESIGNAL_REST_API_KEY, env.ONESIGNAL_APP_ID);
    const res = await os.sendBite({
      externalId: appUserId,
      lakeId,
      lakeName: lake.name,
      notificationId,
    });
    pushStatus = res.status;
  } catch {
    pushStatus = null;
  }

  return { notification_id: notificationId, lake_id: lakeId, sent_at: sentAt, push_status: pushStatus };
}
