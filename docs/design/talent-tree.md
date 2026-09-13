---
doc_type: design
purpose: "Read this when changing talent-tree nodes, budgets, respec rules, or the loadout editor's Talents section."
audience: agent
last_verified: 2026-09-13
last_verified_commit: 1196eff
related_files:
  - packages/shared/src/game/tree.ts
  - packages/shared/src/battle/battle.ts
  - packages/shared/src/battle/effects.ts
  - packages/shared/src/game/progression.ts
  - packages/shared/test/tree.test.ts
  - packages/shared/test/balance.test.ts
  - supabase/functions/set-loadout/index.ts
  - apps/desktop/src/renderer/panel/views/Battles.tsx
  - docs/design/progression.md
---

# Talent tree

Phase C of `docs/design/progression.md`: each mon spends points across 3 branches (6 tiered nodes
each) of its own nation, plus a small nation-agnostic shared-passive pool. All node data and pure
validation live in `packages/shared/src/game/tree.ts`; battle-effect wiring lives in
`packages/shared/src/battle/battle.ts` and `packages/shared/src/battle/effects.ts`.

## Point budget and respec

1 point per level from level 3 to 50, but the tree only *unlocks* at level 3 -- the first point
lands at level 4 (`packages/shared/src/game/tree.ts:pointsAvailable`), so the level-50 total is 47.
A node requires >=1 point already spent in the previous tier of the same branch. Costs: tiers 1-2
cost 1 point/rank (3 ranks each); tiers 3-4 cost 2 points (single rank, per-branch passives); tier 5
costs 3 (move upgrade); tier 6 (capstone) costs 5. Maxing all 3 branches costs 54 against the
47-point budget, so full completion is impossible by design -- the budget forces a specialization
choice. Respec (`packages/shared/src/game/progression.ts:validateLoadout`, called from
`set-loadout`) is free below level 10; at or above it, limited to once per 7 days
(`mons.last_respec_at`). A respec is any submitted change that lowers a node's rank
(`packages/shared/src/game/tree.ts:isRespec`), always re-derived from the submitted ranks
themselves -- the client's own `respec` acknowledgement flag cannot bypass the cooldown.

Move-upgrade nodes (tier 5) grant the equipped move in a fixed loadout slot +6% effect magnitude,
or +3% power if that move has no scaling effect (a `priority`/`true_hit` move) --
`MOVE_UPGRADE_EFFECT_MULT`/`MOVE_UPGRADE_POWER_MULT` in `packages/shared/src/battle/effects.ts`,
tuned down from the design's original +25%/+10% (see Balance targets below).

| Nation | Branch | Upgrades | Tier | Node | Effect |
|---|---|---|---|---|---|
| water | Current | slot 2 | 1 | Riverrun | +ATK/rank, 3 ranks |
| water | Current | slot 2 | 2 | Millrace | +ATK/rank, 3 ranks |
| water | Current | slot 2 | 3 | Pressure Head | Nation-type moves deal +5% vs. targets above 50% HP |
| water | Current | slot 2 | 4 | Spillway | This mon's `def_down` also cuts target SPD 10% for its duration |
| water | Current | slot 2 | 5 | Jetstream Coupling | Slot 2 move: move-upgrade |
| water | Current | slot 2 | 6 | Maelstrom | This mon's nation-type crits deal 2.15x instead of 2x |
| water | Undertow | slot 3 | 1 | Backwash | +DEF/rank, 3 ranks |
| water | Undertow | slot 3 | 2 | Riptide Step | +DEF/rank, 3 ranks |
| water | Undertow | slot 3 | 3 | Silt Cloud | This mon's `def_down` lasts 1 extra turn |
| water | Undertow | slot 3 | 4 | Undercurrent | +5pp dodge chance while target is under this mon's `def_down` |
| water | Undertow | slot 3 | 5 | Drift Anchor | Slot 3 move: move-upgrade |
| water | Undertow | slot 3 | 6 | Abyssal Pull | This mon's `def_down` also cuts target SPD by the same % |
| water | Reservoir | slot 1 | 1 | Cistern | +HP/rank, 3 ranks |
| water | Reservoir | slot 1 | 2 | Aquifer | +HP/rank, 3 ranks |
| water | Reservoir | slot 1 | 3 | Slow Leak | This mon's `drain` moves heal +10% more of damage dealt |
| water | Reservoir | slot 1 | 4 | Watershed | Once/battle, damage that would drop this mon below 20% HP heals 10% max HP first |
| water | Reservoir | slot 1 | 5 | Sluice Control | Slot 1 move: move-upgrade |
| water | Reservoir | slot 1 | 6 | Deep Reserve | Max HP +4% flat, stacks with tier 1/2 |
| fire | Blaze | slot 2 | 1 | Flarelight | +ATK/rank, 3 ranks |
| fire | Blaze | slot 2 | 2 | Firebrand | +ATK/rank, 3 ranks |
| fire | Blaze | slot 2 | 3 | Scorchmark | Crits vs. a burning target deal +10% damage |
| fire | Blaze | slot 2 | 4 | Detonation | This mon's `crit_up` moves gain +5pp crit chance |
| fire | Blaze | slot 2 | 5 | Forge Temper | Slot 2 move: move-upgrade |
| fire | Blaze | slot 2 | 6 | Supernova | This mon's crits ignore `shield_first`/`def_down` on the target |
| fire | Kindling | slot 3 | 1 | Spark Catch | +ATK/rank, 3 ranks |
| fire | Kindling | slot 3 | 2 | Smolder | +ATK/rank, 3 ranks |
| fire | Kindling | slot 3 | 3 | Ashfall | This mon's `burn` deals +2% max HP per tick (10% total) |
| fire | Kindling | slot 3 | 4 | Slow Burn | This mon's `burn` duration +1 turn |
| fire | Kindling | slot 3 | 5 | Tinder Box | Slot 3 move: move-upgrade |
| fire | Kindling | slot 3 | 6 | Ashen Cascade | This mon's `burn` may stack a second instance instead of only refreshing |
| fire | Backdraft | slot 1 | 1 | Firebreak | +DEF/rank, 3 ranks |
| fire | Backdraft | slot 1 | 2 | Ember Ward | +DEF/rank, 3 ranks |
| fire | Backdraft | slot 1 | 3 | Flashover | This mon's `shield_first` reduces the first hit 60% instead of 50% |
| fire | Backdraft | slot 1 | 4 | Rekindle Surge | The turn after taking a crit, this mon's next hit deals +15% |
| fire | Backdraft | slot 1 | 5 | Heat Shield | Slot 1 move: move-upgrade |
| fire | Backdraft | slot 1 | 6 | Phoenix Reborn | 22% chance/battle: a KO instead leaves this mon at 5% HP |
| earth | Tremor | slot 2 | 1 | Fault Crack | +ATK/rank, 3 ranks |
| earth | Tremor | slot 2 | 2 | Shockwave Step | +ATK/rank, 3 ranks |
| earth | Tremor | slot 2 | 3 | Ground Shatter | This mon's `def_down` cuts an extra 5pp DEF |
| earth | Tremor | slot 2 | 4 | Resonant Crack | Landing a crit refreshes this mon's active `def_down` on the target |
| earth | Tremor | slot 2 | 5 | Seismic Brace | Slot 2 move: move-upgrade |
| earth | Tremor | slot 2 | 6 | Fissure Reckoning | This mon's `def_down` also cuts target ATK by half that % |
| earth | Canopy | slot 3 | 1 | Undergrowth | +HP/rank, 3 ranks |
| earth | Canopy | slot 3 | 2 | Root Lattice | +HP/rank, 3 ranks |
| earth | Canopy | slot 3 | 3 | Canopy Cover | This mon's `drain` moves heal +10% more of damage dealt |
| earth | Canopy | slot 3 | 4 | Mulch Layer | While above 50% HP, incoming `def_down` lasts 1 fewer turn |
| earth | Canopy | slot 3 | 5 | Grafted Bough | Slot 3 move: move-upgrade |
| earth | Canopy | slot 3 | 6 | Old Growth | Max HP +9% flat, stacks with tier 1/2 |
| earth | Foundation | slot 1 | 1 | Stoneframe | +DEF/rank, 3 ranks |
| earth | Foundation | slot 1 | 2 | Ironvein | +DEF/rank, 3 ranks |
| earth | Foundation | slot 1 | 3 | Load Bearing | This mon's `shield_first` reduces the first hit 60% instead of 50% |
| earth | Foundation | slot 1 | 4 | Reinforced Crust | After taking a hit, the next hit's damage is reduced 5% (once/battle) |
| earth | Foundation | slot 1 | 5 | Retaining Wall | Slot 1 move: move-upgrade |
| earth | Foundation | slot 1 | 6 | Unmovable | A single hit cannot take this mon below 10% max HP (once/battle) |
| air | Cyclone | slot 2 | 1 | Squall Line | +ATK/rank, 3 ranks |
| air | Cyclone | slot 2 | 2 | Downburst | +ATK/rank, 3 ranks |
| air | Cyclone | slot 2 | 3 | Wind Shear | This mon's `true_hit` moves deal +10% damage |
| air | Cyclone | slot 2 | 4 | Funnel Force | This mon's `charge` release deals +15% additional damage |
| air | Cyclone | slot 2 | 5 | Vortex Edge | Slot 2 move: move-upgrade |
| air | Cyclone | slot 2 | 6 | Tempest | This mon's `charge` moves release the same turn, skipping the telegraph |
| air | Cirrus | slot 3 | 1 | Windrise | +SPD/rank, 3 ranks |
| air | Cirrus | slot 3 | 2 | Jetstream Wing | +SPD/rank, 3 ranks |
| air | Cirrus | slot 3 | 3 | Slipstream | This mon's `priority` moves also grant +5% SPD that turn |
| air | Cirrus | slot 3 | 4 | Thermal Lift | When this mon acts first in a turn, its damage +5% |
| air | Cirrus | slot 3 | 5 | Wingtip Trim | Slot 3 move: move-upgrade |
| air | Cirrus | slot 3 | 6 | Eye of the Storm | 40% chance/turn: acts first the turn after it took damage |
| air | Stratus | slot 1 | 1 | Cloudbank | +DEF/rank, 3 ranks |
| air | Stratus | slot 1 | 2 | High Pressure | +DEF/rank, 3 ranks |
| air | Stratus | slot 1 | 3 | Fog Bank | This mon's `shield_first` reduces the first hit 60% instead of 50% |
| air | Stratus | slot 1 | 4 | Static Charge | Being crit grants this mon +10% dodge chance for 1 turn |
| air | Stratus | slot 1 | 5 | Overcast Veil | Slot 1 move: move-upgrade |
| air | Stratus | slot 1 | 6 | Ceiling Break | Once/battle, a hit exceeding 40% of this mon's max HP is capped at 40% |

Per-rank stat magnitude (`STAT_PCT_PER_RANK`, `packages/shared/src/game/tree.ts`) is 0.33%; see
Balance targets for why. `earth`'s Old Growth (+9%) and `water`'s Deep Reserve (+4%) are
deliberately unequal flat-HP capstones -- see Balance targets.

## Shared passives

Ten passives, available regardless of nation, from a separate small pool (1 point each,
`sharedPassivePoints(level)`: one pick every 15 levels, capped at 3 by level 45).

| Passive | Effect |
|---|---|
| Stone Skin | First hit taken each battle is reduced 25% (stacks with a `shield_first` move) |
| Deep Roots | +20% DEF once this mon drops below 25% HP, for the rest of the battle |
| Bedrock | Immune to critical hits |
| Wildfire | This mon's `burn` deals +30% more damage (2.4pp of max HP/tick) and lasts +1 turn |
| Aftershock | This mon's crits also apply `def_down` |
| Tailwind | Loadout slot 1 always crits |
| Tidal Recovery | Heal 10% max HP on landing a crit |
| Updraft | Guaranteed to act first on turn 1 |
| Second Breath | Survive one KO per battle at 1 HP (only if the mon has no Phoenix Reborn capstone, or it already fired) |
| Ember Heart | The first time this mon's HP drops below 50%, its next move gets +20pp crit chance |

## Implementation notes and simplifications

- **Tier-2 rank-3 alternative not modeled.** The design's "rank 3 may instead be +2pp crit/dodge"
  choice would need per-rank choice storage that `{ [nodeId]: rank }` doesn't have; tier 2's 3rd
  rank always grants the stat bonus. A future phase could add a sibling node id for the alternative.
- **Tier 3/4 nodes are structural only.** They validate (existence, rank, prereq, budget) and cost
  points, but their unique per-branch flavor effects are not wired into `simulateBattle` this
  phase -- same "documented, not yet built" pattern as the move-renaming note in
  `docs/design/progression.md`. Only stat nodes (tier 1-2), move-upgrade (tier 5), capstones
  (tier 6), and the 10 shared passives affect battles.
- **Wild Mons get a default tree.** `packages/shared/src/game/tree.ts:defaultBotTree` spends a bot's
  points down its first branch, tier by tier, so bots scale with level like players
  (`snapshotFor` applies this whenever `playerId === null` and no `loadout.tree` is stored).
- **No SQL mirror.** `mons.loadout` is `jsonb` (already validated at the application layer) and
  `mons.last_respec_at` already exists (`supabase/migrations/20260913020000_progression_phase_a.sql`);
  Phase C added no migration.

## Balance targets

`packages/shared/test/balance.test.ts`'s talent-tree matrix (in addition to the pre-existing
matrices, all still passing):

- a near-budget-maxed tree (points spent tier-by-tier across all 3 branches until the 47-point
  budget at level 50 runs out) beats an empty tree **60-70%** of the time (measured ~67%) --
  the "+15-20% effective power" target;
- for every pair of a nation's 3 branches (each maxed on its own, level 30), neither dominates:
  **40-60%**, measured by a position-bias-corrected metric (see the test file's own comment: a
  same-species mirror match is not exactly 50/50 for every species even with no tree at all, a
  pre-existing per-species characteristic unrelated to talents, so the harness averages both
  orderings to cancel it out rather than measuring one ordered direction).

Getting there required tuning down every magnitude the design doc specified literally, documented
at each constant's definition (`packages/shared/src/game/tree.ts`, `packages/shared/src/battle/effects.ts`):
`STAT_PCT_PER_RANK` 1.5% -> 0.33%/rank; `MOVE_UPGRADE_EFFECT_MULT`/`POWER_MULT` +25%/+10% ->
+6%/+3%; Water's Maelstrom crit multiplier 2.5x -> 2.15x; Earth's Old Growth capstone needed a
*larger* flat-HP bonus (4% -> 9%) than Water's otherwise-identical Deep Reserve, since Earth's
other two branches (Fissure Reckoning, Unmovable) are stronger secondary effects than Water's. Two
capstones needed a trigger *probability* rather than a smaller magnitude, because shrinking a
"prevents death"/"guarantees first move" effect doesn't reduce how much it wins by (surviving or
acting first at all is what wins a short battle, not by how much) -- Fire's Phoenix Reborn
(`PHOENIX_TRIGGER_CHANCE` = 0.22) and Air's Eye of the Storm (`EYE_OF_STORM_CHANCE` = 0.4), both in
`packages/shared/src/battle/effects.ts`.

## Phases

See `docs/design/progression.md` Phases for the overall roadmap; Phase C (this doc) shipped talent
trees, respec, and the Talents section of the loadout editor. Phase D (recent-opponent intel) is
next.
