/**
 * Local persistence for the things that must survive a relaunch.
 *
 * Two of them, and both were real bugs before this file existed:
 *
 *  - **The album.** Best Game scores progression and collection. An album held
 *    in React state is an album the player loses every time Android reclaims
 *    the process — and `rare_count`, which a Journey branches on, would reset
 *    to zero with it.
 *  - **Unlocked lakes.** A relaunch used to boot with only the free lakes and
 *    immediately push that state to the server, so a player who had PAID 1,200
 *    COIN for Quarry saw it locked and priced again. No money was actually lost
 *    (the spend is idempotent), but "the thing I bought is gone" is the worst
 *    possible first impression of an economy.
 *
 * This is a cache of local progress, never of currency. COIN balances are not
 * stored here and never will be — RevenueCat is the only source of truth for a
 * balance, and a cached balance would be a second one.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const ALBUM_KEY = 'lunker.album.v1';
const LAKES_KEY = 'lunker.unlocked_lakes.v1';

export interface StoredCatch {
  fish_id: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  mass_kg: number;
  caught_at: number;
}

/** Cap the persisted album so storage cannot grow without bound. */
const MAX_ALBUM = 200;

export async function loadAlbum(): Promise<StoredCatch[]> {
  try {
    const raw = await AsyncStorage.getItem(ALBUM_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt storage must not brick the app on launch. An empty album is
    // recoverable; a crash loop is not.
    return [];
  }
}

export async function saveAlbum(album: StoredCatch[]): Promise<void> {
  try {
    await AsyncStorage.setItem(ALBUM_KEY, JSON.stringify(album.slice(0, MAX_ALBUM)));
  } catch {
    /* a failed write costs one catch card, never the session */
  }
}

export async function loadUnlockedLakes(fallback: string[]): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(LAKES_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    // The free lakes are always present, whatever storage says.
    return Array.from(new Set([...fallback, ...parsed.filter((l) => typeof l === 'string')]));
  } catch {
    return fallback;
  }
}

export async function saveUnlockedLakes(lakes: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(LAKES_KEY, JSON.stringify(lakes));
  } catch {
    /* the server's `players.unlocked_lakes` is the backstop */
  }
}
