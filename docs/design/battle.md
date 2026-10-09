---
doc_type: design
purpose: "Read this when changing battle math, matchmaking, rewards, or the battle log shape."
audience: agent
last_verified: 2026-10-09
last_verified_commit: 64b6667
related_files:
  - packages/shared/src/battle/battle.ts
  - packages/shared/src/battle/effects.ts
  - packages/shared/src/battle/treeRules.ts
  - packages/shared/src/battle/rng.ts
  - packages/shared/src/game/levels.ts
  - packages/shared/src/game/progression.ts
  - packages/shared/src/game/tree.ts
  - packages/shared/src/game/species.ts
  - packages/shared/test/battle.test.ts
  - packages/shared/test/balance.test.ts
  - packages/shared/test/treeInvariants.test.ts
  - supabase/migrations/20260904000000_init.sql
  - supabase/migrations/20260913010000_battle_limits.sql
  - supabase/migrations/20260913020000_progression_phase_a.sql
  - supabase/migrations/20260913030000_progression_tuning.sql
  - supabase/migrations/20260913040000_progression_phase_b.sql
  - supabase/functions/battle-request/index.ts
  - docs/design/progression.md
  - docs/design/talent-tree.md
  - docs/design/battle-steps.md
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
Since protocol 14 the talent tree no longer folds stat bonuses into the snapshot: its nodes are
event-triggered rules that act on the steps of a turn (step model and trigger log:
`docs/design/battle-steps.md`; node numbers: `docs/design/talent-tree.md`).

## Stances

A mon equips one conditional build passive in `MonSnapshot.loadout?.stance`, defaulting to
`DEFAULT_STANCE` for absent fields. Names, numbers and activation rules live in
`docs/design/progression.md` Stances. `simulateBattle` checks those conditions per direct hit,
then multiplies raw damage by the attacker's qualifying Exploit/Tempo and defender's qualifying
Brace factors. Stances no longer modify stats or counter one another.
Optional `BattleAction.stancePassives` (protocol 12) names the stance that triggered; earlier logs
omit it. `apps/desktop/src/renderer/pet/BattlePlayer.ts` displays the passive names.

## Damage formula (as shipped)

For a turn where mon `M` acts on mon `F`, in `packages/shared/src/battle/battle.ts:simulateBattle` (helper
`act`):

```
scale   = (avgLevel + 24) / 25
K       = 25 * scale                     // equivalently avgLevel + 24
reduction = F.def / (F.def + K)
raw     = power * (M.atk / 50) * (1 - reduction) * 0.75 * (doubleStrike ? 0.4 : 1) * effectiveness * experience * treeFactor * critMult * variance
        * (stance Fury/Gale multiplier) * (stance Bulwark multiplier)
damage  = max(1, floor(raw)); an Earth defender then takes `EARTH_DAMAGE_MULT` of it (min 1)
variance = 0.8 + rng() * 0.4              // uniform in [0.8, 1.2)

```

- **`treeFactor`** is 1 or one tree damage factor (the Opening Setup combo is one source) and
  `critMult` is 1.75 on a crit unless a tree rule overrides it; see step 7 in `docs/design/battle-steps.md`.
- **`power`**: the chosen move's own `power` (docs/design/progression.md Move pool and effects), not
  a fixed per-kind table — every species has its own 8-move pool (`packages/shared/src/game/
  species.ts:Move`) as of Phase B (`BATTLE_PROTOCOL_VERSION` 3). A `charge` move's release turn
  multiplies `power` by `CHARGE_MULTIPLIER` (2.2), see progression.md.
- **Effectiveness**: nation moves use the multipliers in `docs/design/species-and-nations.md`
  Type cycle; neutral moves use 1.
- **Experience** (protocol 11): `1 + 0.03 * clamp(M.level - F.level, -3, 3)`.
  A one-level lead adds 3% damage; stat growth and elemental counters still matter.
- **Follow-through**: the Opening Setup node (`tempo:1`) arms one combo hit per side; its
  multiplier lives with the node rules (`FOLLOW_THROUGH_MULT` in `packages/shared/src/battle/treeRules.ts`).
  Optional `followThrough` marks the boosted action; historical logs are never recomputed.
- **Defense (DEF)**: the DEF reduction curve has diminishing returns. DEF = K prevents 50% of
  direct damage; DEF = 2K prevents about 67%; it never grants immunity. Effective DEF includes
  defense-down and Deep Roots. Burn remains a max-HP effect, independent of DEF.
- **Crit**: chance `clamp(0.08 + (M.spd - F.spd) / (250 * scale), 0.03, 0.30)`; ordinary crits
  multiply damage by 1.75. Crit-up adds 20 percentage points (ceiling 60%); tree rules can override the crit multiplier
  (`docs/design/talent-tree.md`).
- **Dodge**: chance `clamp(0.04 + (F.spd - M.spd) / (160 * scale), 0.02, 0.15)`.
  It rolls before crit and variance; true-hit primary moves skip it.
- **Double strike**: an eligible landed primary attack has an 8% chance of a second action at
  40% power. It cannot crit, combo, chain or apply move effects; it can be dodged and still obeys
  defender shields/KO protections. Charges, misses and defeated targets cannot trigger it; since
  protocol 14 an Opening Setup combo hit can, because no talent rule decides whether a draw is made.
  Its optional `doubleStrike` log field and move label let existing playback animate the second
  swing. Protocol 7 records the new RNG sequence; old logs are replayed unchanged.
- **Innate element traits (protocol 8)**: Wind has 12% more effective speed (turn order, dodge,
  crit); Earth takes 4% less direct damage after the DEF calculation; Fire's landed nation-type
  hits have a 12% chance to ignite an unburned foe; Water's have a 28% chance to slow the foe's
  speed by 28% for the next two turns. Soak refreshes only after expiry and neither trait applies
  on a miss, neutral move or double strike. Fire uses the ordinary non-stacking burn. Logs mark
  triggered traits in `nationPassive`; previous protocol logs remain stored unchanged.
- **Protocol 14** replaces the nation-path tree with shared and nation branches (see Determinism
  contract). The old Flow combos and their `comboTalent` field exist only in pre-14 stored logs.
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
charge?, followThrough?, doubleStrike?, treeTriggers? }` — one primary action per mon that acted that turn, with at most one additional double strike (the second actor's entry is omitted if the first
action already reduced it to 0 HP), plus a synthetic entry (`moveId: null`, `move: 'Burn'`,
`effect: 'burn'`) appended at the end of a turn for each side with an active burn tick. A learned
tree heal (`ward:8`, `ward:11`) adds a synthetic action named after the node, with `moveId: null`,
optional `healing` and the owner's HP afterward. `effect` is
the effect the chosen move carries (`null` if none applied that action); `charge` is present only
for a `charge`-effect move, `'telegraph'` or `'release'`. See docs/design/progression.md Move pool
and effects. `BattleTurn.treeTriggers` and `BattleAction.treeTriggers` (protocol 14, optional) log
the talent-tree rules that fired; see `docs/design/battle-steps.md`.

## Determinism contract

- The RNG (`packages/shared/src/battle/rng.ts:makeRng`) is a `cyrb128`-seeded `sfc32` generator: integer-only
  arithmetic (`Math.imul`, `>>> 0`), bit-exact across V8 and Deno, seeded from the battle id string.
- **The RNG call order inside `simulateBattle` is part of the protocol.** The code comment on
  `simulateBattle` is explicit: "do not reorder calls." Reordering calls (even adding an unconditional roll)
  changes every subsequent draw and desyncs client/server replays of old logs.
- **No tree rule adds or skips a draw (protocol 14).** Whether a draw site is reached depends only on
  base mechanics (turn number, base finisher eligibility, move effect, charge state, the final dodge
  result, target alive). Tree rules may only overwrite or defer the result of a draw that was made,
  e.g. a guaranteed crit overwrites the crit draw. Ignite and soak trait draws are ungated: they are
  made on every eligible landed nation-type hit, whatever a rule does to the status afterwards. The
  v13 draws tied to Eye of the Storm, Phoenix Reborn and Quick Setup are gone.
- **`packages/shared/test/treeInvariants.test.ts` enforces this** with a call-site invariant: it
  traces every draw (`BattleTraceEvent`, `DrawSite`) and checks that each site is reached exactly when
  the base mechanics say, with and without trees.
- **`UNKNOWN_TREE_ID`**: `simulateBattle` throws `UnknownTreeIdError` (`code = 'UNKNOWN_TREE_ID'`)
  for a rank above 0 on an id that is not a known main passive, a shared-branch node or a node of the
  mon's own nation column. Every read path normalizes a saved tree first, so a battle never fights
  with a silently ignored id.
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
| Win vs. player (Rival) | `max(10, 45 + (diff > 0 ? 15 : 5) * diff)`, `diff = clamp(oppLevel - myLevel, -5, 5)` (20–120) | 3 |
| Loss vs. player | 10 | 8 |
| Win vs. Trainer NPC (bot) | same formula with base 30 (10–105) | — (bots never pay) |
| Win vs. Wild Mon (bot) | same formula with base 20 (10–95) | — |
| Loss vs. any NPC (bot) | 10 | — |

`isBot` is true whenever the opponent is a Wild or Trainer NPC (see Matchmaking); bot battles never credit an opponent,
since there is no real player behind the snapshot.

The table above is the *pre-streak* amount `battle-request` passes to `settle_battle`; the actual
XP credited (and reported in the response's `reward.xp`) of a Rival win is further multiplied by the
challenger's win streak; NPC battles get no multiplier and leave the streak unchanged. Numbers and the `mons.win_streak` column live in `docs/design/progression.md`
Matchmaking and streaks; `packages/shared/src/battle/battle.ts:winStreakMultiplier` is the shared
mirror of the multiplier `settle_battle` applies server-side (the SQL copy is authoritative).

## Cooldown and daily caps

`packages/shared/src/battle/battle.ts:BATTLE_RULES`: `cooldownMs = 10 minutes`, `challengesPerDay = 50`,
`defensesPerDay = 10`. `defensesPerDay` is independent of `challengesPerDay`. Battle rewards are not subject to the
work-XP daily caps in `packages/shared/src/game/xp.ts`. These rules are enforced server-side, not
just advisory client constants:

- `claim_battle_slot` (`supabase/migrations/20260904000000_init.sql`, superseded by
  `supabase/migrations/20260913010000_battle_limits.sql`) atomically rejects a challenge with
  `reason: 'no_mon' | 'egg' | 'cooldown' | 'daily_cap'` before any battle is simulated, and otherwise stamps
  `mons.last_battle_at` and increments `xp_daily.battles_started` for the day (UTC).
- `settle_battle` pays the defender only while `xp_daily.battles_defended` for that UTC day is `< 10`; past
  the cap, a `battle_notifications` row is still inserted (the defender is told about every battle, even
  once defender-XP for the day is exhausted), but `opponent_xp_paid` is 0. This defender-side cap is
  unrelated to `challengesPerDay`.

## Matchmaking (`battle-request` Edge Function)

Numbers: `docs/design/progression.md` Matchmaking and streaks.

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

`packages/shared/test/balance.test.ts` simulates the matchups matchmaking can actually produce
(cross-nation only, no mirror matches) and `packages/shared/test/fairBattles.test.ts` checks every
elemental pairing in both positions; the targets are listed in `docs/design/progression.md` Balance targets. If a rebalance is needed, adjust
base stats in `packages/shared/src/game/species.ts` or node numbers in
`packages/shared/src/game/tree.ts` first, not the thresholds. Wild and Trainer NPCs have empty trees
and reduced stats, so they are easier than the trained-bot matrix.

## Rollout and rollback

Protocol 14 ships the rebuilt talent tree and its step engine to desktop and Edge Functions. Deploy
functions before the desktop release. Stored trees are rebuilt on read for the new branches with all
points unspent (client notice: `docs/design/ui-panels.md`). No schema migration is needed;
historical logs are never recomputed.
Rollback deploys the prior backend source and a higher corrective client release restoring prior
behavior; retain all stored logs and published tags.

## History

The frozen `docs/history/v1-design-2026-09-04.md` records the initial proposal; this doc supersedes it.
