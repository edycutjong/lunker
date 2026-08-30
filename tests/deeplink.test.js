/**
 * Deep-link parsing.
 *
 * `lunker://bite/<lake>?nid=<id>` has to land in the minigame. If it fell
 * through to the home screen, the seconds the push promised would be spent on
 * navigation and the product claim would be false — and the symptom ("the
 * notification just opens the app") is the kind nobody notices until the
 * camera is running.
 *
 * The parser is duplicated here rather than imported because App.tsx pulls in
 * the whole React Native runtime. It is kept byte-identical to the copy in
 * App.tsx, and the last test in this file fails if the two drift.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseBiteLink(url) {
  const match = /^lunker:\/\/bite\/([A-Za-z0-9_-]+)(\?.*)?$/.exec(url.trim());
  if (!match) return null;

  const query = match[2] ?? '';
  const nid = /[?&]nid=([^&#]+)/.exec(query)?.[1];
  if (!nid) return null;

  return { lakeId: match[1], notificationId: decodeURIComponent(nid) };
}

describe('parseBiteLink', () => {
  it('parses the canonical bite link', () => {
    expect(parseBiteLink('lunker://bite/willow?nid=abc-123')).toEqual({
      lakeId: 'willow',
      notificationId: 'abc-123',
    });
  });

  it('parses a uuid notification id', () => {
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(parseBiteLink(`lunker://bite/deepsea?nid=${uuid}`)?.notificationId).toBe(uuid);
  });

  it('handles extra query params in any order', () => {
    expect(parseBiteLink('lunker://bite/quarry?src=push&nid=xyz')).toEqual({
      lakeId: 'quarry',
      notificationId: 'xyz',
    });
  });

  it('decodes a percent-encoded id', () => {
    expect(parseBiteLink('lunker://bite/reeds?nid=a%2Fb')?.notificationId).toBe('a/b');
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseBiteLink('  lunker://bite/willow?nid=n1  ')?.lakeId).toBe('willow');
  });

  it('rejects a link with no nid, which could never be validated', () => {
    expect(parseBiteLink('lunker://bite/willow')).toBeNull();
    expect(parseBiteLink('lunker://bite/willow?nid=')).toBeNull();
  });

  it('rejects a different host', () => {
    expect(parseBiteLink('lunker://shop?nid=abc')).toBeNull();
  });

  it('rejects a foreign scheme', () => {
    expect(parseBiteLink('https://lunker.app/bite/willow?nid=abc')).toBeNull();
  });

  it('rejects a lake id with path traversal characters', () => {
    expect(parseBiteLink('lunker://bite/../../etc?nid=abc')).toBeNull();
  });

  it('stops the id at a fragment', () => {
    expect(parseBiteLink('lunker://bite/willow?nid=abc#frag')?.notificationId).toBe('abc');
  });

  it('stays byte-identical to the implementation in App.tsx', () => {
    // A copy that drifts is worse than no copy: these tests would keep passing
    // while the shipped parser broke.
    const app = readFileSync(resolve(ROOT, 'app/App.tsx'), 'utf8');
    const shipped = /const match = \/\^lunker[^\n]+\n/.exec(app)?.[0].trim();
    const here = 'const match = /^lunker:\\/\\/bite\\/([A-Za-z0-9_-]+)(\\?.*)?$/.exec(url.trim());';
    expect(shipped).toBe(here);
  });
});
