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

import { OneSignal, LogLevel } from 'react-native-onesignal';

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

/**
 * Ask for the native Android 13+ permission.
 *
 * Only ever called after the prime has been accepted — never on cold start.
 */
export async function requestPushPermission(): Promise<boolean> {
  return OneSignal.Notifications.requestPermission(true);
}

/**
 * Show the OneSignal in-app message prime.
 *
 * The prime is authored in the OneSignal dashboard and triggered by this tag,
 * so the copy can be tuned without shipping an app update. The native prompt is
 * fired from the message's own click handler, which is what keeps a "no" here
 * recoverable — a "no" to the native prompt is not.
 */
export function triggerPermissionPrime(): void {
  OneSignal.InAppMessages.addTrigger('prime_push', 'true');
}

export function clearPermissionPrime(): void {
  OneSignal.InAppMessages.removeTrigger('prime_push');
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
  const listener = (event: any) => {
    const data = event?.notification?.additionalData ?? {};
    const lakeId = data.lake_id;
    const notificationId = data.notification_id;
    if (lakeId && notificationId) handler(String(lakeId), String(notificationId));
  };

  OneSignal.Notifications.addEventListener('click', listener);
  return () => OneSignal.Notifications.removeEventListener('click', listener);
}

/** Fire a custom event a Journey can enter on. */
export function trackEvent(name: string, properties: Record<string, unknown> = {}): void {
  // The RN SDK exposes custom events through the live-activities/user surface
  // depending on version; tags are the portable path and are what our Journeys
  // are configured against.
  OneSignal.User.addTag(`last_event_${name}`, String(Date.now()));
  if (__DEV__) console.log('[onesignal] event', name, properties);
}
