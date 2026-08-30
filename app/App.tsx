/**
 * Lunker.
 *
 * The whole app is one loop, so the navigation is one switch rather than a
 * router: bite -> minigame -> catch -> water -> shop. Five surfaces, four of
 * them drawn here and the fifth drawn by Android on the lock screen.
 *
 * The deep link is the important part of this file. `lunker://bite/<lake>?nid=`
 * has to land directly in the minigame, both from a cold start and from a warm
 * one. If it landed on the home screen, the seconds the push promised would be
 * spent on navigation — which would make the product claim false.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';

import { GameProvider, useGame } from './src/state/GameContext';
import { MinigameScreen } from './src/screens/MinigameScreen';
import { CatchScreen } from './src/screens/CatchScreen';
import { LakeMapScreen } from './src/screens/LakeMapScreen';
import { ShopScreen } from './src/screens/ShopScreen';
import * as OS from './src/lib/onesignal';
import type { CatchResponse } from './src/lib/api';
import { color } from './src/theme/tokens';

type Screen =
  | { name: 'water' }
  | { name: 'shop' }
  | { name: 'minigame'; lakeId: string; notificationId: string | null }
  | { name: 'catch'; outcome: 'landed' | 'escaped'; response: CatchResponse | null };

/**
 * Parse `lunker://bite/<lakeId>?nid=<notificationId>`.
 *
 * Exported for the test suite: a deep link that silently fails to parse would
 * turn every answered bite into a home-screen landing, and it would do it
 * quietly.
 */
export function parseBiteLink(url: string): { lakeId: string; notificationId: string } | null {
  // Hand-parsed rather than routed through expo-linking so the rule can be
  // unit-tested in plain Node. A deep link that silently stops matching is a
  // bug that shows up as "the notification just opens the home screen", which
  // is exactly the failure nobody notices until it is on camera.
  const match = /^lunker:\/\/bite\/([A-Za-z0-9_-]+)(\?.*)?$/.exec(url.trim());
  if (!match) return null;

  const query = match[2] ?? '';
  const nid = /[?&]nid=([^&#]+)/.exec(query)?.[1];
  if (!nid) return null;

  return { lakeId: match[1], notificationId: decodeURIComponent(nid) };
}

function Root() {
  const game = useGame();
  const [screen, setScreen] = useState<Screen>({ name: 'water' });

  const openBite = useCallback((lakeId: string, notificationId: string) => {
    setScreen({ name: 'minigame', lakeId, notificationId });
  }, []);

  // Warm start: OneSignal hands us the tap directly.
  useEffect(() => OS.onBiteOpened(openBite), [openBite]);

  // Cold start and warm start via the URL scheme.
  useEffect(() => {
    void Linking.getInitialURL().then((url) => {
      const bite = url ? parseBiteLink(url) : null;
      if (bite) openBite(bite.lakeId, bite.notificationId);
    });

    const sub = Linking.addEventListener('url', ({ url }) => {
      const bite = parseBiteLink(url);
      if (bite) openBite(bite.lakeId, bite.notificationId);
    });
    return () => sub.remove();
  }, [openBite]);

  if (!game.ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={color.primary} />
      </View>
    );
  }

  switch (screen.name) {
    case 'minigame':
      return (
        <MinigameScreen
          lakeId={screen.lakeId}
          notificationId={screen.notificationId}
          onResolved={({ outcome, response }) => setScreen({ name: 'catch', outcome, response })}
        />
      );

    case 'catch':
      return (
        <CatchScreen
          outcome={screen.outcome}
          response={screen.response}
          onDone={() => setScreen({ name: 'water' })}
        />
      );

    case 'shop':
      return <ShopScreen onBack={() => setScreen({ name: 'water' })} />;

    case 'water':
    default:
      return (
        <LakeMapScreen
          onCast={(lakeId) => setScreen({ name: 'minigame', lakeId, notificationId: null })}
          onOpenShop={() => setScreen({ name: 'shop' })}
        />
      );
  }
}

export default function App() {
  return (
    <GameProvider>
      <StatusBar style="light" />
      <Root />
    </GameProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1, backgroundColor: color.bgBase,
    alignItems: 'center', justifyContent: 'center',
  },
});
