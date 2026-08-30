/**
 * The server-side catch roll.
 *
 * The security property under test is simple: the outcome is a function of a
 * seed the client never sees, so a modified APK cannot mint itself Legendaries.
 * The fairness property is that the roll actually follows the committed table.
 */

import { describe, it, expect } from 'vitest';
import { deriveRollSeed, rollCatch, draw, hmacHex } from '../shared/roll.js';
import { getLake } from '../shared/content.js';

const SECRET = 'roll_secret_test';

describe('deriveRollSeed', () => {
  it('is deterministic for the same id and secret', async () => {
    const a = await deriveRollSeed('abc-123', SECRET);
    const b = await deriveRollSeed('abc-123', SECRET);
    expect(a).toBe(b);
  });

  it('produces a 64-char hex digest', async () => {
    const seed = await deriveRollSeed('abc-123', SECRET);
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes completely when the notification id changes', async () => {
    const a = await deriveRollSeed('abc-123', SECRET);
    const b = await deriveRollSeed('abc-124', SECRET);
    expect(a).not.toBe(b);
  });

  it('changes completely when the secret rotates', async () => {
    const a = await deriveRollSeed('abc-123', SECRET);
    const b = await deriveRollSeed('abc-123', 'different');
    expect(a).not.toBe(b);
  });

  it('matches a known HMAC-SHA256 vector', async () => {
    // RFC 4231 test case 1: key = 20x 0x0b, data = "Hi There".
    const key = '\x0b'.repeat(20);
    expect(await hmacHex('Hi There', key)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });
});

describe('draw', () => {
  it('returns a float in [0,1)', () => {
    const hex = 'ffffffff'.repeat(8);
    expect(draw(hex, 0)).toBeLessThan(1);
    expect(draw(hex, 0)).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for an all-zero slice', () => {
    expect(draw('0'.repeat(64), 0)).toBe(0);
  });

  it('reads independent slices for different slots', () => {
    const hex = '00000000ffffffff' + '0'.repeat(48);
    expect(draw(hex, 0)).toBe(0);
    expect(draw(hex, 1)).toBeGreaterThan(0.99);
  });
});

describe('rollCatch', () => {
  it('is deterministic for a given seed', async () => {
    const seed = await deriveRollSeed('bite-1', SECRET);
    expect(rollCatch('willow', seed)).toEqual(rollCatch('willow', seed));
  });

  it('rejects an unknown lake instead of silently defaulting', () => {
    expect(() => rollCatch('atlantis', 'ff'.repeat(32))).toThrow(/unknown lake/);
  });

  it('only ever returns a fish that is in that lake table', async () => {
    const willowIds = new Set(getLake('willow').fish.map((f) => f.id));
    for (let i = 0; i < 300; i++) {
      const seed = await deriveRollSeed(`bite-${i}`, SECRET);
      expect(willowIds.has(rollCatch('willow', seed).fish_id)).toBe(true);
    }
  });

  it('returns a mass inside the fish own range', async () => {
    for (let i = 0; i < 300; i++) {
      const seed = await deriveRollSeed(`m-${i}`, SECRET);
      const c = rollCatch('willow', seed);
      const fish = getLake('willow').fish.find((f) => f.id === c.fish_id);
      expect(c.mass_kg).toBeGreaterThanOrEqual(fish.mass_kg[0] - 0.05);
      expect(c.mass_kg).toBeLessThanOrEqual(fish.mass_kg[1] + 0.05);
    }
  });

  it('rounds mass to one decimal so the card never reads like a debug build', async () => {
    for (let i = 0; i < 50; i++) {
      const seed = await deriveRollSeed(`r-${i}`, SECRET);
      const { mass_kg } = rollCatch('willow', seed);
      expect(Math.round(mass_kg * 10)).toBe(mass_kg * 10);
    }
  });

  it('grants the coin value committed in the table, never a client-supplied one', async () => {
    const seed = await deriveRollSeed('coins', SECRET);
    const c = rollCatch('willow', seed);
    const fish = getLake('willow').fish.find((f) => f.id === c.fish_id);
    expect(c.coins).toBe(fish.coins);
  });

  it('produces a rare rate at Willow near the committed 4.0%', async () => {
    // The seed is tuned so an honest rare is filmable in one session. If this
    // drifts, the recording plan quietly stops being feasible and the pressure
    // to script the outcome returns.
    let rares = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const seed = await deriveRollSeed(`dist-${i}`, SECRET);
      if (rollCatch('willow', seed).rarity === 'rare') rares++;
    }
    expect(rares / N).toBeGreaterThan(0.025);
    expect(rares / N).toBeLessThan(0.06);
  });

  it('never yields a legendary at Willow', async () => {
    for (let i = 0; i < 1000; i++) {
      const seed = await deriveRollSeed(`leg-${i}`, SECRET);
      expect(rollCatch('willow', seed).rarity).not.toBe('legendary');
    }
  });

  it('yields legendaries at Deep Sea, which is what the entitlement buys', async () => {
    let legendary = 0;
    for (let i = 0; i < 500; i++) {
      const seed = await deriveRollSeed(`ds-${i}`, SECRET);
      if (rollCatch('deepsea', seed).rarity === 'legendary') legendary++;
    }
    expect(legendary).toBeGreaterThan(0);
  });

  it('cannot be steered by the client: a different id gives a different roll', async () => {
    const seeds = await Promise.all(
      Array.from({ length: 40 }, (_, i) => deriveRollSeed(`steer-${i}`, SECRET)),
    );
    const results = new Set(
      seeds.map((s) => `${rollCatch('willow', s).fish_id}:${rollCatch('willow', s).mass_kg}`),
    );
    expect(results.size).toBeGreaterThan(10);
  });
});
