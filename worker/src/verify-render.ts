/**
 * The /verify page, as a pure function of the /verify?format=json payload.
 *
 * Two places render it and must never disagree: the Worker (server-side, for
 * anyone who opens lunker.edycu.workers.dev/verify?format=html or a test) and the
 * static page at https://lunker.edycu.dev/verify/, whose script fetches the live
 * JSON from the Worker and calls renderVerifyMain() in the browser. One function,
 * so the table a judge sees on the nice domain is byte-for-byte the Worker's.
 */

import type { computeBench } from '../../shared/bench.js';

/** The Worker, which owns the ledger. */
export const API_ORIGIN = 'https://lunker.edycu.workers.dev';

export interface Payload {
  bench: ReturnType<typeof computeBench>;
  testers: number;
  purchase_events: number;
  ledger_tail: { delta: number; reason: string; rc_status: number; created_at: number }[];
  refused: number;
  note: string;
}

export const VERIFY_HEAD = `<!doctype html>
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
  a{color:var(--primary)} a:hover{color:var(--text-hi)} a:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
</style>
</head>`;

export function renderVerifyMain(p: Payload): string {
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

  return `
  <h1>Lunker — live ledger</h1>
  <p class="note">${esc(p.note)} Same computation as <code>node scripts/lunker-verify.mjs bench</code>.
    Raw data: <a href="${API_ORIGIN}/verify?format=json">${API_ORIGIN.replace('https://', '')}/verify?format=json</a>.</p>

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
`;
}

export function renderVerify(p: Payload): string {
  return `${VERIFY_HEAD}<body><main>${renderVerifyMain(p)}</main></body></html>`;
}

/** The static shell GitHub Pages serves; verify.js fills <main> from the live JSON. */
export function renderVerifyShell(): string {
  return `${VERIFY_HEAD.replace('<title>Lunker — live ledger</title>', '<title>Lunker — live ledger</title>\n<link rel="canonical" href="https://lunker.edycu.dev/verify/">\n<link rel="icon" type="image/png" href="../assets/favicon-64.png">')}<body><main id="ledger" aria-live="polite">
  <h1>Lunker — live ledger</h1>
  <p class="note" id="ledger-status">Loading live from the ledger…</p>
  <noscript><p class="note">This page reads the live ledger with JavaScript. The same data, unrendered:
    <a href="${API_ORIGIN}/verify?format=json">${API_ORIGIN.replace('https://', '')}/verify?format=json</a></p></noscript>
</main>
<script src="./verify.js" defer></script>
</body></html>`;
}

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
