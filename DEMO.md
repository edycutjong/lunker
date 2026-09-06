# DEMO — reproduce every number we publish

Two claims live in this repo, and they are different kinds of claim. This file
keeps them separate on purpose, because conflating them is the failure mode
that makes an honest submission look dishonest.

| | Claim | Source | Submittable? |
|---|---|---|---|
| **A** | "X% of bite pushes answered within 60s" | real closed-testing telemetry | **yes — this is the headline** |
| **B** | the bench arithmetic is correct | the E1–E4 fixture | **never.** Validation only. |

---

## A. The headline number — real telemetry

```sh
node scripts/lunker-verify.mjs bench --source remote --url https://lunker.edycu.workers.dev
```

Expected shape (values are whatever the ledger actually holds):

```
Source: live ledger https://lunker.edycu.workers.dev
Rows ingested:              <n>
Answered within window:     <a> / <d>  (<pct>%)
Open latency (ms):          p50=<..>  p95=<..>  max=<..>   (n=<..>)
Duplicate notification_ids collapsed: <..>
Clock-skew rows excluded from latency: <..>  (flagged, retained in denominator)
Fabricated ids rejected:    <..>   (not in `sent` log)
Never-opened (denominator only): <..>
```

The same computation, rendered for a judge with nothing installed:
**https://lunker.edycu.workers.dev/verify** — it imports `computeBench` from
[`shared/bench.js`](shared/bench.js), which is the same function this CLI runs.
The page and this output cannot disagree.

### What the number means, stated against itself

- **Measured from send, not from open.** Anchoring at open would make it ~100%
  by construction and would falsify the product claim that the push *is* the
  timer. Doze and OEM delivery delay therefore appear in p50/p95 rather than
  being defined away.
- **Unanswered bites are in the denominator.** The telemetry row is written at
  send time with a null open. Ignoring a bite counts against us.
- **Report the real N.** If closed testing is thin, we publish "47 bites across
  12 testers over 9 days" rather than a rounder number with a bigger N. A small
  honest N outscores a large synthetic one.

### Honest limitations

1. Android push delivery is not instantaneous and not uniform across OEMs. That
   is *in* the p95, deliberately.
2. `opened_at` is the client's clock. Rows where it precedes `sent_at` are
   flagged and excluded from latency, and **kept in the denominator**.
3. Testers know they are testing. This inflates the answer rate versus a cold
   audience, and we have no way to correct for it — so we say it.

---

## B. The fixture — proves the arithmetic, never the product

```sh
node scripts/lunker-verify.mjs bench --source fixture \
    --file seed/telemetry-anomalies.json --window-sec 60
```

Exact expected output, asserted in CI:

```
Source: fixture seed/telemetry-anomalies.json  (VALIDATION DATA — NOT SUBMITTABLE)
Rows ingested:              45
Answered within window:     17 / 39  (43.6%)
Open latency (ms):          p50=9,000  p95=104,000  max=118,000   (n=23)
Duplicate notification_ids collapsed: 3   (6 rows -> 3 ids)
Clock-skew rows excluded from latency: 4  (flagged, retained in denominator)
Fabricated ids rejected:    3   (not in `sent` log)
Never-opened (denominator only): 12
```

The arithmetic, so you can check it by hand:

- rows ingested: `20 + 6 + 4 + 12 + 3` = **45**
- E4 fabricated, rejected outright: **3** → reach no counter
- unique ids present in `sent`: `20 + 3 + 4 + 12` = **39** ← denominator
- answered within 60s: `14` ordinary `+ 3` (E1 after collapse) = **17** ← numerator
- **17 / 39 = 43.6%**
- 23 latency-bearing rows → p50 = 12th = **9,000** · p95 = 22nd = **104,000**

| Case | What it is | Correct behaviour | The bias it prevents |
|---|---|---|---|
| **E1** | 3 ids delivered twice | collapse to 3, keep earliest open | double-counted opens inflate the % |
| **E2** | 4 rows, `opened_at < sent_at` | flag; drop from numerator and latency; **keep in denominator**; never clamp | clamping to 0 silently promotes them into the numerator |
| **E3** | 12 never opened | denominator only | deleting them turns 43.6% into **63.0%** |
| **E4** | 3 ids never sent | reject at ingest | anyone with the URL could inflate the headline |

Each row of that table has a matching test asserting the bias, not just the
rule — see [`tests/bench.test.js`](tests/bench.test.js), *"the biases the rules
exist to prevent"*.

The `VALIDATION DATA — NOT SUBMITTABLE` banner prints unconditionally on this
path and is part of the CI-asserted output. A number that can be screenshotted
without its provenance is a number that eventually gets pasted into a
submission.

---

## The video, and what was staged

The demo video shows a real device, a real push and a real purchase. One thing
in it is triggered rather than waited for, and the video says so on screen:

- **The bite TIMING is triggered on cue** via `POST /dev/cast` (disabled in
  production). Android push delivery is non-deterministic and a single take
  cannot wait an unknown number of minutes.
- **The CATCH is a live roll.** The fish is rolled server-side against Willow's
  committed table — Moonlight Koi at 3.5%, any Rare at 4.0%. Nothing about the
  outcome is scripted. `P(≥1 Rare in 60 casts) = 91.4%`, which is why one
  recording session is enough without touching the odds.

Those are two different claims and collapsing them into "the demo was staged"
would be wrong in one direction and "everything was live" would be wrong in the
other.

---

## Other commands

```sh
node scripts/lunker-verify.mjs ledger:tail --url https://lunker.edycu.workers.dev
node scripts/lunker-verify.mjs vc:balance --user <app_user_id>
node scripts/lunker-verify.mjs webhook:verify --file body.json --signature <hex>
node scripts/lunker-verify.mjs seed:anomalies
```

## Full check

```sh
npm install
npm test                                    # 223 tests
npm run seed && git diff --exit-code seed/content            # deterministic
npm run seed:anomalies && git diff --exit-code seed/         # deterministic
npm run bench                               # the block above, exactly
npm run readiness                           # fails while any unfilled placeholder survives
```
