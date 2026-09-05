/**
 * The OneSignal surface.
 *
 * Remove OneSignal and there is no bite, so there is no game — not a degraded
 * game, no game. The push is the mechanic, not a re-engagement nudge attached
 * to one.
 *
 * The permission order here is the single highest-leverage decision in the
 * file: an in-app prime is shown AFTER the player's first landed catch and
 * BEFORE the native Android prompt. OneSignal measures a ~27% lift from
 * priming, and warns that once someone declines the native prompt it is very
 * hard to recover. For a game whose entire premise is push, a declined prompt
 * does not degrade the experience — it deletes it.
 */

import {
  OneSignal,
  LogLevel,
  type NotificationClickEvent,
  type InAppMessageClickEvent,
  type InAppMessageWillDisplayEvent,
  type InAppMessageDidDismissEvent,
} from 'react-native-onesignal';

export type BiteHandler = (lakeId: string, notificationId: string) => void;

/**
 * Initialise and bind identity.
 *
 * `externalId` is the SAME id passed to Purchases.logIn(). One id across both
 * SDKs is what makes a Journey able to target purchase state and game state
 * together.
 */
export function initOneSignal(appId: string, externalId: string): void {
  if (__DEV__) OneSignal.Debug.setLogLevel(LogLevel.Verbose);
  OneSignal.initialize(appId);
  OneSignal.login(externalId);
}

/**
 * Whether the OS-level notification permission is actually granted.
 *
 * We report this to the Worker verbatim. Scheduling bites for a player who
 * cannot receive them would inflate the denominator of the killer number with
 * pushes that never had a chance of arriving.
 */
export function hasPushPermission(): boolean {
  return OneSignal.Notifications.hasPermission();
}

/** Trigger key the dashboard in-app message is authored against. */
export const PRIME_TRIGGER = 'prime_push';

/** Action id on the message's accept button. Must match the dashboard exactly. */
export const PRIME_ACCEPT_ACTION_ID = 'prime_accept';

/**
 * How long to wait for the prime to appear before giving up on it.
 *
 * If no message is authored, or the player is not eligible for it, no
 * `willDisplay` ever arrives. Waiting forever would mean nobody is ever asked
 * for permission at all — strictly worse than an unprimed prompt.
 */
export const PRIME_DISPLAY_TIMEOUT_MS = 4000;

/**
 * Prime, then ask — in that order, with the native prompt fired FROM the
 * message's own click handler.
 *
 * This ordering is the whole point and it is easy to get wrong in a way that
 * looks right: calling `requestPermission()` immediately after `addTrigger()`
 * puts the OS dialog on screen at the same moment as the prime, which is not
 * priming, it is two prompts at once. A "no" to an in-app message is
 * recoverable — we can ask again next session. A "no" to the native Android
 * prompt is not, and for a game whose entire premise is push, that is not a
 * degraded experience, it is no experience.
 *
 * Resolves to whether push permission is now granted.
 */
export function primeThenRequestPush(timeoutMs = PRIME_DISPLAY_TIMEOUT_MS): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let displayed = false;

    const onClick = (event: InAppMessageClickEvent) => {
      if (event?.result?.actionId === PRIME_ACCEPT_ACTION_ID) void finish(true);
    };
    const onWillDisplay = (_event: InAppMessageWillDisplayEvent) => {
      displayed = true;
    };
    // Dismissed without accepting. Deliberately does NOT fall through to the
    // native prompt — that would spend the one unrecoverable ask on a player
    // who just said no.
    const onDidDismiss = (_event: InAppMessageDidDismissEvent) => {
      void finish(false);
    };

    const finish = async (accepted: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      OneSignal.InAppMessages.removeEventListener('click', onClick);
      OneSignal.InAppMessages.removeEventListener('willDisplay', onWillDisplay);
      OneSignal.InAppMessages.removeEventListener('didDismiss', onDidDismiss);
      OneSignal.InAppMessages.removeTrigger(PRIME_TRIGGER);
      resolve(accepted ? await OneSignal.Notifications.requestPermission(true) : false);
    };

    const timer = setTimeout(() => {
      // The prime never showed. Ask natively rather than never asking — and
      // only when it never *displayed*, so a player still reading it is not
      // interrupted by the OS dialog.
      if (!displayed) void finish(true);
    }, timeoutMs);

    OneSignal.InAppMessages.addEventListener('click', onClick);
    OneSignal.InAppMessages.addEventListener('willDisplay', onWillDisplay);
    OneSignal.InAppMessages.addEventListener('didDismiss', onDidDismiss);

    OneSignal.InAppMessages.addTrigger(PRIME_TRIGGER, 'true');
  });
}

/**
 * Tags the Journeys branch on. These are the state a bite Journey reads when it
 * decides who to send to and what to say.
 */
export function syncTags(tags: {
  current_lake: string;
  streak_days: number;
  unlocked_count: number;
  rare_count: number;
}): void {
  OneSignal.User.addTags({
    current_lake: tags.current_lake,
    streak_days: String(tags.streak_days),
    unlocked_count: String(tags.unlocked_count),
    rare_count: String(tags.rare_count),
  });
}

/**
 * Handle a bite tap.
 *
 * The payload carries the lake and the notification id. The id is what the
 * telemetry route validates against the `sent` log — a ping whose id we never
 * sent is rejected, which is what makes the headline number attack-proof.
 */
export function onBiteOpened(handler: BiteHandler): () => void {
  const listener = (event: NotificationClickEvent) => {
    // `additionalData` is `object` in the SDK's types — it is whatever the
    // Worker put in `data`, so it is narrowed here rather than trusted.
    const data = (event?.notification?.additionalData ?? {}) as Record<string, unknown>;
    const lakeId = data.lake_id;
    const notificationId = data.notification_id;
    if (lakeId && notificationId) handler(String(lakeId), String(notificationId));
  };

  OneSignal.Notifications.addEventListener('click', listener);
  return () => OneSignal.Notifications.removeEventListener('click', listener);
}

// NOTE: there is deliberately no client-side `trackEvent` here.
//
// Journey entry events (`rare_landed`, `lake_unlocked`) are fired SERVER-SIDE
// from the Worker, because the server is the only party that knows what was
// actually caught or actually paid for. A client-side event helper existed
// briefly, wrote a `last_event_<name>` tag nothing consumed, and had no call
// sites — so it was a phantom OneSignal surface. Removed rather than left
// looking like integration depth.
