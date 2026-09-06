/**
 * The identity spine.
 *
 * ONE id is generated on first launch and used as both the RevenueCat
 * `appUserID` and the OneSignal `external_id`. That single shared value is what
 * lets a Journey target "this player unlocked Deep Sea three days ago and has
 * not opened since" — the targeting reads state that only exists because the
 * two identity graphs are the same graph.
 *
 * It is persisted, not derived from a device identifier: a device id changes on
 * reinstall and would silently orphan the player's purchases.
 *
 * WHY THIS ID IS CRYPTOGRAPHICALLY RANDOM
 *
 * It used to be `Date.now()` plus two slices of `Math.random()`, with a comment
 * arguing it "does not need to be crypto-grade" because RevenueCat holds the
 * authoritative purchase record. That reasoning describes a display handle, and
 * this is not one.
 *
 * The Worker accepts `app_user_id` as the ONLY credential on `/spend-coin`,
 * `/catch-resolved` and `/player/sync`. There is no signature and no session.
 * So whoever can produce another player's id can spend that player's COIN —
 * which makes the id a bearer token, and a bearer token built from a readable
 * clock plus a non-cryptographic PRNG is guessable. `Date.now().toString(36)`
 * is simply the time the app was first opened, and Hermes' `Math.random` is not
 * seeded for unpredictability.
 *
 * That is a real hole under this project's central claim — that the economy
 * cannot be forged. The server-side settlement is genuinely sound: the client
 * cannot mint currency, cannot choose its fish, and cannot replay a catch. None
 * of that helps if the identity authorizing the spend can be derived.
 *
 * Found by CodeQL (js/insecure-randomness) on 2026-09-06 and changed the same
 * day, while `/verify` still reported zero players — so the change orphaned
 * nobody. After the first real tester it would have cost their progress.
 *
 * The right long-term fix is to stop treating the id as a credential at all and
 * sign requests. That is a protocol change; this is the part that was both
 * correct and free today.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const KEY = 'lunker.app_user_id';

function randomId(): string {
  // UUIDv4 from the platform CSPRNG — 122 bits of entropy, no clock component.
  return `angler_${Crypto.randomUUID()}`;
}

export async function getOrCreateAppUserId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) return existing;

  const id = randomId();
  await AsyncStorage.setItem(KEY, id);
  return id;
}
