/**
 * Worker client.
 *
 * Every currency movement goes through here. The app has no code path that
 * changes a balance locally, which is why the balance on screen is worth
 * believing.
 */

import Constants from 'expo-constants';

const BASE: string =
  (Constants.expoConfig?.extra as any)?.workerUrl ?? 'https://lunker.workers.dev';

export interface CatchResult {
  fish_id: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  mass_kg: number;
  coins: number;
}

export interface CatchResponse {
  outcome: 'landed' | 'escaped';
  catch: CatchResult | null;
  balance: number | null;
  settled?: boolean;
  replayed?: boolean;
}

export interface SpendResponse {
  unlocked: boolean;
  lake_id: string;
  cost: number;
  balance: number | null;
  reason?: 'insufficient_coin' | 'upstream_error';
}

async function post<T>(path: string, body: unknown, { retry = true } = {}): Promise<T> {
  const send = () =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  let res: Response;
  try {
    res = await send();
  } catch (err) {
    // Retry exactly once on a transport failure. The server side of every
    // mutating route is idempotent on a stable key, so a retry that arrives
    // twice cannot double-grant or double-charge.
    if (!retry) throw err;
    res = await send();
  }

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`unreadable response from ${path} (${res.status})`);
  }

  if (!res.ok && res.status !== 422) {
    throw Object.assign(new Error(json?.error ?? `${path} failed (${res.status})`), {
      status: res.status,
      body: json,
    });
  }
  return json as T;
}

/**
 * Report a finished bite. The body says only that we won — never what we
 * caught. The server rolls the fish and returns it.
 */
export function reportCatch(input: {
  app_user_id: string;
  lake_id: string;
  notification_id: string;
  outcome: 'win' | 'loss';
}): Promise<CatchResponse> {
  return post<CatchResponse>('/catch-resolved', {
    ...input,
    idempotency_key: `catch:${input.notification_id}`,
  });
}

/** Atomic COIN spend for a coin-gated lake. A 422 is a real answer, not an error. */
export function spendCoin(input: { app_user_id: string; lake_id: string }): Promise<SpendResponse> {
  return post<SpendResponse>('/spend-coin', {
    ...input,
    idempotency_key: `unlock:${input.app_user_id}:${input.lake_id}`,
  });
}

/**
 * Telemetry for the killer number. Fire-and-forget: a dropped ping costs us a
 * data point, but blocking the player's 60 seconds on a network call would cost
 * them the fish.
 */
export function reportBiteOpened(notificationId: string): void {
  post('/bite-opened', { notification_id: notificationId, opened_at: Date.now() }).catch(() => {});
}

export interface SyncResponse {
  ok: boolean;
  current_lake: string;
  unlocked_lakes: string[];
  /** Computed server-side. The client never declares its own streak. */
  streak_days: number;
}

/**
 * Announce targeting state so the dispatcher knows who is due a bite.
 *
 * Returns the server's view, which is authoritative for two things the client
 * must not decide for itself: the streak, and the merged set of unlocked lakes
 * (a reinstalled client must not be able to erase a lake it already paid for).
 * Resolves to null on failure — a missed sync costs targeting freshness, never
 * the session.
 */
export function syncPlayer(input: {
  app_user_id: string;
  current_lake: string;
  unlocked_lakes: string[];
  push_enabled: boolean;
}): Promise<SyncResponse | null> {
  return post<SyncResponse>('/player/sync', {
    ...input,
    // getTimezoneOffset is minutes BEHIND UTC; the server wants minutes ahead.
    tz_offset_min: -new Date().getTimezoneOffset(),
  }).catch(() => null);
}

export const workerUrl = BASE;
