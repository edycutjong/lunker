/**
 * Design tokens. Single source — no hex value is forked into a component.
 *
 * The palette is dark, high-contrast and saturated on purpose: YouTube at 1080p
 * crushes low-contrast mid-tones, and most of the judging happens through a
 * compressed video and a gallery of stills.
 */

export const color = {
  bgBase: '#04171E',
  bgElevated: 'rgba(240,250,246,0.045)',
  bgOverlay: 'rgba(4,23,30,0.80)',
  line: 'rgba(240,250,246,0.10)',

  primary: '#3FDBB6',
  accent: '#FFA05A',

  textHi: '#F0FAF6',
  textMid: '#94B3AC',
  /**
   * 2.81:1 against the base — fails WCAG AA, so it is NEVER used for text a
   * player must read. Locked and disabled affordances only, and only where the
   * meaning is also carried by an explicit lock glyph. This is a build rule.
   */
  textLow: '#47635F',

  success: '#22C55E',
  error: '#EF4444',
} as const;

export const rarityColor = {
  common: color.textMid, // deliberately dull; makes rare feel rare
  uncommon: color.primary,
  rare: color.accent, // the koi-lantern amber — the hero catch sits here
  legendary: '#C77DFF', // the only colour outside the base palette
} as const;

export type Rarity = keyof typeof rarityColor;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = { sm: 8, md: 14, lg: 20, pill: 999 } as const;

import type { TextStyle } from 'react-native';

export const font: {
  numeric: TextStyle;
  display: TextStyle;
  minSize: number;
} = {
  /** Tabular figures are required anywhere a number changes: a countdown whose
   *  digits shift width reads as jitter on video. */
  numeric: { fontVariant: ['tabular-nums'], fontWeight: '700' },
  display: { fontWeight: '700', letterSpacing: -0.5 },
  /** Minimum on-screen size. Judges watch on phones and on projectors. */
  minSize: 14,
};
