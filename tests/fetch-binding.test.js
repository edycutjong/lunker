/**
 * Regression: the Worker's HTTP clients must call the global fetch with a
 * valid `this`.
 *
 * Both clients defaulted `fetchImpl` to the bare global and called it as
 * `this.fetchImpl(...)`. The Workers runtime rejects that with "TypeError:
 * Illegal invocation" on EVERY request — so in production no bite push was
 * ever sent and no COIN ever moved. The rest of the suite stubs fetch with an
 * arrow function, which ignores `this`, so it could not see the bug. The stub
 * here enforces the runtime's rule instead.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { RevenueCatClient } from '../worker/src/lib/revenuecat.js';
import { OneSignalClient } from '../worker/src/lib/onesignal.js';
import { spendCoin } from '../worker/src/routes/spend-coin.js';
import { FakeD1, makeDeps, postJson } from './helpers/d1.js';

function workersStrictFetch(response) {
  return vi.fn(function (_url, _init) {
    if (this !== undefined && this !== globalThis) {
      throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
    }
    return Promise.resolve(response());
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('fetch binding (Workers "Illegal invocation")', () => {
  it('RevenueCatClient calls the global fetch without a foreign `this`', async () => {
    const fetchStub = workersStrictFetch(
      () => new Response(JSON.stringify({ items: [{ currency_code: 'COIN', balance: 50 }] })),
    );
    vi.stubGlobal('fetch', fetchStub);
    const res = await new RevenueCatClient('sk', 'proj').grantCoins('user-1', 50);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('OneSignalClient calls the global fetch without a foreign `this`', async () => {
    const fetchStub = workersStrictFetch(() => new Response(JSON.stringify({ id: 'n1' })));
    vi.stubGlobal('fetch', fetchStub);
    const res = await new OneSignalClient('key', 'app').sendBite({
      externalId: 'user-1',
      lakeId: 'willow',
      lakeName: 'Willow Lake',
      notificationId: 'n1',
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it('a transport failure releases the spend reservation instead of locking the lake', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });
    const deps = makeDeps({ db: new FakeD1() });
    const body = { app_user_id: 'user-1', lake_id: 'quarry' };

    const first = await spendCoin(postJson('/spend-coin', body), deps);
    expect(first.status).toBe(502);

    // The retry must reach RevenueCat again, not be refused as `in_flight`.
    const second = await spendCoin(postJson('/spend-coin', body), deps);
    expect(second.status).toBe(502);
    expect((await second.json()).reason).toBe('upstream_error');
  });
});
