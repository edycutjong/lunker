/**
 * 4.2 — The reel-tension minigame. The 60 seconds the push promised.
 *
 * Landing here directly from the notification is the whole product claim. If
 * tapping a bite dropped the player on a home screen, the seconds the push sold
 * them would be spent on navigation.
 *
 * The COIN balance is deliberately HIDDEN on this screen. It reappears on the
 * catch screen so the credit reads as an event rather than a number that was
 * always there.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, SafeAreaView } from 'react-native';
import * as Haptics from 'expo-haptics';

import { createState, step, remaining, DEFAULTS, type TensionState } from '../../../shared/tension.js';
import { getLake } from '../../../shared/content.js';
import { CountdownRing, TensionArc } from '../components';
import { color, font, space } from '../theme/tokens';
import { useGame } from '../state/GameContext';
import * as api from '../lib/api';

export function MinigameScreen({
  lakeId, notificationId, onResolved,
}: {
  lakeId: string;
  /** Null when the player cast manually rather than answering a bite. */
  notificationId: string | null;
  onResolved: (result: { outcome: 'landed' | 'escaped'; response: api.CatchResponse | null }) => void;
}) {
  const game = useGame();
  const lake = getLake(lakeId);

  const [state, setState] = useState<TensionState>(() => createState({ phase: Math.random() }));
  const holding = useRef(false);
  const phase = useRef(Math.random());
  const lastInZone = useRef(false);
  const resolved = useRef(false);

  // Report the open immediately, before any gameplay. The latency we publish is
  // time-to-open, not time-to-finish, and measuring it after the minigame would
  // quietly flatter every number.
  useEffect(() => {
    if (notificationId) api.reportBiteOpened(notificationId);
  }, [notificationId]);

  // Fixed-step simulation driven by wall clock, so a dropped frame slows the
  // animation rather than changing the outcome.
  useEffect(() => {
    let raf: number;
    let last = Date.now();

    const tick = () => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;

      setState((prev) => {
        if (prev.status !== 'playing') return prev;
        const next = step(prev, dt, holding.current, { phase: phase.current });

        // A light tick on entering the zone, a heavier one on leaving it. This
        // is the entire game-feel budget.
        if (next.inZone !== lastInZone.current) {
          lastInZone.current = next.inZone;
          void Haptics.impactAsync(
            next.inZone ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
          );
        }
        return next;
      });

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = useCallback(
    async (outcome: 'landed' | 'escaped') => {
      if (resolved.current) return;
      resolved.current = true;

      void Haptics.notificationAsync(
        outcome === 'landed'
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );

      // No notification id means this was a manual cast (the degraded mode a
      // player who declined push gets). Nothing is granted for it — the economy
      // only pays out against a bite we actually sent.
      if (!notificationId || !game.appUserId) {
        onResolved({ outcome, response: null });
        return;
      }

      try {
        const response = await api.reportCatch({
          app_user_id: game.appUserId,
          lake_id: lakeId,
          notification_id: notificationId,
          outcome: outcome === 'landed' ? 'win' : 'loss',
        });
        onResolved({ outcome, response });
      } catch {
        onResolved({ outcome, response: null });
      }
    },
    [game.appUserId, lakeId, notificationId, onResolved],
  );

  useEffect(() => {
    if (state.status === 'landed') void finish('landed');
    else if (state.status === 'escaped') void finish('escaped');
  }, [state.status, finish]);

  const secondsLeft = remaining(state);

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.lakeName}>{lake?.name ?? lakeId}</Text>
        <CountdownRing remaining={secondsLeft} total={DEFAULTS.windowSec} />
      </View>

      <Pressable
        style={styles.arena}
        onPressIn={() => { holding.current = true; }}
        onPressOut={() => { holding.current = false; }}
        accessibilityLabel="Hold to reel in. Keep the needle inside the green zone."
      >
        <TensionArc
          pos={state.pos}
          zoneCenter={state.zoneCenter}
          zoneHalfWidth={DEFAULTS.zoneHalfWidth}
          inZone={state.inZone}
          progress={state.progress}
          required={DEFAULTS.requiredHold}
        />
      </Pressable>

      <View style={styles.footer}>
        <Text style={styles.hint}>
          {state.inZone ? 'Hold it there' : 'Hold to pull, release to give line'}
        </Text>
        <Text style={styles.progress}>
          {Math.min(DEFAULTS.requiredHold, state.progress).toFixed(1)}s / {DEFAULTS.requiredHold}s
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bgBase, paddingHorizontal: space.lg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: space.lg,
  },
  lakeName: { ...font.display, color: color.textHi, fontSize: 22 },
  arena: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { alignItems: 'center', paddingBottom: space.xl, gap: space.xs },
  hint: { color: color.textMid, fontSize: 15 },
  progress: { ...font.numeric, color: color.primary, fontSize: 18 },
});
