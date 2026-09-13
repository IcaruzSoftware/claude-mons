---
doc_type: design
purpose: "Read this when changing the panel's visual language, design tokens, or a shared UI component (gems, segmented bars, chips, the game-menu bar) before it looks like a generic web app."
audience: agent
last_verified: 2026-09-13
last_verified_commit: 275569c
related_files:
  - apps/desktop/src/renderer/ui/theme.css
  - apps/desktop/src/renderer/panel/panel.css
  - apps/desktop/src/renderer/panel/views/Mon.tsx
  - apps/desktop/src/renderer/panel/views/Leaderboard.tsx
  - apps/desktop/src/renderer/panel/views/Battles.tsx
  - apps/desktop/src/renderer/panel/views/Settings.tsx
  - apps/desktop/src/renderer/ui/SpriteView.tsx
  - packages/sprites/README.md
  - docs/design/species-and-nations.md
  - docs/design/ui-panels.md
---

# Panel visual language

The 440x660 panel (`apps/desktop/src/renderer/panel/panel.css`, tokens in
`apps/desktop/src/renderer/ui/theme.css`) currently reads as a settings web page: flat rows, a soft
6px radius, one thin border everywhere, a single sans font, an unsegmented gradient XP bar. Owner
feedback: "it looks vibe coded, bloated and not intentional." This doc is the fix — a small, reused
set of tokens and chrome rules so every tab reads as one small game. `docs/design/ui-panels.md` applies
these rules per tab; this doc does not restate per-tab layout.

## Goals

- A restricted palette and a handful of reused shapes (gems, segmented bars, bevelled cards), not a
  new color or radius per component.
- Chrome that reads as game UI (borders, bevels, chunky corners) without abandoning the dark theme or
  legibility at 13px body text.
- No emoji, no photographic or flat "material design" icons — glyphs are either the mon's own pixel
  sprite (`packages/sprites`) or hand-drawn 8x8 pixel icons in the same style.
- Stay inside 440x660 with no horizontal scroll anywhere; vertical scroll is allowed where
  `docs/design/ui-panels.md` says so, never hidden without a visual cue.

## Palette

Keep `--bg`/`--bg-2`/`--bg-3`/`--fg`/`--fg-dim`/`--line`/`--accent` and the four nation colors from
`apps/desktop/src/renderer/ui/theme.css` — they are already the right restricted set. Add two neutrals
rather than new hues:

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0a0b0f` | Deeper than `--bg`; game-menu bar, digital-readout chrome (cooldown timer), gem/badge text on a bright fill |
| `--parchment` | `#f5ecd7` | Warm cream, used sparingly: leaf/point-counter badges, podium plaques, "about" flavor text — never a background |

Every nation color keeps its existing hex from `docs/design/species-and-nations.md`'s palette table;
this doc does not restate them. A nation's color is used at full saturation only for small, bold-text
elements (badges, chips, gem borders, crest tiles) — never as a large body-text background, since a
saturated fill under `--fg`-colored body text at 13px risks failing 4.5:1 contrast (see Accessibility).
For a nation-tinted card background (the Mon hero, arena header), use the nation color as a low-opacity
tint mixed into `--bg-2` (roughly a 15-25% mix, e.g. CSS `color-mix(in srgb, var(--water) 20%, var(--bg-2))`),
not the flat hue.

## Typography

Two families, not one:

- **Display** (`--font-display`): a pixel/bitmap face for headings, tab labels, numerals, badges —
  anywhere text is short, bold and can afford wider letter-spacing. Ship it as a real bundled font
  (a local `.woff2` file under a new `fonts` directory inside `apps/desktop/src/renderer/ui`, loaded
  with `@font-face` from a relative `url()`, never a Google Fonts or other CDN request — the packaged
  app has no guaranteed network access and CLAUDE.md's hook/hardening rules already assume none).
  Fallback stack:
  `'<bundled name>', 'Courier New', ui-monospace, SFMono-Regular, Menlo, monospace` — this fallback is
  exactly today's `--font-pixel` value, so a build without the bundled font degrades to the current
  look instead of breaking.
- **Body** (`--font`): keep the existing system-UI stack. A pixel face below ~11px stops being legible;
  section copy, hints, move descriptions and flavor text stay in the system font at the current 13px
  base / 11px hint sizes.

Do not introduce a third family. A component that needs emphasis uses the display font at a larger
size or the accent color, not a new typeface.

## Spacing scale

Four-pixel base grid, five steps, replacing ad hoc `8px`/`12px`/`16px`/`18px`/`24px` literals in
`apps/desktop/src/renderer/panel/panel.css`:

| Token | Value | Typical use |
|---|---|---|
| `--sp-1` | 4px | icon-to-label gaps, chip padding |
| `--sp-2` | 8px | gem/card internal padding, row gaps |
| `--sp-3` | 12px | card padding, section-internal gaps |
| `--sp-4` | 16px | gaps between sections, view padding |
| `--sp-5` | 24px | separation before a dev-only or footer block |

## Chrome: borders, radii, bevel

- **Border**: 2px solid `--line` on every card-level container (hero, gems, slot cards, banner tiles,
  talent nodes). 2px reads as intentional pixel-art chrome at this DPI; the current 1px reads as a
  default browser hairline.
- **Radius**: 4px (`--radius`) almost everywhere — chunky enough to feel drawn, not rounded enough to
  feel like a native OS control. Circular only for gems' hex/diamond caps, the stance triangle's
  corners, talent nodes, and the pixel toggle switch's knob — shapes that are circular/diamond by
  definition, not by default.
- **Bevel**: every card gets a two-tone inset shadow suggesting a raised pixel-art panel:
  `box-shadow: inset 1px 1px 0 rgba(255,255,255,.06), inset -2px -2px 0 rgba(0,0,0,.35);` alongside its
  border. Buttons in a pressed/active state (the active game-menu tab, a selected pixel-tab) invert it
  to read as pushed in.
- Existing `.stat`/`.hero`/`.board-row` etc. keep their current DOM structure; only the border width,
  radius and box-shadow change — see `docs/design/ui-panels.md`'s implementation plan for order of work.

## Iconography

No emoji anywhere (glyphs must survive font-substitution and packaging identically). Two allowed icon
sources:

1. **The mon's own sprite** (`packages/sprites` via `apps/desktop/src/renderer/ui/SpriteView.tsx`) —
   used directly wherever a mon is depicted (hero, arena, podium, opponent cards), including its idle
   animation loop, never a static crop.
2. **8x8 pixel glyphs**, drawn as inline SVG `<rect>` grids (matching the sprite package's own
   `size: 32` string-row convention conceptually, just smaller) or a CSS grid of `box-shadow` pixels.
   Used for: the four game-menu bar tabs (mon head / trophy-like board / crossed-blades / gear), the
   streak flame, and the talent tree's leaf/point-counter badge. Keep every glyph the same 8x8 logical
   grid and 1-2 colors so the set reads as one family.

## Motion

- Transitions are short: 120-180ms `ease-out` for hover/active state changes, tab switches, and the
  segmented XP bar's fill (replacing the current 300ms `width` transition on `.bar > i`, which is fine
  to keep at 300ms only for the XP fill itself since that one is a meaningful, rarer event worth
  noticing — every other state change uses 120-180ms).
- Sprites keep animating via their own idle loop (`SpriteView`'s `requestAnimationFrame` loop) wherever
  shown; a panel that redesigns a mon into a static image loses the "alive" read that is this app's
  entire premise.
- No motion is required to convey information (a locked talent node is dim and non-interactive, not
  merely animated); this keeps the panel calm at a glance, matching CLAUDE.md's existing behavior-engine
  restraint.

## Component specs

- **Stat gems**: a diamond (`clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)`)
  card per stat, 2px border in a fixed per-stat color (HP fire-red, ATK accent-yellow, DEF earth-green,
  SPD air-blue — these are fixed hints, not the mon's own nation color, so all four stats stay
  visually distinct on every nation's mon), display-font numeral, small dim label beneath.
- **XP bar**: replace the single gradient `<i>` fill with a row of discrete segments (`display:flex`,
  each segment a bordered 1-2px-gapped rect); filled segments use `--accent` with a slight inner
  highlight, empty segments use `--bg-3`. Segment count is cosmetic (12-20), not tied to a real unit —
  it must not imply "1 segment = 1 XP" or any other exact quantity.
- **Chips (move types)**: a `nation`-type move's chip fills solid with that nation's color, dark ink
  text; a `neutral`-type move's chip fills a fixed neutral grey. This maps 1:1 onto
  `docs/design/progression.md`'s move `type: 'neutral' | 'nation'` field — do not invent a third chip
  color per move effect, the type is what the chip encodes.
- **Tabs — bottom game-menu bar, not a top pixel-underline strip.** Justification: three of the four
  tabs now open with a header element that wants the full top of the view (Mon's hero, Battles' arena,
  Leaderboard's banner tiles) — a persistent top tab strip would compete with exactly the element doing
  the most work to look game-like. A bottom bar with a small icon + label per tab (mon/board/battle/gear)
  reads as a console/handheld menu (the mental model this app is already borrowing from), keeps the
  content area's top edge free, and is the natural place for a bevelled "pressed" active state. The
  existing top strip (`apps/desktop/src/renderer/panel/panel.css`'s `.tabs`) is replaced, not kept
  alongside the bottom bar.

## Accessibility

Text contrast stays >=4.5:1 (WCAG AA, normal text) everywhere, including inside a nation-tinted card:

- Body/hint text (`--fg` / `--fg-dim` on `--bg`/`--bg-2`/`--bg-3`) already passes today and is
  unchanged by this doc.
- A nation-color chip/badge/gem-border always pairs with `--ink` (near-black) text, never `--fg` — the
  lightest nation color (`--air`, `#4fc3f7`) against `--ink` measures well above 4.5:1; against `--fg`
  it would not.
- `--parchment` text is only ever placed on `--ink` or `--bg-2`-family backgrounds, never on a nation
  color directly.
- The nation-tint used for a card *background* (the 15-25% mix described under Palette) is a tint of
  `--bg-2`, not the flat hue, specifically so `--fg` body text on top of it keeps the same contrast
  ratio it has on plain `--bg-2`.
