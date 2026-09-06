/**
 * Lunker — the killer-number computation.
 *
 * "X% of bite push notifications answered (opened + minigame started) within 60
 * seconds of delivery."
 *
 * This module is the SINGLE implementation of that number. It is imported by
 * both `scripts/lunker-verify.mjs bench` and the Worker's `GET /verify` route,
 * so the page a judge opens and the figure in DEMO.md are provably the same
 * computation rather than two implementations that happen to agree today.
 *
 * Plain ESM with JSDoc types (no TS build step) precisely so both consumers can
 * import it directly.
 *
 * The window is measured FROM SEND, not from open. Anchoring at open would make
 * the metric trivially ~100% and would falsify the product claim that the push
 * is the timer. Doze / OEM delivery delay is therefore disclosed through the
 * real p50/p95 distribution rather than defined away.
 */

/** @typedef {{ notification_id: string, app_user_id?: string, lake_id?: string, sent_at: number }} SentRow */
/** @typedef {{ notification_id: string, opened_at: number|null, resolved?: string|null }} PingRow */

/**
 * @typedef {object} BenchResult
 * @property {number} ingested            raw telemetry rows read, before any filtering
 * @property {number} denominator         unique notification_ids that exist in the `sent` log
 * @property {number} answered            unique ids opened within the window
 * @property {number|null} answeredPct    answered/denominator * 100, null when denominator is 0
 * @property {number|null} p50            open latency ms, nearest-rank
 * @property {number|null} p95            open latency ms, nearest-rank
 * @property {number|null} max            slowest open latency ms
 * @property {number} latencyN            rows contributing a latency
 * @property {number} duplicateIds        ids that arrived more than once
 * @property {number} duplicateRows       raw rows those ids accounted for
 * @property {number} clockSkew           rows where opened_at < sent_at
 * @property {number} fabricated          unique ids not present in the `sent` log
 * @property {number} neverOpened         ids in the denominator that were never opened
 * @property {number} windowMs
 */

/**
 * Nearest-rank percentile (the method DEMO.md documents).
 *
 * Deliberately NOT interpolated: with the small N a solo closed test produces,
 * an interpolated p95 invents a latency no device ever reported. Nearest-rank
 * only ever returns a measurement that actually happened.
 *
 * @param {number[]} sorted ascending
 * @param {number} p 0..1
 * @returns {number|null}
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil(p * sorted.length);
  const idx = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[idx];
}

/**
 * Compute the killer number.
 *
 * Every rule below exists because dropping it moves the headline number in our
 * favour, which is exactly why each one is asserted in the test suite:
 *
 *  - Fabricated ids (not in `sent`) are rejected outright. Without this, anyone
 *    holding the endpoint URL can inflate the one number we headline.
 *  - Duplicate ids (Android redelivery) collapse to one, keeping the earliest
 *    open. Double-counting opens inflates the answered %.
 *  - Clock-skew rows (opened_at < sent_at) are FLAGGED, never clamped, and are
 *    excluded from the numerator and from latency while staying in the
 *    denominator. Clamping a negative latency to 0 would silently move the row
 *    INTO the numerator.
 *  - Never-opened rows stay in the denominator. Deleting them is the single
 *    largest free upgrade available to a dishonest implementation.
 *
 * @param {SentRow[]} sent
 * @param {PingRow[]} pings
 * @param {{ windowMs?: number }} [opts]
 * @returns {BenchResult}
 */
export function computeBench(sent, pings, opts = {}) {
  const windowMs = opts.windowMs ?? 60_000;

  /** @type {Map<string, number>} notification_id -> sent_at */
  const sentAt = new Map();
  for (const row of sent) sentAt.set(row.notification_id, row.sent_at);

  const ingested = pings.length;

  // --- Pass 1: reject fabricated ids, group the rest by notification_id ------
  /** @type {Map<string, PingRow[]>} */
  const byId = new Map();
  /** @type {Set<string>} */
  const fabricatedIds = new Set();

  for (const ping of pings) {
    if (!sentAt.has(ping.notification_id)) {
      fabricatedIds.add(ping.notification_id);
      continue;
    }
    const bucket = byId.get(ping.notification_id);
    if (bucket) bucket.push(ping);
    else byId.set(ping.notification_id, [ping]);
  }

  // Every bite that was SENT is in the denominator, whether or not telemetry
  // exists for it.
  //
  // This used to be derived from the telemetry table alone, which meant a bite
  // with no ping row simply vanished — no counter, no flag, nothing. The file's
  // own header calls an inflated answer rate "the single largest free upgrade
  // available to a dishonest implementation", and this was the door: one
  // `DELETE FROM bite_telemetry WHERE opened_at IS NULL` turns 17/39 = 43.6%
  // into 17/27 = 63.0%, and the page reports it with neverOpened: 0 and no
  // anomaly of any kind. The same gap opens by accident if the batch write in
  // dispatchBite ever partially fails.
  //
  // Seeding from the send log makes an absent telemetry row indistinguishable
  // from an unopened one, which is what it actually is.
  let missingTelemetry = 0;
  for (const id of sentAt.keys()) {
    if (!byId.has(id)) {
      byId.set(id, []);
      missingTelemetry += 1;
    }
  }

  // --- Pass 2: collapse duplicates, classify each unique id -----------------
  let duplicateIds = 0;
  let duplicateRows = 0;
  let clockSkew = 0;
  let neverOpened = 0;
  let answered = 0;
  /** @type {number[]} */
  const latencies = [];

  for (const [id, rows] of byId) {
    if (rows.length > 1) {
      duplicateIds += 1;
      duplicateRows += rows.length;
    }

    // Earliest real open wins. A duplicate that arrives later must never be
    // able to turn an in-window answer into an out-of-window one, or vice versa.
    let openedAt = null;
    for (const row of rows) {
      if (row.opened_at == null) continue;
      if (openedAt == null || row.opened_at < openedAt) openedAt = row.opened_at;
    }

    if (openedAt == null) {
      neverOpened += 1; // denominator only
      continue;
    }

    const latency = openedAt - /** @type {number} */ (sentAt.get(id));

    if (latency < 0) {
      clockSkew += 1; // flagged, retained in denominator, excluded from both stats
      continue;
    }

    latencies.push(latency);
    if (latency <= windowMs) answered += 1;
  }

  // byId is now seeded from the send log, so this is the number of bites sent.
  const denominator = byId.size;
  latencies.sort((a, b) => a - b);

  return {
    ingested,
    denominator,
    answered,
    answeredPct: denominator === 0 ? null : (answered / denominator) * 100,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    max: latencies.length ? latencies[latencies.length - 1] : null,
    latencyN: latencies.length,
    duplicateIds,
    duplicateRows,
    clockSkew,
    fabricated: fabricatedIds.size,
    neverOpened,
    missingTelemetry,
    windowMs,
  };
}

/** @param {number} n */
const grp = (n) => n.toLocaleString('en-US');

/**
 * Render the CLI report. The exact shape here is asserted in CI (.github/workflows/ci.yml
 * "Expected output"), so this is a contract, not cosmetics.
 *
 * @param {BenchResult} r
 * @param {{ sourceLabel: string, fixture: boolean }} meta
 * @returns {string}
 */
export function formatBench(r, meta) {
  const lines = [];
  lines.push(
    `Source: ${meta.sourceLabel}` + (meta.fixture ? '  (VALIDATION DATA — NOT SUBMITTABLE)' : ''),
  );
  lines.push(`Rows ingested:              ${r.ingested}`);
  const pct = r.answeredPct == null ? 'n/a' : `${r.answeredPct.toFixed(1)}%`;
  lines.push(`Answered within window:     ${r.answered} / ${r.denominator}  (${pct})`);
  const p = (v) => (v == null ? 'n/a' : grp(v));
  lines.push(
    `Open latency (ms):          p50=${p(r.p50)}  p95=${p(r.p95)}  max=${p(r.max)}   (n=${r.latencyN})`,
  );
  lines.push(
    `Duplicate notification_ids collapsed: ${r.duplicateIds}   (${r.duplicateRows} rows -> ${r.duplicateIds} ids)`,
  );
  lines.push(
    `Clock-skew rows excluded from latency: ${r.clockSkew}  (flagged, retained in denominator)`,
  );
  lines.push(`Fabricated ids rejected:    ${r.fabricated}   (not in \`sent\` log)`);
  lines.push(`Never-opened (denominator only): ${r.neverOpened}`);
  return lines.join('\n');
}
