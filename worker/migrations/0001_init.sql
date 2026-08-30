-- Lunker — D1 schema.
--
-- Every table here is read by either GET /verify or `lunker-verify.mjs bench`.
-- There is no table that exists only to exist.
--
-- Deliberately NOT stored: raw device tokens (OneSignal holds those) and COIN
-- balances (RevenueCat holds those). Caching a balance locally would create a
-- second source of truth for the exact number the "server-settled" claim rests
-- on, and the two would drift.

-- Every bite push we send. Written at send time, BEFORE the push leaves.
-- This is also the validity gate for the killer number: a telemetry ping whose
-- notification_id is not in here is fabricated and gets 404'd.
CREATE TABLE IF NOT EXISTS sent (
  notification_id TEXT PRIMARY KEY,      -- uuid, also carried in the OneSignal payload
  app_user_id     TEXT NOT NULL,         -- == RevenueCat appUserID == OneSignal external_id
  lake_id         TEXT NOT NULL,         -- willow | reeds | quarry | deepsea
  roll_seed       TEXT NOT NULL,         -- HMAC(notification_id, ROLL_SERVER_SECRET); the fish roll
  sent_at         INTEGER NOT NULL       -- epoch ms, server clock
);
CREATE INDEX IF NOT EXISTS idx_sent_user_time ON sent(app_user_id, sent_at);

-- One row per bite, inserted at send time with opened_at NULL.
-- Inserting at SEND time (not at open time) is what keeps unanswered bites in
-- the denominator. If the row only appeared on open, the killer number would
-- silently become "of the bites that were answered, how many were answered",
-- which is 100% by construction.
CREATE TABLE IF NOT EXISTS bite_telemetry (
  notification_id TEXT PRIMARY KEY REFERENCES sent(notification_id),
  opened_at       INTEGER,               -- epoch ms, client clock; NULL if unanswered
  latency_ms      INTEGER,               -- opened_at - sent_at; NULL if unanswered or clock-skewed
  clock_skew      INTEGER NOT NULL DEFAULT 0,  -- 1 when opened_at < sent_at: flagged, NOT clamped
  resolved        TEXT                   -- landed | escaped | NULL (opened but never finished)
);

-- HMAC-verified purchases. Independent of anything the client says about itself.
-- event_id as the primary key makes the webhook idempotent for free: RevenueCat
-- retries on non-200, and a retry that double-counted revenue would corrupt the
-- one ledger a judge is invited to inspect.
CREATE TABLE IF NOT EXISTS purchase_events (
  event_id    TEXT PRIMARY KEY,          -- RevenueCat event id
  app_user_id TEXT NOT NULL,
  product_id  TEXT NOT NULL,             -- coins_500 | coins_1600 | coins_6000 | anglers_pass
  event_type  TEXT NOT NULL,             -- INITIAL_PURCHASE | NON_RENEWING_PURCHASE | EXPIRATION | ...
  revenue_usd REAL,
  verified_at INTEGER NOT NULL
);

-- Every COIN movement, mirrored from the RevenueCat VC REST call that is the
-- real ledger. RevenueCat is authoritative; this exists so /verify can render a
-- tail without an API round-trip.
CREATE TABLE IF NOT EXISTS vc_transactions (
  idempotency_key TEXT PRIMARY KEY,      -- client-supplied; makes retry-once safe
  app_user_id     TEXT NOT NULL,
  delta           INTEGER NOT NULL,      -- +120 grant, -1200 spend
  reason          TEXT NOT NULL,         -- catch | lake_unlock
  rc_status       INTEGER NOT NULL,      -- 200 | 422 (insufficient balance)
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vc_user_time ON vc_transactions(app_user_id, created_at);

-- Who to send a bite to, and when it is their turn.
--
-- Added during Phase 1: architecture.md's original four tables had no answer to
-- "which players are due a bite", and the scheduled dispatcher cannot invent
-- one. Balances and push tokens still live upstream — this table holds only
-- targeting state.
CREATE TABLE IF NOT EXISTS players (
  app_user_id     TEXT PRIMARY KEY,      -- == RC appUserID == OneSignal external_id
  current_lake    TEXT NOT NULL DEFAULT 'willow',
  unlocked_lakes  TEXT NOT NULL DEFAULT 'willow,reeds',  -- csv
  streak_days     INTEGER NOT NULL DEFAULT 0,
  push_enabled    INTEGER NOT NULL DEFAULT 0,
  tz_offset_min   INTEGER NOT NULL DEFAULT 0,
  last_bite_at    INTEGER,
  last_active_at  INTEGER,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_due ON players(push_enabled, last_bite_at);
