# Security Policy

## Reporting a vulnerability

**Please do not open a public issue.** Report privately, either way:

- GitHub → **Security → Report a vulnerability**
  ([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability))
- Email **edy.cu@live.com**

Acknowledgement within 48 hours, and a triage outcome with a timeline after
that. Please allow a reasonable window to patch before public disclosure.

| Version | Supported |
| --- | --- |
| `main` | ✅ |

## What is actually at risk

Four secrets back this project. None of them is in this repository, and none of
them is ever in the app bundle.

| Secret | Where it lives | What it can do if leaked |
| --- | --- | --- |
| `REVENUECAT_SECRET_KEY` | `wrangler secret put` | Grant and spend virtual currency for any customer |
| `REVENUECAT_WEBHOOK_SECRET` | `wrangler secret put` | Forge entries in the purchase ledger `/verify` reads from |
| `ONESIGNAL_REST_API_KEY` | `wrangler secret put` | Push to every installed device |
| `ROLL_SERVER_SECRET` | `wrangler secret put` | Derive any bite's roll seed — compute the fish before the push is opened |

The Cloudflare Worker is the only component that ever holds any of them. The
Android app holds the RevenueCat *public* SDK key and the OneSignal *app id*,
both of which are public by design.

## The security claims, and the tests that pin them

These are assertions backed by tests in `tests/routes.test.js`, not paragraphs.
Each runs against real SQLite executing the real migration.

**The client cannot name its own catch.** `POST /catch-resolved` takes no `fish`
field; the server rolls against the lake's committed weight table using a seed
derived from `HMAC-SHA256(notification_id, ROLL_SERVER_SECRET)` and written to
the `sent` table before the push leaves.
→ *"ignores a client-supplied fish entirely — the server rolls"*,
*"returns the same fish on replay, not a fresh roll"*

**The client cannot move its own balance.** Every grant and spend is a
server-side RevenueCat REST v2 virtual-currency transaction. A spend that would
overdraw returns 422 and deducts nothing — there is no read-then-write to race.
→ *"grants COIN through the RevenueCat VC REST API, server-side"*,
*"surfaces a 422 as the honest 'cannot afford' state, not a dead tap"*,
*"reports settled:false rather than faking success when RevenueCat errors"*

**Replays cannot double-spend.** Every mutating route is idempotent on a stable
key, so the client's single transport retry is safe.
→ *"is idempotent: a replayed win never grants twice"*, *"never double-charges on
a retry"*, *"is idempotent on RevenueCat retries"*

**Permission boundaries hold.** One player cannot answer another player's bite,
and a notification id that was never sent does not exist.
→ *"403s an attempt to answer another player bite"*,
*"404s a notification we have no record of sending"*,
*"404s a notification id that was never sent"*

**The purchase ledger only accepts signed writes.** The webhook HMAC is verified
over the raw body bytes before any parse.
→ *"401s an unsigned request"*, *"401s a request signed with the wrong secret"*

**The demo trigger is off in production.** `POST /dev/cast` exists so a demo
video does not have to wait an unknown number of minutes for Android push
delivery. It is gated by `DEV_CAST_ENABLED`, which is `0` in `wrangler.toml`, and
it can only trigger the *timing* — the roll is live either way.
→ *"is 404 in production, where DEV_CAST_ENABLED is 0"*,
*"discloses that only the timing was triggered, never the roll"*

**The headline metric cannot be inflated by a stranger.** `POST /bite-opened`
rejects any `notification_id` not present in the `sent` log, so nobody with the
URL can manufacture answered bites. Clock skew is flagged and excluded from
latency, never clamped to zero.
→ *"flags clock skew instead of clamping a negative latency to zero"*,
*"keeps the first open when Android redelivers the same notification"*

## Automated scanning

| Layer | Tool | Where |
| --- | --- | --- |
| Secrets, full git history | gitleaks + project rules for all four secrets | `.github/workflows/security.yml`, `.gitleaks.toml` |
| Secrets, working tree | gitleaks `--no-git` | same workflow |
| SAST | CodeQL, `javascript-typescript`, `security-and-quality` | `.github/workflows/codeql.yml` |
| Dependency CVEs | `npm audit` across all three manifests | `.github/workflows/security.yml` |
| Dependency updates | Dependabot, grouped, no majors | `.github/dependabot.yml` |
| Licences | `license-checker` over the app's runtime tree | `.github/workflows/security.yml` |

The gitleaks job clones with `fetch-depth: 0` on purpose. This repository is
private during development and public at submission, and the whole history goes
public with it — a key deleted in a later commit is still a key that ships.

### Known accepted risk

`npm audit` reports `high` findings in the app tree for `metro`, `postcss` and
`image-size`. All are reached through `react-native` and all are part of the
Expo bundler that runs on a developer machine at build time; none is present in
the shipped APK. They are pinned by `expo ~53` and the only remedy is an SDK
major upgrade. The app job therefore gates at `critical` (currently zero) and
prints the full `high` report to the run summary rather than hiding it.
