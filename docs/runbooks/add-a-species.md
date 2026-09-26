---
doc_type: runbook
purpose: "Read this when adding a new species to a nation."
audience: both
last_verified: 2026-09-26
last_verified_commit: 1c03a6e
related_files:
  - packages/shared/src/game/species.ts
  - packages/shared/src/battle/effects.ts
  - packages/shared/src/game/tree.ts
  - packages/sprites/src/species/sparkit.ts
  - packages/sprites/src/species/water.ts
  - packages/sprites/src/index.ts
  - packages/shared/test/balance.test.ts
  - docs/design/species-and-nations.md
---

# Add a Species

When you need to design a new species and register it across the sprite, shared, and database layers.

## 1. Plan the species

Choose a nation, rarity (common or rare), and stat budget. Refer to [species-and-nations.md](../design/species-and-nations.md) for the type cycle, rarity weights, base stat ranges per nation, and the current table of all species.

New species must keep `id === names.baby.toLowerCase()` (`packages/shared/test/battle.test.ts`
enforces this). `cinderpup` is the one documented legacy exception: its id is a stable database key
(`species_base_stats`, `mons.species_id`, battle snapshots) that predates a display-name rename to
"Emberkit", so it cannot change without a migration. Do not introduce a second exception; rename the
display name of a *new* species before shipping it instead.

```bash
# Example: new rare Water species
nation='water'
rarity='rare'
id='<new-species-id>'
baby_name='<Baby Name>'
teen_name='<Teen Name>'
adult_name='<Adult Name>'
```

## 2. Create sprite files

Sprite files are named after the **stage form**, not the species id: each stage of a species
(baby/teen/adult) usually has its own display name (e.g. Pebblet's teen form is "Boulderbyte"), and
`packages/sprites/src/species/` has one file per stage form — 24 files total for the 8 existing
species (`docs/design/species-and-nations.md` "Species data lives in three places"). A species
whose baby/teen/adult names are all different needs three *new* files; reusing an existing form name
means reusing that existing file instead.

Create the three new stage-form files under `packages/sprites/src/species/`, one per stage. Base
each on `packages/sprites/src/species/sparkit.ts` (or copy an existing stage of a species in your
nation), adjust the palette if needed, and export one `SpriteDef` per file whose `id` is
`<stageFormName>-baby|teen|adult`:

```bash
# Example: baby form name equals the species id ("newspecies"); teen/adult are their own names.
cat > packages/sprites/src/species/newspecies.ts << 'EOF'
import type { SpriteDef } from '../types.ts';
// ... build the sprite the same way packages/sprites/src/species/sparkit.ts does
export const NEWSPECIES_BABY: SpriteDef = { id: 'newspecies-baby', /* ... */ };
EOF
# Repeat for the teen form file (e.g. teenformname.ts) and the adult form file (e.g. adultformname.ts).
```

## 3. Register sprites in the nation aggregator and EVOLUTION_LINES

**Edit the existing nation aggregator** (`packages/sprites/src/species/water.ts`, `packages/sprites/src/species/fire.ts`,
`packages/sprites/src/species/earth.ts`, or `packages/sprites/src/species/air.ts` — do not recreate it) to import and append your three new sprites to its
exported array (e.g. `WATER_SPRITES`). Do not touch `packages/sprites/src/index.ts`'s own imports —
it already imports each nation's aggregator array once and does not need per-species changes.

**Add an entry to `EVOLUTION_LINES` in `packages/sprites/src/index.ts`** mapping the species id to
its three stage-form names:

```typescript
// packages/sprites/src/index.ts
export const EVOLUTION_LINES: Record<string, { baby: string; teen: string; adult: string }> = {
  // ... existing entries
  newspecies: { baby: 'newspecies', teen: 'teenformname', adult: 'adultformname' },
};
```

This step is not optional: `spriteIdFor(speciesId, stage)` looks up `EVOLUTION_LINES` to turn a
species id into `` `${form}-${stage}` ``, and a species is missing from this table only renders
correctly at baby stage (where `form` happens to equal the id by convention) — every evolved
(teen/adult) mon has no registered sprite and renders as nothing. This exact bug shipped in 0.2.0
(see the "Fixed 0.2.0" note in `docs/design/species-and-nations.md`) before `EVOLUTION_LINES` was
introduced as the fix.

**Verify:** each new sprite's `.id` field matches `<stageFormName>-<stage>`, the nation aggregator's
exported array includes all three, and `EVOLUTION_LINES[id]` names all three stage forms correctly.

## 4. Run sprite tests and preview

```bash
pnpm --filter @claude-mons/sprites test
pnpm --filter @claude-mons/sprites preview
```

Review output in `packages/sprites/preview/sheet.png` and per-animation PNG strips. Anchor lines (red) must sit at the foot, and the sprite must center ±2 px horizontally.

## 5. Add species to shared table

Edit `packages/shared/src/game/species.ts`: add a new entry to `SPECIES` with the id, nation, rarity, stage names, base stats (HP/ATK/DEF/SPD), an 8-move `movePool`, and flavor text.

Every species needs exactly 8 moves (`docs/design/progression.md` Move pool and effects): slot 1 is
always the `priority` effect (it doubles as the loadout's fixed opener) and unlocks at level 2 along
with slot 2; core slots 3/4/5/6 unlock at 5/10/15/20. Append teen/adult signature
moves in pool slots 7/8 (unlocks 10/25, power 80/85, same effect as core slot 3). Each move gets exactly one of the 8 effects
(`priority`, `crit_up`, `drain`, `shield_first`, `def_down`, `burn`, `true_hit`, `charge` —
`packages/shared/src/battle/effects.ts`) and a `type` of `neutral` or `nation`. Use the `pool()`
helper already in `packages/shared/src/game/species.ts` to build the array and derive each move's `id` (a slug of its name)
automatically:

```typescript
// packages/shared/src/game/species.ts
export const SPECIES: Record<string, Species> = {
  // ... existing
  newspecies: {
    id: 'newspecies',
    nation: 'water',
    rarity: 'rare',
    names: { baby: '<Baby>', teen: '<Teen>', adult: '<Adult>' },
    baseStats: { hp: 80, atk: 50, def: 55, spd: 30 },
    movePool: pool([
      ['<Move 1>', 45, 'neutral', 'priority'],
      ['<Move 2>', 40, 'nation', 'def_down'],
      ['<Move 3>', 75, 'nation', 'crit_up'],
      ['<Move 4>', 50, 'nation', 'true_hit'],
      ['<Move 5>', 55, 'nation', 'burn'],
      ['<Move 6>', 65, 'nation', 'drain'],
      ['<Teen signature>', 80, 'nation', 'crit_up'],
      ['<Adult signature>', 85, 'nation', 'crit_up'],
    ]),
    flavor: '<Flavor text>',
  },
};
```

After adding the species, re-run the balance suite (step 8) — the new species also joins the
archetype matrix in `packages/shared/test/balance.test.ts`, which needs at least one unlocked move
per `ARCHETYPE_EFFECTS` cluster to build a sensible loadout at every level.

**No talent-tree changes needed.** The talent tree (`packages/shared/src/game/tree.ts`) is keyed by
**nation**, not species: every node id is `${nation}:${branchSlug}:${tier}` (3 branches × 6 tiers
per nation, plus 10 shared nation-agnostic passives), and every species in a nation shares that
nation's tree. Adding a species never adds, removes, or touches any tree node — only a new *nation*
would.

## 6. Add new migration

Create a new migration file (do not edit `supabase/migrations/20260904000000_init.sql`):

```bash
cat > supabase/migrations/$(date +%Y%m%d%H%M%S)_add_newspecies.sql << 'EOF'
insert into public.species_base_stats
  (species_id, nation, rarity, weight, hp, atk, def, spd, sort_order)
values
  ('newspecies', 'water', 'rare', 25, 80, 50, 55, 30, 9);
EOF
```

Use the same stats as in step 5. The `sort_order` must increment from the highest existing row, and
it must keep each nation's rows in the same relative order as the `SPECIES` object in
`packages/shared/src/game/species.ts` — insert the SPECIES entry right after the species it follows,
and append the SQL row with the next `sort_order`, so `roll_species` and `rollSpecies` walk the
nation's species in the same order and the same roll picks the same species on both sides.

## 7. Keep the rest of the code in sync

Adding a species touches a few places beyond the three data homes in step 5/6. Skipping any of
these leaves a test failing or the UI/offline hatch out of step:

- **`packages/shared/test/battle.test.ts` shape assertions.** The `species table` describe block
  asserts each nation's species count and rarities, the total `SPECIES_IDS` length, and explicit
  `rollSpecies(nation, roll)` boundaries. When your species changes a nation's count (e.g. a nation
  gaining a second rare), update the per-nation `toHaveLength`/rarity check, the total-count
  assertion, and that nation's roll boundaries (the weights set the cut points — e.g. Water's
  75/25/25 makes the ranges dripple `[0, 0.6)`, bubblit `[0.6, 0.8)`, ottlet `[0.8, 1)`).
- **`packages/sprites/test/index.test.ts` species list.** The "resolves a registered sprite for
  every species at every stage" test iterates a hard-coded list of species ids; add yours so its
  teen/adult sprites are covered.
- **`apps/desktop/src/main/game/species.ts` offline table.** `SPECIES_BY_NATION` (the local/dev
  hatch table used in `CLAUDE_MONS_OFFLINE` / `LOCAL_GAME` mode) must gain the same id + rarity.
  `rollSpeciesForNation` already picks deterministically among species that share the drawn rarity,
  so no code change is needed there for an extra rare — but add it to the table.
- **Mon view odds copy.** `apps/desktop/src/renderer/panel/views/Mon.tsx`'s "What could hatch" list
  computes each species' percentage from `RARITY_WEIGHT` over `speciesForNation(nation)`, so it
  needs no edit; just note the displayed odds shift for any nation whose species set you change (see
  `docs/design/species-and-nations.md` Hatch roll for the per-nation numbers).

## 8. Run the balance suite

```bash
pnpm test
```

The archetype matrix in `packages/shared/test/balance.test.ts` iterates `Object.keys(SPECIES)`
automatically, so your new species is included with no test-code changes: it asserts every
species' win rate across all loadout archetypes stays within **35–65 %** at levels 10 and 30. If
`pnpm test` fails on your new species, tune its `baseStats` or `movePool` (not the test's
thresholds) until it passes — do not loosen the balance harness to make a species fit.

Two other harnesses in the same file (the 3-level-advantage check and the stance-triangle check)
exercise a small fixed set of existing species regardless of how many are in `SPECIES`; they need
no changes for a new species addition.

## 9. Check and deploy

```bash
pnpm check
pnpm deno:check
```

Fix any lint or type errors. Then follow [docs/runbooks/deploy-backend.md](./deploy-backend.md) to deploy the migration.

## Acceptance

- [ ] `pnpm check` and `pnpm deno:check` report 0 errors.
- [ ] `pnpm test` passes, including the new species in the balance suite's archetype matrix.
- [ ] Sprite preview shows the mon at all three stages with correct anchor placement.
- [ ] `packages/shared/src/game/species.ts` SPECIES entry has id, nation, rarity, baseStats, and an 8-move `movePool`.
- [ ] `EVOLUTION_LINES` in `packages/sprites/src/index.ts` maps the species id to its three stage-form names.
- [ ] New migration file inserts the species into `species_base_stats` with matching stats.
- [ ] `speciesOf('<id>')` and `speciesForNation('<nation>')` return the new species; `spriteIdFor('<id>', 'teen')` and `'adult'` resolve to a registered sprite.
