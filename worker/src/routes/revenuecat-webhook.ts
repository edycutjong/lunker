/**
 * POST /webhooks/revenuecat
 *
 * HMAC-verified purchase ledger. This is the only record of a purchase that
 * does not originate from the client describing itself, which is what makes
 * `purchase_events` worth showing a judge.
 *
 * RevenueCat retries up to 5x on a non-200 and expects a response within 60s.
 * `event_id` is the table's primary key, so a retry that would otherwise
 * double-count revenue is idempotent for free.
 */

import { verifySignature } from '../lib/webhook.js';
import type { Deps } from '../types.js';
import { json } from '../lib/http.js';

/** Event types that represent money actually moving. */
const LEDGER_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'NON_RENEWING_PURCHASE',
  'RENEWAL',
  'EXPIRATION',
  'CANCELLATION',
  'REFUND',
]);

export async function revenuecatWebhook(req: Request, deps: Deps): Promise<Response> {
  const { db, env, now } = deps;

  // Raw bytes, before any parse. Re-serialising first changes whitespace and
  // key order, and the mismatch that follows looks exactly like a bad secret.
  const raw = await req.text();

  const signature =
    req.headers.get('x-revenuecat-signature') ?? req.headers.get('authorization');

  const ok = await verifySignature(raw, signature, env.REVENUECAT_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'invalid signature' }, 401);

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    // Signature was valid, so this is our bug rather than an attack. A 400
    // stops RevenueCat retrying a body that will never parse.
    return json({ error: 'malformed json' }, 400);
  }

  const event = payload?.event ?? payload;
  const eventId: string | undefined = event?.id;
  const type: string | undefined = event?.type;

  if (!eventId || !type) return json({ error: 'missing event id or type' }, 400);

  // Unknown and non-monetary event types are acknowledged, not stored. v2 is
  // forward-compatible and may introduce types without a version bump; 200 here
  // keeps a future event type from burning five retries.
  if (!LEDGER_EVENTS.has(type)) return json({ ok: true, ignored: type });

  const appUserId: string = event.app_user_id ?? event.original_app_user_id ?? 'unknown';
  const productId: string = event.product_id ?? 'unknown';
  const revenue: number | null =
    typeof event.price_in_purchased_currency === 'number'
      ? event.price_in_purchased_currency
      : typeof event.price === 'number'
        ? event.price
        : null;

  await db
    .prepare(
      'INSERT OR IGNORE INTO purchase_events (event_id, app_user_id, product_id, event_type, revenue_usd, verified_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(eventId, appUserId, productId, type, revenue, now())
    .run();

  return json({ ok: true, event_id: eventId, type });
}
