/**
 * Content seed integrity.
 *
 * The economy pacing here is a set of deliberate design numbers, not values
 * picked to look plausible. Guarding them means a later "small tuning tweak"
 * cannot silently invalidate the published rarity rate or the free-to-paid
 * curve that the whole monetization argument rests on.
 */

import { describe, it, expect } from 'vitest';
import { LAKES, PRODUCTS, getLake, meanGrant, RARITY_ORDER } from '../shared/content.js';

const sum = (l) => l.fish.reduce((s, f) => s + f.weight, 0);

describe('every lake', () => {
  it.each(LAKES.map((l) => [l.id, l]))('%s: weights sum to exactly 100', (_id, lake) => {
    // Anything else makes every published rarity percentage a lie.
    expect(sum(lake)).toBeCloseTo(100, 9);
  });

  it.each(LAKES.map((l) => [l.id, l]))('%s: mass ranges are ordered and positive', (_id, lake) => {
    for (const f of lake.fish) {
      expect(f.mass_kg[0]).toBeGreaterThan(0);
      expect(f.mass_kg[1]).toBeGreaterThan(f.mass_kg[0]);
    }
  });

  it.each(LAKES.map((l) => [l.id, l]))('%s: rarer fish never pay less than commoner ones', (_id, lake) => {
    const byTier = new Map();
    for (const f of lake.fish) {
      const tier = RARITY_ORDER.indexOf(f.rarity);
      byTier.set(tier, Math.min(byTier.get(tier) ?? Infinity, f.coins));
    }
    const tiers = [...byTier.keys()].sort((a, b) => a - b);
    for (let i = 1; i < tiers.length; i++) {
      expect(byTier.get(tiers[i])).toBeGreaterThan(byTier.get(tiers[i - 1]));
    }
  });

  it('uses unique fish ids across the whole game', () => {
    const ids = LAKES.flatMap((l) => l.fish.map((f) => f.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships exactly 4 lakes, the scope cutline cap', () => {
    expect(LAKES).toHaveLength(4);
  });
});

describe('Willow Lake — the demo table', () => {
  const willow = getLake('willow');

  it('has a 4.0% combined rare rate', () => {
    const rare = willow.fish.filter((f) => f.rarity === 'rare').reduce((s, f) => s + f.weight, 0);
    expect(rare).toBeCloseTo(4.0, 6);
  });

  it('gives Moonlight Koi a 3.5% rate, which makes P(>=1 in 60 casts) = 88.2%', () => {
    const koi = willow.fish.find((f) => f.id === 'moonlight_koi');
    expect(koi.weight).toBe(3.5);
    const p = 1 - Math.pow(1 - 0.035, 60);
    expect(p).toBeCloseTo(0.882, 3);
  });

  it('makes any rare 91.4% likely across a 60-cast recording session', () => {
    expect(1 - Math.pow(1 - 0.04, 60)).toBeCloseTo(0.914, 3);
  });

  it('grants the Moonlight Koi 120 COIN in the 3.6-4.8 kg band from the demo script', () => {
    const koi = willow.fish.find((f) => f.id === 'moonlight_koi');
    expect(koi.coins).toBe(120);
    expect(koi.mass_kg).toEqual([3.6, 4.8]);
  });

  it('has a mean grant of 38.9 COIN per landed fish', () => {
    expect(meanGrant(willow)).toBeCloseTo(38.9, 1);
  });
});

describe('economy pacing', () => {
  it('puts Quarry ~12 free days away at Willow, or one $2.99 pack', () => {
    // 4 bites/day midpoint x ~65% landing rate = 2.6 landed/day.
    const perDay = 2.6 * meanGrant(getLake('willow'));
    expect(perDay).toBeCloseTo(101, 0);
    const days = 1200 / perDay;
    expect(days).toBeGreaterThan(10);
    expect(days).toBeLessThan(14);

    const tackleBox = PRODUCTS.find((p) => p.product_id === 'coins_1600');
    expect(tackleBox.coins).toBeGreaterThan(1200);
  });

  it('makes each lake richer than the last, so progression reads as progress', () => {
    const means = ['reeds', 'willow', 'quarry', 'deepsea'].map((id) => meanGrant(getLake(id)));
    for (let i = 1; i < means.length; i++) {
      expect(means[i]).toBeGreaterThan(means[i - 1]);
    }
  });

  it('sells Deep Sea depth per bite rather than more bites', () => {
    // Fewer pushes, richer table. A paid tier that simply sent more
    // notifications would be pay-to-spam.
    const deep = getLake('deepsea');
    const willow = getLake('willow');
    expect(deep.bites_per_day[1]).toBeLessThan(willow.bites_per_day[0]);
    expect(meanGrant(deep)).toBeGreaterThan(meanGrant(willow));
  });
});

describe('lake gating exercises both monetization rails', () => {
  it('has exactly one COIN-gated lake', () => {
    expect(LAKES.filter((l) => l.unlock.type === 'coin')).toHaveLength(1);
  });

  it('has exactly one entitlement-gated lake', () => {
    expect(LAKES.filter((l) => l.unlock.type === 'entitlement')).toHaveLength(1);
  });

  it('keeps two lakes free, so the paid ones read as a choice not a wall', () => {
    expect(LAKES.filter((l) => l.unlock.type === 'free')).toHaveLength(2);
  });

  it('prices Quarry at the 1,200 COIN the UI copy quotes', () => {
    expect(getLake('quarry').unlock).toEqual({ type: 'coin', cost: 1200 });
  });

  it('gates Deep Sea on the anglers_pass entitlement', () => {
    expect(getLake('deepsea').unlock).toEqual({ type: 'entitlement', entitlement: 'anglers_pass' });
  });
});

describe('products', () => {
  it("makes Angler's Pass a subscription, not a non-consumable", () => {
    // A non-consumable cannot carry a Play free-trial base-plan offer, can never
    // fire trial_started/expiration, and cannot lapse — which would make both
    // the judge-access deliverable and the win-back Journey unbuildable.
    const pass = PRODUCTS.find((p) => p.product_id === 'anglers_pass');
    expect(pass.kind).toBe('subscription');
    expect(pass.trial_days).toBe(7);
    expect(pass.entitlement).toBe('anglers_pass');
  });

  it('associates every coin pack to the virtual currency for auto-credit', () => {
    for (const p of PRODUCTS.filter((p) => p.product_id.startsWith('coins_'))) {
      expect(p.vc_associated).toBe(true);
      expect(p.coins).toBeGreaterThan(0);
    }
  });

  it('improves COIN-per-dollar as the pack gets bigger', () => {
    const packs = PRODUCTS.filter((p) => p.coins).sort((a, b) => a.coins - b.coins);
    for (let i = 1; i < packs.length; i++) {
      expect(packs[i].coins / packs[i].price_tier_usd).toBeGreaterThan(
        packs[i - 1].coins / packs[i - 1].price_tier_usd,
      );
    }
  });
});

describe('getLake', () => {
  it('returns null for an unknown id rather than throwing', () => {
    expect(getLake('atlantis')).toBeNull();
  });
});
