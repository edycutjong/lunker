/**
 * Lunker — reel-tension minigame logic.
 *
 * Pure, frame-rate independent, and deliberately kept out of the React tree so
 * the win/lose resolution can be tested without rendering anything. The screen
 * is a thin renderer over `step()`.
 *
 * One mechanic, no variants: thumb-hold a needle inside a moving green zone.
 * Holding accelerates the needle up, releasing lets it fall. Time spent in the
 * zone accumulates toward the landing; time outside drains it. The pressure
 * comes from the 60-second window, not from visual noise.
 */

export const DEFAULTS = {
  /** seconds of accumulated in-zone time needed to land the fish */
  requiredHold: 6,
  /** the push's own promise, in seconds — this is the same 60s the body copy states */
  windowSec: 60,
  /** needle acceleration while held, in position-units/s^2 */
  pull: 1.15,
  /** gravity while released */
  gravity: 0.95,
  /** velocity damping, per second */
  drag: 2.4,
  /** half-width of the safe zone in position units */
  zoneHalfWidth: 0.11,
  /** how fast progress bleeds away while out of zone, relative to real time */
  drainRate: 0.55,
  /** zone drift speed (Hz) */
  zoneSpeed: 0.23,
};

/**
 * @typedef {object} TensionState
 * @property {number} t          elapsed seconds
 * @property {number} pos        needle position, 0 (bottom) .. 1 (top)
 * @property {number} vel
 * @property {number} progress   accumulated in-zone seconds
 * @property {boolean} inZone
 * @property {number} zoneCenter
 * @property {'playing'|'landed'|'escaped'} status
 */

/**
 * @param {object} [opts]
 * @param {number} [opts.phase] starting phase of the zone drift, 0..1
 * @returns {TensionState}
 */
export function createState(opts = {}) {
  const phase = opts.phase ?? 0;
  return {
    t: 0,
    pos: 0.5,
    vel: 0,
    progress: 0,
    inZone: false,
    zoneCenter: zoneAt(0, phase),
    status: 'playing',
  };
}

/**
 * Zone drift. Two summed sines rather than one so the motion does not read as a
 * metronome the player can solve once and stop watching.
 * @param {number} t seconds
 * @param {number} phase
 */
export function zoneAt(t, phase = 0) {
  const a = Math.sin((t * DEFAULTS.zoneSpeed + phase) * Math.PI * 2);
  const b = Math.sin((t * DEFAULTS.zoneSpeed * 1.7 + phase) * Math.PI * 2);
  const raw = 0.5 + 0.28 * a + 0.1 * b;
  return Math.min(0.88, Math.max(0.12, raw));
}

/**
 * Advance the simulation by `dt` seconds.
 *
 * @param {TensionState} s
 * @param {number} dt      seconds since last step
 * @param {boolean} holding whether the thumb is down
 * @param {object} [opts]
 * @param {number} [opts.phase]
 * @param {typeof DEFAULTS} [opts.cfg]
 * @returns {TensionState} a new state (never mutates)
 */
export function step(s, dt, holding, opts = {}) {
  const cfg = opts.cfg ?? DEFAULTS;
  const phase = opts.phase ?? 0;

  if (s.status !== 'playing') return s;

  // Clamp dt so a backgrounded app that resumes after 20s does not teleport the
  // needle through the zone and hand out a free landing.
  const d = Math.min(Math.max(dt, 0), 0.05);

  const t = s.t + d;
  const accel = (holding ? cfg.pull : -cfg.gravity) - s.vel * cfg.drag;
  let vel = s.vel + accel * d;
  let pos = s.pos + vel * d;

  if (pos <= 0) {
    pos = 0;
    vel = 0;
  } else if (pos >= 1) {
    pos = 1;
    vel = 0;
  }

  const zoneCenter = zoneAt(t, phase);
  const inZone = Math.abs(pos - zoneCenter) <= cfg.zoneHalfWidth;

  let progress = inZone ? s.progress + d : s.progress - d * cfg.drainRate;
  if (progress < 0) progress = 0;

  /** @type {TensionState['status']} */
  let status = 'playing';
  if (progress >= cfg.requiredHold) status = 'landed';
  else if (t >= cfg.windowSec) status = 'escaped';

  return { t, pos, vel, progress, inZone, zoneCenter, status };
}

/**
 * Seconds left in the push's window, floored at 0.
 * @param {TensionState} s
 * @param {typeof DEFAULTS} [cfg]
 */
export function remaining(s, cfg = DEFAULTS) {
  return Math.max(0, cfg.windowSec - s.t);
}

/**
 * `0:47` with a tabular-safe shape. A countdown whose digits shift width reads
 * as jitter on video, which is why the numeral is always mm:ss.
 * @param {number} sec
 */
export function formatClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
