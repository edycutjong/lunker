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
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'lunker.app_user_id';

function randomId(): string {
  // Not crypto-grade and does not need to be: this is a stable handle, and the
  // authoritative purchase identity is RevenueCat's own record of it.
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `angler_${Date.now().toString(36)}${rand()}${rand()}`;
}

export async function getOrCreateAppUserId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) return existing;

  const id = randomId();
  await AsyncStorage.setItem(KEY, id);
  return id;
}
