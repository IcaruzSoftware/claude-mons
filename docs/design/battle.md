---
doc_type: design
purpose: "Read this when changing battle math, matchmaking, rewards, or the battle log shape."
audience: agent
last_verified: 2026-10-03
last_verified_commit: da1f9c0
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
`docs/design/talent-tree.md`) before combat; the tree's move-upgrade/capstone nodes and shared
passives change the formula below directly (crit chance/multiplier, `def_down`/`burn`/`shield_first`
magnitudes, turn order) — numbers live in `docs/design/talent-tree.md`.

## Stances

A mon equips one conditional build passive in `MonSnapshot.loadout?.stance`, defaulting to
`DEFAULT_STANCE` for absent fields. Names, numbers and activation rules live in
`docs/design/progression.md` Stances. `simulateBattle` checks those conditions per direct hit,
then multiplies raw damage by the attacker's qualifying Exploit/Tempo and defender's qualifying
Brace factors. Stances no longer modify stats or counter one another.
Protocol 12 adds optional `BattleAction.stancePassives` entries with the side and stance that
actually triggered. `apps/desktop/src/renderer/pet/BattlePlayer.ts` displays their passive names.
Earlier logs omit that field and replay unchanged from stored actions. No new RNG draws are added.

## Damage formula (as shipped)

For a turn where mon `M` acts on mon `F`, in `packages/shared/src/battle/battle.ts:simulateBattle` (helper
`act`):

```
scale   = (avgLevel + 24) / 25
K       = 25 * scale                     // equivalently avgLevel + 24
reduction = F.def / (F.def + K)
raw     = power * (M.atk / 50) * (1 - reduction) * 0.75 * effectiveness * experience * followThrough * (crit ? 1.75 : 1) * variance
damage  = max(1, floor(raw))
variance = 0.8 + rng() * 0.4              // uniform in [0.8, 1.2)

```

- **`power`**: the chosen move's own `power` (docs/design/progression.md Move pool and effects), not
  a fixed per-kind table — every species has its own 8-move pool (`packages/shared/src/game/
  species.ts:Move`) as of Phase B (`BATTLE_PROTOCOL_VERSION` 3). A `charge` move's release turn
  multiplies `power` by `CHARGE_MULTIPLIER` (2.2), see progression.md.
- **Effectiveness**: nation moves use the multipliers in `docs/design/species-and-nations.md`
  Type cycle; neutral moves use 1.
- **Experience** (protocol 11): `1 + 0.03 * clamp(M.level - F.level, -3, 3)`.
  A one-level lead adds 3% damage; stat growth and elemental counters still matter.
- **Follow-through**: one opening combo per side after learning Flow's Quick Setup; its multiplier and eligibility live
  in `docs/design/progression.md`. Optional `followThrough` marks the boosted action in protocol 5;
  historical logs remain stored and are never recomputed.
- **Defense (DEF)**: the DEF reduction curve has diminishing returns. DEF = K prevents 50% of
  direct damage; DEF = 2K prevents about 67%; it never grants immunity. Effective DEF includes
  defense-down and Deep Roots. Burn remains a max-HP effect, independent of DEF.
- **Crit**: chance `clamp(0.08 + (M.spd - F.spd) / (250 * scale), 0.03, 0.30)`; ordinary crits
  multiply damage by 1.75. Crit-up adds 20 percentage points (ceiling 60%); talent overrides
  remain explicit. Maelstrom increases nation crits to 1.9x.
- **Dodge**: chance `clamp(0.04 + (F.spd - M.spd) / (160 * scale), 0.02, 0.15)`.
  It rolls before crit and variance; true-hit primary moves skip it.
- **Double strike**: an eligible landed primary attack has an 8% chance of a second action at
  40% power. It cannot crit, combo, chain or apply move effects; it can be dodged and still obeys
  defender shields/KO protections. Charges, combo hits, misses and defeated targets cannot trigger
  it. Its optional `doubleStrike` log field and move label let existing playback animate the second
  swing. Protocol 7 records the new RNG sequence; old logs are replayed unchanged.
- **Innate element traits (protocol 8)**: Wind has 12% more effective speed (turn order, dodge,
  crit); Earth takes 4% less direct damage after the DEF calculation; Fire's landed nation-type
  hits have a 12% chance to ignite an unburned foe; Water's have a 28% chance to slow the foe's
  speed by 28% for the next two turns. Soak refreshes only after expiry and neither trait applies
  on a miss, neutral move or double strike. Fire uses the ordinary non-stacking burn. Logs mark
  triggered traits in `nationPassive`; previous protocol logs remain stored unchanged.
- **Protocol 9** activates all nation-tree tier-3/4 talents, adds six once-per-battle Flow combos,
  and uses the finisher more often from turns 3–4. `comboTalent` names a triggered combo in the
  stored action and playback. Multiple regular talent damage bonuses use the strongest value.
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

`MAX_TURNS = 12`. The simulation loop stops early on a KO (`reason: 'ko'`). If turn 12 completes with both
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
charge?, followThrough?, doubleStrike? }` — one primary action per mon that acted that turn, with at most one additional double strike (the second actor's entry is omitted if the first
action already reduced it to 0 HP), plus a synthetic entry (`moveId: null`, `move: 'Burn'`,
`effect: 'burn'`) appended at the end of a turn for each side with an active burn tick. A learned
recovery skill adds a synthetic `Regeneration` action with optional `healing` and the owner's HP
afterward. `effect` is
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

On a Rival attempt, `findOpponent` searches peers first, then nearby, then the remaining
pool within three levels. The immediate previous opponent is excluded; other repeats wait one hour. A repeated element
causes a different band to be searched. When no Rival is selected, online and offline battles use
Wild or Trainer NPCs with rotating elements. SQL independently caps the level gap at five in
`supabase/migrations/20260930000000_varied_challenges.sql`. Wild stats are 20% below Trainer stats;
Trainer stats are 10% below an equivalent Rival. `wildEncounterLevel` supplies the bounded NPC
distribution.
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
- a **+3 level** advantage (`sparkit` L13 vs. `pebblet` L10, 600 battles) wins over **90 %** without
  guaranteeing victory; this particular neutral matchup is not the overall level-gap target.

If a rebalance is needed, the test's own comment says to adjust base stats in
`packages/shared/src/game/species.ts` first, not loosen the thresholds.

Stage-transition boundaries (L9/L11 and L24/L26) give the lower side a 10-25% win rate.
Default-build conditional stance pairings target 40-60%; activation tests verify their build dependency.

`packages/shared/test/fairBattles.test.ts` also checks every elemental pairing in both battle
positions at levels 2/5/10/30/50, one-level Earth underdogs against Ottlet, and neutral Earth
durability. The trained-bot matrix includes default bot talents and targets 50-82% overall wins;
actual Wild/Trainer NPCs have empty trees and reduced stats, so they are easier. Their strength
ordering and shared encounter distribution are verified separately.

## Rollout and rollback

Protocol 12 ships conditional stance formulas to desktop and Edge Functions. Deploy functions
before the desktop release. No schema migration is needed; historical logs are never recomputed.
Rollback deploys the prior backend source and a higher corrective client release restoring prior
behavior; retain all stored logs and published tags.

## History

The frozen `docs/history/v1-design-2026-09-04.md` records the initial battle proposal.
Current formulas and tests above supersede that historical proposal.
