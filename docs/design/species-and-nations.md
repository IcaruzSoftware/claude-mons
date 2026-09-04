---
doc_type: design
purpose: "Read this when adding/changing a nation, species, hatch rarity, stage threshold, or sprite id, and need every place that must stay in sync."
audience: agent
last_verified: 2026-09-05
last_verified_commit: 6d99ae3
related_files:
  - packages/shared/src/game/nations.ts
  - packages/shared/src/game/species.ts
  - packages/shared/src/game/levels.ts
  - packages/sprites/src/index.ts
  - packages/sprites/src/egg.ts
  - supabase/migrations/20260904000000_init.sql
---

# Species & Nations

## Nations

A player picks one nation at first launch (`packages/shared/src/types.ts`); it is permanent and doubles as the mon's battle type. Metadata lives in `packages/shared/src/game/nations.ts`.

| Nation | Personality | Palette (primary / secondary / accent / dark) |
|---|---|---|
| Water | Calm and adaptive. Flows around problems, refactors with patience, loves pipelines. | `#2ec4b6` / `#1b4f8a` / `#e8fbff` / `#0d2a4a` |
| Fire | Bold and quick. Ships hotfixes at 2 a.m. and never leaves a build red for long. | `#ff5252` / `#ff9100` / `#ffd740` / `#3a0f0f` |
| Earth | Steady and reliable. Tests everything twice, tends the infrastructure, keeps the monolith standing. | `#7cb342` / `#8d8d8d` / `#ffb300` / `#2e3a1f` |
| Air | Light and curious. Writes the docs, prototypes the wild thing, lives in the cloud. | `#4fc3f7` / `#f5f7ff` / `#b39ddb` / `#2b3550` |

Each nation's egg sprite and per-species sprites are tinted from this same palette (`packages/sprites/src/palette.ts:tintPalette`).

## Type cycle

`packages/shared/src/game/nations.ts:NATION_BEATS` fixes a 4-cycle: **Water → Fire → Air → Earth → Water**. `effectiveness(attacker, defender)` returns:

| Matchup | Multiplier |
|---|---|
| Attacker's cycle target (attacker beats defender) | 2× |
| Attacker's cycle predecessor (defender beats attacker) | 0.5× |
| Any other pairing | 1× |

Each nation beats exactly one other and is resisted by exactly one other; the fourth nation is neutral both ways.

## Species

Eight species, two per nation (one common, one rare), defined in `packages/shared/src/game/species.ts` and mirrored in `supabase/migrations/20260904000000_init.sql` (`species_base_stats`). Rarity weights: `RARITY_WEIGHT = { common: 75, rare: 25 }`.

| Nation | Id | Rarity | Baby → Teen → Adult | HP/ATK/DEF/SPD | Moves (normal / typed / special) |
|---|---|---|---|---|---|
| Water | dripple | common | Dripple → Pipefin → Torrentide | 85/45/50/30 | Drip Tap / Stream Splash / Backpressure |
| Water | bubblit | rare | Bubblit → Cachecoral → Deepseaquel | 80/50/55/30 | Bubble Pop / Cache Wave / Full Outer Join |
| Fire | sparkit | common | Sparkit → Blazebit → Infernode | 70/60/40/40 | Spark Nip / Hot Reload / Force Push |
| Fire | cinderpup | rare | Cinderpup → Hotfixhound → Overclockwolf | 75/60/40/40 | Ember Bite / Hotfix Howl / Overclock |
| Earth | pebblet | common | Pebblet → Boulderbyte → Monolithor | 90/45/55/20 | Pebble Toss / Bedrock Slam / Monolith Drop |
| Earth | mossling | rare | Mossling → Rootling → Terraformer | 85/50/55/25 | Moss Pat / Root Bind / `terraform apply` |
| Air | puffle | common | Puffle → Gustling → Nimbyte | 65/50/40/55 | Puff / Gust Draft / Thunderclap |
| Air | wispit | rare | Wispit → Zephyrix → Stratosphinx | 70/50/40/55 | Wisp Flick / Zephyr Cut / Riddle of the Docs |

`speciesOf(id)` throws on an unknown id; `speciesForNation(nation)` filters `SPECIES` by nation; `displayName(speciesId, stage)` returns `'Egg'` for stage `'egg'`, else the per-stage name above.

## Hatch roll

The species is chosen server-side, restricted to the player's own nation, weighted by rarity. `packages/shared/src/game/species.ts:rollSpecies` takes a nation and a uniform `roll` in `[0, 1)` supplied by the caller (never `Math.random()` inside this function) and walks the nation's species in table order, subtracting each one's weight until the running total goes negative. `supabase/migrations/20260904000000_init.sql`'s `roll_species(p_nation, p_roll)` function implements the identical algorithm over `species_base_stats`, walking rows by `sort_order` — the two must stay in the same relative order (common before rare) so the same `roll` value picks the same species on both sides. In production the roll comes from `supabase/functions/_shared/random.ts:randomUnit`, passed through as `apply_xp`'s `p_species_roll`.

## Stages

`packages/shared/src/game/levels.ts:stageForLevel` derives stage purely from level:

| Stage | Level range |
|---|---|
| Egg | 1 (level < 2) |
| Baby | 2–9 |
| Teen | 10–24 |
| Adult | 25–50 |

`TEEN_LEVEL = 10`, `ADULT_LEVEL = 25`, `MAX_LEVEL = 50`. Per-level stat scaling is `statAtLevel()` in the same file; it is not restated here.

## Sprite id convention

`packages/sprites/src/index.ts:spriteIdFor` returns the shared id `'egg'` for stage `'egg'`, otherwise `` `${speciesId}-${stage}` `` (e.g. `dripple-teen`). Species sprite files live in `packages/sprites/src/species/{water,fire,earth,air}.ts`, one file per species exporting an id of the form `<babyName>-baby|teen|adult`.

## Species data lives in three places

These must agree on id, nation, rarity, and (for the first two) stats — the code wins on conflict:

| Location | Path | Holds |
|---|---|---|
| Shared game table | `packages/shared/src/game/species.ts` | Canonical: id, nation, rarity, names, base stats, moves, flavor |
| SQL seed | `supabase/migrations/20260904000000_init.sql` (`species_base_stats`) | id, nation, rarity, weight, stats, `sort_order` — used by `roll_species` and the nation leaderboard |
| Sprite files | `packages/sprites/src/species/{water,fire,earth,air}.ts` | One `SpriteDef` per species per stage, id `<babyName>-baby|teen|adult` |

## Egg cracking

The egg sprite (`packages/sprites/src/egg.ts`) has a single non-looping `crack` animation of four frames — hairline crack, medium crack, big crack, then a light-burst frame — played once at hatch time. It is a fixed visual sequence, not a meter: nothing in the sprite or its caller maps crack frame to XP percentage toward hatch.

`apps/desktop/src/renderer/pet/PetRenderer.ts` selects it: the shared `animationFor(state, stage)` (`packages/shared/src/behavior/states.ts`) maps the `hatching` state at `egg` stage to the `crack` clip, and the renderer's rasterizer advances its four frames at the clip's own fps, holding the last frame since the clip does not loop. This is independent of the `hatching` state's own expiry (`DURATIONS.HATCHING`) and the main process's stage-swap delay after `game:hatch` (see [onboarding.md](../architecture/flows/onboarding.md)) — the crack frames are timed only by the sprite's own animation definition.
