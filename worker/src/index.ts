/**
 * Lunker Worker — the only backend.
 *
 * It holds the RevenueCat secret key and the OneSignal REST key, and it is the
 * only component allowed to move currency. The client never mutates a balance,
 * speculatively or otherwise.
 */

import type { Env, Deps } from './types.js';
import { json, html, preflight } from './lib/http.js';
import { catchResolved } from './routes/catch-resolved.js';
import { spendCoin } from './routes/spend-coin.js';
import { biteOpened } from './routes/bite-opened.js';
import { revenuecatWebhook } from './routes/revenuecat-webhook.js';
import { verify } from './routes/verify.js';
import { playerSync } from './routes/player-sync.js';
import { devCast } from './routes/dev-cast.js';
import { dispatchBite, isDue, bitesSentToday, dailyCapFor, type Player } from './lib/bite.js';
import { renderLanding } from './landing.js';
import { PRIVACY_HTML } from './routes/privacy.js';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const deps: Deps = { db: env.DB, env, now: () => Date.now() };

    if (req.method === 'OPTIONS') return preflight();

    try {
      if (req.method === 'POST') {
        switch (path) {
          case '/catch-resolved':
            return await catchResolved(req, deps);
          case '/spend-coin':
            return await spendCoin(req, deps);
          case '/bite-opened':
            return await biteOpened(req, deps);
          case '/webhooks/revenuecat':
            return await revenuecatWebhook(req, deps);
          case '/player/sync':
            return await playerSync(req, deps);
          case '/dev/cast':
            return await devCast(req, deps);
        }
      }

      if (req.method === 'GET') {
        if (path === '/verify') return await verify(req, deps);
        if (path === '/' || path === '/index.html') return html(renderLanding());
        if (path === '/privacy') return html(PRIVACY_HTML);
        if (path === '/health') return json({ ok: true });
      }

      return json({ error: 'not found', path }, 404);
    } catch (err) {
      // Never leak a stack to a public endpoint. `/verify` is linked from the
      // submission, so its error surface is judge-facing too.
      console.error('unhandled', path, err);
      return json({ error: 'internal error' }, 500);
    }
  },

  /**
   * Bite dispatcher. Runs on a cron and sends to whoever is due.
   *
   * Journeys own re-engagement messaging (tide reminder, milestone, win-back).
   * This handler owns only the bite itself, because the bite has to write
   * `sent.roll_seed` to D1 before the push leaves and a Journey cannot do that.
   *
   * There is deliberately no `await` here. Awaiting `runDispatch` would hold the
   * cron invocation open for the whole fan-out; `ctx.waitUntil` is the Workers
   * contract for "keep the isolate alive until this settles" and is what lets a
   * slow OneSignal round-trip finish without the scheduled handler timing out.
   */
  // eslint-disable-next-line require-await -- see above: waitUntil, not await.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const deps: Deps = { db: env.DB, env, now: () => Date.now() };
    ctx.waitUntil(runDispatch(deps));
  },
};

export async function runDispatch(deps: Deps): Promise<number> {
  const now = deps.now();

  const { results } = await deps.db
    .prepare(
      `SELECT app_user_id, current_lake, unlocked_lakes, streak_days, push_enabled, tz_offset_min, last_bite_at
       FROM players
       WHERE push_enabled = 1
       ORDER BY COALESCE(last_bite_at, 0) ASC
       LIMIT 200`,
    )
    .all<Player>();

  let sent = 0;
  for (const player of results ?? []) {
    if (!isDue(player, now)) continue;
    try {
      // The per-lake daily cap. Without this the one-hour gap alone would allow
      // ~11 bites a day at Willow, against a content table that has always
      // declared 3-5 — and against what we tell players.
      const cap = dailyCapFor(player.current_lake);
      if (cap > 0 && (await bitesSentToday(deps, player, now)) >= cap) continue;

      await dispatchBite(deps, player.app_user_id, player.current_lake);
      sent += 1;
    } catch (err) {
      // One player's failed dispatch must not stop the rest of the run.
      console.error('dispatch failed', player.app_user_id, err);
    }
  }
  return sent;
}
