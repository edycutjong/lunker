/**
 * Webhook signature verification.
 *
 * `purchase_events` is the one ledger a judge is invited to inspect, so the
 * gate in front of it has to be right rather than approximately right.
 */

import { describe, it, expect } from 'vitest';
import { hmacSha256Hex, timingSafeEqual, verifySignature } from '../worker/src/lib/webhook.js';

const SECRET = 'whsec_test';
const BODY = '{"event":{"id":"evt-1","type":"INITIAL_PURCHASE"}}';

describe('hmacSha256Hex', () => {
  it('matches RFC 4231 test case 1', () => {
    return expect(hmacSha256Hex('Hi There', '\x0b'.repeat(20))).resolves.toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
  });

  it('matches RFC 4231 test case 2', () => {
    return expect(hmacSha256Hex('what do ya want for nothing?', 'Jefe')).resolves.toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('is sensitive to a single byte of the body', async () => {
    const a = await hmacSha256Hex(BODY, SECRET);
    const b = await hmacSha256Hex(BODY.replace('evt-1', 'evt-2'), SECRET);
    expect(a).not.toBe(b);
  });

  it('is sensitive to whitespace, which is why the raw body is used', async () => {
    // Parsing and re-serialising before verifying would change spacing and key
    // order, and the mismatch would look exactly like a bad secret.
    const a = await hmacSha256Hex(BODY, SECRET);
    const b = await hmacSha256Hex(JSON.stringify(JSON.parse(BODY), null, 2), SECRET);
    expect(a).not.toBe(b);
  });
});

describe('timingSafeEqual', () => {
  it('is true for identical strings', () => {
    expect(timingSafeEqual('abc123', 'abc123')).toBe(true);
  });

  it('is false for different strings of equal length', () => {
    expect(timingSafeEqual('abc123', 'abc124')).toBe(false);
  });

  it('is false for different lengths without throwing', () => {
    expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
  });

  it('compares every character rather than short-circuiting on the first', () => {
    // A difference in the last position must still be caught.
    expect(timingSafeEqual('a'.repeat(63) + 'b', 'a'.repeat(63) + 'c')).toBe(false);
  });
});

describe('verifySignature', () => {
  it('accepts a correct bare hex signature', async () => {
    const sig = await hmacSha256Hex(BODY, SECRET);
    expect(await verifySignature(BODY, sig, SECRET)).toBe(true);
  });

  it('accepts a sha256= prefixed signature', async () => {
    const sig = await hmacSha256Hex(BODY, SECRET);
    expect(await verifySignature(BODY, `sha256=${sig}`, SECRET)).toBe(true);
  });

  it('accepts an uppercase signature', async () => {
    const sig = await hmacSha256Hex(BODY, SECRET);
    expect(await verifySignature(BODY, sig.toUpperCase(), SECRET)).toBe(true);
  });

  it('rejects a missing header rather than defaulting to trust', async () => {
    expect(await verifySignature(BODY, null, SECRET)).toBe(false);
  });

  it('rejects when the secret is empty, so a misconfigured Worker fails closed', async () => {
    // An unset REVENUECAT_WEBHOOK_SECRET must reject every request rather than
    // accept every request. The check short-circuits before hashing, which also
    // avoids WebCrypto's zero-length-key error surfacing as a 500.
    const anySignature = await hmacSha256Hex(BODY, SECRET);
    expect(await verifySignature(BODY, anySignature, '')).toBe(false);
  });

  it('rejects a signature computed over a tampered body', async () => {
    const sig = await hmacSha256Hex(BODY, SECRET);
    expect(await verifySignature(BODY.replace('evt-1', 'evt-9'), sig, SECRET)).toBe(false);
  });

  it('rejects a truncated signature', async () => {
    const sig = await hmacSha256Hex(BODY, SECRET);
    expect(await verifySignature(BODY, sig.slice(0, 32), SECRET)).toBe(false);
  });

  describe("RevenueCat's documented t=,v1= header", () => {
    // Found 2026-09-26: the dashboard's HMAC signing sends
    // `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex>` over "<t>.<body>".
    // Only the bare-hex shape was accepted, so every real delivery was a 401.
    const T = 1_790_000_000;
    const NOW = T * 1000;
    const header = async (t = T, body = BODY) =>
      `t=${t},v1=${await hmacSha256Hex(`${t}.${body}`, SECRET)}`;

    it('accepts a correct signature inside the window', async () => {
      expect(await verifySignature(BODY, await header(), SECRET, NOW)).toBe(true);
    });

    it('rejects a signature over the body alone, without the timestamp', async () => {
      const bodyOnly = await hmacSha256Hex(BODY, SECRET);
      expect(await verifySignature(BODY, `t=${T},v1=${bodyOnly}`, SECRET, NOW)).toBe(false);
    });

    it('rejects a tampered body', async () => {
      const h = await header();
      expect(await verifySignature(BODY.replace('evt-1', 'evt-9'), h, SECRET, NOW)).toBe(false);
    });

    it('rejects a delivery replayed outside the 5-minute window', async () => {
      expect(await verifySignature(BODY, await header(), SECRET, NOW + 301_000)).toBe(false);
      expect(await verifySignature(BODY, await header(), SECRET, NOW - 301_000)).toBe(false);
    });

    it('rejects a header with no timestamp', async () => {
      const sig = await hmacSha256Hex(`.${BODY}`, SECRET);
      expect(await verifySignature(BODY, `v1=${sig}`, SECRET, NOW)).toBe(false);
    });
  });
});
