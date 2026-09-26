/**
 * The landing page and pitch deck as served by the Worker.
 *
 * Both are judge-facing, and both used to be places where a claim could drift
 * from the code: a schedule drawn by hand, an image path that 404s once
 * deployed, a static file that silently shadows /verify. Each test here pins
 * one of those so the surface cannot say something the Worker does not do.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAKES } from '../shared/content.js';
import { isWithinCadence } from '../worker/src/lib/bite.js';
import { renderLanding, renderBiteTimes, ORIGIN } from '../worker/src/landing.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'worker/public');
const DECK = join(PUBLIC, 'pitch/index.html');

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('static assets never shadow a Worker route', () => {
  // Workers static assets are matched BEFORE the Worker runs. One stray
  // public/verify.html or public/index.html would replace the live ledger or
  // the landing page with a frozen file, and every test of the route would
  // still pass, because they call the handler directly.
  const ROUTES = [
    '/',
    '/index.html',
    '/verify',
    '/privacy',
    '/health',
    '/catch-resolved',
    '/spend-coin',
    '/bite-opened',
    '/webhooks/revenuecat',
    '/player/sync',
    '/dev/cast',
  ];

  it('has no public file whose served path is a route', () => {
    const served = walk(PUBLIC).map((f) => '/' + relative(PUBLIC, f).split('\\').join('/'));
    const shadows = served.filter((p) => {
      const bare = p.replace(/\.html$/, '').replace(/\/index$/, '') || '/';
      return ROUTES.some((r) => r === p || r === bare || p.startsWith(r + '/'));
    });
    expect(shadows).toEqual([]);
  });
});

describe('the bite-times card is the schedule, not a picture of it', () => {
  it('marks exactly the hours isWithinCadence() allows, per lake', () => {
    const html = renderBiteTimes();
    for (const lake of LAKES) {
      const on = [
        ...html.matchAll(new RegExp(`class="on" title="${lake.name} (\\d\\d):00"`, 'g')),
      ].map((m) => Number(m[1]));
      const expected = [...Array(24).keys()].filter((h) => isWithinCadence(lake.id, h));
      expect(on, lake.id).toEqual(expected);
      expect(expected.length, lake.id).toBeGreaterThan(0);
    }
  });

  it('is what the landing page serves', () => {
    expect(renderLanding()).toContain(renderBiteTimes());
  });

  it('is byte-identical in the pitch deck, so the deck cannot drift from the cron', () => {
    expect(readFileSync(DECK, 'utf8')).toContain(renderBiteTimes());
  });
});

describe('every asset the surfaces reference exists', () => {
  it('resolves each /assets/ path on the landing page and ../assets/ path in the deck', () => {
    const landing = [...renderLanding().matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map(
      (m) => m[1],
    );
    const deck = [
      ...readFileSync(DECK, 'utf8').matchAll(/(?:src|href)="\.\.\/assets\/([^"]+)"/g),
    ].map((m) => m[1]);
    expect(landing.length).toBeGreaterThan(0);
    expect(deck.length).toBeGreaterThan(0);
    const missing = [...landing, ...deck].filter((f) => !existsSync(join(PUBLIC, 'assets', f)));
    expect(missing).toEqual([]);
  });

  it('points og:image at an absolute URL of a file that ships', () => {
    const m = /<meta property="og:image" content="([^"]+)">/.exec(renderLanding());
    expect(m?.[1]).toBe(`${ORIGIN}/assets/og-image.jpg`);
    expect(existsSync(join(PUBLIC, 'assets/og-image.jpg'))).toBe(true);
  });
});

describe('the landing page links what a judge and Play both need', () => {
  it('links the privacy policy and the live ledger', () => {
    const out = renderLanding();
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="/verify"');
    expect(out).toContain('href="/pitch/"');
  });

  it('never links the store listing or the video while they are placeholders', () => {
    const out = renderLanding();
    expect(out).not.toMatch(/href="[^"]*play\.google\.com/);
    expect(out).toContain(
      '<span class="btn primary pending" aria-disabled="true">Get it on Google Play</span>',
    );
    expect(out).toContain('<span class="pending" aria-disabled="true">Demo video</span>');
  });
});
