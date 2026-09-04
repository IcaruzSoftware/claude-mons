---
doc_type: design
purpose: "Read this when changing battle math, matchmaking, rewards, or the battle log shape."
audience: agent
last_verified: 2026-09-05
last_verified_commit: 6d99ae3
related_files:
  - packages/shared/src/battle/battle.ts
  - packages/shared/src/battle/rng.ts
  - packages/shared/src/game/levels.ts
  - packages/shared/test/battle.test.ts
  - packages/shared/test/balance.test.ts
  - supabase/migrations/20260904000000_init.sql
  - supabase/functions/battle-request/index.ts
---

# Battle system

Deterministic auto-battle: given the same two `MonSnapshot`s and the same seed, `simulateBattle()` in
`packages/shared/src/battle/battle.ts` produces the exact same log on the client and on the server. This
document describes the **shipped** behavior; where it differs from the original plan, see History below.

## Level curve and stats

Level curve, stage thresholds (`HATCH_XP`, `TEEN_LEVEL`, `ADULT_LEVEL`, `MAX_LEVEL`) and the per-stat
growth curve live in `packages/shared/src/game/levels.ts:statAtLevel` — this doc does not restate the
numbers, only how battle code uses them. A mon's battle stats are `statsAtLevel()`
(`packages/shared/src/battle/battle.ts:statsAtLevel`), which applies
`packages/shared/src/game/levels.ts:statAtLevel` to each of `hp`, `atk`, `def`, `spd` independently.

## Damage formula (as shipped)

For a turn where mon `M` acts on mon `F`, in `packages/shared/src/battle/battle.ts:simulateBattle` (helper
`act`):

```
scale   = (avgLevel + 49) / 50            // avgLevel = (a.level + b.level) / 2, same curve as statAtLevel
raw     = (POWER[kind] * M.atk / F.def) * scale / 4 * effectiveness * (crit ? 2 : 1) * variance
damage  = max(1, floor(raw))
variance = 0.7 + rng() * 0.6              // uniform in [0.7, 1.3)
```

- **Move power table** (`packages/shared/src/battle/battle.ts:POWER`): `normal = 45`, `typed = 40`,
  `special = 75`.
- **Effectiveness**: `typed` and `special` moves use `effectiveness(M.nation, F.nation)` (0.5, 1, or 2 —
  see `packages/shared/src/game/nations.ts:effectiveness`); `normal` always uses `1`.
- **Crit**: chance `clamp(0.08 + (M.spd - F.spd) / 250, 0.03, 0.30)`; a crit doubles `raw` before flooring.
- **Dodge**: checked before crit/variance are rolled. Chance `clamp((F.spd - M.spd) / 250, 0, 0.20)` — i.e.
  clamped to `min(0.2, max(0, ...))` in code. A dodge deals 0 damage and skips the crit/variance rolls
  entirely (they are not rolled on a dodged attack).

### Move selection policy

- **Special**: each side may use `special` at most once per battle, and it auto-triggers the moment that
  side's own HP first drops to `≤ 50 %` of its max (checked at the start of `act`, before dodge). Once used,
  `specialUsed[side]` is set and that side never uses `special` again in the battle.
- **Normal vs. typed** (when special is not triggering): the "best" move is whichever of `typed`/`normal`
  deals more (`POWER.typed * effectiveness > POWER.normal ? 'typed' : 'normal'`). The actor picks the best
  move with probability `0.75`, otherwise the other one — so the AI is not perfectly predictable.

## Turn order (as shipped)

Turn order is **probabilistic by speed**, not a strict "faster always goes first" rule:

```
pFirstA = a.spd / (a.spd + b.spd)
```

Each turn, one `rng()` draw picks who acts first using that probability; the second mon then acts if it is
still alive. This means a one-point speed edge does not decide every turn (see History).

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

`BattleAction`: `{ actor, move, kind, dodged, damage, crit, effectiveness, targetHpAfter }` — one per mon
that acted that turn (the second actor's entry is omitted if the first action already reduced it to 0 HP).

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
| Win vs. player | `30 + 5 * clamp(oppLevel - myLevel, -3, 3)` (15–45) | 3 |
| Loss vs. player | 10 | 8 |
| Win vs. Wild Mon (bot) | 20 | — (bots never pay) |
| Loss vs. Wild Mon (bot) | 5 | — |

`isBot` is true whenever the opponent is a Wild Mon (see Matchmaking); bot battles never credit an opponent,
since there is no real player behind the snapshot.

## Cooldown and daily caps

`packages/shared/src/battle/battle.ts:BATTLE_RULES`: `cooldownMs = 5 minutes`, `challengesPerDay = 10`,
`defensesPerDay = 10`. These are enforced server-side, not just advisory client constants:

- `claim_battle_slot` (`supabase/migrations/20260904000000_init.sql`) atomically rejects a challenge with
  `reason: 'no_mon' | 'egg' | 'cooldown' | 'daily_cap'` before any battle is simulated, and otherwise stamps
  `mons.last_battle_at` and increments `xp_daily.battles_started` for the day (UTC).
- `settle_battle` pays the defender only while `xp_daily.battles_defended` for that UTC day is `< 10`; past
  the cap, a `battle_notifications` row is still inserted (the defender is told about every battle, even
  once defender-XP for the day is exhausted), but `opponent_xp_paid` is 0.

## Matchmaking (`battle-request` Edge Function)

`supabase/functions/battle-request/index.ts:findOpponent` queries `pick_opponent`
(`supabase/migrations/20260904000000_init.sql`), which is restricted to **other nations only**
(`p.nation <> p_nation`) and further excludes: eggs, mons with no species, players inactive > 30 days,
`suspicion >= 10`, the requester themselves, and the requester's `last_opponent_id`.

`findOpponent` widens the search in two nested passes:

1. Outer loop: `p_exclude_recent = true` first (skip anyone the challenger fought via this challenger's own
   `battles` rows in the last 24 h), then `false`.
2. Inner loop: `LEVEL_WINDOWS = [3, 6, 10, null]` — level difference `<= 3`, then `<= 6`, then `<= 10`, then
   `null` (any level) — stopping at the first window that returns a row.

If every combination returns nothing, `findOpponent` returns `null` and `battle-request` falls back to a
**Wild Mon** (`wildMon()`): a random species from a random other nation, at
`level = max(2, challenger.level)`, `nickname = "Wild <BabyName>"`, `playerId: null`. A Wild Mon opponent
sets `isBot = true`, which is what routes rewards to the bot-only rows in the table above.

`simulateBattle` is called with `seed = battleId = crypto.randomUUID()`, generated fresh per request; the
challenger is always side `a`.

## Balance harness

`packages/shared/test/balance.test.ts` simulates the matchups matchmaking can actually produce — cross-
nation only, no mirror matches — at level 10, 150 battles per ordered species pair, and asserts:

- every species' win rate stays within **35–65 %** across all its cross-nation matchups;
- mean battle length is between **3 and 8 turns**;
- timeouts (`reason !== 'ko'`) stay under **2 %** of battles;
- a **+3 level** advantage (`sparkit` L13 vs. `pebblet` L10, 600 battles) wins between **60 % and 90 %** of
  the time.

If a rebalance is needed, the test's own comment says to adjust base stats in
`packages/shared/src/game/species.ts` first, not loosen the thresholds.

## History

> Unverified: exact figures below are as recorded in the frozen historical doc, not re-derived here.

The original plan (`docs/history/v1-design-2026-09-04.md`, §5.5) specified strict "faster acts first" turn
order, damage variance of `0.85`–`1.0`, and a `4 %`-per-level stat growth curve. Simulation showed the strict
turn order plus that steeper growth made a one-level edge win about 90 % of mirror matches, so the shipped
code widened variance to `0.7`–`1.3`, made turn order probabilistic by speed, and halved stat growth to
`2 %`/level (`packages/shared/src/game/levels.ts:statAtLevel`). `docs/history/*` is a frozen record — treat
it as historical
background only, not as a current spec; this file describes the code that actually ships.
