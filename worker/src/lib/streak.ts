/**
 * Streak accounting.
 *
 * The streak is computed SERVER-SIDE from the player's own local calendar days,
 * never sent up by the client. Two reasons, and the second is the one that
 * matters: a client-declared streak is trivially forged, and — more to the
 * point — a streak the client owns is a streak nothing verifies, which is how
 * a "Journeys branch on streak state" claim ends up describing a number that is
 * permanently zero.
 *
 * Days are the player's LOCAL days, not UTC days. A player in UTC+7 who fishes
 * at 9pm and again the next morning has kept a streak; scoring that in UTC
 * would silently break it for most of the world.
 */

/** Calendar-day index in the player's own timezone. */
export function localDayIndex(epochMs: number, tzOffsetMin: number): number {
  return Math.floor((epochMs + tzOffsetMin * 60_000) / 86_400_000);
}

/**
 * @param previousActiveAt  players.last_active_at, or null for a first sync
 * @param previousStreak    players.streak_days
 * @param now               epoch ms
 * @param tzOffsetMin       minutes AHEAD of UTC
 */
export function nextStreak(
  previousActiveAt: number | null,
  previousStreak: number,
  now: number,
  tzOffsetMin: number,
): number {
  const today = localDayIndex(now, tzOffsetMin);

  // First ever session: day one of a streak, not day zero.
  if (previousActiveAt == null) return 1;

  const previousDay = localDayIndex(previousActiveAt, tzOffsetMin);
  const gap = today - previousDay;

  // Same day — already counted. Guard against a stored 0 from before streaks
  // were computed here, so an existing player does not sit at zero forever.
  if (gap <= 0) return Math.max(1, previousStreak);

  // Consecutive local day.
  if (gap === 1) return Math.max(1, previousStreak) + 1;

  // Missed at least one whole day. The streak restarts at 1 — today still
  // counts. Restarting at 0 would mean a returning player is told they have
  // nothing, which is the opposite of what a win-back Journey is for.
  return 1;
}
