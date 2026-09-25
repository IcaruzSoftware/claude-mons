---
doc_type: design
purpose: "Read this when adding/changing a nation, species, hatch rarity, stage threshold, or sprite id, and need every place that must stay in sync."
audience: agent
last_verified: 2026-09-25
last_verified_commit: 76a7435
related_files:
  - packages/shared/src/game/nations.ts
  - packages/shared/src/game/species.ts
  - packages/shared/src/game/levels.ts
  - packages/sprites/src/index.ts
  - packages/sprites/src/egg.ts
  - supabase/migrations/20260904000000_init.sql
  - docs/design/progression.md
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
| Attacker's cycle target (attacker beats defender) | 1.2× |
| Attacker's cycle predecessor (defender beats attacker) | 0.9× |
| Any other pairing | 1× |

Each nation beats exactly one other and is resisted by exactly one other; the fourth nation is neutral both ways.

## Species

Nine species, defined in `packages/shared/src/game/species.ts` and mirrored in `supabase/migrations/20260904000000_init.sql` (`species_base_stats`) plus later per-species migrations. Every nation has one common and one rare; Water additionally has a second rare (Ottlet). Rarity weights: `RARITY_WEIGHT = { common: 75, rare: 25 }`.

| Nation | Id | Rarity | Baby → Teen → Adult | HP/ATK/DEF/SPD |
|---|---|---|---|---|
| Water | dripple | common | Dripple → Pipefin → Torrentide | 85/45/50/30 |
| Water | bubblit | rare | Bubblit → Cachecoral → Deepseaquel | 76/50/53/36 |
| Water | ottlet | rare | Ottlet → Brookfin → Tidewhisker | 75/60/40/40 |
| Fire | sparkit | common | Sparkit → Blazebit → Infernode | 70/60/42/38 |
| Fire | cinderpup | rare | Emberkit → Emberfox → Twinflare | 75/60/40/40 |
| Earth | pebblet | common | Pebblet → Boulderbyte → Monolithor | 90/45/55/20 |
| Earth | mossling | rare | Mossling → Rootling → Terraformer | 91/46/55/23 |
| Air | puffle | common | Puffle → Gustling → Nimbyte | 61/52/48/49 |
| Air | wispit | rare | Wispit → Zephyrix → Stratosphinx | 70/48/42/55 |

The `Id` column is a stable database key (`species_base_stats`, `mons.species_id`, battle
snapshots) and never changes; the baby/teen/adult names in the table above are display names only
and can be renamed without a migration -- `cinderpup`'s baby form displays as "Emberkit" while its
id stays `cinderpup`.

Each species also carries a 6-move pool (`Species.movePool`, unlocked progressively from level 2 to
level 20) used by battle; the full per-species move table (power, type, effect, unlock level) lives
in `docs/design/progression.md` Move pool and effects — not restated here since a fact has one home.

`speciesOf(id)` throws on an unknown id; `speciesForNation(nation)` filters `SPECIES` by nation; `displayName(speciesId, stage)` returns `'Egg'` for stage `'egg'`, else the per-stage name above.

## Hatch roll

The species is chosen server-side, restricted to the player's own nation, weighted by rarity. `packages/shared/src/game/species.ts:rollSpecies` takes a nation and a uniform `roll` in `[0, 1)` supplied by the caller (never `Math.random()` inside this function) and walks the nation's species in table order, subtracting each one's weight until the running total goes negative. `supabase/migrations/20260904000000_init.sql`'s `roll_species(p_nation, p_roll)` function implements the identical algorithm over `species_base_stats`, walking rows by `sort_order` — the two must stay in the same relative order (common before rare) so the same `roll` value picks the same species on both sides. In production the roll comes from `supabase/functions/_shared/random.ts:randomUnit`, passed through as `apply_xp`'s `p_species_roll`.

Because weights are per-species, the resulting odds depend on how many species a nation has. Fire, Earth and Air each have one common and one rare, so their odds are common 75 % / rare 25 %. Water has a third species (a second rare), so its total weight is 75 + 25 + 25 = 125 and its odds are dripple 60 % / bubblit 20 % / ottlet 20 %. The Mon view's "What could hatch" list (`apps/desktop/src/renderer/panel/views/Mon.tsx`) computes these percentages from `RARITY_WEIGHT` over `speciesForNation(nation)` rather than hard-coding them, so they follow this table automatically.

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

`packages/sprites/src/index.ts:spriteIdFor` returns the shared id `'egg'` for stage `'egg'`,
otherwise looks up the species id in `EVOLUTION_LINES` (same file) to get that stage's *sprite
form name* and returns `` `${form}-${stage}` `` (e.g. `spriteIdFor('pebblet', 'teen')` →
`'boulderbyte-teen'`, since Pebblet's teen form is drawn as Boulderbyte). A mon keeps its species id
(`pebblet`) for life; only the sprite changes form per stage. `EVOLUTION_LINES` also accepts a
stage-form name as input (falls back to a reverse lookup) so a caller already holding a display name
keeps working.

> Fixed 0.2.0: `spriteIdFor` used to build `` `${speciesId}-${stage}` `` directly, which produced
> ids like `pebblet-teen` that no sprite is registered under (sprites are registered under the stage
> form, `boulderbyte-teen`) — every evolved (teen/adult) mon rendered with no sprite. The
> `EVOLUTION_LINES` table fixes this by mapping species id → per-stage form name explicitly.

## Species data lives in three places

These must agree on id, nation, rarity, and (for the first two) stats — the code wins on conflict:

| Location | Path | Holds |
|---|---|---|
| Shared game table | `packages/shared/src/game/species.ts` | Canonical: id, nation, rarity, names, base stats, moves, flavor |
| SQL seed | `supabase/migrations/20260904000000_init.sql` (`species_base_stats`), plus later per-species migrations (e.g. `supabase/migrations/20260922054153_add_ottlet_species.sql`) | id, nation, rarity, weight, stats, `sort_order` — used by `roll_species` and the nation leaderboard. `sort_order` must follow the insertion order of `SPECIES` in `packages/shared/src/game/species.ts` so the same roll picks the same species on both sides |
| Sprite files | `packages/sprites/src/species/<stageFormName>.ts` (one file per stage form, e.g. `packages/sprites/src/species/pebblet.ts`, `packages/sprites/src/species/boulderbyte.ts`, `packages/sprites/src/species/monolithor.ts`; 27 files total, aggregated per nation by `packages/sprites/src/species/{water,fire,earth,air}.ts`) | One `SpriteDef` per stage form, id `<stageFormName>-baby\|teen\|adult`; mapped back to a species id by `EVOLUTION_LINES` above |

## Egg cracking

The egg sprite (`packages/sprites/src/egg.ts`) has a single non-looping `crack` animation of four frames — hairline crack, medium crack, big crack, then a light-burst frame — played once at hatch time. It is a fixed visual sequence, not a meter: nothing in the sprite or its caller maps crack frame to XP percentage toward hatch.

`apps/desktop/src/renderer/pet/PetRenderer.ts` selects it: the shared `animationFor(state, stage)` (`packages/shared/src/behavior/states.ts`) maps the `hatching` state at `egg` stage to the `crack` clip, and the renderer's rasterizer advances its four frames at the clip's own fps, holding the last frame since the clip does not loop. This is independent of the `hatching` state's own expiry (`DURATIONS.HATCHING`) and the main process's stage-swap delay after `game:hatch` (see [onboarding.md](../architecture/flows/onboarding.md)) — the crack frames are timed only by the sprite's own animation definition.
