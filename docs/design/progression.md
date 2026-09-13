---
doc_type: design
purpose: "Read this when changing moves, stances, talents, matchmaking windows, streaks or evolution stat multipliers, or building the loadout editor."
audience: agent
last_verified: 2026-09-13
last_verified_commit: e3483fc
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

**Tuned by simulation on 2026-09-13** (implemented in `packages/shared/src/battle/effects.ts`,
original spec was `def_down` = −25% DEF / `crit_up` = +20pp capped at the normal 30% crit ceiling):
with the loadout policy's 80%-probability slot-2 weighting, a refreshing 3-turn `def_down` stays up
almost every turn, so −25% DEF (a sustained +33% damage multiplier) dwarfed the other slot-2 effects
it sits alongside — e.g. pebblet (`def_down` in slot 2) beat same-level, same-loadout-policy sparkit
(`crit_up` in slot 2) roughly 70% of the time, and the pre-existing "+3 level advantage" balance test
(`packages/shared/test/balance.test.ts`) dropped from its 60–90% target to ~49%. Root cause for
`crit_up` specifically: a flat +20pp bonus very often did nothing, since most matchups' base crit
chance already sits well above the 30% ceiling minus 20pp, so the bonus just hit the same cap the
base roll would have anyway. Fix: `def_down`'s multiplier moved from 0.75 to **0.88** (−12% DEF, a
+14% damage multiplier — comparable to the other slot-2 effects instead of dominating them), and
`crit_up` got its own, higher ceiling, **`CRIT_UP_MAX` = 0.5** (uncapped by the normal 30% ceiling up
to 50%), instead of sharing it. Both constants live in `packages/shared/src/battle/effects.ts`; see
`packages/shared/test/balance.test.ts`'s archetype matrix (Balance targets below) for the search that
confirmed these numbers.

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

Three stances in a rock-paper-scissors triangle: each grants +2% to one stat and costs −6% on
another (independently tunable, not opposed-and-equal). Countering the opponent's stance grants +2%
damage dealt and −2% damage taken for the whole battle.

| Stance | Grants | Costs | Beats | Loses to |
|---|---|---|---|---|
| Fury | ATK +2% | DEF −6% | Gale | Bulwark |
| Bulwark | DEF +2% | ATK −6% | Fury | Gale |
| Gale | SPD +2% | ATK −6% | Bulwark | Fury |

**Tuned by simulation on 2026-09-13** (original spec was ±18%/±18% grant/cost with a ±10% counter
bonus). The original numbers were internally consistent but produced two of the three counter
pairings winning 80-97% of the time while the third swung anywhere from ~37-64% (sometimes not even
an advantage), against a 55-62% target for every pairing. The root cause was structural, not just
magnitude: Fury was the only stance touching both ATK and DEF (the two stats the damage formula's
atk/def ratio actually uses) — its grant boosts ATK *and* its cost cuts DEF — so both pairings
involving Fury got a "double" swing, while Bulwark and Gale (each touching only one of ATK/DEF, plus
SPD) produced a much flatter Bulwark-vs-Gale pairing. Fixing this required changing *which* stat a
stance costs, not only shrinking the numbers: Bulwark's cost moved from SPD to ATK (Gale's stays
ATK), so every pairing now touches the ATK/DEF axis symmetrically — Fury costs DEF, Bulwark and Gale
both cost ATK. Flavor still reads cleanly: Bulwark and Gale each give up raw power for their
specialty (bulk or speed, respectively); Fury gives up survivability for power. Combined with the
much smaller grant/cost/counter magnitudes above, this lands every pairing at 55-62%, all three
within a few points of each other (see `packages/shared/test/balance.test.ts`'s stance-triangle
test, and the sweep script referenced in the Phase A implementation report for the search that
found these numbers). Constants: `STANCE_INFO`, `STANCE_COUNTER_DEALT_MULT`/
`STANCE_COUNTER_TAKEN_MULT` in `packages/shared/src/game/progression.ts`.

## Talent tree

3 branches of 6 tiered nodes per nation, plus a small shared-passive pool, spent from level 3
(47 points by level 50). Full node tables, the shared-passive list, the respec rule and the
"tuned by simulation" magnitudes all live in `docs/design/talent-tree.md` -- this section is
just the pointer so this doc stays under its length budget.

## Evolution multipliers

`packages/shared/src/game/levels.ts:statAtLevel` gains a per-stage multiplier on top of its existing linear level scaling: Baby ×1.00, Teen ×1.03, Adult ×1.06, keyed off `stageForLevel(level)` (same file). This changes the stat curve `docs/design/battle.md` describes without changing its `(level + 49) / 50` shape; the balance test must be re-verified against the new curve (see Balance targets).

**Tuned by simulation on 2026-09-13** (original spec was ×1.15/×1.30). Those multipliers made a
stage-boundary matchup (a level-9 baby vs. a level-11 teen, or a level-24 teen vs. a level-26 adult)
win only ~27-28% for the low-level side — the 2-level gap and the full stage-multiplier jump both
push the same way (more damage dealt *and* less damage taken), well outside the 35-65% band
`docs/design/battle.md`'s balance harness targets elsewhere. ×1.03/×1.06 lands both boundary
matchups at 38-48% for the low side (see `packages/shared/test/balance.test.ts`'s boundary tests) —
still a real, smaller handicap by design, not the full 35-65% band, since a stage-boundary matchup
is genuinely lopsided. `supabase/migrations/20260913030000_progression_tuning.sql` mirrors this in
`recompute_mon`.

## Matchmaking and streaks

Widens the real-player search beyond today's `LEVEL_WINDOWS = [3, 6, 10, null]` in `supabase/migrations/20260904000000_init.sql`'s `pick_opponent` / `findOpponent()` (`docs/design/battle.md` Matchmaking section): three passes of asymmetric level windows relative to the challenger's own level, `[-2, +1]` then `[-4, +2]` then any level, stopping at the first pass with a candidate. A Wild Mon (bot) opponent's level is `own level + rng(-3, +1)`; 10% of Wild Mon encounters roll as **elite** — `+3` levels and double the challenger's XP reward on a win.

Win streaks add +10% challenger XP per consecutive win, capped at +50% (5 wins), resetting to 0 on a loss; tracked in `mons.win_streak` (new column). No Elo/rating system in v1.

## Data model and API

Fields on `public.mons` (`supabase/migrations/20260904000000_init.sql`), added across two
migrations per the `CLAUDE.md` Gotcha that the init migration is not edited in place —
`supabase/migrations/20260913020000_progression_phase_a.sql` (columns) and
`supabase/migrations/20260913040000_progression_phase_b.sql` (docs only, see below):

| Column | Type | Holds |
|---|---|---|
| `loadout` | `jsonb` | `{ moves?: [string, string, string], stance?: string, tree?: { [nodeId]: rank } }` |
| `win_streak` | `int` | Consecutive real-player wins, see Matchmaking above |
| `last_respec_at` | `timestamptz` | Enforces the once-per-7-days respec cooldown past level 10 |

`loadout.moves` has no backfill for mons that predate Phase B: `packages/shared/src/battle/
battle.ts:snapshotFor` always defaults an absent/incomplete `moves` to
`defaultLoadoutMoveIds(species, level)` (`packages/shared/src/game/species.ts`) when it builds a
snapshot, so every mon always battles with a valid, level-appropriate loadout whether or not it has
ever called `set-loadout`; see `supabase/migrations/20260913040000_progression_phase_b.sql`'s
comment for the reasoning against a backfill migration.

The `set-loadout` Edge Function validates a submitted `{ stance?, moves?, tree?, respec? }` against
the mon's level (which moves are unlocked, the talent tree's node/prereq/budget/respec-cooldown
rules — see `docs/design/talent-tree.md`) via the pure shared `validateLoadout`
(`packages/shared/src/game/progression.ts`). Rejection reasons are typed (`LoadoutErrorCode`, e.g.
`MOVE_LOCKED`, `MOVES_NOT_DISTINCT`, `TREE_OVER_BUDGET`, `RESPEC_COOLDOWN`), returned as
`error.details.code` alongside the human-readable `error.message`. `MonSnapshot`
(`packages/shared/src/battle/battle.ts`) has a `loadout` field (always populated by `snapshotFor`),
stored in `public.battles.challenger_snapshot`/`opponent_snapshot` so old battle logs keep replaying
against the loadout that was actually equipped. `MonState` (`packages/shared/src/api.ts`) carries
the mon's own `loadout`, `unlockedMoveIds`, `treePoints`/`sharedPassivePoints` and `lastRespecAt` so
the client can render the loadout editor without a separate call.
`apps/desktop/src/renderer/panel/views/Battles.tsx` has a loadout editor overlay (move dropdowns
per slot with reorder, locked moves greyed with "unlocks at level N", the stance picker, and a
Talents section — see `docs/design/talent-tree.md`) and, since Phase D, "Recent opponents" cards —
see Recent-opponent intel below.

## Recent-opponent intel

Phase D adds no new battle math -- it is a read-only explainer over facts the battle system already
computes, so the Battles tab can teach a player *why* a recent fight went the way it did and what to
try next, without a server round-trip. The shared pure `explainMatchup(me, opp)`
(`packages/shared/src/battle/matchup.ts`, `MonSnapshot` on both sides) returns:

- `nationLine` -- which side's nation type has the advantage (`effectiveness()`,
  `packages/shared/src/game/nations.ts`), or that they trade evenly;
- `stanceLine` -- whether either stance counters the other (`stanceBeats()`, Stances above), or that
  both picked the same stance;
- `openerLine`/`finisherLine` -- the opponent's loadout slot 1/3 move name plus a one-line gloss on
  its effect (defaulting to `defaultLoadoutMoveIds` for a snapshot with fewer than 3 stored moves,
  same fallback `snapshotFor` itself uses);
- `topBranchLine` -- the opponent's nation talent-tree branch with the highest rank total
  (`treeSummary()`, `docs/design/talent-tree.md`), or null with no spent tree;
- `suggestion` (with `suggestedStance` set only when it recommends a stance switch) -- exactly one
  rule-derived tip, first match wins:
  1. the opponent's stance counters mine -> switch to the stance that counters theirs;
  2. the opponent has a `shield_first` move equipped, or the Stone Skin shared passive -> `burn`
     ignores a one-hit shield (it is end-of-turn damage, not a hit `shield_first`/Stone Skin ever
     reduce);
  3. the opponent is in Gale (its SPD grant raises their dodge chance, Move pool and effects'
     dodge formula) -> a `true_hit` opener ignores dodge entirely;
  4. my nation type is resisted by theirs -> avoid trading nation-type hits;
  5. my nation type has the advantage -> lean on nation-type moves;
  6. none of the above -> a neutral fallback line.

Every field falls back the same way `snapshotFor`/`resolveLoadoutMoves` already do for a snapshot
that predates a field entirely (an absent `loadout` -> `DEFAULT_STANCE` + `defaultLoadoutMoveIds`,
an absent `tree` -> no branch line) -- `packages/shared/test/matchup.test.ts` covers this alongside
the rule priority above (12 cases).

The Battles tab's "Recent opponents" cards (last 10, `apps/desktop/src/renderer/panel/views/
Battles.tsx`) call `explainMatchup` with `opp` rebuilt from the recorded `BattleSummary.opponent`
(nickname/nation/speciesId/level/loadout -- `apps/desktop/src/common/ipc.ts`, recorded by
`BattleService.finish`) and `me` rebuilt from the player's *current* loadout (`UiSnapshot.battles.
loadout`), not the loadout that was actually equipped in that stored battle -- re-run on every
render, so the explanation and the "Counter this" button (pre-selects `suggestedStance` in the
loadout editor without saving it) track loadout edits without a round-trip. Each card also shows the
opponent's nation badge, species + level, stance, its 3 equipped move names, and a "Branch RankSum"
badge (roman numeral, e.g. "Tremor III") from the same `topBranch`/`toRoman` helpers
`packages/shared/src/battle/matchup.ts` exports.

## Balance targets

`packages/shared/test/balance.test.ts` runs two matrices: the original cross-nation round-robin
(35–65% per species, level 10 and 30) plus a Phase B archetype matrix — every species × 4 loadout
archetypes (aggro/bulk/dot/tempo, each a 3-move pick favoring a cluster of effects — see the test's
own `ARCHETYPE_EFFECTS`) × 4 opposing archetypes × cross-nation pairs, at levels 10 and 30 (stances
cycled across the matrix rather than fully crossed, to keep the battle count tractable):

- every species stays within **35–65%** win rate across its matchups (unchanged threshold from
  `docs/design/battle.md`), both in the original matrix and aggregated across the archetype matrix;
- no single archetype exceeds **60%** win rate across the matrix (measured: all 8
  level × archetype combinations landed 46–55%);
- the stance triangle holds at **55–62%** for the counter side, on every pairing, within 5 points of
  each other (see Stances above for the 2026-09-13 tuning that made this achievable);
- boundary matchups (level 9 vs. 11, level 24 vs. 26 — either side of a stage transition) land the
  low-level side at **38–48%** (see Evolution multipliers above);
- Phase C's talent-tree matrix (a maxed tree vs. an empty one, and every pair of a nation's
  branches against each other) — see `docs/design/talent-tree.md` Balance targets for the numbers
  and the tuning that got there.

Any change to `simulateBattle`'s RNG call order (a talent-tree roll, a stance check, etc.) resets the golden log snapshot (`docs/design/battle.md` Determinism contract) and bumps the battle protocol version. `BATTLE_PROTOCOL_VERSION` is **4** as of Phase C (talent-tree stat nodes folded into snapshot stats, move-upgrade/capstone nodes and the 10 shared passives; the golden log itself was unaffected since an untreed mon's battle is bit-identical to Phase B).

## Phases

| Phase | Scope | Status |
|---|---|---|
| A | Stances, evolution multipliers, matchmaking windows, win streaks | shipped |
| B | Move pool (6/species), loadout policy, `MonSnapshot.loadout`, `set-loadout` | shipped |
| C | Talent tree (nation branches + shared passives), respec | shipped |
| D | Recent-opponent intel: `explainMatchup` summaries on the Battles tab | shipped |
