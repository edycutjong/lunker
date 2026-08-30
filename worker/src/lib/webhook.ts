/**
 * RevenueCat webhook signature verification.
 *
 * The webhook is not optional. Without it, the only evidence a purchase
 * happened is the client's own report of itself — and `purchase_events` is the
 * same table `/verify` and `lunker-verify.mjs` read from, so a client-trusted
 * ledger would make the one artifact we invite a judge to inspect worthless.
 *
 * The HMAC is computed over the RAW body bytes, before any JSON parse. Parsing
 * and re-serialising first would change whitespace and key order and break
 * verification for reasons that look like a signature mismatch.
 */

const enc = new TextEncoder();

/**
 * @returns lowercase hex HMAC-SHA256
 */
export async function hmacSha256Hex(raw: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(raw));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Length-independent, value-constant-time comparison.
 *
 * A plain `===` on the hex leaks position-of-first-difference through timing.
 * That is a real (if slow) forgery oracle against the ledger a judge is
 * invited to read, and avoiding it costs four lines.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a RevenueCat webhook.
 *
 * Accepts the signature bare or prefixed (`sha256=…`), because the dashboard's
 * own examples have shipped both shapes.
 */
export async function verifySignature(
  rawBody: string,
  headerValue: string | null,
  secret: string,
): Promise<boolean> {
  if (!headerValue || !secret) return false;
  const provided = headerValue.trim().replace(/^sha256=/i, '').toLowerCase();
  const expected = await hmacSha256Hex(rawBody, secret);
  return timingSafeEqual(provided, expected);
}
