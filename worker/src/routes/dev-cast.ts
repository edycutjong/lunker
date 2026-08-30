/**
 * POST /dev/cast — trigger a bite on demand.
 *
 * This exists for ONE reason: Android push delivery timing is not deterministic
 * on camera, and a demo video cannot wait an unknown number of minutes for a
 * Journey to fire.
 *
 * What it does and does not do is the honest distinction the video and DEMO.md
 * both state out loud:
 *
 *   - it triggers the BITE (the timing)
 *   - it does NOT touch the ROLL (the outcome)
 *
 * The fish is still rolled server-side against Willow's committed 4.0%-rare
 * table from a seed derived after this call. Conflating "we chose when the push
 * fired" with "we chose what was caught" is the exact failure this comment
 * exists to prevent.
 *
 * Disabled unless DEV_CAST_ENABLED=1. It is off in the production Worker.
 */

import { dispatchBite } from '../lib/bite.js';
import { getLake } from '../../../shared/content.js';
import type { Deps } from '../types.js';
import { json, badRequest } from '../lib/http.js';

interface Body {
  app_user_id?: string;
  lake_id?: string;
}

export async function devCast(req: Request, deps: Deps): Promise<Response> {
  if (deps.env.DEV_CAST_ENABLED !== '1') {
    return json({ error: 'not found' }, 404);
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.app_user_id) return badRequest('app_user_id is required');

  const lakeId = body.lake_id ?? 'willow';
  if (!getLake(lakeId)) return badRequest(`unknown lake: ${lakeId}`);

  const record = await dispatchBite(deps, body.app_user_id, lakeId);
  return json({
    ...record,
    disclosure: 'Bite TIMING triggered manually for recording. The catch is a live server-side roll.',
  });
}
