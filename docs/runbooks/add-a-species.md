---
doc_type: runbook
purpose: "Read this when adding a new species to a nation."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - packages/shared/src/game/species.ts
  - packages/sprites/src/species/sparkit.ts
  - packages/sprites/src/index.ts
  - docs/design/species-and-nations.md
---

# Add a Species

When you need to design a new species and register it across the sprite, shared, and database layers.

## 1. Plan the species

Choose a nation, rarity (common or rare), and stat budget. Refer to [species-and-nations.md](../design/species-and-nations.md) for the type cycle, rarity weights (common: 75, rare: 25), base stat ranges per nation, and the current table of all species.

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

Create three files under `packages/sprites/src/species/` — one per stage. Base each on `packages/sprites/src/species/sparkit.ts` (or copy an existing stage of a species in your nation), adjust palette if needed, then export one `SpriteDef` per file.

```bash
cat > packages/sprites/src/species/water.ts << 'EOF'
import type { SpriteDef } from '../types.ts';
import { DRIPPLE_BABY } from './dripple.ts';
import { TORRENTIDE_ADULT } from './dripple.ts';
// ... (import your three new sprites)
import { YOURSPECIES_BABY } from './yourspecies.ts';
import { YOURSPECIES_TEEN } from './yourspecies.ts';
import { YOURSPECIES_ADULT } from './yourspecies.ts';

export const WATER_SPRITES: SpriteDef[] = [
  DRIPPLE_BABY,
  // ... (existing sprites)
  YOURSPECIES_BABY,
  YOURSPECIES_TEEN,
  YOURSPECIES_ADULT,
];
EOF
```

## 3. Register sprites in SPRITES

`packages/sprites/src/index.ts` imports the nation aggregator. Your three sprite ids must match `<speciesId>-baby|teen|adult`.

**Verify:** each sprite's `.id` field matches the object key in `packages/sprites/src/species/{nation}.ts`, and the aggregator export appears in `packages/sprites/src/index.ts`.

## 4. Run sprite tests and preview

```bash
pnpm --filter @claude-mons/sprites test
pnpm --filter @claude-mons/sprites preview
```

Review output in `packages/sprites/preview/sheet.png` and per-animation PNG strips. Anchor lines (red) must sit at the foot, and the sprite must center ±2 px horizontally.

## 5. Add species to shared table

Edit `packages/shared/src/game/species.ts`: add a new entry to `SPECIES` with the id, nation, rarity, stage names, base stats (HP/ATK/DEF/SPD), move names (normal / typed / special), and flavor text.

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
    moves: { normal: '<Move>', typed: '<Typed>', special: '<Special>' },
    flavor: '<Flavor text>',
  },
};
```

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

## 7. Update balance expectations

If your stats differ from template species, run balance tests:

```bash
pnpm test
```

Edit golden expectations in `packages/shared/test/balance.test.ts` if needed to match your new species.

## 8. Check and deploy

```bash
pnpm check
pnpm deno:check
```

Fix any lint or type errors. Then follow [docs/runbooks/deploy-backend.md](./deploy-backend.md) to deploy the migration.

## Acceptance

- [ ] `pnpm check` and `pnpm deno:check` report 0 errors.
- [ ] Sprite preview shows the mon at all three stages with correct anchor placement.
- [ ] `packages/shared/src/game/species.ts` SPECIES entry has id, nation, rarity, and baseStats.
- [ ] New migration file inserts the species into `species_base_stats` with matching stats.
- [ ] `speciesOf('<id>')` and `speciesForNation('<nation>')` return the new species.
