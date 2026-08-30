/**
 * Lunker — the server-side catch roll.
 *
 * The client posts only `{player, lake, outcome}`. It never names its own
 * catch. A modified APK that claims a Legendary gets whatever the server's roll
 * says it got, because the roll is seeded from a value the client cannot
 * produce: HMAC-SHA256(notification_id, ROLL_SERVER_SECRET).
 *
 * The seed is written to `sent.roll_seed` BEFORE the push leaves, which is what
 * makes the outcome reproducible server-side for dispute and unguessable
 * client-side — without the second secret, roll log and two-phase contract that
 * a full commit-reveal scheme would have cost for a threat no rubric line
 * scores.
 *
 * WebCrypto only (no node:crypto import) so the identical module runs in the
 * Cloudflare Worker and under Node's test runner.
 */

import { getLake } from './content.js';

const enc = new TextEncoder();

/**
 * @param {string} message
 * @param {string} secret
 * @returns {Promise<string>} lowercase hex
 */
export async function hmacHex(message, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive the roll seed for a bite. Called at SEND time, stored in `sent`.
 * @param {string} notificationId
 * @param {string} secret
 */
export function deriveRollSeed(notificationId, secret) {
  return hmacHex(notificationId, secret);
}

/**
 * Pull a float in [0,1) out of a hex seed at a given 8-hex-digit offset.
 * Two draws are needed per catch (which fish, then how heavy) and they must be
 * independent, so they read different slices of the same 64-hex digest.
 *
 * @param {string} hex
 * @param {number} slot 0-based, 8 hex chars each (a SHA-256 digest gives 8 slots)
 * @returns {number}
 */
export function draw(hex, slot) {
  const start = (slot * 8) % hex.length;
  const chunk = hex.slice(start, start + 8).padEnd(8, '0');
  return parseInt(chunk, 16) / 0x1_0000_0000;
}

/**
 * Roll a catch against a lake's committed weight table.
 *
 * @param {string} lakeId
 * @param {string} rollSeed  hex from deriveRollSeed
 * @returns {{ fish_id: string, name: string, rarity: string, mass_kg: number, coins: number }}
 */
export function rollCatch(lakeId, rollSeed) {
  const lake = getLake(lakeId);
  if (!lake) throw new Error(`unknown lake: ${lakeId}`);

  const total = lake.fish.reduce((s, f) => s + f.weight, 0);
  const target = draw(rollSeed, 0) * total;

  let acc = 0;
  let picked = lake.fish[lake.fish.length - 1];
  for (const f of lake.fish) {
    acc += f.weight;
    if (target < acc) {
      picked = f;
      break;
    }
  }

  const [lo, hi] = picked.mass_kg;
  // One decimal place: the card reads "4.2 kg", and a mass rendered to four
  // decimals looks like a debug build in the one frame most likely to become
  // the Devpost gallery thumbnail.
  const mass = Math.round((lo + draw(rollSeed, 1) * (hi - lo)) * 10) / 10;

  return {
    fish_id: picked.id,
    name: picked.name,
    rarity: picked.rarity,
    mass_kg: mass,
    coins: picked.coins,
  };
}
