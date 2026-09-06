/**
 * Reel-tension minigame resolution.
 *
 * The mechanic is one thing done properly, so these tests are about the rules
 * that decide whether a player keeps a fish — not about how it looks.
 */

import { describe, it, expect } from 'vitest';
import { createState, step, zoneAt, remaining, formatClock, DEFAULTS } from '../shared/tension.js';

/** Play a whole round with a policy function deciding hold state each frame. */
function play(policy, { dt = 1 / 60, maxSeconds = 90, phase = 0 } = {}) {
  let s = createState({ phase });
  const frames = Math.ceil(maxSeconds / dt);
  for (let i = 0; i < frames && s.status === 'playing'; i++) {
    s = step(s, dt, policy(s), { phase });
  }
  return s;
}

/** A competent player: hold when below the zone, release when above it. */
const perfect = (s) => s.pos < s.zoneCenter;

describe('createState', () => {
  it('starts mid-arc, stationary, with no progress', () => {
    const s = createState();
    expect(s.pos).toBe(0.5);
    expect(s.vel).toBe(0);
    expect(s.progress).toBe(0);
    expect(s.status).toBe('playing');
  });
});

describe('zoneAt', () => {
  it('stays inside the reachable band', () => {
    for (let t = 0; t < 120; t += 0.1) {
      const z = zoneAt(t);
      expect(z).toBeGreaterThanOrEqual(0.12);
      expect(z).toBeLessThanOrEqual(0.88);
    }
  });

  it('is deterministic for a given time and phase', () => {
    expect(zoneAt(3.5, 0.25)).toBe(zoneAt(3.5, 0.25));
  });

  it('actually moves rather than sitting still', () => {
    const samples = new Set([0, 1, 2, 3, 4].map((t) => zoneAt(t).toFixed(3)));
    expect(samples.size).toBeGreaterThan(3);
  });
});

describe('resolution', () => {
  it('lands the fish when the needle is tracked competently', () => {
    expect(play(perfect).status).toBe('landed');
  });

  it('lets the fish escape when the player never touches the screen', () => {
    const s = play(() => false);
    expect(s.status).toBe('escaped');
    expect(s.progress).toBe(0);
  });

  it('lets the fish escape when the player just holds the whole time', () => {
    // Holding pins the needle at the top; the zone leaves it behind.
    const s = play(() => true);
    expect(s.status).toBe('escaped');
  });

  it('requires the full six seconds of in-zone time', () => {
    const s = play(perfect);
    expect(s.progress).toBeGreaterThanOrEqual(DEFAULTS.requiredHold);
  });

  it('escapes exactly at the 60s window, matching the push copy', () => {
    const s = play(() => false);
    expect(s.t).toBeGreaterThanOrEqual(DEFAULTS.windowSec);
    expect(s.t).toBeLessThan(DEFAULTS.windowSec + 0.1);
  });

  it('is frame-rate independent: 30fps and 120fps agree on the outcome', () => {
    expect(play(perfect, { dt: 1 / 30 }).status).toBe('landed');
    expect(play(perfect, { dt: 1 / 120 }).status).toBe('landed');
  });

  // The test above could never see the defect it is named for: both deltas sit
  // UNDER the 0.05 clamp, so nothing was clamped and nothing diverged. The
  // window used to advance by the clamped delta, so on a device dropping frames
  // it silently stretched — 80 real seconds at 15fps, 120 at 10fps — while the
  // push promised 60. This asserts wall-clock, at rates the clamp actually bites.
  it('the 60-second window is 60 REAL seconds, however slow the device', () => {
    for (const fps of [60, 30, 15, 10, 5]) {
      const dt = 1 / fps;
      let s = createState();
      let real = 0;
      // Hold nothing, so the only way out is the window expiring.
      while (s.status === 'playing' && real < 200) {
        s = step(s, dt, false);
        real += dt;
      }
      expect(s.status).toBe('escaped');
      // Escapes within one frame of the real 60s mark, at every frame rate.
      expect(real).toBeGreaterThanOrEqual(DEFAULTS.windowSec);
      expect(real).toBeLessThan(DEFAULTS.windowSec + dt + 0.001);
    }
  });

  // Backgrounding stops the RAF loop; the single huge delta on resume clamps to
  // 0.05, so a player could background mid-bite for ten minutes, come back, and
  // still hold a full window — then cash it in inside the 15-minute claim
  // ceiling. Real time keeps running whether or not frames do.
  it('a backgrounded app does not get its window back', () => {
    let s = createState();
    s = step(s, 1 / 60, false);
    // Gone for ten minutes, then one frame on resume.
    s = step(s, 600, false);
    expect(s.status).toBe('escaped');
  });
});

describe('progress accounting', () => {
  it('drains progress while out of zone but never below zero', () => {
    let s = createState();
    s = { ...s, progress: 0.2 };
    for (let i = 0; i < 200; i++) s = step(s, 1 / 60, false);
    expect(s.progress).toBe(0);
  });

  it('drains more slowly than it fills, so a slip is recoverable', () => {
    expect(DEFAULTS.drainRate).toBeLessThan(1);
  });
});

describe('anti-cheat and robustness', () => {
  it('clamps a huge dt so a backgrounded app cannot teleport into a landing', () => {
    // Without the clamp, one 30-second frame would satisfy requiredHold outright.
    let s = createState();
    s = step(s, 30, true);
    expect(s.t).toBeLessThanOrEqual(0.05);
    expect(s.status).toBe('playing');
  });

  it('ignores a negative dt rather than rewinding the clock', () => {
    const s = createState();
    const next = step(s, -5, true);
    expect(next.t).toBe(0);
  });

  it('is a no-op once resolved, so a late frame cannot revive a lost fish', () => {
    const landed = play(perfect);
    expect(step(landed, 1 / 60, true)).toBe(landed);
  });

  it('never mutates the state it was given', () => {
    const s = createState();
    const before = { ...s };
    step(s, 1 / 60, true);
    expect(s).toEqual(before);
  });

  it('keeps the needle inside the arc at both extremes', () => {
    let s = createState();
    for (let i = 0; i < 600; i++) s = step(s, 1 / 60, true);
    expect(s.pos).toBeLessThanOrEqual(1);
    let t = createState();
    for (let i = 0; i < 600; i++) t = step(t, 1 / 60, false);
    expect(t.pos).toBeGreaterThanOrEqual(0);
  });
});

describe('countdown display', () => {
  it('never reports negative time remaining', () => {
    // `remaining` reads wall-clock `elapsed`, not simulation time `t`.
    expect(remaining({ ...createState(), elapsed: 999 })).toBe(0);
  });

  it('formats as m:ss with a stable width', () => {
    expect(formatClock(47)).toBe('0:47');
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(5)).toBe('0:05');
    expect(formatClock(0)).toBe('0:00');
  });

  it('floors at zero rather than showing a negative clock', () => {
    expect(formatClock(-3)).toBe('0:00');
  });

  it('ceilings so the last second is shown as 0:01, not 0:00', () => {
    expect(formatClock(0.4)).toBe('0:01');
  });
});
