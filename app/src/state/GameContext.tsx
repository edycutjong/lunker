/**
 * Game state.
 *
 * The one invariant worth stating: `coinBalance` is only ever assigned from a
 * RevenueCat read or a server response. There is no `setCoinBalance(b => b + n)`
 * anywhere in this app, because a local increment would make the HUD a
 * different number from the ledger, and the ledger is the thing we invite a
 * judge to check.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { CustomerInfo } from 'react-native-purchases';

import { LAKES, getLake, type Lake } from '../../../shared/content.js';
import * as RC from '../lib/purchases';
import * as OS from '../lib/onesignal';
import * as api from '../lib/api';
import { getOrCreateAppUserId } from '../lib/identity';
import { loadAlbum, saveAlbum, loadUnlockedLakes, saveUnlockedLakes } from '../lib/storage';

export interface AlbumEntry {
  fish_id: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary';
  mass_kg: number;
  caught_at: number;
}

interface GameState {
  ready: boolean;
  appUserId: string | null;
  coinBalance: number | null;
  customerInfo: CustomerInfo | null;
  hasPass: boolean;
  unlockedLakes: string[];
  currentLake: string;
  album: AlbumEntry[];
  streakDays: number;
  pushEnabled: boolean;
  /** Set when the player declined push — the UI says so plainly rather than pretending. */
  pushDeclined: boolean;
}

interface GameApi extends GameState {
  refreshBalance: (opts?: { fresh?: boolean }) => Promise<void>;
  refreshCustomerInfo: () => Promise<void>;
  recordCatch: (entry: AlbumEntry) => void;
  setCurrentLake: (lakeId: string) => void;
  unlockLake: (lakeId: string) => void;
  markPushEnabled: (enabled: boolean) => void;
  primeAndRequestPush: () => Promise<void>;
}

const Ctx = createContext<GameApi | null>(null);

const FREE_LAKES = LAKES.filter((l: Lake) => l.unlock.type === 'free').map((l: Lake) => l.id);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GameState>({
    ready: false,
    appUserId: null,
    coinBalance: null,
    customerInfo: null,
    hasPass: false,
    unlockedLakes: FREE_LAKES,
    currentLake: 'willow',
    album: [],
    streakDays: 0,
    pushEnabled: false,
    pushDeclined: false,
  });

  /** Has the permission prime already been shown? It fires once, after the first catch. */
  const primed = useRef(false);

  const refreshBalance = useCallback(async (opts: { fresh?: boolean } = {}) => {
    try {
      const balance = await RC.readCoinBalance({ fresh: opts.fresh ?? false });
      setState((s) => ({ ...s, coinBalance: balance }));
    } catch {
      // Leave the last known balance on screen rather than flashing a zero the
      // player does not have.
    }
  }, []);

  const refreshCustomerInfo = useCallback(async () => {
    try {
      const info = await RC.getCustomerInfo();
      setState((s) => ({ ...s, customerInfo: info, hasPass: RC.hasAnglersPass(info) }));
    } catch {
      /* keep the previous entitlement state */
    }
  }, []);

  // --- boot ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const appUserId = await getOrCreateAppUserId();

      // Hydrate persisted progress FIRST. Syncing before this would push a
      // freshly-booted "only the free lakes" state at the server and overwrite
      // its record of a lake the player already paid for.
      const [album, unlockedLakes] = await Promise.all([
        loadAlbum(),
        loadUnlockedLakes(FREE_LAKES),
      ]);

      // Both SDKs get the SAME id. This is the identity spine.
      await RC.configurePurchases(process.env.EXPO_PUBLIC_RC_ANDROID_KEY ?? '', appUserId);
      const info = await RC.loginPurchases(appUserId);
      OS.initOneSignal(process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? '', appUserId);

      const pushEnabled = OS.hasPushPermission();
      const balance = await RC.readCoinBalance({ fresh: true }).catch(() => null);

      if (cancelled) return;
      setState((s) => ({
        ...s,
        ready: true,
        appUserId,
        customerInfo: info,
        hasPass: RC.hasAnglersPass(info),
        coinBalance: balance,
        pushEnabled,
        album,
        unlockedLakes,
      }));

      // The server owns the streak and returns the merged unlock set, so this
      // is also how the client learns both.
      void api
        .syncPlayer({
          app_user_id: appUserId,
          current_lake: 'willow',
          unlocked_lakes: unlockedLakes,
          push_enabled: pushEnabled,
        })
        .then((res) => {
          if (cancelled || !res) return;
          setState((s) => ({
            ...s,
            streakDays: res.streak_days ?? s.streakDays,
            unlockedLakes: res.unlocked_lakes ?? s.unlockedLakes,
          }));
          if (res.unlocked_lakes) void saveUnlockedLakes(res.unlocked_lakes);
        });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Entitlements can change without us asking — a trial converting, a
  // subscription lapsing. Deep Sea has to lock itself in that case.
  useEffect(
    () =>
      RC.onCustomerInfoChanged((info) => {
        setState((s) => ({ ...s, customerInfo: info, hasPass: RC.hasAnglersPass(info) }));
      }),
    [],
  );

  // Re-read the balance whenever the app comes back to the foreground: a coin
  // pack bought on another device, or a server grant, changed it while we slept.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshBalance({ fresh: true });
    });
    return () => sub.remove();
  }, [refreshBalance]);

  const api_: GameApi = useMemo(
    () => ({
      ...state,

      refreshBalance,
      refreshCustomerInfo,

      recordCatch(entry) {
        setState((s) => {
          const album = [entry, ...s.album];
          void saveAlbum(album);
          OS.syncTags({
            current_lake: s.currentLake,
            streak_days: s.streakDays,
            unlocked_count: s.unlockedLakes.length,
            rare_count: album.filter((a) => a.rarity === 'rare' || a.rarity === 'legendary').length,
          });
          return { ...s, album };
        });
      },

      setCurrentLake(lakeId) {
        if (!getLake(lakeId)) return;
        setState((s) => {
          if (s.appUserId) {
            api.syncPlayer({
              app_user_id: s.appUserId,
              current_lake: lakeId,
              unlocked_lakes: s.unlockedLakes,
              push_enabled: s.pushEnabled,
            });
          }
          return { ...s, currentLake: lakeId };
        });
      },

      unlockLake(lakeId) {
        setState((s) => {
          if (s.unlockedLakes.includes(lakeId)) return s;
          const unlockedLakes = [...s.unlockedLakes, lakeId];
          void saveUnlockedLakes(unlockedLakes);
          if (s.appUserId) {
            api.syncPlayer({
              app_user_id: s.appUserId,
              current_lake: lakeId,
              unlocked_lakes: unlockedLakes,
              push_enabled: s.pushEnabled,
            });
          }
          return { ...s, unlockedLakes, currentLake: lakeId };
        });
      },

      markPushEnabled(enabled) {
        setState((s) => ({ ...s, pushEnabled: enabled, pushDeclined: !enabled && primed.current }));
      },

      /**
       * The prime, then the native prompt — in that order, once, after the first
       * landed catch. Asking on cold start is how a push-premised game gets
       * permanently muted before it has shown anyone why it deserves the slot.
       */
      async primeAndRequestPush() {
        if (primed.current || OS.hasPushPermission()) return;
        primed.current = true;

        OS.triggerPermissionPrime();
        const granted = await OS.requestPushPermission();
        OS.clearPermissionPrime();

        setState((s) => {
          if (s.appUserId) {
            api.syncPlayer({
              app_user_id: s.appUserId,
              current_lake: s.currentLake,
              unlocked_lakes: s.unlockedLakes,
              push_enabled: granted,
            });
          }
          return { ...s, pushEnabled: granted, pushDeclined: !granted };
        });
      },
    }),
    [state, refreshBalance, refreshCustomerInfo],
  );

  return <Ctx.Provider value={api_}>{children}</Ctx.Provider>;
}

export function useGame(): GameApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useGame must be used inside GameProvider');
  return ctx;
}
