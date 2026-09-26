/// <reference lib="dom" />
/**
 * Browser entry for https://lunker.edycu.dev/verify/ — bundled into
 * site/verify/verify.js by scripts/build-site.mjs.
 *
 * GitHub Pages cannot read D1, so the page fetches the Worker's live JSON and
 * renders it with the same renderVerifyMain() the Worker uses. Nothing is
 * cached or typed in: every visit is a fresh read of the ledger.
 */
import { API_ORIGIN, esc, renderVerifyMain, type Payload } from '../worker/src/verify-render.js';

const main = document.getElementById('ledger');
const status = document.getElementById('ledger-status');
const windowMs = new URLSearchParams(location.search).get('window_ms');
const src = `${API_ORIGIN}/verify?format=json${windowMs ? `&window_ms=${encodeURIComponent(windowMs)}` : ''}`;

fetch(src, { cache: 'no-store' })
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<Payload>;
  })
  .then((p) => {
    if (main) main.innerHTML = renderVerifyMain(p);
  })
  .catch((err: unknown) => {
    if (status) {
      status.innerHTML =
        `The ledger could not be reached (${esc(String(err instanceof Error ? err.message : err))}). ` +
        `The raw data is at <a href="${src}">${esc(src.replace('https://', ''))}</a>.`;
    }
  });
