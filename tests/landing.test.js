/**
 * The landing page and pitch deck, published by GitHub Pages from site/ at
 * https://lunker.edycu.dev, while the live ledger and API stay on the Worker.
 *
 * Both are judge-facing, and both used to be places where a claim could drift
 * from the code: a schedule drawn by hand, an image path that 404s once
 * deployed, committed HTML that no longer matches its source, an old Worker URL
 * (already pasted into Play) that stops resolving. Each test pins one of those.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAKES } from '../shared/content.js';
import { isWithinCadence } from '../worker/src/lib/bite.js';
import { renderLanding, renderBiteTimes, ORIGIN, API_ORIGIN } from '../worker/src/landing.js';
import { PRIVACY_HTML } from '../worker/src/routes/privacy.js';
import worker, { sitePath } from '../worker/src/index.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const DECK = join(SITE, 'pitch/index.html');

describe('the committed site/ is exactly what the source renders', () => {
  // GitHub Pages serves the committed files, not the TypeScript. If someone edits
  // landing.ts and forgets `node scripts/build-site.mjs`, this is what fails.
  it('site/index.html matches renderLanding()', () => {
    expect(readFileSync(join(SITE, 'index.html'), 'utf8')).toBe(renderLanding());
  });
  it('site/privacy.html matches PRIVACY_HTML', () => {
    expect(readFileSync(join(SITE, 'privacy.html'), 'utf8')).toBe(PRIVACY_HTML);
  });
});

describe('old Worker page URLs redirect to the static site', () => {
  // The privacy URL may already be pasted into Play Console as
  // https://lunker.edycu.workers.dev/privacy — it must keep resolving.
  it.each([
    ['/', '/'],
    ['/index.html', '/'],
    ['/privacy', '/privacy.html'],
    ['/pitch', '/pitch/'],
    ['/pitch/index.html', '/pitch/index.html'],
    ['/assets/og-image.jpg', '/assets/og-image.jpg'],
  ])('%s -> %s', (from, to) => {
    expect(sitePath(from)).toBe(to);
  });

  it('never redirects a live route', () => {
    for (const r of [
      '/verify',
      '/health',
      '/catch-resolved',
      '/spend-coin',
      '/webhooks/revenuecat',
    ]) {
      expect(sitePath(r), r).toBeNull();
    }
  });

  it('answers GET /privacy with a 301 to the Pages URL', async () => {
    const res = await worker.fetch(new Request('https://lunker.edycu.workers.dev/privacy'), {});
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/privacy.html`);
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
    const missing = [...landing, ...deck].filter((f) => !existsSync(join(SITE, 'assets', f)));
    expect(missing).toEqual([]);
  });

  it('points og:image at an absolute URL of a file that ships', () => {
    const m = /<meta property="og:image" content="([^"]+)">/.exec(renderLanding());
    expect(m?.[1]).toBe(`${ORIGIN}/assets/og-image.jpg`);
    expect(existsSync(join(SITE, 'assets/og-image.jpg'))).toBe(true);
  });
});

describe('the landing page links what a judge and Play both need', () => {
  it('links the privacy policy and the live ledger', () => {
    const out = renderLanding();
    expect(out).toContain('href="/privacy.html"');
    expect(out).toContain(`href="${API_ORIGIN}/verify"`);
    expect(out).toContain('href="/pitch/"');
    // Pages has no /verify: a relative ledger link or fetch would 404 there.
    expect(out).not.toContain('href="/verify"');
    expect(out).toContain(`fetch('${API_ORIGIN}/verify?format=json')`);
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
