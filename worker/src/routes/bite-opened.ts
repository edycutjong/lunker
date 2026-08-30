/**
 * POST /bite-opened
 *
 * The telemetry ping behind the killer number: `{notification_id, opened_at}`.
 *
 * It 404s any id that is not in the `sent` log. That single rule is what makes
 * the headline figure attack-proof — without it, anyone holding this endpoint's
 * URL could inflate the one number the submission leads with, and the number
 * would deserve the scepticism it got.
 *
 * Clock skew is FLAGGED here and never clamped. A device whose clock is behind
 * the server produces a negative latency; clamping it to zero would silently
 * promote the row into the numerator, which is precisely the bias the fixture
 * suite exists to catch.
 */

import type { Deps } from '../types.js';
import { json, badRequest } from '../lib/http.js';

interface Body {
  notification_id?: string;
  opened_at?: number;
}

export async function biteOpened(req: Request, deps: Deps): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return badRequest('malformed json');

  const { notification_id, opened_at } = body;
  if (!notification_id || typeof opened_at !== 'number') {
    return badRequest('notification_id and numeric opened_at are required');
  }

  const { db } = deps;

  const sent = await db
    .prepare('SELECT sent_at FROM sent WHERE notification_id = ?')
    .bind(notification_id)
    .first<{ sent_at: number }>();

  if (!sent) {
    // The validity gate. Fabricated ids never reach a counter.
    return json({ error: 'unknown notification_id' }, 404);
  }

  const latency = opened_at - sent.sent_at;
  const skew = latency < 0 ? 1 : 0;

  // First open wins. Android redelivery posts the same id more than once and a
  // later duplicate must not be able to rewrite an earlier, faster answer.
  await db
    .prepare(
      `INSERT INTO bite_telemetry (notification_id, opened_at, latency_ms, clock_skew)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(notification_id) DO UPDATE SET
         opened_at   = COALESCE(bite_telemetry.opened_at, excluded.opened_at),
         latency_ms  = COALESCE(bite_telemetry.latency_ms, excluded.latency_ms),
         clock_skew  = MAX(bite_telemetry.clock_skew, excluded.clock_skew)`,
    )
    .bind(notification_id, opened_at, skew ? null : latency, skew)
    .run();

  return json({ ok: true, latency_ms: skew ? null : latency, clock_skew: skew === 1 });
}
