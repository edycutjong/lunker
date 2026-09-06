/**
 * GET /verify — the read-only proof surface a judge can open without installing
 * anything.
 *
 * It runs `computeBench` from `shared/bench.js`, which is the exact function
 * `scripts/lunker-verify.mjs bench` runs. That is deliberate: the page and
 * DEMO.md are one computation, so a judge cannot find a number here that
 * disagrees with the number we published.
 *
 * Aggregate and anonymized. It is not a dashboard — a dashboard about the
 * product would be a different (and worse) submission than the product.
 */

import { computeBench } from '../../../shared/bench.js';
import type { Deps } from '../types.js';
import { json, html } from '../lib/http.js';

export async function verify(req: Request, deps: Deps): Promise<Response> {
  const { db } = deps;
  const url = new URL(req.url);
  // Clamped, because this page is the proof a judge is handed.
  //
  // The value went straight from the query string into the headline statistic,
  // so `?window_ms=600000` rendered a 30px "80.0%" where the honest figure was
  // 20.0%, and `?window_ms=abc` rendered "0.0%" under the label "Answered
  // within NaNs". The unit label does change with it, which is why this is a
  // clamp and not a removal — but the big number is what gets screenshotted,
  // and a pre-loaded link is a trivial way to make it say something else.
  const requested = Number(url.searchParams.get('window_ms') ?? 60_000);
  const windowMs =
    Number.isFinite(requested) && requested > 0 && requested <= 300_000 ? requested : 60_000;

  const sentRows = await db
    .prepare('SELECT notification_id, sent_at FROM sent')
    .all<{ notification_id: string; sent_at: number }>();

  const pingRows = await db
    .prepare('SELECT notification_id, opened_at, resolved FROM bite_telemetry')
    .all<{ notification_id: string; opened_at: number | null; resolved: string | null }>();

  const ledger = await db
    .prepare(
      'SELECT delta, reason, rc_status, created_at FROM vc_transactions ORDER BY created_at DESC LIMIT 25',
    )
    .all<{ delta: number; reason: string; rc_status: number; created_at: number }>();

  // Only events where money actually moved TOWARD us. `purchase_events` also
  // stores EXPIRATION (the win-back Journey branches on it), CANCELLATION and
  // REFUND — counting those under a label that reads "HMAC-verified purchases"
  // would inflate the one figure we invite a judge to audit, and it would do it
  // in the direction that flatters us.
  const purchases = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM purchase_events WHERE event_type IN ('INITIAL_PURCHASE','NON_RENEWING_PURCHASE','RENEWAL')",
    )
    .first<{ n: number }>();

  const testers = await db
    .prepare('SELECT COUNT(DISTINCT app_user_id) AS n FROM sent')
    .first<{ n: number }>();

  const bench = computeBench(sentRows.results ?? [], pingRows.results ?? [], { windowMs });

  const payload = {
    bench,
    testers: testers?.n ?? 0,
    purchase_events: purchases?.n ?? 0,
    ledger_tail: ledger.results ?? [],
    // Derived, not hardcoded: this page renders identically in local dev, and
    // claiming "production" there would be a small lie on the one surface whose
    // entire job is being checkable.
    note:
      deps.env.DEV_CAST_ENABLED === '1'
        ? 'Read-only, anonymized, live from the development ledger.'
        : 'Read-only, anonymized, live from the production ledger.',
  };

  if (url.searchParams.get('format') === 'json') return json(payload);

  return html(renderVerify(payload));
}

interface Payload {
  bench: ReturnType<typeof computeBench>;
  testers: number;
  purchase_events: number;
  ledger_tail: { delta: number; reason: string; rc_status: number; created_at: number }[];
  note: string;
}

function renderVerify(p: Payload): string {
  const b = p.bench;
  const pct = b.answeredPct == null ? '—' : `${b.answeredPct.toFixed(1)}%`;
  const ms = (v: number | null) => (v == null ? '—' : `${v.toLocaleString('en-US')} ms`);

  const rows = p.ledger_tail
    .map(
      (t) => `<tr>
        <td class="num ${t.delta >= 0 ? 'pos' : 'neg'}">${t.delta >= 0 ? '+' : ''}${t.delta.toLocaleString('en-US')}</td>
        <td>${esc(t.reason)}</td>
        <td class="num">${t.rc_status}${
          t.rc_status === 422
            ? ' <span class="tag">insufficient</span>'
            : t.rc_status !== 200
              ? ' <span class="tag">not settled</span>'
              : ''
        }</td>
        <td class="num dim">${new Date(t.created_at).toISOString().replace('T', ' ').slice(0, 19)}Z</td>
      </tr>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lunker — live ledger</title>
<style>
  :root{
    --bg-base:#04171E; --text-hi:#F0FAF6; --text-mid:#94B3AC; --text-low:#47635F;
    --primary:#3FDBB6; --accent:#FFA05A; --error:#EF4444;
    --panel:rgba(240,250,246,.04); --line:rgba(240,250,246,.10);
  }
  *{box-sizing:border-box}
  body{margin:0;padding:32px 20px 72px;background:var(--bg-base);color:var(--text-hi);
    font:400 16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
  main{max-width:760px;margin:0 auto}
  h1{font-size:22px;letter-spacing:-.01em;margin:0 0 4px}
  .note{color:var(--text-mid);font-size:14px;margin:0 0 28px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:28px}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
  .stat .v{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.02em;color:var(--primary)}
  .stat .k{font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--text-mid);margin-top:6px}
  .stat .src{font-size:11px;color:var(--text-low);margin-top:8px;font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--text-mid);
    font-weight:500;padding:0 10px 8px;border-bottom:1px solid var(--line)}
  td{padding:9px 10px;border-bottom:1px solid var(--line)}
  .num{text-align:right}
  td.num:first-child{text-align:left}
  .pos{color:var(--primary)} .neg{color:var(--accent)} .dim{color:var(--text-low)}
  .tag{color:var(--error);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.09em;color:var(--text-mid);
     font-weight:500;margin:32px 0 12px}
  .caveat{margin-top:28px;padding:14px 16px;border-left:2px solid var(--accent);
    background:var(--panel);border-radius:0 10px 10px 0;font-size:13px;color:var(--text-mid)}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--text-hi)}
  .empty{color:var(--text-mid);font-size:14px;padding:18px 0}
</style>
</head><body><main>
  <h1>Lunker — live ledger</h1>
  <p class="note">${esc(p.note)} Same computation as <code>node scripts/lunker-verify.mjs bench</code>.</p>

  <div class="grid">
    <div class="stat">
      <div class="v">${pct}</div>
      <div class="k">Answered within ${Math.round(b.windowMs / 1000)}s</div>
      <div class="src">${b.answered} / ${b.denominator} bites · ${p.testers} testers</div>
    </div>
    <div class="stat">
      <div class="v">${ms(b.p50)}</div>
      <div class="k">p50 open latency</div>
      <div class="src">p95 ${ms(b.p95)} · max ${ms(b.max)} · n=${b.latencyN}</div>
    </div>
    <div class="stat">
      <div class="v">${p.purchase_events}</div>
      <div class="k">HMAC-verified purchases</div>
      <div class="src">RevenueCat webhook, signature checked</div>
    </div>
  </div>

  <h2>COIN ledger — last 25 movements</h2>
  ${rows ? `<table><thead><tr><th>Delta</th><th>Reason</th><th class="num">RC status</th><th class="num">When</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">No transactions yet.</p>'}

  <div class="caveat">
    The window is measured <strong>from send</strong>, not from open. Anchoring at open would make
    this number trivially ~100% and would falsify the claim that the push is the timer. Android
    Doze and OEM delivery delay therefore show up in the p50/p95 distribution above rather than
    being defined away. Clock-skewed rows (${b.clockSkew}) are flagged and excluded from latency
    but retained in the denominator; never-opened bites (${b.neverOpened}) stay in the denominator;
    fabricated ids (${b.fabricated}) are rejected at ingest.
  </div>
</main></body></html>`;
}

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
