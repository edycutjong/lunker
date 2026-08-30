/**
 * 4.5 — Tackle Shop + album.
 *
 * Prices are rendered from the store's own localized `priceString`, never from
 * a table in this repo. Hardcoded prices are the tell that an economy is fake,
 * and this one is not.
 *
 * The album lives here as a section rather than a sixth screen — the UI spec
 * caps this build at five, and a sixth would be a scope breach.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, SafeAreaView, Pressable, Alert, ActivityIndicator,
} from 'react-native';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';

import { CatchCard, CoinBalance, EmptyAlbumSlot, GlassPanel, PrimaryButton } from '../components';
import { color, font, radius, space } from '../theme/tokens';
import { useGame } from '../state/GameContext';
import * as RC from '../lib/purchases';

const ALBUM_SLOTS = 12;

export function ShopScreen({ onBack }: { onBack: () => void }) {
  const game = useGame();
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    RC.getCurrentOffering()
      .then(setOffering)
      .catch(() => setOffering(null))
      .finally(() => setLoading(false));
  }, []);

  const buy = useCallback(
    async (pkg: PurchasesPackage) => {
      setBusy(pkg.identifier);
      try {
        const info = await RC.buyPackage(pkg);
        if (!info) return; // user cancelled — a normal outcome

        await game.refreshCustomerInfo();
        // Coin packs are VC-associated in the dashboard, so a successful
        // purchase auto-credits COIN with no client code. Invalidate and re-read
        // so the HUD shows the credited balance rather than the stale one.
        await game.refreshBalance({ fresh: true });
      } catch (e: any) {
        Alert.alert('Purchase failed', e?.message ?? 'Please try again.');
      } finally {
        setBusy(null);
      }
    },
    [game],
  );

  const restore = useCallback(async () => {
    setBusy('restore');
    try {
      await RC.restore();
      await game.refreshCustomerInfo();
      await game.refreshBalance({ fresh: true });
      Alert.alert('Restored', 'Any previous purchases on this account are back.');
    } catch {
      Alert.alert('Nothing to restore', 'We could not find previous purchases for this account.');
    } finally {
      setBusy(null);
    }
  }, [game]);

  const { coinPacks, pass } = RC.splitPackages(offering);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <CoinBalance balance={game.coinBalance} compact />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Tackle Shop</Text>

        {loading && <ActivityIndicator color={color.primary} style={{ marginVertical: space.lg }} />}

        {!loading && !offering && (
          <Text style={styles.empty}>
            The shop could not reach the store. Check your connection and try again.
          </Text>
        )}

        {/* --- Angler's Pass: dashboard-designed paywall, not a hand-built screen --- */}
        {pass && (
          <GlassPanel style={styles.passCard}>
            <Text style={styles.passTitle}>Angler&apos;s Pass</Text>
            <Text style={styles.passBody}>
              Opens Deep Sea, where the only fish are Rare and above. Seven days free.
            </Text>
            <Text style={styles.price}>{pass.product.priceString}</Text>
            {game.hasPass ? (
              <Text style={styles.active}>Active</Text>
            ) : (
              <PrimaryButton
                label={busy === pass.identifier ? 'Opening…' : 'Start free trial'}
                onPress={() => void buy(pass)}
                disabled={busy !== null}
              />
            )}
          </GlassPanel>
        )}

        {/* --- Coin packs: price strings come from the store --- */}
        {coinPacks.length > 0 && <Text style={styles.section}>Coin packs</Text>}
        {coinPacks.map((pkg) => (
          <Pressable
            key={pkg.identifier}
            onPress={() => void buy(pkg)}
            disabled={busy !== null}
            style={({ pressed }) => [styles.packRow, pressed && { opacity: 0.8 }]}
            accessibilityRole="button"
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.packName}>{pkg.product.title}</Text>
              <Text style={styles.packDesc} numberOfLines={1}>{pkg.product.description}</Text>
            </View>
            <Text style={styles.price}>
              {busy === pkg.identifier ? '…' : pkg.product.priceString}
            </Text>
          </Pressable>
        ))}

        {/* --- Album --- */}
        <Text style={styles.section}>Album</Text>
        <View style={styles.album}>
          {Array.from({ length: ALBUM_SLOTS }).map((_, i) => {
            const entry = game.album[i];
            return entry ? (
              <View key={`${entry.fish_id}-${entry.caught_at}`} style={styles.albumCell}>
                <CatchCard
                  name={entry.name}
                  rarity={entry.rarity}
                  massKg={entry.mass_kg}
                  scale={0.55}
                />
              </View>
            ) : (
              <View key={`empty-${i}`} style={styles.albumCell}>
                <EmptyAlbumSlot />
              </View>
            );
          })}
        </View>

        <Pressable onPress={() => void restore()} disabled={busy !== null} hitSlop={8}>
          <Text style={styles.restore}>
            {busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bgBase, paddingHorizontal: space.lg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: space.lg, paddingBottom: space.sm,
  },
  back: { color: color.textMid, fontSize: 16 },
  body: { paddingBottom: space.xxl, gap: space.sm },
  title: { ...font.display, color: color.textHi, fontSize: 28, marginBottom: space.sm },
  section: {
    color: color.textMid, fontSize: 12, letterSpacing: 1.6,
    textTransform: 'uppercase', marginTop: space.lg, marginBottom: space.xs,
  },
  empty: { color: color.textMid, fontSize: 15, marginVertical: space.lg },

  passCard: { padding: space.lg, gap: space.sm },
  passTitle: { ...font.display, color: color.textHi, fontSize: 22 },
  passBody: { color: color.textMid, fontSize: 15, lineHeight: 22 },
  active: { color: color.success, fontSize: 15, fontWeight: '600' },

  packRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.md, borderRadius: radius.lg, borderWidth: 1,
    borderColor: color.line, backgroundColor: color.bgElevated,
  },
  packName: { color: color.textHi, fontSize: 17, fontWeight: '600' },
  packDesc: { color: color.textMid, fontSize: 14, marginTop: 2 },
  price: { ...font.numeric, color: color.primary, fontSize: 17 },

  album: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  albumCell: { width: '31%' },

  restore: {
    color: color.textMid, fontSize: 15, textAlign: 'center',
    marginTop: space.xl, textDecorationLine: 'underline',
  },
});
