#!/usr/bin/env node
/**
 * Deterministic content seed.
 *
 *   SEED=lunker-2026 node scripts/seed.mjs
 *
 * Writes the lakes, fish tables and product tiers from shared/content.js to
 * seed/content/*.json so a judge reproduces byte-identical fixtures and can diff
 * them against the RevenueCat dashboard config.
 *
 * This is content, not telemetry. Nothing here ever supplies a number for the
 * killer metric — that comes from real closed-testing data and nothing else.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAKES, PRODUCTS, meanGrant } from '../shared/content.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = process.env.SEED ?? 'lunker-2026';
const OUT = resolve(ROOT, 'seed/content');

/** Stable key order so the output is byte-identical across runs and machines. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  }
  return value;
}

async function write(name, data) {
  const path = resolve(OUT, name);
  await writeFile(path, JSON.stringify(stable(data), null, 2) + '\n', 'utf8');
  console.log(`  seed/content/${name}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`seeding content (SEED=${SEED})`);

  for (const lake of LAKES) {
    const total = lake.fish.reduce((s, f) => s + f.weight, 0);
    if (Math.abs(total - 100) > 1e-9) {
      // A table that does not sum to 100 makes every published rarity rate a
      // lie, so this fails the seed rather than shipping a plausible number.
      console.error(`error: ${lake.id} fish weights sum to ${total}, expected 100`);
      process.exit(1);
    }
    await write(`lake-${lake.id}.json`, {
      ...lake,
      derived: {
        mean_coin_grant: Number(meanGrant(lake).toFixed(2)),
        rarity_rates: Object.fromEntries(
          ['common', 'uncommon', 'rare', 'legendary'].map((r) => [
            r,
            Number(
              (
                lake.fish.filter((f) => f.rarity === r).reduce((s, f) => s + f.weight, 0) / total
              ).toFixed(4),
            ),
          ]),
        ),
      },
    });
  }

  await write('products.json', { seed: SEED, products: PRODUCTS });
  await write('index.json', {
    seed: SEED,
    lakes: LAKES.map((l) => ({ id: l.id, name: l.name, unlock: l.unlock })),
    note: 'Prices are intended tiers for diffing against the RevenueCat dashboard. The app renders the store\'s own localized priceString and never these literals.',
  });

  console.log('done');
}

main();
