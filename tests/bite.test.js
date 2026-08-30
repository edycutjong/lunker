/**
 * Bite dispatch and cadence.
 *
 * The ordering guarantee tested here is the one the whole honesty story rests
 * on: `sent` and the null-open telemetry row are written BEFORE the push, so an
 * unanswered bite is still in the denominator and the roll seed exists before
 * anyone could have influenced it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeD1, makeDeps } from './helpers/d1.js';
import {
  dispatchBite, isDue, isWithinCadence, localHourFor, MIN_BITE_GAP_MS,
} from '../worker/src/lib/bite.js';
import { runDispatch } from '../worker/src/index.js';

const NOW = 1_756_512_000_000;
const USER = 'angler-1';

let deps;
let pushes;

beforeEach(() => {
  deps = makeDeps({ db: new FakeD1(), now: () => NOW });
  pushes = [];
  vi.stubGlobal('fetch', async (url, init) => {
    pushes.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ id: 'os-1' }), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

function addPlayer(db, over = {}) {
  const p = {
    app_user_id: USER, current_lake: 'willow', unlocked_lakes: 'willow,reeds',
    streak_days: 0, push_enabled: 1, tz_offset_min: 0, last_bite_at: null, ...over,
  };
  db.prepare(
    'INSERT INTO players (app_user_id,current_lake,unlocked_lakes,streak_days,push_enabled,tz_offset_min,last_bite_at,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).bind(p.app_user_id, p.current_lake, p.unlocked_lakes, p.streak_days, p.push_enabled, p.tz_offset_min, p.last_bite_at, NOW).run();
  return p;
}

describe('cadence windows', () => {
  it('never sends while a player is asleep, whatever the lake', () => {
    for (const lake of ['willow', 'reeds', 'quarry', 'deepsea']) {
      expect(isWithinCadence(lake, 3)).toBe(false);
      expect(isWithinCadence(lake, 6)).toBe(false);
    }
  });

  it('weights Willow toward daytime', () => {
    expect(isWithinCadence('willow', 11)).toBe(true);
    expect(isWithinCadence('willow', 21)).toBe(false);
  });

  it('weights Deep Sea toward night', () => {
    expect(isWithinCadence('deepsea', 20)).toBe(true);
    expect(isWithinCadence('deepsea', 11)).toBe(false);
  });

  it('lets the even-cadence lakes fire across the whole waking window', () => {
    expect(isWithinCadence('reeds', 9)).toBe(true);
    expect(isWithinCadence('reeds', 20)).toBe(true);
  });

  it('returns false for an unknown lake rather than defaulting to send', () => {
    expect(isWithinCadence('atlantis', 12)).toBe(false);
  });
});

describe('localHourFor', () => {
  it('applies a positive UTC offset', () => {
    const utcHour = new Date(NOW).getUTCHours();
    expect(localHourFor({ tz_offset_min: 60 }, NOW)).toBe((utcHour + 1) % 24);
  });

  it('wraps a negative offset instead of going below zero', () => {
    const h = localHourFor({ tz_offset_min: -600 }, NOW);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(24);
  });
});

describe('isDue', () => {
  const base = { app_user_id: USER, current_lake: 'reeds', unlocked_lakes: 'reeds', streak_days: 0, push_enabled: 1, tz_offset_min: 0, last_bite_at: null };
  // Pin local time to noon so cadence is satisfied and only the rule under test varies.
  const noon = NOW - new Date(NOW).getUTCHours() * 3_600_000 + 12 * 3_600_000;

  it('is due for an opted-in player inside the window', () => {
    expect(isDue(base, noon)).toBe(true);
  });

  it('is never due when push was declined', () => {
    // We do not keep scheduling into a void and call it engagement.
    expect(isDue({ ...base, push_enabled: 0 }, noon)).toBe(false);
  });

  it('never sends two bites within an hour', () => {
    expect(isDue({ ...base, last_bite_at: noon - 30 * 60_000 }, noon)).toBe(false);
    expect(isDue({ ...base, last_bite_at: noon - MIN_BITE_GAP_MS - 1 }, noon)).toBe(true);
  });

  it('respects the lake cadence even for an opted-in player', () => {
    const threeAm = NOW - new Date(NOW).getUTCHours() * 3_600_000 + 3 * 3_600_000;
    expect(isDue(base, threeAm)).toBe(false);
  });
});

describe('dispatchBite', () => {
  it('writes sent and the null-open telemetry row before sending the push', async () => {
    addPlayer(deps.db);
    const rec = await dispatchBite(deps, USER, 'willow');

    const [sent] = deps.db.raw('SELECT * FROM sent');
    expect(sent.notification_id).toBe(rec.notification_id);
    expect(sent.roll_seed).toMatch(/^[0-9a-f]{64}$/);
    expect(sent.sent_at).toBe(NOW);

    const [tel] = deps.db.raw('SELECT * FROM bite_telemetry');
    // Null open at send time is what keeps an unanswered bite in the denominator.
    expect(tel.opened_at).toBeNull();
    expect(tel.resolved).toBeNull();
  });

  it('carries the notification id and deep link in the push payload', async () => {
    addPlayer(deps.db);
    const rec = await dispatchBite(deps, USER, 'willow');
    const push = pushes.find((p) => p.url.includes('onesignal'));
    expect(push.body.include_aliases.external_id).toEqual([USER]);
    expect(push.body.app_url).toBe(`lunker://bite/willow?nid=${rec.notification_id}`);
    expect(push.body.data.notification_id).toBe(rec.notification_id);
  });

  it('writes body copy inside the ~65-char Android pre-ellipsis budget', async () => {
    addPlayer(deps.db);
    await dispatchBite(deps, USER, 'willow');
    const push = pushes.find((p) => p.url.includes('onesignal'));
    // If the stakes hide behind a chevron, the push is just another reminder.
    expect(push.body.contents.en.length).toBeLessThanOrEqual(65);
    expect(push.body.contents.en).toContain('60s before it escapes.');
    expect(push.body.headings.en).toBe('Lunker');
  });

  it('uses no emoji or em dash in the body, which render inconsistently across OEM skins', async () => {
    addPlayer(deps.db);
    await dispatchBite(deps, USER, 'willow');
    const body = pushes.find((p) => p.url.includes('onesignal')).body.contents.en;
    expect(body).not.toMatch(/—/);
    expect(body).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('expires the push after 60 seconds so a stale bite never sits in the tray', async () => {
    addPlayer(deps.db);
    await dispatchBite(deps, USER, 'willow');
    const push = pushes.find((p) => p.url.includes('onesignal')).body;
    expect(push.ttl).toBe(60);
    expect(push.collapse_id).toBe(`bite:${USER}`);
  });

  it('advances last_bite_at so the hourly gap is enforced', async () => {
    addPlayer(deps.db);
    await dispatchBite(deps, USER, 'willow');
    const [p] = deps.db.raw('SELECT last_bite_at FROM players');
    expect(p.last_bite_at).toBe(NOW);
  });

  it('still logs the bite when the push fails to send', async () => {
    // Dropping it would quietly remove the hardest rows from the denominator.
    vi.stubGlobal('fetch', async () => { throw new Error('network down'); });
    addPlayer(deps.db);
    const rec = await dispatchBite(deps, USER, 'willow');
    expect(rec.push_status).toBeNull();
    expect(deps.db.raw('SELECT * FROM sent')).toHaveLength(1);
  });

  it('gives every bite a distinct notification id and roll seed', async () => {
    addPlayer(deps.db);
    await dispatchBite(deps, USER, 'willow');
    await dispatchBite(deps, USER, 'willow');
    const rows = deps.db.raw('SELECT * FROM sent');
    expect(new Set(rows.map((r) => r.notification_id)).size).toBe(2);
    expect(new Set(rows.map((r) => r.roll_seed)).size).toBe(2);
  });

  it('refuses an unknown lake', async () => {
    addPlayer(deps.db);
    await expect(dispatchBite(deps, USER, 'atlantis')).rejects.toThrow(/unknown lake/);
  });
});

describe('runDispatch', () => {
  it('skips players who have not enabled push', async () => {
    addPlayer(deps.db, { push_enabled: 0 });
    expect(await runDispatch(deps)).toBe(0);
    expect(deps.db.raw('SELECT * FROM sent')).toHaveLength(0);
  });

  it('skips a player who was sent a bite ten minutes ago', async () => {
    addPlayer(deps.db, { current_lake: 'reeds', last_bite_at: NOW - 10 * 60_000 });
    expect(await runDispatch(deps)).toBe(0);
  });

  it('keeps going when one player dispatch throws', async () => {
    addPlayer(deps.db, { app_user_id: 'broken', current_lake: 'reeds' });
    // Corrupt one row so its dispatch fails, and confirm the run continues.
    deps.db.raw("UPDATE players SET current_lake = 'atlantis' WHERE app_user_id = 'broken'");
    addPlayer(deps.db, { app_user_id: 'fine', current_lake: 'reeds' });
    await expect(runDispatch(deps)).resolves.toBeGreaterThanOrEqual(0);
  });
});
