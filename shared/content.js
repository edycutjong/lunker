/**
 * Lunker — content seed (lakes, fish tables, coin packs).
 *
 * This is the canonical, committed content. `scripts/seed.mjs` emits it to
 * `seed/content/*.json` under a fixed SEED so a judge reproduces byte-identical
 * fixtures, and the Worker rolls catches against THESE weights. The client
 * never rolls and never names a catch.
 *
 * Coin-pack prices are NOT here for the client to render. The app renders the
 * store's own localized `priceString` from `getOfferings().availablePackages`.
 * The tiers below exist so the RevenueCat dashboard config can be diffed
 * against the repo. Hardcoded prices in a shipped UI are the tell that an
 * economy is fake.
 */

/** @typedef {'common'|'uncommon'|'rare'|'legendary'} Rarity */

/**
 * @typedef {object} Fish
 * @property {string} id
 * @property {string} name
 * @property {Rarity} rarity
 * @property {number} weight     relative roll weight; every table sums to 100
 * @property {[number, number]} mass_kg  inclusive range
 * @property {number} coins      COIN granted on landing this fish
 */

/**
 * @typedef {object} Lake
 * @property {string} id
 * @property {string} name
 * @property {{ type: 'free' }|{ type: 'coin', cost: number }|{ type: 'entitlement', entitlement: string }} unlock
 * @property {[number, number]} bites_per_day
 * @property {'day'|'night'|'even'} cadence_weighting
 * @property {Fish[]} fish
 */

/** @type {Lake[]} */
export const LAKES = [
  {
    id: 'willow',
    name: 'Willow Lake',
    unlock: { type: 'free' },
    bites_per_day: [3, 5],
    cadence_weighting: 'day',
    // The demo lake. Rare rate is 4.0% and Moonlight Koi alone is 3.5%, which
    // makes P(>=1 Koi in 60 casts) = 88.2%. The seed is tuned so that filming an
    // honest rare in one session is the path of least resistance — at 1% the
    // temptation to hardcode the outcome becomes real.
    fish: [
      { id: 'silver_roach',    name: 'Silver Roach',    rarity: 'common',   weight: 44,  mass_kg: [0.2, 0.9],  coins: 20 },
      { id: 'bronze_carp',     name: 'Bronze Carp',     rarity: 'common',   weight: 26,  mass_kg: [0.8, 2.4],  coins: 30 },
      { id: 'reed_pike',       name: 'Reed Pike',       rarity: 'uncommon', weight: 18,  mass_kg: [1.5, 4.0],  coins: 60 },
      { id: 'ghost_perch',     name: 'Ghost Perch',     rarity: 'uncommon', weight: 8,   mass_kg: [0.9, 2.1],  coins: 75 },
      { id: 'moonlight_koi',   name: 'Moonlight Koi',   rarity: 'rare',     weight: 3.5, mass_kg: [3.6, 4.8],  coins: 120 },
      { id: 'willow_sturgeon', name: 'Willow Sturgeon', rarity: 'rare',     weight: 0.5, mass_kg: [8.0, 14.0], coins: 260 },
    ],
  },
  {
    id: 'reeds',
    name: 'Reed Shallows',
    unlock: { type: 'free' },
    bites_per_day: [2, 4],
    cadence_weighting: 'even',
    // Teaches the loop and makes Willow's rares feel earned. Mean grant 25.1
    // COIN — deliberately the poorest water in the game.
    fish: [
      { id: 'minnow_shoal', name: 'Minnow Shoal', rarity: 'common',   weight: 52, mass_kg: [0.1, 0.5], coins: 15 },
      { id: 'reed_roach',   name: 'Reed Roach',   rarity: 'common',   weight: 30, mass_kg: [0.3, 1.1], coins: 22 },
      { id: 'green_tench',  name: 'Green Tench',  rarity: 'uncommon', weight: 13, mass_kg: [1.0, 2.6], coins: 55 },
      { id: 'glass_eel',    name: 'Glass Eel',    rarity: 'uncommon', weight: 5,  mass_kg: [0.6, 1.4], coins: 70 },
    ],
  },
  {
    id: 'quarry',
    name: 'Quarry Pool',
    unlock: { type: 'coin', cost: 1200 },
    bites_per_day: [2, 3],
    cadence_weighting: 'even',
    // The server-settled COIN spend rail, and where the 422 "can't afford it
    // yet" state is demonstrated. Mean grant 100.3 COIN — it repays its own
    // 1,200 in ~12 landed catches, so the unlock reads as an investment.
    fish: [
      { id: 'slate_bream',       name: 'Slate Bream',       rarity: 'uncommon', weight: 46, mass_kg: [0.7, 2.2],  coins: 70 },
      { id: 'quarry_chub',       name: 'Quarry Chub',       rarity: 'uncommon', weight: 32, mass_kg: [1.2, 3.0],  coins: 85 },
      { id: 'copper_bass',       name: 'Copper Bass',       rarity: 'rare',     weight: 15, mass_kg: [2.8, 5.5],  coins: 150 },
      { id: 'anvil_catfish',     name: 'Anvil Catfish',     rarity: 'rare',     weight: 6,  mass_kg: [6.0, 12.0], coins: 240 },
      { id: 'drowned_bell_carp', name: 'Drowned Bell Carp', rarity: 'rare',     weight: 1,  mass_kg: [9.0, 18.0], coins: 400 },
    ],
  },
  {
    id: 'deepsea',
    name: 'Deep Sea',
    unlock: { type: 'entitlement', entitlement: 'anglers_pass' },
    bites_per_day: [1, 2],
    cadence_weighting: 'night',
    // The RevenueCat paywall rail. Fewer bites, far richer table — the Pass buys
    // depth per bite, not more bites, so it never reads as pay-to-spam.
    fish: [
      { id: 'lantern_snapper',    name: 'Lantern Snapper',    rarity: 'rare',      weight: 48, mass_kg: [1.5, 4.0],   coins: 180 },
      { id: 'abyss_ray',          name: 'Abyss Ray',          rarity: 'rare',      weight: 30, mass_kg: [4.0, 9.0],   coins: 260 },
      { id: 'hadal_oarfish',      name: 'Hadal Oarfish',      rarity: 'legendary', weight: 14, mass_kg: [8.0, 17.0],  coins: 520 },
      { id: 'moonwake_leviathan', name: 'Moonwake Leviathan', rarity: 'legendary', weight: 6,  mass_kg: [20.0, 48.0], coins: 900 },
      { id: 'the_lunker',         name: 'The Lunker',         rarity: 'legendary', weight: 2,  mass_kg: [30.0, 60.0], coins: 1500 },
    ],
  },
];

/**
 * Coin packs + the Pass, mirrored from the RevenueCat dashboard so the two can
 * be diffed. `anglers_pass` is an auto-renewing subscription, NOT a
 * non-consumable: a non-consumable cannot carry a Play free-trial base-plan
 * offer, can never fire `trial_started` / `expiration`, and cannot lapse — which
 * would make both the judge-access deliverable and the win-back Journey
 * structurally unbuildable.
 */
export const PRODUCTS = [
  { product_id: 'coins_500',   display: 'Bait Tin',      coins: 500,  price_tier_usd: 0.99, kind: 'consumable',   vc_associated: true },
  { product_id: 'coins_1600',  display: 'Tackle Box',    coins: 1600, price_tier_usd: 2.99, kind: 'consumable',   vc_associated: true },
  { product_id: 'coins_6000',  display: 'Trawler Haul',  coins: 6000, price_tier_usd: 9.99, kind: 'consumable',   vc_associated: true },
  { product_id: 'anglers_pass', display: "Angler's Pass", coins: null, price_tier_usd: 4.99, kind: 'subscription', entitlement: 'anglers_pass', trial_days: 7 },
];

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary'];

/** @param {string} id */
export function getLake(id) {
  return LAKES.find((l) => l.id === id) ?? null;
}

/**
 * Mean COIN granted per landed fish. Used by the economy assertions in the test
 * suite — the free-to-paid pacing is a design number, not a value picked to
 * look plausible, so it is guarded.
 * @param {Lake} lake
 */
export function meanGrant(lake) {
  const total = lake.fish.reduce((s, f) => s + f.weight, 0);
  return lake.fish.reduce((s, f) => s + (f.weight / total) * f.coins, 0);
}
