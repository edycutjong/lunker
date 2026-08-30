/**
 * RevenueCat REST v2 — the server side of the COIN economy.
 *
 * Virtual Currency grants and spends MUST be initiated server-side over an
 * authenticated channel (SDK docs §8, verbatim). This file is the only place
 * the secret key is used, and it never reaches the client bundle.
 *
 * RevenueCat is the authoritative ledger. The Worker's `vc_transactions` table
 * mirrors what happened here so `/verify` can render a tail without an API
 * round-trip — it is a mirror, never a second source of truth.
 */

const BASE = 'https://api.revenuecat.com/v2';

export interface VcResult {
  /** 200 on success, 422 when RevenueCat refuses for insufficient balance. */
  status: number;
  /** Post-transaction balance when RevenueCat returns one. */
  balance: number | null;
  raw: unknown;
}

export class RevenueCatClient {
  constructor(
    private readonly secretKey: string,
    private readonly projectId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Apply an atomic adjustment to a customer's virtual currencies.
   *
   * `adjustments` is a map of currency code -> signed delta, which is what makes
   * the call atomic: a spend that would overdraw returns 422 and deducts
   * nothing. We never read-then-write, because a read-then-write is exactly the
   * race a determined player exploits by backgrounding the app mid-purchase.
   */
  async adjust(
    appUserId: string,
    adjustments: Record<string, number>,
  ): Promise<VcResult> {
    const url = `${BASE}/projects/${encodeURIComponent(
      this.projectId,
    )}/customers/${encodeURIComponent(appUserId)}/virtual_currencies/transactions`;

    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ adjustments }),
    });

    let raw: unknown = null;
    try {
      raw = await res.json();
    } catch {
      // A 422 with an empty body is still a meaningful 422. Never let a JSON
      // parse failure masquerade as a transport error and trigger a retry that
      // double-grants.
    }

    return { status: res.status, balance: readBalance(raw), raw };
  }

  /** Credit COIN for a landed catch. */
  grantCoins(appUserId: string, amount: number) {
    return this.adjust(appUserId, { COIN: Math.abs(amount) });
  }

  /** Debit COIN for a lake unlock. 422 means "can't afford it yet". */
  spendCoins(appUserId: string, amount: number) {
    return this.adjust(appUserId, { COIN: -Math.abs(amount) });
  }
}

/**
 * Read the post-transaction COIN balance out of a v2 response.
 *
 * Deliberately lenient: v2 is forward-compatible and may add fields without a
 * version bump, so a shape we do not recognise degrades to `null` (the HUD
 * falls back to a fresh `virtualCurrencies()` read on the client) rather than
 * throwing and failing a transaction that actually succeeded.
 */
export function readBalance(raw: unknown): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, any>;

  if (typeof obj.balance === 'number') return obj.balance;

  const candidates = [obj.virtual_currencies, obj.balances, obj.items];
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c)) {
      const coin = c.find(
        (i: any) => i?.code === 'COIN' || i?.currency_code === 'COIN',
      );
      if (coin && typeof coin.balance === 'number') return coin.balance;
    } else if (typeof c === 'object') {
      const coin = c.COIN;
      if (typeof coin === 'number') return coin;
      if (coin && typeof coin.balance === 'number') return coin.balance;
    }
  }
  return null;
}
