---
doc_type: design
purpose: "Read this when changing moves, stances, talents, matchmaking windows, streaks or evolution stat multipliers, or building the loadout editor."
audience: agent
last_verified: 2026-10-04
last_verified_commit: da1f9c0
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

The battle itself stays a deterministic autobattle (`packages/shared/src/battle/battle.ts:simulateBattle`, see `docs/design/battle.md`); this doc adds the skill players exercise *before* a battle: which 8 moves a mon knows, which 3 it brings, its stance, and its talent tree. Phases A–D (see Phases) have all shipped; several magnitudes below were **retuned by simulation on 2026-09-13**, after shipping, to hit their balance targets (see each section's tuning note).

## Goals

- Keep autobattle: no in-battle move selection by the player.
- Move the skill expression into preparation: move pool, loadout, stance, talents.
- Extend rather than replace `docs/design/battle.md`'s damage formula, turn order and RNG protocol.
- Widen matchmaking and reward streaks without introducing Elo.

## Move pool and effects

Every species gets six core moves and two evolution signature moves. Each move has a `power`, a `type` of `neutral` (never affected by nation matchups) or `nation` (uses `effectiveness()` from `packages/shared/src/game/nations.ts` like today's `typed`/`special` kinds), and exactly one effect:

| Effect | Meaning |
|---|---|
| `priority` | Acts first this turn, overriding the normal speed-probability roll |
| `crit_up` | +20pp critical-hit chance on this move, up to its own 60% ceiling (not the shared 30% crit cap) |
| `drain` | Heals the user 30% of damage dealt |
| `shield_first` | The first hit this mon takes in the battle is reduced 50% (once per battle) |
| `def_down` | Target's DEF −12% for 3 turns; reapplying refreshes the duration, does not stack |
| `burn` | Target loses 2.5% max HP at the end of each turn for 3 turns (one instance active at a time) |
| `true_hit` | Ignores the target's dodge chance |
| `charge` | Turn 1 telegraphs for 0 damage; turn 2 auto-releases at 2.2× power |

**Tuned by simulation on 2026-09-24**: protocol 5 reduces the elemental swing and rebalances
burn/drain against direct offense (`crit_up` +20pp, ceiling 60%). Five species redistribute the
same rarity stat budget; the shared balance harness retains its equal-level acceptance bands.

Core unlock schedule (by mon level): 2 moves at hatch (level 2), 3rd at 5, 4th at 10, 5th at 15, 6th at 20. Slots 1–3 are each species' current `normal`/`typed`/`special` move, kept as-is (unlock 2/2/5); slots 4–6 are new (unlock 10/15/20). Slot 1 is always `priority` — it doubles as the loadout's fixed opener (see Loadout policy). Renaming the existing moves to the new convention is a possible follow-up, not part of this design.

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
| cinderpup | 2 | Hotfix Howl | 38 | nation | burn | 2 |
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

Evolution signatures append to the pool without changing any existing move id. At level 10 the teen form learns a new 80-power attack; at level 25 the adult learns a new 85-power attack. Both
use the species' original finisher effect and nation type. These exceed the 75-power core
finisher and automatically fill slot 3 of the default loadout. Saved custom move selections remain
intact and can equip the unlocked signatures through the existing editor. Ottlet learns **Fish
Breaker** and **Torrent Fish Slam**, respectively. The existing stage stat multipliers below
apply at the same thresholds; no XP or hatch-odds changes are required.

## Loadout policy

A loadout is 3 of the mon's unlocked moves plus a stance. Selection each turn (one RNG draw, replacing the current `normal`/`typed`/`special` choice in `simulateBattle`):

- **Slot 1** always opens turn 1.
- **Slot 3** fires once per battle from turn 3 below 60% HP on either side, or on turn 4 if the fight lasts that long.
- Otherwise: slot 2 with probability 0.8, slot 1 with probability 0.2.
- A `charge` move's release always fires on its own second turn regardless of this policy.

This supersedes `docs/design/battle.md`'s `special`-at-≤50%-own-HP rule once Phase B ships; slot 3 keeps each species' current `special` move, so the finisher role carries over.

## Automatic opening combo

Combat remains passive. Arrange a Burn or DEF-down move in slot 1 before battle. While that
landed opening effect is active, the first different landed Priority, True-hit, Crit-up or Charge
release gets 1.2x direct damage, once per side per battle. Against a higher-level foe,
add 0.4 per higher level (gap capped at 3): 1.6x / 2.0x / 2.4x for this one hit.
The underdog bonus makes a prepared challenge winnable without boosting equal-level combos. Dodges and charge telegraphs do not
consume it; expiry discards it. Healing and further status moves cannot trigger it. Existing
slot selection and combat timing are unchanged; no clicks or timing inputs are added.

## Stances

Protocol 12 replaces the stance triangle and flat stat trade-offs with one equipped build passive.
Choose a stance for free in the Skill Tree; existing ids and saved choices remain valid.

| Stance | Passive | Activation and payoff |
|---|---|---|
| Fury | Exploit | +8% direct damage on a crit or charged release against a foe already affected by Burn or DEF down |
| Bulwark | Brace | 10% less direct damage during a charge telegraph turn or at <=35% HP before the hit |
| Gale | Tempo | +10% direct damage when acting first with a different move the turn immediately after landing Priority |

The hit that applies a debuff cannot Exploit that new debuff. Tempo's window is consumed by
repetition, a miss, acting second or telegraphing; a landed repeated Priority opens a fresh
window for the following turn. Double strikes neither receive offensive stance bonuses nor
consume/rearm Tempo. Brace protects the entire telegraph turn regardless of initiative, not
the release turn; instant-charge talents remove that window. It can protect double strikes,
but never burn ticks. Its low-HP condition checks HP before each individual hit.
The shared metadata and build hints live in `packages/shared/src/game/progression.ts`.
`packages/shared/test/stancePassives.test.ts` checks activation, missed windows, real damage,
instant charge and unusable builds. No new RNG draws are added.

## Talent tree

4 branches of 12 single-purchase nodes per nation, plus a small shared-passive pool, spent from level 4
(47 points by level 50). Full node tables, the shared-passive list, the respec rule and the
"tuned by simulation" magnitudes all live in `docs/design/talent-tree.md` -- this section is
just the pointer so this doc stays under its length budget.

## Evolution multipliers

`packages/shared/src/game/levels.ts:statAtLevel` gains a per-stage multiplier on top of its existing linear level scaling: Baby ×1.00, Teen ×1.03, Adult ×1.06, keyed off `stageForLevel(level)` (same file). Each level now adds 4% of the base stat, with a minimum one-point gain before evolution: `floor((base + (level - 1) * max(1, base / 25)) * stageMultiplier)`. Integer arithmetic matches PostgreSQL numeric rounding. Every level adds at least one HP, ATK, DEF and SPD; XP thresholds stay unchanged. The Mon panel previews next-level gains. Server mirror: `supabase/migrations/20260927120000_level_stat_growth.sql`.

The stage multipliers remain unchanged. Protocol 11 leaves room for elemental counters:
the unprepared lower-level side wins 10-25% at evolution boundaries (9/11 and 24/26).
Prepared +3 challenges still win 30-60% in the opening-combo matrix. A bounded experience multiplier keeps level differences relevant
late in the game (see battle.md Damage formula).
Equal-level species, archetype and talent balance bounds remain unchanged; passive stances use the non-dominance target below.

## Matchmaking and streaks

Rivals (real players) appear on 30% of online matchmaking attempts when an eligible player exists.
They search peers first: [0, 0], then [-1, +1], then [-3, +3].
The previous opponent is never picked immediately again; other repeats wait one hour. A repeated
element sends matchmaking to another band or an NPC. Selection caps gaps at three; SQL retains its five-level defense cap for older callers.
Without a rival, Wild and Trainer NPCs alternate. Both have no invested talents. Trainer stats are
90% of a comparable Rival's; Wild stats are 80% of Trainer stats. The offline fallback mirrors
these NPCs. NPC levels are 75% weaker (-1: 40%, -2: 30%, -3: 5%), 15% peers, and
10% elite (equally split across +1/+2/+3);
levels clamp to [2, 50]. At the hatch floor, weaker enemies may therefore be equal. On wins,
Wild, Trainer and Rival base rewards are 20, 30 and 45 XP respectively, plus 15 XP per higher
opponent level (capped at +5). All challenger losses pay the same 10 XP
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
| `last_respec_at` | `timestamptz` | Legacy timestamp, no longer limits respecs |

`loadout.moves` has no backfill for mons predating Phase B: `packages/shared/src/battle/
battle.ts:snapshotFor` always defaults an absent/incomplete `moves` to
`defaultLoadoutMoveIds(species, level)` (`packages/shared/src/game/species.ts`), so every mon battles
with a valid loadout whether or not it has ever called `set-loadout`. The `set-loadout` Edge
Function validates a submitted `{ stance?, moves?, tree?, respec? }` against
the mon's level (unlocked moves and the talent tree's node/prereq/budget rules — see
`docs/design/talent-tree.md`) via the pure shared `validateLoadout`
(`packages/shared/src/game/progression.ts`), returning typed `LoadoutErrorCode`s (e.g. `MOVE_LOCKED`,
`MOVES_NOT_DISTINCT`, `TREE_OVER_BUDGET`) as `error.details.code`. `MonSnapshot`
(`packages/shared/src/battle/battle.ts`) carries a `loadout` field, stored in
`public.battles.challenger_snapshot`/`opponent_snapshot` so old battle logs keep replaying against
the loadout actually equipped. `MonState` (`packages/shared/src/api.ts`) carries the mon's own
`loadout`, `unlockedMoveIds`, `treePoints`/`sharedPassivePoints` and `lastRespecAt` so the client
renders the loadout editor without a separate call. `apps/desktop/src/renderer/panel/views/
Battles.tsx` shows abilities, the Skill Tree entry and the latest battle history. Stances,
nation talents and main passives are exclusively inside the map. Left click autosaves; right
click refunds; Reset all is free. At most one main passive (from level 10) plus one stance may be equipped. An explicitly cleared stance is stored as null and grants no stance bonus; missing legacy stance fields keep the old Bulwark fallback. Map roles and availability are documented in `docs/design/ui-panels.md`.

## Matchup explanations

The shared pure `explainMatchup(me, opp)` in `packages/shared/src/battle/matchup.ts` remains a
read-only helper over snapshots. It names each equipped passive without claiming a stance
counter or recommending a switch. Suggestions prioritize Burn against single-hit shields,
then elemental advantage/disadvantage, then a neutral fallback. Missing loadouts use the same
stance/move defaults as battle snapshots; missing trees omit branch facts.
The Battle panel's compact history does not display this helper's detailed explanations.
`packages/shared/test/matchup.test.ts` verifies facts, fallbacks and suggestion priority.

## Balance targets

`packages/shared/test/balance.test.ts` runs the original cross-nation round-robin (35–65% per
species, level 10 and 30) plus a Phase B archetype matrix — every species × 4 loadout archetypes
(aggro/bulk/dot/tempo, each a 3-move pick favoring a cluster of effects) × 4 opposing archetypes ×
cross-nation pairs, at levels 10 and 30 (stances cycled rather than fully crossed, to keep the battle
count tractable):

- every species stays within **35–65%** win rate (unchanged threshold from `docs/design/battle.md`);
- no single archetype exceeds **60%** win rate (measured: all 8 level × archetype combos landed 46–55%);
- same-species default-build stance pairings stay within **40–60%** across four species; there is no universal stance counter (see Stances above);
- boundary matchups (level 9 vs. 11, level 24 vs. 26) land the low-level side at **10–25%** (see
  Evolution multipliers above);
- Phase C's talent-tree matrix (a maxed tree vs. an empty one, and every pair of a nation's branches
  against each other) — see `docs/design/talent-tree.md` Balance targets.

Any change to `simulateBattle`'s RNG call order resets the golden log snapshot (`docs/design/battle.md`
Determinism contract) and bumps `BATTLE_PROTOCOL_VERSION` (**12** for the current combat rules).

## Phases

| Phase | Scope | Status |
|---|---|---|
| A | Stances, evolution multipliers, matchmaking windows, win streaks | shipped |
| B | Move pool (6/species), loadout policy, `MonSnapshot.loadout`, `set-loadout` | shipped |
| C | Talent tree (nation branches + shared passives), respec | shipped |
| D | Recent-opponent intel: `explainMatchup` summaries on the Battles tab | shipped |
