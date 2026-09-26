---
doc_type: design
purpose: "Read this when changing battle math, matchmaking, rewards, or the battle log shape."
audience: agent
last_verified: 2026-09-26
last_verified_commit: 1c03a6e
related_files:
  - packages/shared/src/battle/battle.ts
  - packages/shared/src/battle/effects.ts
  - packages/shared/src/battle/rng.ts
  - packages/shared/src/game/levels.ts
  - packages/shared/src/game/progression.ts
  - packages/shared/src/game/tree.ts
  - packages/shared/src/game/species.ts
  - packages/shared/test/battle.test.ts
  - packages/shared/test/balance.test.ts
  - supabase/migrations/20260904000000_init.sql
  - supabase/migrations/20260913010000_battle_limits.sql
  - supabase/migrations/20260913020000_progression_phase_a.sql
  - supabase/migrations/20260913030000_progression_tuning.sql
  - supabase/migrations/20260913040000_progression_phase_b.sql
  - supabase/functions/battle-request/index.ts
  - docs/design/progression.md
  - docs/design/talent-tree.md
---

# Battle system

Deterministic auto-battle: given the same two `MonSnapshot`s and the same seed, `simulateBattle()` in
`packages/shared/src/battle/battle.ts` produces the exact same log on the client and on the server. This
document describes the **shipped** behavior; where it differs from the original plan, see History below.
Move pools, loadouts, stances, talent trees and the future matchmaking/streak design live in
`docs/design/progression.md`, not here.

## Level curve and stats

Level curve, stage thresholds (`HATCH_XP`, `TEEN_LEVEL`, `ADULT_LEVEL`, `MAX_LEVEL`), the per-stat
growth curve, and the evolution-stage multiplier layered on top of it live in
`packages/shared/src/game/levels.ts:statAtLevel` (numbers and rationale:
`docs/design/progression.md` Evolution multipliers) — this doc does not restate them, only how
battle code uses them. A mon's battle stats are `statsAtLevel()`
(`packages/shared/src/battle/battle.ts:statsAtLevel`), which applies
`packages/shared/src/game/levels.ts:statAtLevel` to each of `hp`, `atk`, `def`, `spd` independently.
`snapshotFor` then folds in the mon's talent-tree stat/flat-stat-capstone bonuses (Phase C,
`docs/design/talent-tree.md`) before stance; the tree's move-upgrade/capstone nodes and shared
passives change the formula below directly (crit chance/multiplier, `def_down`/`burn`/`shield_first`
magnitudes, turn order) — numbers live in `docs/design/talent-tree.md`.

## Stances

A mon's `MonSnapshot.loadout?.stance` (default `DEFAULT_STANCE` when unset, e.g. for a pre-Phase-A
stored snapshot) modifies its effective `atk`/`def`/`spd` for the whole battle before the damage
formula below runs, and grants a flat damage-dealt/damage-taken bonus against the stance it counters.
Numbers, names and the rock-paper-scissors triangle live in `docs/design/progression.md` Stances;
this doc only notes where it plugs in: `packages/shared/src/game/progression.ts:applyStanceModifiers`
computes the modified stats once per battle (not per turn — a stance is fixed for the whole fight),
and `stanceBeats` decides which side (if either) gets the counter multiplier
(`STANCE_COUNTER_DEALT_MULT` / `STANCE_COUNTER_TAKEN_MULT`) applied in `simulateBattle`'s `act()`.
Stance does not change RNG call order, but it does change the stats/damage formula, hence
`BATTLE_PROTOCOL_VERSION` bumping to 2 for Phase A.

## Damage formula (as shipped)

For a turn where mon `M` acts on mon `F`, in `packages/shared/src/battle/battle.ts:simulateBattle` (helper
`act`):

```
scale   = (avgLevel + 49) / 50            // avgLevel = (a.level + b.level) / 2, same curve as statAtLevel
raw     = (power * M.atk / F.def) * scale / 4 * effectiveness * experience * followThrough * (crit ? 2 : 1) * variance
damage  = max(1, floor(raw))
variance = 0.7 + rng() * 0.6              // uniform in [0.7, 1.3)
```

- **`power`**: the chosen move's own `power` (docs/design/progression.md Move pool and effects), not
  a fixed per-kind table — every species has its own 8-move pool (`packages/shared/src/game/
  species.ts:Move`) as of Phase B (`BATTLE_PROTOCOL_VERSION` 3). A `charge` move's release turn
  multiplies `power` by `CHARGE_MULTIPLIER` (2.2), see progression.md.
- **Effectiveness**: a `type: 'nation'` move uses `effectiveness(M.nation, F.nation)` (0.9, 1, or 1.2 —
  see `packages/shared/src/game/nations.ts:effectiveness`); `type: 'neutral'` always uses `1`.
- **Experience** (protocol 6): equal levels use 1. Higher levels deal 1.12 / 1.14 / 1.16x
  damage at gaps +1 / +2 / +3; the lower side deals 0.88 / 0.86 / 0.84x. Gaps cap at 3.
  This supplements the small relative stat increase at high levels; it never decides a winner.
- **Follow-through**: one automatic opening combo per side; its multiplier and eligibility live
  in `docs/design/progression.md`. Optional `followThrough` marks the boosted action in protocol 5;
  historical logs remain stored and are never recomputed.
- **Crit**: chance `clamp(0.08 + (M.spd - F.spd) / 250, 0.03, 0.30)`; a crit doubles `raw` before
  flooring. A move with the `crit_up` effect adds a further bonus, capped by its own higher ceiling
  rather than the 0.30 above (docs/design/progression.md Move pool and effects has the tuned
  numbers).
- **Dodge**: checked before crit/variance are rolled. Chance `clamp((F.spd - M.spd) / 250, 0, 0.20)` — i.e.
  clamped to `min(0.2, max(0, ...))` in code. A dodge deals 0 damage and skips the crit/variance rolls
  entirely (they are not rolled on a dodged attack). A move with the `true_hit` effect skips this roll
  entirely (never dodged; no `rng()` call is made for it).
- **`def_down`, `burn`, `drain`, `shield_first`, `priority`, `charge`**: the remaining 5 of the 8
  move effects. Numbers, per-battle state, and the loadout policy that picks a move each turn all
  live in docs/design/progression.md Move pool and effects / Loadout policy — this doc only notes
  that they run inside the same `act()` this damage formula lives in
  (`packages/shared/src/battle/effects.ts` has the magnitudes and per-side state shape).

## Turn order (as shipped)

Turn order is **probabilistic by speed**, not a strict "faster always goes first" rule, *unless*
exactly one side's chosen move for this turn has the `priority` effect — that side always goes
first, no `rng()` draw (docs/design/progression.md Move pool and effects). Otherwise:

```
pFirstA = a.spd / (a.spd + b.spd)
```

one `rng()` draw picks who acts first using that probability; the second mon then acts if it is
still alive. This means a one-point speed edge does not decide every turn (see History). Both sides'
moves for the turn are chosen (via the loadout policy, docs/design/progression.md) before turn order
is decided, since the `priority` check needs to know both.

## Max turns and timeout resolution

`MAX_TURNS = 10`. The simulation loop stops early on a KO (`reason: 'ko'`). If turn 10 completes with both
mons still alive:

- Whoever has the higher HP fraction (`hp / maxHp`) wins, `reason: 'timeout_hp'`.
- If the fractions are exactly equal, a final `rng()` coin flip decides, `reason: 'timeout_coin'`.

## `BattleResult` log shape

Fields only — see `packages/shared/src/battle/battle.ts` for exact types.

| Field | Type | Notes |
|---|---|---|
| `seed` | `string` | the battle id; re-running `simulateBattle` with the same two snapshots and this seed reproduces the log |
| `winner` | `'a' \| 'b'` | |
| `reason` | `'ko' \| 'timeout_hp' \| 'timeout_coin'` | |
| `turns` | `BattleTurn[]` | `{ turn, first, actions: BattleAction[] }` |
| `finalHp` | `Record<Side, number>` | |
| `maxHp` | `Record<Side, number>` | |

`BattleAction`: `{ actor, move, moveId, dodged, damage, crit, effectiveness, targetHpAfter, effect,
charge?, followThrough? }` — one per mon that acted that turn (the second actor's entry is omitted if the first
action already reduced it to 0 HP), plus a synthetic entry (`moveId: null`, `move: 'Burn'`,
`effect: 'burn'`) appended at the end of a turn for each side with an active burn tick. `effect` is
the effect the chosen move carries (`null` if none applied that action); `charge` is present only
for a `charge`-effect move, `'telegraph'` or `'release'`. See docs/design/progression.md Move pool
and effects.

## Determinism contract

- The RNG (`packages/shared/src/battle/rng.ts:makeRng`) is a `cyrb128`-seeded `sfc32` generator: integer-only
  arithmetic (`Math.imul`, `>>> 0`), bit-exact across V8 and Deno, seeded from the battle id string.
- **The RNG call order inside `simulateBattle` is part of the protocol.** The code comment on
  `simulateBattle` is explicit: "do not reorder calls." Reordering calls (even adding an unconditional roll)
  changes every subsequent draw and desyncs client/server replays of old logs.
- `packages/shared/test/battle.test.ts` pins this with a **golden log snapshot**
  (`packages/shared/test/__snapshots__/battle.test.ts.snap`, test "golden log: pins the protocol"): if a
  deliberate formula change breaks the snapshot, the fixture must be updated **and** the battle protocol
  version bumped in the Edge Function, because old stored battle logs must keep replaying from their stored
  snapshots rather than being recomputed.
- Same-seed determinism and cross-seed divergence are also asserted directly in
  `packages/shared/test/battle.test.ts` ("is deterministic for the same seed and differs across seeds").

## Rewards

`packages/shared/src/battle/battle.ts:challengerReward` / `:defenderReward`:

| Situation | Challenger XP | Defender XP |
|---|---|---|
| Win vs. player | `30 + (diff > 0 ? 15 : 5) * diff`, `diff = clamp(oppLevel - myLevel, -3, 3)` (15–75) | 3 |
| Loss vs. player | 10 | 8 |
| Win vs. Wild Mon (bot) | 20 plus 15 per higher level (20-65, difference capped at 3) | — (bots never pay) |
| Loss vs. Wild Mon (bot) | 10 | — |

`isBot` is true whenever the opponent is a Wild Mon (see Matchmaking); bot battles never credit an opponent,
since there is no real player behind the snapshot.

The table above is the *pre-streak* amount `battle-request` passes to `settle_battle`; the actual
XP credited (and reported in the response's `reward.xp`) is further multiplied by the challenger's
win streak. Numbers and the `mons.win_streak` column live in `docs/design/progression.md`
Matchmaking and streaks; `packages/shared/src/battle/battle.ts:winStreakMultiplier` is the shared
mirror of the multiplier `settle_battle` applies server-side (the SQL copy is authoritative).

## Cooldown and daily caps

`packages/shared/src/battle/battle.ts:BATTLE_RULES`: `cooldownMs = 10 minutes`, `challengesPerDay = 50`,
`defensesPerDay = 10`. `defensesPerDay` is its own constant, independent of `challengesPerDay` — raising
the challenger-side cap does not change how many defenses pay XP per day. There is no separate cap on
battle XP itself: challenger/defender rewards (see Rewards above) are not subject to the work-XP daily
caps in `packages/shared/src/game/xp.ts`, and that remains true at the new 50/day challenge limit. These
rules are enforced server-side, not just advisory client constants:

- `claim_battle_slot` (`supabase/migrations/20260904000000_init.sql`, superseded by
  `supabase/migrations/20260913010000_battle_limits.sql`) atomically rejects a challenge with
  `reason: 'no_mon' | 'egg' | 'cooldown' | 'daily_cap'` before any battle is simulated, and otherwise stamps
  `mons.last_battle_at` and increments `xp_daily.battles_started` for the day (UTC).
- `settle_battle` pays the defender only while `xp_daily.battles_defended` for that UTC day is `< 10`; past
  the cap, a `battle_notifications` row is still inserted (the defender is told about every battle, even
  once defender-XP for the day is exhausted), but `opponent_xp_paid` is 0. This defender-side cap is
  unrelated to `challengesPerDay` and was left unchanged.

## Matchmaking (`battle-request` Edge Function)

Numbers below are `docs/design/progression.md`'s Matchmaking and streaks section; this is how they
plug into the Edge Function.

`supabase/functions/battle-request/index.ts:findOpponent` queries `pick_opponent`
(`supabase/migrations/20260904000000_init.sql`, windows updated in
`supabase/migrations/20260913020000_progression_phase_a.sql`), which is restricted to **other
nations only** (`p.nation <> p_nation`) and further excludes: eggs, mons with no species, players
inactive > 30 days, `suspicion >= 10`, the requester themselves, and the requester's
`last_opponent_id`.

`findOpponent` searches the shared `MATCHMAKING_WINDOWS` in order: weaker, equal, stronger.
Within each band it first excludes recent opponents, then relaxes recency. The SQL RPC also
independently enforces an absolute level gap of at most three, including for older callers.
The new guard and stat mirror live in `supabase/migrations/20260924120000_fair_matchmaking.sql`.
If no player qualifies, `wildEncounterLevel` supplies the same bounded distribution used offline.
Exact bands, probabilities and passive combo rules live in `docs/design/progression.md`.

`simulateBattle` is called with `seed = battleId = crypto.randomUUID()`, generated fresh per request; the
challenger is always side `a`.

## Balance harness

`packages/shared/test/balance.test.ts` simulates the matchups matchmaking can actually produce — cross-
nation only, no mirror matches — at level 10 **and** level 30 (150 battles per ordered species pair
at each), and asserts:

- every species' win rate stays within **35–65 %** across all its cross-nation matchups, at both levels;
- mean battle length is between **3 and 8 turns**;
- timeouts (`reason !== 'ko'`) stay under **2 %** of battles at level 10, under **4 %** at level 30 (a
  pre-existing, minor characteristic of the damage formula's level `scale` term, not something the
  evolution multiplier introduces — see the test's own comment);
- a **+3 level** advantage (`sparkit` L13 vs. `pebblet` L10, 600 battles) wins between **60 % and 90 %** of
  the time.

If a rebalance is needed, the test's own comment says to adjust base stats in
`packages/shared/src/game/species.ts` first, not loosen the thresholds.

Two more scenarios were added for Phase A: stage-transition boundary matchups (L9 vs. L11, L24 vs.
L26) and the stance triangle (`docs/design/progression.md` Stances). Both initially missed their
design-doc targets by a wide margin (a 2-level gap plus the original evolution-stage multiplier
compounded into the low side winning only ~27–28 %; the original ±18 %/±10 % stance modifiers landed
two of the three counter pairings at 80–97 % and the third anywhere from ~37–64 %). Both were fixed
by simulation-tuned constants, not by loosening these test bounds — the tuned magnitudes, the
stance-mapping change that fixed the structural stance asymmetry, and the "tuned by simulation on
2026-09-13" notes live in `docs/design/progression.md` (Evolution multipliers and Stances). The
current, passing targets are **25–40 %** for the boundary matchups' low side and **55–62 %** (all
three pairings within 5 points of each other) for the stance triangle.

## History

The original plan (`docs/history/v1-design-2026-09-04.md`, §5.5) specified strict "faster acts first" turn
order, damage variance of `0.85`–`1.0`, and a `4 %`-per-level stat growth curve. Simulation showed the strict
turn order plus that steeper growth made a one-level edge win about 90 % of mirror matches, so the shipped
code widened variance to `0.7`–`1.3`, made turn order probabilistic by speed, and halved stat growth to
`2 %`/level (`packages/shared/src/game/levels.ts:statAtLevel`). `docs/history/*` is a frozen record — treat
it as historical
background only, not as a current spec; this file describes the code that actually ships.
