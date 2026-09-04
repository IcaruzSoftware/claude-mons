export type Nation = 'water' | 'fire' | 'earth' | 'air';

/** Nation color sets (DESIGN.md 5.3). Sprites mark tintable pixels with the keys P/S/A/D. */
export const NATION_PALETTES: Record<
  Nation,
  { primary: string; secondary: string; accent: string; dark: string }
> = {
  water: { primary: '#26a69a', secondary: '#1e5aa8', accent: '#e0f7fa', dark: '#0d2a3f' },
  fire: { primary: '#ff5252', secondary: '#ff9100', accent: '#ffd740', dark: '#2b2b2b' },
  earth: { primary: '#6b9b37', secondary: '#8d8d8d', accent: '#ffb300', dark: '#263318' },
  air: { primary: '#64b5f6', secondary: '#f5f5ff', accent: '#b39ddb', dark: '#3a3f5c' },
};

/** Palette keys that `tintPalette` replaces, and the nation color each one takes. */
export const TINT_KEYS = { P: 'primary', S: 'secondary', A: 'accent', D: 'dark' } as const;

/**
 * Returns a copy of `palette` with the tintable keys P/S/A/D replaced by the nation colors.
 * Keys the palette does not define are not added; all other keys are untouched.
 */
export function tintPalette(
  palette: Record<string, string>,
  nation: Nation,
): Record<string, string> {
  const colors = NATION_PALETTES[nation];
  const out: Record<string, string> = { ...palette };
  for (const [key, role] of Object.entries(TINT_KEYS) as Array<
    [keyof typeof TINT_KEYS, (typeof TINT_KEYS)[keyof typeof TINT_KEYS]]
  >) {
    if (key in out) out[key] = colors[role];
  }
  return out;
}

/** Parses '#rgb', '#rgba', '#rrggbb' or '#rrggbbaa' into [r, g, b, a] (0-255). Throws on bad input. */
export function hexToRgba(hex: string): [number, number, number, number] {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if ((h.length !== 6 && h.length !== 8) || !/^[0-9a-fA-F]+$/.test(h)) {
    throw new Error(`Invalid hex color: ${JSON.stringify(hex)}`);
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255;
  return [r, g, b, a];
}
