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

import { getLake } from '../../../shared/content.js';
import type { Deps } from '../types.js';
import { json, badRequest } from '../lib/http.js';

interface Body {
  app_user_id?: string;
  current_lake?: string;
  unlocked_lakes?: string[];
  push_enabled?: boolean;
  tz_offset_min?: number;
  streak_days?: number;
}

export async function playerSync(req: Request, deps: Deps): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.app_user_id) return badRequest('app_user_id is required');

  const currentLake = body.current_lake ?? 'willow';
  if (!getLake(currentLake)) return badRequest(`unknown lake: ${currentLake}`);

  const unlocked = (body.unlocked_lakes ?? ['willow', 'reeds']).filter((l) => getLake(l));
  if (unlocked.length === 0) unlocked.push('willow');

  const tz = Number.isFinite(body.tz_offset_min) ? Math.trunc(body.tz_offset_min as number) : 0;
  if (tz < -1440 || tz > 1440) return badRequest('tz_offset_min out of range');

  const { db, now } = deps;
  const ts = now();

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
      currentLake,
      unlocked.join(','),
      Math.max(0, Math.trunc(body.streak_days ?? 0)),
      body.push_enabled ? 1 : 0,
      tz,
      ts,
      ts,
    )
    .run();

  return json({ ok: true, app_user_id: body.app_user_id, current_lake: currentLake, unlocked_lakes: unlocked });
}
