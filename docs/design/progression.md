---
doc_type: design
purpose: "Read this when changing moves, stances, talents, matchmaking windows, streaks or evolution stat multipliers, or building the loadout editor."
audience: agent
last_verified: 2026-09-13
last_verified_commit: 8f6efa8
related_files:
  - packages/shared/src/battle/battle.ts
  - packages/shared/src/game/species.ts
  - packages/shared/src/game/levels.ts
  - packages/shared/src/game/nations.ts
  - docs/design/battle.md
  - docs/design/species-and-nations.md
  - supabase/migrations/20260904000000_init.sql
  - packages/shared/test/balance.test.ts
  - apps/desktop/src/renderer/panel/views/Battles.tsx
---

# Progression system

The battle itself stays a deterministic autobattle (`packages/shared/src/battle/battle.ts:simulateBattle`, see `docs/design/battle.md`); this doc adds the skill players exercise *before* a battle: which 6 moves a mon knows, which 3 it brings, its stance, and its talent tree. **Design target for phases A–D** (see Phases); not all shipped yet — each change lands with its phase.

## Goals

- Keep autobattle: no in-battle move selection by the player.
- Move the skill expression into preparation: move pool, loadout, stance, talents.
- Extend rather than replace `docs/design/battle.md`'s damage formula, turn order and RNG protocol.
- Widen matchmaking and reward streaks without introducing Elo.

## Move pool and effects

Every species gets a 6-move pool. Each move has a `power`, a `type` of `neutral` (never affected by nation matchups) or `nation` (uses `effectiveness()` from `packages/shared/src/game/nations.ts` like today's `typed`/`special` kinds), and exactly one effect:

| Effect | Meaning |
|---|---|
| `priority` | Acts first this turn, overriding the normal speed-probability roll |
| `crit_up` | +20pp critical-hit chance on this move |
| `drain` | Heals the user 50% of damage dealt |
| `shield_first` | The first hit this mon takes in the battle is reduced 50% (once per battle) |
| `def_down` | Target's DEF −25% for 3 turns; reapplying refreshes the duration, does not stack |
| `burn` | Target loses 8% max HP at the end of each turn for 3 turns (one instance active at a time) |
| `true_hit` | Ignores the target's dodge chance |
| `charge` | Turn 1 telegraphs for 0 damage; turn 2 auto-releases at 2.2× power |

Unlock schedule (by mon level): 2 moves at hatch (level 2), 3rd at 5, 4th at 10, 5th at 15, 6th at 20. Slots 1–3 are each species' current `normal`/`typed`/`special` move, kept as-is (unlock 2/2/5); slots 4–6 are new (unlock 10/15/20). Slot 1 is always `priority` — it doubles as the loadout's fixed opener (see Loadout policy). Renaming the existing moves to the new convention is a possible follow-up, not part of this design.

| Species | Slot | Move | Power | Type | Effect | Unlocks |
|---|---|---|---|---|---|---|
| dripple | 1 | Drip Tap | 45 | neutral | priority | 2 |
| dripple | 2 | Stream Splash | 40 | nation | def_down | 2 |
| dripple | 3 | Backpressure | 75 | nation | shield_first | 5 |
| dripple | 4 | Ripple Step | 50 | neutral | priority | 10 |
| dripple | 5 | Pressure Jet | 55 | nation | crit_up | 15 |
| dripple | 6 | Deep Current | 65 | nation | drain | 20 |
| bubblit | 1 | Bubble Pop | 45 | neutral | priority | 2 |
| bubblit | 2 | Cache Wave | 40 | nation | drain | 2 |
| bubblit | 3 | Full Outer Join | 75 | nation | true_hit | 5 |
| bubblit | 4 | Foam Barrier | 50 | nation | shield_first | 10 |
| bubblit | 5 | Brine Corrode | 55 | nation | def_down | 15 |
| bubblit | 6 | Scalding Current | 65 | nation | burn | 20 |
| sparkit | 1 | Spark Nip | 45 | neutral | priority | 2 |
| sparkit | 2 | Hot Reload | 40 | nation | crit_up | 2 |
| sparkit | 3 | Force Push | 75 | nation | def_down | 5 |
| sparkit | 4 | Brushfire | 50 | nation | true_hit | 10 |
| sparkit | 5 | Kindling Surge | 58 | nation | charge | 15 |
| sparkit | 6 | Flash Ignite | 50 | neutral | priority | 20 |
| cinderpup | 1 | Ember Bite | 45 | neutral | priority | 2 |
| cinderpup | 2 | Hotfix Howl | 40 | nation | burn | 2 |
| cinderpup | 3 | Overclock | 75 | nation | crit_up | 5 |
| cinderpup | 4 | Ashfang Strike | 50 | nation | crit_up | 10 |
| cinderpup | 5 | Cinder Feast | 55 | nation | drain | 15 |
| cinderpup | 6 | Soot Ward | 50 | nation | shield_first | 20 |
| pebblet | 1 | Pebble Toss | 45 | neutral | priority | 2 |
| pebblet | 2 | Bedrock Slam | 40 | nation | def_down | 2 |
| pebblet | 3 | Monolith Drop | 75 | nation | crit_up | 5 |
| pebblet | 4 | Fault Line | 50 | nation | def_down | 10 |
| pebblet | 5 | Magma Vein | 55 | nation | burn | 15 |
| pebblet | 6 | Landslide | 65 | nation | true_hit | 20 |
| mossling | 1 | Moss Pat | 45 | neutral | priority | 2 |
| mossling | 2 | Root Bind | 40 | nation | def_down | 2 |
| mossling | 3 | terraform apply | 75 | nation | drain | 5 |
| mossling | 4 | Taproot Surge | 58 | nation | charge | 10 |
| mossling | 5 | Spore Burst | 50 | neutral | priority | 15 |
| mossling | 6 | Ironwood Strike | 60 | nation | crit_up | 20 |
| puffle | 1 | Puff | 45 | neutral | priority | 2 |
| puffle | 2 | Gust Draft | 40 | nation | crit_up | 2 |
| puffle | 3 | Thunderclap | 75 | nation | true_hit | 5 |
| puffle | 4 | Vortex Pull | 50 | nation | drain | 10 |
| puffle | 5 | Windbreak | 50 | nation | shield_first | 15 |
| puffle | 6 | Pressure Drop | 55 | nation | def_down | 20 |
| wispit | 1 | Wisp Flick | 45 | neutral | priority | 2 |
| wispit | 2 | Zephyr Cut | 40 | nation | crit_up | 2 |
| wispit | 3 | Riddle of the Docs | 75 | nation | def_down | 5 |
| wispit | 4 | Windburn | 50 | nation | burn | 10 |
| wispit | 5 | Foretold Squall | 58 | nation | true_hit | 15 |
| wispit | 6 | Gathering Storm | 60 | nation | charge | 20 |

## Loadout policy

A loadout is 3 of the mon's unlocked moves plus a stance. Selection each turn (one RNG draw, replacing the current `normal`/`typed`/`special` choice in `simulateBattle`):

- **Slot 1** always opens turn 1.
- **Slot 3** fires once per battle, the first turn target HP < 35% or own HP < 40% (whichever comes first).
- Otherwise: slot 2 with probability 0.8, slot 1 with probability 0.2.
- A `charge` move's release always fires on its own second turn regardless of this policy.

This supersedes `docs/design/battle.md`'s `special`-at-≤50%-own-HP rule once Phase B ships; slot 3 keeps each species' current `special` move, so the finisher role carries over.

## Stances

Three stances, ±18% opposed stat trade-offs in a rock-paper-scissors triangle. Countering the opponent's stance grants +10% damage dealt and −10% damage taken for the whole battle.

| Stance | Grants | Costs | Beats | Loses to |
|---|---|---|---|---|
| Fury | ATK +18% | DEF −18% | Gale | Bulwark |
| Bulwark | DEF +18% | SPD −18% | Fury | Gale |
| Gale | SPD +18% | ATK −18% | Bulwark | Fury |

## Talent tree

1 point per level from level 3 to 50 (47 points total). Points are spent in the mon's own nation only (fixed at hatch), across 3 branches of 6 tiered nodes each. A node requires at least 1 point already spent in the previous tier of the same branch. Costs: tiers 1–2 are 1 point/rank (3 ranks, +1.5% per rank; tier 2's 3rd rank may instead be taken as +2pp crit chance or +2pp dodge chance, branch's choice, see table); tiers 3–4 cost 2 points each (passives); tier 5 costs 3 (move upgrade); tier 6 (capstone) costs 5. Maxing every branch in a nation costs 54 points against a 47-point budget, so full completion is impossible by design — the budget forces a specialization choice. Respec is free below level 10, then limited to once per 7 days (`mons.last_respec_at`); target power at a maxed, budget-respecting spend is **+15–20%** effective power at level 50.

Move-upgrade nodes (tier 5) grant the equipped move in a fixed loadout slot +25% effect magnitude, or +10% power if that move has no scaling effect (a `priority`/`true_hit` move, for instance).

| Nation | Branch | Upgrades | Tier | Node | Effect |
|---|---|---|---|---|---|
| water | Current | slot 2 | 1 | Riverrun | +1.5%/rank ATK, 3 ranks |
| water | Current | slot 2 | 2 | Millrace | +1.5%/rank ATK, 3 ranks; rank 3 may be +2pp crit instead |
| water | Current | slot 2 | 3 | Pressure Head | Nation-type moves deal +5% vs. targets above 50% HP |
| water | Current | slot 2 | 4 | Spillway | This mon's `def_down` also cuts target SPD 10% for its duration |
| water | Current | slot 2 | 5 | Jetstream Coupling | Slot 2 move: +25% effect magnitude or +10% power |
| water | Current | slot 2 | 6 | Maelstrom | This mon's nation-type crits deal 2.5× instead of 2× |
| water | Undertow | slot 3 | 1 | Backwash | +1.5%/rank DEF, 3 ranks |
| water | Undertow | slot 3 | 2 | Riptide Step | +1.5%/rank DEF, 3 ranks; rank 3 may be +2pp dodge instead |
| water | Undertow | slot 3 | 3 | Silt Cloud | This mon's `def_down` lasts 1 extra turn |
| water | Undertow | slot 3 | 4 | Undercurrent | +5pp dodge chance while target is under this mon's `def_down` |
| water | Undertow | slot 3 | 5 | Drift Anchor | Slot 3 move: +25% effect magnitude or +10% power |
| water | Undertow | slot 3 | 6 | Abyssal Pull | This mon's `def_down` also cuts target SPD by the same % |
| water | Reservoir | slot 1 | 1 | Cistern | +1.5%/rank max HP, 3 ranks |
| water | Reservoir | slot 1 | 2 | Aquifer | +1.5%/rank max HP, 3 ranks; rank 3 may be +2pp dodge instead |
| water | Reservoir | slot 1 | 3 | Slow Leak | This mon's `drain` moves heal +10% more of damage dealt |
| water | Reservoir | slot 1 | 4 | Watershed | Once/battle, damage that would drop this mon below 20% HP heals 10% max HP first |
| water | Reservoir | slot 1 | 5 | Sluice Control | Slot 1 move: +25% effect magnitude or +10% power |
| water | Reservoir | slot 1 | 6 | Deep Reserve | Max HP +8% flat, stacks with tier 1/2 |
| fire | Blaze | slot 2 | 1 | Flarelight | +1.5%/rank ATK, 3 ranks |
| fire | Blaze | slot 2 | 2 | Firebrand | +1.5%/rank ATK, 3 ranks; rank 3 may be +2pp crit instead |
| fire | Blaze | slot 2 | 3 | Scorchmark | Crits vs. a burning target deal +10% damage |
| fire | Blaze | slot 2 | 4 | Detonation | This mon's `crit_up` moves gain +5pp crit chance |
| fire | Blaze | slot 2 | 5 | Forge Temper | Slot 2 move: +25% effect magnitude or +10% power |
| fire | Blaze | slot 2 | 6 | Supernova | This mon's crits ignore `shield_first`/`def_down` on the target |
| fire | Kindling | slot 3 | 1 | Spark Catch | +1.5%/rank ATK, 3 ranks |
| fire | Kindling | slot 3 | 2 | Smolder | +1.5%/rank ATK, 3 ranks; rank 3 may be +2pp crit instead |
| fire | Kindling | slot 3 | 3 | Ashfall | This mon's `burn` deals +2% max HP per tick (10% total) |
| fire | Kindling | slot 3 | 4 | Slow Burn | This mon's `burn` duration +1 turn |
| fire | Kindling | slot 3 | 5 | Tinder Box | Slot 3 move: +25% effect magnitude or +10% power |
| fire | Kindling | slot 3 | 6 | Ashen Cascade | This mon's `burn` may stack a second instance instead of only refreshing |
| fire | Backdraft | slot 1 | 1 | Firebreak | +1.5%/rank DEF, 3 ranks |
| fire | Backdraft | slot 1 | 2 | Ember Ward | +1.5%/rank DEF, 3 ranks; rank 3 may be +2pp dodge instead |
| fire | Backdraft | slot 1 | 3 | Flashover | This mon's `shield_first` reduces the first hit 60% instead of 50% |
| fire | Backdraft | slot 1 | 4 | Rekindle Surge | The turn after taking a crit, this mon's next hit deals +15% |
| fire | Backdraft | slot 1 | 5 | Heat Shield | Slot 1 move: +25% effect magnitude or +10% power |
| fire | Backdraft | slot 1 | 6 | Phoenix Reborn | Once/battle, a KO instead leaves this mon at 15% HP with its next hit a guaranteed crit |
| earth | Tremor | slot 2 | 1 | Fault Crack | +1.5%/rank ATK, 3 ranks |
| earth | Tremor | slot 2 | 2 | Shockwave Step | +1.5%/rank ATK, 3 ranks; rank 3 may be +2pp dodge instead |
| earth | Tremor | slot 2 | 3 | Ground Shatter | This mon's `def_down` cuts an extra 5pp DEF |
| earth | Tremor | slot 2 | 4 | Resonant Crack | Landing a crit refreshes this mon's active `def_down` on the target |
| earth | Tremor | slot 2 | 5 | Seismic Brace | Slot 2 move: +25% effect magnitude or +10% power |
| earth | Tremor | slot 2 | 6 | Fissure Reckoning | This mon's `def_down` also cuts target ATK by half that % |
| earth | Canopy | slot 3 | 1 | Undergrowth | +1.5%/rank max HP, 3 ranks |
| earth | Canopy | slot 3 | 2 | Root Lattice | +1.5%/rank max HP, 3 ranks; rank 3 may be +2pp crit instead |
| earth | Canopy | slot 3 | 3 | Canopy Cover | This mon's `drain` moves heal +10% more of damage dealt |
| earth | Canopy | slot 3 | 4 | Mulch Layer | While above 50% HP, incoming `def_down` lasts 1 fewer turn |
| earth | Canopy | slot 3 | 5 | Grafted Bough | Slot 3 move: +25% effect magnitude or +10% power |
| earth | Canopy | slot 3 | 6 | Old Growth | Max HP +8% flat, stacks with tier 1/2 |
| earth | Foundation | slot 1 | 1 | Stoneframe | +1.5%/rank DEF, 3 ranks |
| earth | Foundation | slot 1 | 2 | Ironvein | +1.5%/rank DEF, 3 ranks; rank 3 may be +2pp crit instead |
| earth | Foundation | slot 1 | 3 | Load Bearing | This mon's `shield_first` reduces the first hit 60% instead of 50% |
| earth | Foundation | slot 1 | 4 | Reinforced Crust | After taking a hit, the next hit's damage is reduced 5% (once/battle) |
| earth | Foundation | slot 1 | 5 | Retaining Wall | Slot 1 move: +25% effect magnitude or +10% power |
| earth | Foundation | slot 1 | 6 | Unmovable | A single hit cannot take this mon below 10% max HP (once/battle) |
| air | Cyclone | slot 2 | 1 | Squall Line | +1.5%/rank ATK, 3 ranks |
| air | Cyclone | slot 2 | 2 | Downburst | +1.5%/rank ATK, 3 ranks; rank 3 may be +2pp crit instead |
| air | Cyclone | slot 2 | 3 | Wind Shear | This mon's `true_hit` moves deal +10% damage |
| air | Cyclone | slot 2 | 4 | Funnel Force | This mon's `charge` release deals +15% additional damage |
| air | Cyclone | slot 2 | 5 | Vortex Edge | Slot 2 move: +25% effect magnitude or +10% power |
| air | Cyclone | slot 2 | 6 | Tempest | This mon's `charge` moves release the same turn, skipping the telegraph |
| air | Cirrus | slot 3 | 1 | Windrise | +1.5%/rank SPD, 3 ranks |
| air | Cirrus | slot 3 | 2 | Jetstream Wing | +1.5%/rank SPD, 3 ranks; rank 3 may be +2pp dodge instead |
| air | Cirrus | slot 3 | 3 | Slipstream | This mon's `priority` moves also grant +5% SPD that turn |
| air | Cirrus | slot 3 | 4 | Thermal Lift | When this mon acts first in a turn, its damage +5% |
| air | Cirrus | slot 3 | 5 | Wingtip Trim | Slot 3 move: +25% effect magnitude or +10% power |
| air | Cirrus | slot 3 | 6 | Eye of the Storm | This mon always acts first the turn after it took damage |
| air | Stratus | slot 1 | 1 | Cloudbank | +1.5%/rank DEF, 3 ranks |
| air | Stratus | slot 1 | 2 | High Pressure | +1.5%/rank DEF, 3 ranks; rank 3 may be +2pp dodge instead |
| air | Stratus | slot 1 | 3 | Fog Bank | This mon's `shield_first` reduces the first hit 60% instead of 50% |
| air | Stratus | slot 1 | 4 | Static Charge | Being crit grants this mon +10% dodge chance for 1 turn |
| air | Stratus | slot 1 | 5 | Overcast Veil | Slot 1 move: +25% effect magnitude or +10% power |
| air | Stratus | slot 1 | 6 | Ceiling Break | Once/battle, a hit exceeding 40% of this mon's max HP in damage is capped at 40% |

### Shared passives

Ten passives, available regardless of nation, occupying their own small pool of points (not part of the 47/nation budget above; exact slotting is a Phase C implementation detail).

| Passive | Effect |
|---|---|
| Stone Skin | First hit taken each battle is reduced 25% |
| Deep Roots | +20% DEF once this mon drops below 25% HP |
| Bedrock | Immune to critical hits |
| Wildfire | This mon's `burn` deals +30% damage and lasts +1 turn |
| Aftershock | This mon's crits also apply `def_down` |
| Tailwind | Loadout slot 1 always crits |
| Tidal Recovery | Heal 10% max HP on landing a crit |
| Updraft | Guaranteed to act first on turn 1 |
| Second Breath | Survive one KO per battle at 1 HP |
| Ember Heart | The first time this mon's HP drops below 50%, its next move gets +20pp crit chance |

## Evolution multipliers

`packages/shared/src/game/levels.ts:statAtLevel` gains a per-stage multiplier on top of its existing linear level scaling: Baby ×1.00, Teen ×1.15, Adult ×1.30, keyed off `stageForLevel(level)` (same file). This changes the stat curve `docs/design/battle.md` describes without changing its `(level + 49) / 50` shape; the balance test must be re-verified against the new curve (see Balance targets).

## Matchmaking and streaks

Widens the real-player search beyond today's `LEVEL_WINDOWS = [3, 6, 10, null]` in `supabase/migrations/20260904000000_init.sql`'s `pick_opponent` / `findOpponent()` (`docs/design/battle.md` Matchmaking section): three passes of asymmetric level windows relative to the challenger's own level, `[-2, +1]` then `[-4, +2]` then any level, stopping at the first pass with a candidate. A Wild Mon (bot) opponent's level is `own level + rng(-3, +1)`; 10% of Wild Mon encounters roll as **elite** — `+3` levels and double the challenger's XP reward on a win.

Win streaks add +10% challenger XP per consecutive win, capped at +50% (5 wins), resetting to 0 on a loss; tracked in `mons.win_streak` (new column). No Elo/rating system in v1.

## Data model and API

New fields on `public.mons` (`supabase/migrations/20260904000000_init.sql`), added by a new migration per the `CLAUDE.md` Gotcha that the init migration is not edited in place — see `supabase/migrations/<timestamp>_progression.sql`:

| Column | Type | Holds |
|---|---|---|
| `loadout` | `jsonb` | `{ moves: [string, string, string], stance: string, tree: { [nodeId]: rank } }` |
| `win_streak` | `int` | Consecutive real-player wins, see Matchmaking above |
| `last_respec_at` | `timestamptz` | Enforces the once-per-7-days respec cooldown past level 10 |

A new Edge Function, `set-loadout`, validates a submitted loadout against the mon's level (which moves and tree tier are unlocked), the nation's talent budget, and node prerequisites, via a pure shared `validateLoadout` (`packages/shared/src/game/<progression>.ts:validateLoadout` — new file, Deno-safe like the rest of `packages/shared`). `MonSnapshot` (`packages/shared/src/battle/battle.ts`) gains a `loadout` field, stored in `public.battles.challenger_snapshot`/`opponent_snapshot` so old battle logs keep replaying against the loadout that was actually equipped. `apps/desktop/src/renderer/panel/views/Battles.tsx` gains a loadout editor overlay (moves/stance/tree) and recent-opponent cards summarizing the last few foes' setups.

## Balance targets

Extends `packages/shared/test/balance.test.ts`'s matrix (currently cross-nation only, level 10, 150 battles per pair) to every species × 4 loadout archetypes (aggro/bulk/dot/tempo) × 3 stances, at levels 10 and 30, cross-nation only:

- every species stays within **35–65%** win rate across its matchups (unchanged threshold from
  `docs/design/battle.md`);
- no single archetype exceeds **60%** win rate across the matrix;
- the stance triangle holds at roughly **55/45** for the counter side;
- boundary matchups (level 9 vs. 11, level 24 vs. 26 — either side of a stage transition) stay in bounds.

Any change to `simulateBattle`'s RNG call order (adding a talent roll, a stance check, etc.) resets the golden log snapshot (`docs/design/battle.md` Determinism contract) and bumps the battle protocol version.

## Phases

| Phase | Scope |
|---|---|
| A | Stances, evolution multipliers, matchmaking windows, win streaks |
| B | Move pool (6/species), loadout policy, `MonSnapshot.loadout`, `set-loadout` |
| C | Talent tree (nation branches + shared passives), respec |
| D | Recent-opponent intel: `explainMatchup` summaries on the Battles tab |
