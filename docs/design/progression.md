---
doc_type: design
purpose: "Read this when changing moves, stances, talents, matchmaking windows, streaks or evolution stat multipliers, or building the loadout editor."
audience: agent
last_verified: 2026-09-25
last_verified_commit: 1c03a6e
related_files:
  - packages/shared/src/battle/battle.ts
  - packages/shared/src/battle/effects.ts
  - packages/shared/src/battle/matchup.ts
  - packages/shared/src/game/species.ts
  - packages/shared/src/game/levels.ts
  - packages/shared/src/game/nations.ts
  - docs/design/battle.md
  - docs/design/species-and-nations.md
  - docs/design/talent-tree.md
  - supabase/migrations/20260904000000_init.sql
  - supabase/migrations/20260913030000_progression_tuning.sql
  - supabase/migrations/20260913040000_progression_phase_b.sql
  - packages/shared/src/game/progression.ts
  - packages/shared/src/game/tree.ts
  - packages/shared/test/balance.test.ts
  - packages/shared/test/matchup.test.ts
  - apps/desktop/src/renderer/panel/views/Battles.tsx
  - apps/desktop/src/main/game/BattleService.ts
  - apps/desktop/src/main/persistence/state.ts
---

# Progression system

The battle itself stays a deterministic autobattle (`packages/shared/src/battle/battle.ts:simulateBattle`, see `docs/design/battle.md`); this doc adds the skill players exercise *before* a battle: which 6 moves a mon knows, which 3 it brings, its stance, and its talent tree. Phases A–D (see Phases) have all shipped; several magnitudes below were **retuned by simulation on 2026-09-13**, after shipping, to hit their balance targets (see each section's tuning note).

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
| `crit_up` | +30pp critical-hit chance on this move, up to its own 60% ceiling (not the shared 30% crit cap) |
| `drain` | Heals the user 35% of damage dealt |
| `shield_first` | The first hit this mon takes in the battle is reduced 50% (once per battle) |
| `def_down` | Target's DEF −12% for 3 turns; reapplying refreshes the duration, does not stack |
| `burn` | Target loses 3% max HP at the end of each turn for 3 turns (one instance active at a time) |
| `true_hit` | Ignores the target's dodge chance |
| `charge` | Turn 1 telegraphs for 0 damage; turn 2 auto-releases at 2.2× power |

**Tuned by simulation on 2026-09-24**: protocol 5 reduces the elemental swing and rebalances
burn/drain against direct offense (`crit_up` +30pp, ceiling 60%). Five species redistribute the
same rarity stat budget; the shared balance harness retains its equal-level acceptance bands.

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
| ottlet | 1 | Splash Dash | 45 | neutral | priority | 2 |
| ottlet | 2 | Fish Flick | 40 | nation | crit_up | 2 |
| ottlet | 3 | River Rush | 75 | nation | def_down | 5 |
| ottlet | 4 | Whisker Sense | 50 | nation | true_hit | 10 |
| ottlet | 5 | Undertow | 55 | nation | drain | 15 |
| ottlet | 6 | Tidal Tumble | 65 | nation | burn | 20 |
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

## Automatic opening combo

Combat remains passive. Arrange a Burn or DEF-down move in slot 1 before battle. While that
landed opening effect is active, the first different landed Priority, True-hit, Crit-up or Charge
release gets 1.2x direct damage, once per side per battle. Against a higher-level foe,
add 0.5 per higher level (gap capped at 3): 1.7x / 2.2x / 2.7x for this one hit.
The underdog bonus makes a prepared challenge winnable without boosting equal-level combos. Dodges and charge telegraphs do not
consume it; expiry discards it. Healing and further status moves cannot trigger it. Existing
slot selection and combat timing are unchanged; no clicks or timing inputs are added.

## Stances

Three stances in a rock-paper-scissors triangle: each grants +2% to one stat and costs −6% on
another (independently tunable, not opposed-and-equal). Countering the opponent's stance grants +2%
damage dealt and −2% damage taken for the whole battle.

| Stance | Grants | Costs | Beats | Loses to |
|---|---|---|---|---|
| Fury | ATK +2% | DEF −6% | Gale | Bulwark |
| Bulwark | DEF +2% | ATK −6% | Fury | Gale |
| Gale | SPD +2% | ATK −6% | Bulwark | Fury |

**Tuned by simulation on 2026-09-13** (`packages/shared/src/game/progression.ts`; original spec was
±18% grant/cost, ±10% counter bonus): two of three counter pairings won 80-97% of the time (Fury
alone touched both ATK and DEF, giving pairings against it a "double" swing), the third as low as
~37%. Fix: shrink the magnitudes above *and* move Bulwark's cost stat from SPD to ATK, so all three
pairings touch ATK/DEF symmetrically — lands every pairing at 55-62%; see
`packages/shared/test/balance.test.ts`'s stance-triangle test.

## Talent tree

3 branches of 6 tiered nodes per nation, plus a small shared-passive pool, spent from level 3
(47 points by level 50). Full node tables, the shared-passive list, the respec rule and the
"tuned by simulation" magnitudes all live in `docs/design/talent-tree.md` -- this section is
just the pointer so this doc stays under its length budget.

## Evolution multipliers

`packages/shared/src/game/levels.ts:statAtLevel` gains a per-stage multiplier on top of its existing linear level scaling: Baby ×1.00, Teen ×1.03, Adult ×1.06, keyed off `stageForLevel(level)` (same file). This changes the stat curve `docs/design/battle.md` describes without changing its `(level + 49) / 50` shape; the balance test must be re-verified against the new curve (see Balance targets).

The stage multipliers remain unchanged. Protocol 6 deliberately targets a 90-97% win rate for
the higher-level default at the evolution boundaries (9/11 and 24/26): easier encounters should
usually be wins. The unprepared lower-level target is 3-10%; prepared +3 challenges still win 30-60%
in the opening-combo matrix. A bounded experience multiplier keeps level differences relevant
late in the game (see battle.md Damage formula).
All equal-level species, archetype, stance and talent balance bounds remain unchanged.

## Matchmaking and streaks

Real opponents are searched in level bands `[-3, -2]`, `[-1, -1]`, `[0, 0]`, then `[+1, +3]`, stopping at the
first candidate. Within each band, recent opponents are excluded first, then allowed. Both sides
are protected by a SQL absolute-gap limit of three. Wild encounters (online and offline) are 90%
weaker (-3: 60%, -2: 25%, -1: 5%) and 10% elite, split equally across +1/+2/+3;
levels clamp to [2, 50]. Clearer level gaps make ordinary battles more forgiving.
At the hatch floor, weaker enemies may therefore be equal. Elite is a label, not an extra XP multiplier;
win rewards use the actual level difference, and all challenger losses pay the same amount
(`docs/design/battle.md` Rewards). No real-player pool can guarantee weaker candidates exist.

Win streaks add +10% challenger XP per consecutive win, capped at +50% (5 wins), resetting to 0 on a loss; tracked in `mons.win_streak` (new column). No Elo/rating system in v1.

## Data model and API

Fields on `public.mons` (`supabase/migrations/20260904000000_init.sql`), added across two later
migrations per `CLAUDE.md`'s "init migration is not edited in place" gotcha --
`supabase/migrations/20260913020000_progression_phase_a.sql` (columns) and
`supabase/migrations/20260913040000_progression_phase_b.sql` (docs only):

| Column | Type | Holds |
|---|---|---|
| `loadout` | `jsonb` | `{ moves?: [string, string, string], stance?: string, tree?: { [nodeId]: rank } }` |
| `win_streak` | `int` | Consecutive real-player wins, see Matchmaking above |
| `last_respec_at` | `timestamptz` | Enforces the once-per-7-days respec cooldown past level 10 |

`loadout.moves` has no backfill for mons predating Phase B: `packages/shared/src/battle/
battle.ts:snapshotFor` always defaults an absent/incomplete `moves` to
`defaultLoadoutMoveIds(species, level)` (`packages/shared/src/game/species.ts`), so every mon battles
with a valid loadout whether or not it has ever called `set-loadout`. The `set-loadout` Edge
Function validates a submitted `{ stance?, moves?, tree?, respec? }` against
the mon's level (unlocked moves, the talent tree's node/prereq/budget/respec-cooldown rules — see
`docs/design/talent-tree.md`) via the pure shared `validateLoadout`
(`packages/shared/src/game/progression.ts`), returning typed `LoadoutErrorCode`s (e.g. `MOVE_LOCKED`,
`MOVES_NOT_DISTINCT`, `TREE_OVER_BUDGET`, `RESPEC_COOLDOWN`) as `error.details.code`. `MonSnapshot`
(`packages/shared/src/battle/battle.ts`) carries a `loadout` field, stored in
`public.battles.challenger_snapshot`/`opponent_snapshot` so old battle logs keep replaying against
the loadout actually equipped. `MonState` (`packages/shared/src/api.ts`) carries the mon's own
`loadout`, `unlockedMoveIds`, `treePoints`/`sharedPassivePoints` and `lastRespecAt` so the client
renders the loadout editor without a separate call. `apps/desktop/src/renderer/panel/views/
Battles.tsx` hosts that editor (move dropdowns with reorder, locked moves greyed with "unlocks at
level N", the stance picker, a Talents section — see `docs/design/talent-tree.md`) and, since Phase
D, "Recent opponents" cards — see below.

## Recent-opponent intel

Phase D adds no new battle math -- a read-only explainer over facts the battle system already
computes, so the Battles tab can teach a player *why* a recent fight went the way it did, without a
server round-trip. The shared pure `explainMatchup(me, opp)` (`packages/shared/src/battle/
matchup.ts`, `MonSnapshot` on both sides) returns `nationLine` (which side's nation type has the
advantage, or an even trade — `effectiveness()`, `packages/shared/src/game/nations.ts`), `stanceLine`
(whether either stance counters the other, `stanceBeats()`), `openerLine`/`finisherLine` (the
opponent's loadout slot 1/3 move name plus a one-line gloss), `topBranchLine` (the opponent's
highest-ranked talent branch, `treeSummary()`, `docs/design/talent-tree.md`, or null with no spent
tree), and one rule-derived `suggestion` (`suggestedStance` set only for a stance-switch tip), first
match wins:

1. opponent's stance counters mine -> switch to the stance that counters theirs;
2. opponent has `shield_first` equipped or the Stone Skin passive -> `burn` ignores a one-hit shield;
3. opponent is in Gale (SPD grant raises dodge chance) -> a `true_hit` opener ignores dodge;
4. my nation type is resisted by theirs -> avoid trading nation-type hits;
5. my nation type has the advantage -> lean on nation-type moves;
6. none of the above -> a neutral fallback line.
Every field falls back the same way `snapshotFor`/`resolveLoadoutMoves` do for a pre-field snapshot
(absent `loadout` -> `DEFAULT_STANCE` + `defaultLoadoutMoveIds`, absent `tree` -> no branch line) --
`packages/shared/test/matchup.test.ts` covers this and the rule priority above (12 cases). The
Battles tab's "Recent opponents" cards (last 10, `apps/desktop/src/renderer/panel/views/
Battles.tsx`) call `explainMatchup` with `opp` rebuilt from the recorded `BattleSummary.opponent` and
`me` rebuilt from the player's *current* loadout, re-run on every render so the explanation and the
"Counter this" button (pre-selects `suggestedStance` without saving it) track loadout edits without a
round-trip. Each card also shows the opponent's nation badge, species + level, stance, its 3 move
names, and a "Branch RankSum" badge (e.g. "Tremor III") from the same `topBranch`/`toRoman` helpers.

## Balance targets

`packages/shared/test/balance.test.ts` runs the original cross-nation round-robin (35–65% per
species, level 10 and 30) plus a Phase B archetype matrix — every species × 4 loadout archetypes
(aggro/bulk/dot/tempo, each a 3-move pick favoring a cluster of effects) × 4 opposing archetypes ×
cross-nation pairs, at levels 10 and 30 (stances cycled rather than fully crossed, to keep the battle
count tractable):

- every species stays within **35–65%** win rate (unchanged threshold from `docs/design/battle.md`);
- no single archetype exceeds **60%** win rate (measured: all 8 level × archetype combos landed 46–55%);
- the stance triangle holds at **55–62%** for the counter side, every pairing within 5 points of each
  other (see Stances above);
- boundary matchups (level 9 vs. 11, level 24 vs. 26) land the low-level side at **25–40%** (see
  Evolution multipliers above);
- Phase C's talent-tree matrix (a maxed tree vs. an empty one, and every pair of a nation's branches
  against each other) — see `docs/design/talent-tree.md` Balance targets.

Any change to `simulateBattle`'s RNG call order resets the golden log snapshot (`docs/design/battle.md`
Determinism contract) and bumps `BATTLE_PROTOCOL_VERSION` (**4** as of Phase C: talent-tree stat
nodes folded into snapshot stats, move-upgrade/capstone nodes and the 10 shared passives; an untreed
mon's battle stays bit-identical to Phase B).

## Phases

| Phase | Scope | Status |
|---|---|---|
| A | Stances, evolution multipliers, matchmaking windows, win streaks | shipped |
| B | Move pool (6/species), loadout policy, `MonSnapshot.loadout`, `set-loadout` | shipped |
| C | Talent tree (nation branches + shared passives), respec | shipped |
| D | Recent-opponent intel: `explainMatchup` summaries on the Battles tab | shipped |
