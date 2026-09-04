---
doc_type: reference
purpose: "Read this when authoring sprite definitions (SpriteDef), understanding the grid format, or running the preview script."
audience: agent
last_verified: 2026-09-05
last_verified_commit: 6d99ae3
related_files:
  - packages/sprites/src/types.ts
  - packages/sprites/src/palette.ts
  - packages/sprites/src/util.ts
  - packages/sprites/test/sprites.test.ts
  - packages/sprites/scripts/preview.ts
---

# Sprite Package

This package defines and renders animated sprites for mons, eggs, and FX overlays. Sprites are authored as grid-based frame strings and exported as `SpriteDef` objects from `packages/sprites/src/types.ts`.

## SpriteDef Format

A `SpriteDef` in `packages/sprites/src/types.ts` comprises:

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | e.g. `'egg'`, `'sparkit-baby'`, `'fx-zzz'` |
| `size` | 32 \| 48 | Grid width and height in chars; 32 for egg/baby/teen/FX, 48 for adults |
| `palette` | Record<char, hex> | Maps single-char palette keys to hex colors (`#rrggbb`, `#rrggbbaa`, or 3/4-digit shorthand) |
| `anchor` | { x, y } | Foot point in grid pixels; sprite stands on anchor row |
| `anims` | Partial<Record<AnimName, AnimDef>> | One or more animations; `idle` is required |

Each frame is a string of `size` rows of `size` chars joined by `\n`. The `.` char is always transparent; all other chars must exist in the palette. Use `frame()` and `rowsOf()` from `packages/sprites/src/util.ts` to join and split frame strings.

### Frame Example

A 4×4 frame for a hypothetical mon:

```
PPPP
PhhP
P..P
PPPP
```

Rendered with palette `{ P: '#ff5252', h: '#ffffff' }` and rasterized to RGBA.

## Palette and Tinting

The shared `NATION_PALETTES` in `packages/sprites/src/palette.ts` defines four colors per nation (water/fire/earth/air): primary (P), secondary (S), accent (A), and dark (D).

To make a sprite tintable by nation, use those keys in its palette. Call `tintPalette(palette, nation)` to replace only the keys present, leaving unrelated keys (like eye or outline colors) untouched.

## Grid Sizes and Anchors

| Stage | Size | Anchor | Notes |
|-------|------|--------|-------|
| Egg | 32 | {16, 31} | Stands on row 31; centered ±2 px |
| Baby | 32 | {16, 31} | Foot point at row 31 |
| Teen | 32 | {16, 31} | Foot point at row 31 |
| Adult | 48 | {24, 47} | Foot point at row 47 |
| FX | 32 | {16, 31} | Content in upper-left quadrant; shared 32-grid with mons |

Tests assert idle idle bbox bottom == anchor.y and horizontal centering ±2 px.

## Required Animations and Timing

**Species (all stages):** idle, walk, sleep, work, happy, hurt, attack

| Animation | FPS | Loop | Common Frames |
|-----------|-----|------|---|
| idle | 3 | true | 2–3 |
| walk | 8 | true | 4 |
| sleep | 1 | true | 2 |
| work | 6 | true | 3 |
| happy | 8 | true | 3 |
| hurt | 8 | true | 2 |
| attack | 10 | **false** | 3–4 |

**Egg:** idle, wobble, crack

| Animation | FPS | Loop | Frames |
|-----------|-----|------|--------|
| idle | 2 | true | 2 |
| wobble | 8 | true | 4 |
| crack | 6 | **false** | 4 (hairline → medium → big → burst) |

**FX (all types):** idle only

| FX | FPS | Loop | Frames |
|----|-----|------|--------|
| zzz | 2 | true | 3 |
| sparkle | 6 | true | 3 |
| sweat | 6 | true | 3 |
| question | 3 | true | 2 |
| heart | 6 | true | 3 |

## Authoring Helpers

`packages/sprites/src/util.ts` exports helpers that never mutate input:

| Function | Purpose |
|----------|---------|
| `blank(size)` | Create a size×size grid of `.` |
| `place(base, art, x, y)` | Paint `art` onto `base` at (x, y); `.` pixels skip; clips out-of-bounds |
| `compose(size, layers)` | Composite layers (back to front) onto blank grid |
| `shift(rows, dx, dy)` | Translate art; uncovered cells become `.` |
| `flipH(rows)` | Mirror left-to-right |
| `mirrorH(half)` | Build symmetric art from its left half |
| `squashTop(rows, untilRow)` | Breathing squash: rows 0..(untilRow-1) move down; feet stay planted |
| `lean(rows, pivotRow, step, dir)` | Lean top sideways (used for egg wobble) |
| `recolor(rows, map)` | Replace chars according to `map` |
| `withRows(rows, overrides)` | Replace specific rows by index |
| `dots(rows, char, points)` | Paint single pixels at (x,y) positions |

See `packages/sprites/src/egg.ts` or `packages/sprites/src/species/sparkit.ts` for real usage.

## Registry and Lookup

`packages/sprites/src/index.ts` exports:

- `SPRITES` — Record<id, SpriteDef> with 30 entries (egg, 24 species across 4 nations, 5 FX)
- `getSprite(id)` — Throws on unknown id
- `spriteIdFor(speciesId, stage)` — Returns `'egg'` for egg stage, else `` `${speciesId}-${stage}` ``

## Rasterization

`packages/sprites/src/raster.ts` converts SpriteDef frames to RGBA pixel buffers:

| Function | Purpose |
|----------|---------|
| `animOf(def, name)` | Get anim, falling back to idle |
| `frameAt(def, name, ms)` | Frame index at elapsed time; loop wraps, non-loop clamps |
| `frameBBox(def, name, frame)` | Opaque bounds (alpha > 0), or null if empty |
| `rasterize(def, name, frame, paletteOverride?)` | → RasterFrame { width, height, data: Uint8ClampedArray, bbox } |

Missing palette keys render magenta (visible error), and alpha-0 entries are excluded from bbox.

## Test Invariants

`packages/sprites/test/sprites.test.ts` enforces:

- [ ] Registry keys == sprite ids
- [ ] Fire line (sparkit, blazebit, infernode) has full animation set (7 anims)
- [ ] Egg has exactly idle, wobble, crack
- [ ] Every sprite has non-empty idle
- [ ] Palette keys are single chars; no `.` key; all values parse as valid hex
- [ ] Anchor is inside grid
- [ ] Every frame is exactly size×size; all chars in palette
- [ ] Every frame has non-null bbox (non-empty opaque pixels)
- [ ] Consecutive frames in any animation differ
- [ ] Egg/sparkit-baby/blazebit-teen/infernode-adult stand on anchor row and center ±2 px

## Preview Script

`pnpm --filter @claude-mons/sprites preview` renders PNG strips per animation to `packages/sprites/preview/` (gitignored). Output includes per-anim strips with red anchor line and a contact sheet (`sheet.png`). The script is not run in CI and depends only on Node built-ins (`node:fs`, `node:zlib`).
