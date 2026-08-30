# FEEDBACK — DX friction, sent to the sponsors

Kept at repo root and linked from the README's first screen. Written while the
friction was fresh rather than reconstructed at the end, because reconstructed
feedback is always vaguer and always kinder than the real thing.

**Send-by date: 2026-09-20.** Prepared-but-unfired feedback has cost us before;
the fix is a date at creation time, not better intentions.

**Scope of this document, stated up front:** everything below comes from
*integrating the SDKs in code* — reading the docs, pinning versions, and getting
the client and server paths working. The OneSignal app, its Journeys, and the
RevenueCat→OneSignal integration are dashboard configuration that is **not yet
enabled**, so nothing here reports operational experience with them. Where a
point is about the docs rather than a running system, it says so.

---

## RevenueCat

### 1. Virtual Currency is invisible in the SDK version most tutorials pin

**Cost: half a day, and it nearly cost the whole economy design.**

We specified the entire COIN economy against `Purchases.virtualCurrencies()`.
That method does not exist. The real name is `getVirtualCurrencies()`, and
— the part that actually hurt — **it does not exist at all below
`react-native-purchases@10`**. We had pinned `^8.11.0`, which is a perfectly
current-looking version with *no virtual-currency surface whatsoever*.

The failure mode is quiet: `Purchases.getVirtualCurrencies` is simply
`undefined`, so you get a runtime `TypeError` deep in a screen rather than
anything pointing at the version.

**What would have helped:** a "Requires SDK v10+" badge on the Virtual Currency
docs page, the way platform-minimum badges already appear elsewhere. One line
would have saved the day.

### 2. The 422 on insufficient balance is the best part, and it is buried

The atomic `adjustments` map returning 422 with *nothing deducted* is genuinely
excellent — it let us delete an entire read-check-write race from the design.
But it appears as one clause in a paragraph. It deserves its own section with a
worked example, because it is the thing that makes a server-settled currency
safe to build on.

### 3. VC balances and the response shape

`POST /virtual_currencies/transactions` returns a body we ended up parsing
defensively across three plausible shapes, because we could not find a
documented schema for the success response. If the balance is guaranteed to be
present on 200, saying so explicitly would let integrators skip the fallback
path.

---

## OneSignal

### 4. The permission prime is the single highest-value thing in the product, and we nearly missed it

Your own webinar quantifies ~27% and warns that a declined native prompt is
close to irreversible. That is not a tip — for a push-premised app it is the
difference between a product and a broken one. It is currently a paragraph in a
long guide.

**What would have helped:** a prominent callout in the *Mobile Push Setup*
quickstart, at the exact point where the reader is about to call
`requestPermission`. That is where the mistake gets made.

### 5. Custom events vs tags for Journey entry is genuinely confusing in RN

*(Docs feedback — our Journeys are not live yet, so this is about what the
documentation led us to build, not about how it behaved in production.)*

The RN SDK surfaces tags cleanly (`User.addTags`) but the custom-events path
moved between versions, and the docs' examples are REST-first. We settled on
setting tags from the client and firing entry events from our backend — the
backend is the only party that knows what was actually caught or actually paid
for — but we arrived there by trial rather than by reading. A short "client SDK
vs REST: which one for Journey entry?" table would have resolved it in a
minute.

### 6. `collapse_id` + `ttl` for expiring notifications deserves a named pattern

Our whole mechanic is a notification that becomes a lie after 60 seconds. The
combination that solves it (`ttl: 60` plus a per-user `collapse_id`) is two
separate reference entries. "Time-sensitive notifications" as a documented
pattern would be broadly useful — anything with a countdown, a queue position,
or a live event needs exactly this.

---

## Both

### 7. The RevenueCat → OneSignal integration is the best thing neither doc leads with

*(Discoverability feedback. We designed the win-back Journey around this and it
is why our schema stores `EXPIRATION` events — but the integration is dashboard
config we have not switched on yet, so we cannot report on it running.)*

Forwarding `trial_started` / `expiration` and `entitlement_ids` onto the
OneSignal user is the difference between a win-back Journey that branches on
real subscription state and one that guesses. It looks like the highest-leverage
integration available to an app that uses both products — and we found it late,
in an integrations index, rather than in either product's Journey or
re-engagement guide. Both sides would benefit from linking to it from the place
people actually plan re-engagement.
