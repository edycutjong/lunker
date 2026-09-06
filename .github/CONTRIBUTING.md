# Contributing to Lunker

Thanks for looking. Lunker is a cozy fishing game where the push notification
*is* the game — a bite arrives, you have sixty seconds, and the economy is
settled on a server you do not control.

That last part shapes everything below: **the client is never allowed to name
its own catch or move its own balance.** A change that adds a local coin
increment, or accepts a `fish` field from the app, is not a feature — it is the
one bug that would make the whole project not worth believing.

## Layout

| Path | What it is |
|---|---|
| `worker/` | Cloudflare Worker (TypeScript) — the only backend. Holds every secret. D1 + a cron `scheduled` handler. |
| `app/` | Expo / React Native app (Android). No paywall UI of its own — RevenueCat renders it. |
| `shared/` | Plain ESM imported unchanged by the Worker, the app *and* the CLIs. The content seed and the bench arithmetic live here. |
| `scripts/` | Three Node ESM CLIs: seed, verify/bench, submission readiness. |
| `tests/` | Vitest. 234 tests across 10 files, run from the repo root. |

## Getting set up

```sh
# Root — tests, lint, bench, seed. Node 22.5+ (the suite uses node:sqlite).
npm install
npm test

# Worker
cd worker && npm install
npx wrangler d1 migrations apply lunker --local
npx wrangler dev            # / is the landing page, /verify is the ledger

# App (Expo SDK 53 needs the legacy peer resolver)
cd app && npm install --legacy-peer-deps
npx expo run:android
```

Copy `.env.example` for reference, but **never put a secret in this repo**. The
Worker reads its four secrets from `wrangler secret put`, and `.gitleaks.toml`
is configured to fail CI if any of them ever appears in a commit — including in
history, which is what matters when the repo goes public.

## Before you open a PR

```sh
npm run ci          # prettier --check, eslint, 234 tests
npm run typecheck   # tsc --noEmit for the Worker and the app
npm run secrets     # gitleaks, if you have it installed locally
```

Three project-specific rules the CI enforces and a reviewer will ask about:

1. **The seed and the fixture are byte-compared.** `npm run seed` and
   `npm run seed:anomalies` must regenerate `seed/` with no diff. If your change
   moves those bytes, a published rarity rate or the documented bench output has
   changed and that belongs in the PR description.
2. **The bench output is asserted literally**, down to
   `17 / 39  (43.6%)`. It is not a smoke test — it is the arithmetic behind the
   one number the project leads with.
3. **Name a regression test after the defect it pins.** `test('a replayed catch
   calls RevenueCat exactly once')` tells a reader what went wrong once;
   `test('catch 3')` does not.

Route tests run against real SQLite executing the real migration. Please keep it
that way — a hand-written mock will happily agree with a bug in an `ON CONFLICT`
clause.

## Commits and PRs

Conventional prefixes (`feat:`, `fix:`, `docs:`, `chore:`, `test:`). Small,
reviewable commits: the history of this repo is part of what is being judged.

## Reporting things

Bugs and features use the issue templates. **Security issues do not** — see
[SECURITY.md](SECURITY.md) and report privately.
