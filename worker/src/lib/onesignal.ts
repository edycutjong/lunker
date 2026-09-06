/**
 * OneSignal REST — server-side sends and Journey triggers.
 *
 * CORRECTED 2026-09-06. This header used to claim the exact opposite of what
 * the file does: that `sendBite()` was "used ONLY for the deterministic bite
 * trigger during demo recording", and that `trackEvent()` was "the path
 * production uses". Both halves were false, in the sponsor's own integration
 * file, in a public repo, arguing against the project's own KTCB pitch.
 *
 * Two distinct uses, kept separate on purpose:
 *
 *  1. `sendBite()` — the bite itself, and the production path. `dispatchBite()`
 *     calls it for every bite the cron `scheduled` handler decides is due, and
 *     `/dev/cast` also calls it for the deterministic demo trigger. Cadence and
 *     quiet hours are enforced in `lib/bite.ts`, not by a Journey — the roll
 *     seed has to reach D1 before the push leaves, and no Journey can write a
 *     row before it sends.
 *  2. `trackEvent()` — a custom event (`rare_landed`, `lake_unlocked`) that a
 *     lifecycle Journey is designed to enter on. Those Journeys are dashboard
 *     configuration and are not yet created, so today this fires into a
 *     listener that does not exist. `ARCHITECTURE.md` carries the same status.
 */

const BASE = 'https://api.onesignal.com';

export interface BitePush {
  externalId: string;
  lakeId: string;
  lakeName: string;
  notificationId: string;
  /** Absolute URL of the lake art. Android renders it as the large icon. */
  largeIcon?: string;
}

export class OneSignalClient {
  constructor(
    private readonly appApiKey: string,
    private readonly appId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers() {
    return {
      authorization: `Key ${this.appApiKey}`,
      'content-type': 'application/json; charset=utf-8',
    };
  }

  /**
   * The hero moment. Body copy is budgeted to stay inside Android's ~65-char
   * pre-ellipsis window so "60s before it escapes" is readable WITHOUT
   * expanding the notification — if the urgency hides behind a chevron, the
   * push is just another reminder.
   */
  async sendBite(p: BitePush): Promise<{ status: number; raw: unknown }> {
    const body = {
      app_id: this.appId,
      target_channel: 'push',
      name: `bite:${p.lakeId}`,
      include_aliases: { external_id: [p.externalId] },
      headings: { en: 'Lunker' },
      contents: {
        en: `Your rod is twitching at ${p.lakeName}\n60s before it escapes.`,
      },
      // Deep link straight into the minigame. Landing on a home screen would
      // spend the seconds the push just promised.
      app_url: `lunker://bite/${p.lakeId}?nid=${p.notificationId}`,
      android_channel_id: undefined,
      priority: 10,
      android_visibility: 1,
      large_icon: p.largeIcon,
      data: { notification_id: p.notificationId, lake_id: p.lakeId },
      // Two bites can never stack in the tray: an expired one is a lie about a
      // window that already closed.
      android_group: 'bite',
      collapse_id: `bite:${p.externalId}`,
      ttl: 60,
    };

    const res = await this.fetchImpl(`${BASE}/notifications`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return { status: res.status, raw: await safeJson(res) };
  }

  /**
   * Fire a custom event that a Journey enters on.
   *
   * Exactly two are fired, both from routes: `rare_landed`
   * (routes/catch-resolved.ts) and `lake_unlocked` (routes/spend-coin.ts).
   */
  async trackEvent(
    externalId: string,
    name: string,
    properties: Record<string, unknown> = {},
  ): Promise<{ status: number; raw: unknown }> {
    const res = await this.fetchImpl(
      `${BASE}/apps/${encodeURIComponent(this.appId)}/integrations/custom_events`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          events: [{ name, external_id: externalId, properties }],
        }),
      },
    );
    return { status: res.status, raw: await safeJson(res) };
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
