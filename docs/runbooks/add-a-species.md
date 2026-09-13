---
doc_type: runbook
purpose: "Read this when adding a new species to a nation."
audience: both
last_verified: 2026-09-13
last_verified_commit: 8a24ac9
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

**Edit the existing nation aggregator** (`packages/sprites/src/species/water.ts`, `fire.ts`,
`earth.ts`, or `air.ts` — do not recreate it) to import and append your three new sprites to its
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

Edit `packages/shared/src/game/species.ts`: add a new entry to `SPECIES` with the id, nation, rarity, stage names, base stats (HP/ATK/DEF/SPD), a 6-move `movePool`, and flavor text.

Every species needs exactly 6 moves (`docs/design/progression.md` Move pool and effects): slot 1 is
always the `priority` effect (it doubles as the loadout's fixed opener) and unlocks at level 2 along
with slot 2; slots 3/4/5/6 unlock at 5/10/15/20. Each move gets exactly one of the 8 effects
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
    ]),
    flavor: '<Flavor text>',
  },
};
```

After adding the species, re-run the balance suite (step 7) — the new species also joins the
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

Use the same stats as in step 5. The `sort_order` must increment from the highest existing row.

## 7. Run the balance suite

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

## 8. Check and deploy

```bash
pnpm check
pnpm deno:check
```

Fix any lint or type errors. Then follow [docs/runbooks/deploy-backend.md](./deploy-backend.md) to deploy the migration.

## Acceptance

- [ ] `pnpm check` and `pnpm deno:check` report 0 errors.
- [ ] `pnpm test` passes, including the new species in the balance suite's archetype matrix.
- [ ] Sprite preview shows the mon at all three stages with correct anchor placement.
- [ ] `packages/shared/src/game/species.ts` SPECIES entry has id, nation, rarity, baseStats, and a 6-move `movePool`.
- [ ] `EVOLUTION_LINES` in `packages/sprites/src/index.ts` maps the species id to its three stage-form names.
- [ ] New migration file inserts the species into `species_base_stats` with matching stats.
- [ ] `speciesOf('<id>')` and `speciesForNation('<nation>')` return the new species; `spriteIdFor('<id>', 'teen')` and `'adult'` resolve to a registered sprite.
