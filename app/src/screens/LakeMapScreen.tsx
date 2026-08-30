/**
 * 4.4 — Lake map. Where both gates live.
 *
 * The two monetization rails are visually distinct on purpose: an entitlement
 * lock opens the RevenueCat paywall, a COIN lock runs an atomic server-side
 * spend. A judge should be able to tell them apart in a single still.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, SafeAreaView, Alert } from 'react-native';

import { LAKES, type Lake, type Fish } from '../../../shared/content.js';
import { CoinBalance, LakeCard, PrimaryButton, type LakeLock } from '../components';
import { color, font, space, type Rarity } from '../theme/tokens';
import { useGame } from '../state/GameContext';
import * as RC from '../lib/purchases';
import * as api from '../lib/api';

const RANK: Rarity[] = ['common', 'uncommon', 'rare', 'legendary'];

function topRarity(lake: Lake): Rarity {
  return lake.fish.reduce(
    (best: Rarity, f: Fish) => (RANK.indexOf(f.rarity) > RANK.indexOf(best) ? f.rarity : best),
    'common' as Rarity,
  );
}

export function LakeMapScreen({
  onCast,
  onOpenShop,
}: {
  onCast: (lakeId: string) => void;
  onOpenShop: () => void;
}) {
  const game = useGame();
  const [busy, setBusy] = useState<string | null>(null);

  async function handleLakePress(lake: Lake) {
    const unlocked = game.unlockedLakes.includes(lake.id);

    if (unlocked) {
      game.setCurrentLake(lake.id);
      return;
    }

    if (lake.unlock.type === 'entitlement') {
      // The paywall is designed in the RevenueCat dashboard. We ship no paywall UI.
      setBusy(lake.id);
      try {
        const nowEntitled = await RC.presentAnglersPassPaywall();
        await game.refreshCustomerInfo();
        if (nowEntitled) game.unlockLake(lake.id);
      } catch {
        Alert.alert('Could not open the store', 'Please try again in a moment.');
      } finally {
        setBusy(null);
      }
      return;
    }

    if (lake.unlock.type === 'coin') {
      if (!game.appUserId) return;
      setBusy(lake.id);
      try {
        const res = await api.spendCoin({ app_user_id: game.appUserId, lake_id: lake.id });

        if (res.unlocked) {
          game.unlockLake(lake.id);
          await game.refreshBalance({ fresh: true });
        } else if (res.reason === 'insufficient_coin') {
          // The honest state, never a silently dead tap.
          Alert.alert(
            'Not enough COIN yet',
            `${lake.name} costs ${lake.unlock.cost.toLocaleString('en-US')} COIN. ` +
              `You have ${(res.balance ?? game.coinBalance ?? 0).toLocaleString('en-US')}.`,
            [{ text: 'Keep fishing' }, { text: 'Tackle Shop', onPress: onOpenShop }],
          );
        } else {
          Alert.alert(
            'Could not settle that',
            'The server did not confirm the spend. Nothing was charged.',
          );
        }
      } finally {
        setBusy(null);
      }
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>The Water</Text>
        <CoinBalance balance={game.coinBalance} />
      </View>

      {game.pushDeclined && (
        // Say it plainly rather than pretending bites are still arriving.
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Notifications are off, so bites will not arrive. You can still cast manually, but the
            game is built around the push. Turn it on in Settings to play it as designed.
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {LAKES.map((lake: Lake) => {
          const unlocked = game.unlockedLakes.includes(lake.id);
          const lock: LakeLock = unlocked
            ? { type: 'open' }
            : lake.unlock.type === 'coin'
              ? { type: 'coin', cost: lake.unlock.cost, balance: game.coinBalance }
              : { type: 'entitlement' };

          return (
            <LakeCard
              key={lake.id}
              name={busy === lake.id ? 'Working…' : lake.name}
              topRarity={topRarity(lake)}
              lock={lock}
              selected={game.currentLake === lake.id}
              onPress={() => void handleLakePress(lake)}
            />
          );
        })}
      </ScrollView>

      <View style={styles.actions}>
        <PrimaryButton label="Cast now" onPress={() => onCast(game.currentLake)} />
        <PrimaryButton label="Tackle Shop" onPress={onOpenShop} tone="ghost" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bgBase, paddingHorizontal: space.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  title: { ...font.display, color: color.textHi, fontSize: 28 },
  notice: {
    backgroundColor: 'rgba(255,160,90,0.10)',
    borderLeftWidth: 2,
    borderLeftColor: color.accent,
    padding: space.md,
    borderRadius: 10,
    marginBottom: space.md,
  },
  noticeText: { color: color.textMid, fontSize: 14, lineHeight: 21 },
  list: { gap: space.sm, paddingBottom: space.lg },
  actions: { gap: space.sm, paddingBottom: space.xl, paddingTop: space.sm },
});
