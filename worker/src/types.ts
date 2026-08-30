export interface Env {
  DB: D1Database;

  /** RevenueCat V2 secret key (sk_…). Server-only, never shipped to the client. */
  REVENUECAT_SECRET_KEY: string;
  /** RevenueCat project id the VC transactions are scoped to. */
  REVENUECAT_PROJECT_ID: string;
  /** Shared secret RevenueCat signs webhook bodies with. */
  REVENUECAT_WEBHOOK_SECRET: string;

  /** OneSignal App API Key — `authorization: Key …` on REST sends. */
  ONESIGNAL_REST_API_KEY: string;
  ONESIGNAL_APP_ID: string;

  /** HMAC secret the fish roll is seeded from. Rotating it re-rolls the future, never the past. */
  ROLL_SERVER_SECRET: string;

  /** Set to "1" to expose POST /dev/cast, the on-demand bite trigger used for recording. */
  DEV_CAST_ENABLED?: string;
}

export interface CatchResult {
  fish_id: string;
  name: string;
  rarity: string;
  mass_kg: number;
  coins: number;
}

/** Everything a route needs, injected so handlers stay testable without miniflare. */
export interface Deps {
  db: D1Database;
  env: Env;
  now: () => number;
}
