/**
 * The killer number's arithmetic.
 *
 * Every rule tested here has the property that removing it moves the headline
 * figure in our favour. That is exactly why each one is asserted on a fixture
 * whose correct answer was computed by hand before the code existed.
 */

import { describe, it, expect } from 'vitest';
import { computeBench, formatBench, percentile } from '../shared/bench.js';
import { buildAnomalyFixture } from '../scripts/lunker-verify.mjs';

const fx = buildAnomalyFixture();
const run = (opts) => computeBench(fx.sent, fx.pings, { windowMs: 60_000, ...opts });

describe('percentile — nearest rank', () => {
  it('returns null on an empty set rather than 0', () => {
    // 0 would render as "p50=0ms", which reads as an impossibly fast app.
    expect(percentile([], 0.5)).toBeNull();
  });

  it('picks the ceil(p*n)th value', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5);
  });

  it('never interpolates a latency no device reported', () => {
    const vals = [10, 20];
    expect([10, 20]).toContain(percentile(vals, 0.5));
    expect(percentile(vals, 0.5)).not.toBe(15);
  });

  it('clamps p=0 to the first element', () => {
    expect(percentile([7, 8, 9], 0)).toBe(7);
  });
});

describe('fixture E1-E4 — the hand-computed expected answer', () => {
  const expected = fx._meta.expected;
  const r = run();

  it('ingests all 45 raw rows', () => {
    expect(r.ingested).toBe(45);
    expect(r.ingested).toBe(expected.ingested);
  });

  it('counts 39 unique ids present in the sent log as the denominator', () => {
    expect(r.denominator).toBe(39);
  });

  it('counts 17 answered within the 60s window', () => {
    expect(r.answered).toBe(17);
  });

  it('reports 43.6%', () => {
    expect(r.answeredPct).toBeCloseTo(43.589, 2);
    expect(r.answeredPct.toFixed(1)).toBe('43.6');
  });

  it('reports p50=9,000 p95=104,000 max=118,000 over n=23', () => {
    expect(r.p50).toBe(9_000);
    expect(r.p95).toBe(104_000);
    expect(r.max).toBe(118_000);
    expect(r.latencyN).toBe(23);
  });

  it('E1: collapses 3 duplicated ids from 6 rows', () => {
    expect(r.duplicateIds).toBe(3);
    expect(r.duplicateRows).toBe(6);
  });

  it('E2: flags 4 clock-skew rows', () => {
    expect(r.clockSkew).toBe(4);
  });

  it('E3: keeps 12 never-opened bites in the denominator', () => {
    expect(r.neverOpened).toBe(12);
  });

  it('E4: rejects 3 fabricated ids from both numerator and denominator', () => {
    expect(r.fabricated).toBe(3);
    // 39, not 42 — the fabricated ids did not inflate the denominator either.
    expect(r.denominator).toBe(39);
  });

  it('matches every value the fixture declares up front', () => {
    expect({
      ingested: r.ingested,
      denominator: r.denominator,
      answered: r.answered,
      p50: r.p50,
      p95: r.p95,
      max: r.max,
      latency_n: r.latencyN,
      duplicate_ids: r.duplicateIds,
      duplicate_rows: r.duplicateRows,
      clock_skew: r.clockSkew,
      fabricated: r.fabricated,
      never_opened: r.neverOpened,
    }).toEqual({
      ingested: expected.ingested,
      denominator: expected.denominator,
      answered: expected.answered,
      p50: expected.p50,
      p95: expected.p95,
      max: expected.max,
      latency_n: expected.latency_n,
      duplicate_ids: expected.duplicate_ids,
      duplicate_rows: expected.duplicate_rows,
      clock_skew: expected.clock_skew,
      fabricated: expected.fabricated,
      never_opened: expected.never_opened,
    });
  });
});

describe('the biases the rules exist to prevent', () => {
  it('E3: dropping never-opened rows would inflate 43.6% to 63.0%', () => {
    // The exact free upgrade available for deleting inconvenient rows.
    const withoutNeverOpened = fx.pings.filter((p) => p.opened_at !== null);
    const r = computeBench(fx.sent, withoutNeverOpened, { windowMs: 60_000 });
    expect(r.denominator).toBe(27);
    expect(r.answeredPct.toFixed(1)).toBe('63.0');
  });

  it('E2: clamping negative latency to 0 would move 4 rows into the numerator', () => {
    const clamped = fx.pings.map((p) => {
      const s = fx.sent.find((x) => x.notification_id === p.notification_id);
      if (!s || p.opened_at === null) return p;
      return { ...p, opened_at: Math.max(p.opened_at, s.sent_at) };
    });
    const r = computeBench(fx.sent, clamped, { windowMs: 60_000 });
    expect(r.answered).toBe(21); // 17 + the 4 skewed rows
    expect(r.clockSkew).toBe(0); // and the flag that would have disclosed it is gone
  });

  it('E1: counting duplicate rows separately would inflate the answered count', () => {
    // Proven by construction: 6 duplicate rows collapse to 3 answers, so a
    // naive per-row count would report 20 answered instead of 17.
    const r = run();
    expect(r.answered).toBe(17);
    expect(r.answered + r.duplicateRows - r.duplicateIds).toBe(20);
  });

  it('E1: the earliest open wins even when a redelivery lands outside the window', () => {
    // dup-03 was opened at +21s and redelivered at +95s. It must count as
    // answered, and its latency must be 21,000.
    const r = run();
    expect(r.p95).toBe(104_000); // unchanged by the 95,000 redelivery
    expect(r.latencyN).toBe(23);
  });

  it('E4: a fabricated ping cannot reach any counter', () => {
    const extra = [...fx.pings];
    for (let i = 0; i < 500; i++) {
      extra.push({ notification_id: `spam-${i}`, opened_at: 1 });
    }
    const r = computeBench(fx.sent, extra, { windowMs: 60_000 });
    expect(r.denominator).toBe(39);
    expect(r.answered).toBe(17);
    expect(r.fabricated).toBe(503);
  });
});

describe('window anchoring', () => {
  it('a wider window admits more answers but never changes the denominator', () => {
    const wide = run({ windowMs: 120_000 });
    expect(wide.denominator).toBe(39);
    expect(wide.answered).toBeGreaterThan(17);
  });

  it('a 2-minute window admits the four late rows under 120s', () => {
    const wide = run({ windowMs: 120_000 });
    // 64k, 71k, 83k, 95k, 104k, 118k are all under 120,000.
    expect(wide.answered).toBe(23);
  });

  it('handles an empty dataset without dividing by zero', () => {
    const r = computeBench([], [], {});
    expect(r.answeredPct).toBeNull();
    expect(r.p50).toBeNull();
    expect(r.denominator).toBe(0);
  });
});

describe('formatBench — the CI-asserted contract', () => {
  it('reproduces the documented fixture output exactly', () => {
    const out = formatBench(run(), {
      sourceLabel: 'fixture seed/telemetry-anomalies.json',
      fixture: true,
    });
    expect(out).toBe(
      [
        'Source: fixture seed/telemetry-anomalies.json  (VALIDATION DATA — NOT SUBMITTABLE)',
        'Rows ingested:              45',
        'Answered within window:     17 / 39  (43.6%)',
        'Open latency (ms):          p50=9,000  p95=104,000  max=118,000   (n=23)',
        'Duplicate notification_ids collapsed: 3   (6 rows -> 3 ids)',
        'Clock-skew rows excluded from latency: 4  (flagged, retained in denominator)',
        'Fabricated ids rejected:    3   (not in `sent` log)',
        'Never-opened (denominator only): 12',
      ].join('\n'),
    );
  });

  it('prints the NOT SUBMITTABLE banner unconditionally for fixture data', () => {
    const out = formatBench(run(), { sourceLabel: 'anything', fixture: true });
    expect(out).toContain('VALIDATION DATA — NOT SUBMITTABLE');
  });

  it('omits the banner for real ledger data', () => {
    const out = formatBench(run(), { sourceLabel: 'live ledger', fixture: false });
    expect(out).not.toContain('NOT SUBMITTABLE');
  });
});
