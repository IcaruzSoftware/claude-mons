---
doc_type: design
purpose: "Read this when changing talent-tree nodes, budgets, forks, saved-tree normalization, respec behaviour or the Skill Tree editor."
audience: agent
last_verified: 2026-10-09
last_verified_commit: 64b6667
related_files:
  - packages/shared/src/game/tree.ts
  - packages/shared/src/game/progression.ts
  - packages/shared/src/battle/treeRules.ts
  - packages/shared/src/battle/effects.ts
  - packages/shared/src/battle/battle.ts
  - packages/shared/test/tree.test.ts
  - packages/shared/test/treeNodes.test.ts
  - packages/shared/test/treeInvariants.test.ts
  - packages/shared/test/balance.test.ts
  - apps/desktop/src/main/game/loadout.ts
  - apps/desktop/src/renderer/panel/views/SkillTree.tsx
  - apps/desktop/src/renderer/panel/views/Battles.tsx
  - supabase/functions/_shared/loadout.ts
  - supabase/functions/set-loadout/index.ts
  - supabase/functions/battle-request/index.ts
  - docs/design/battle-steps.md
  - docs/design/progression.md
  - docs/decisions/0022-talent-tree-v2.md
---

# Talent tree

Since battle protocol 14 a mon's tree is five columns of 17 single-purchase nodes: four shared
branches (Bastion, Strike, Ward, Tempo) and one nation column for the mon's own nation. Every node
is an event-triggered battle rule; none adds a stat. The roster (136 nodes: 4 x 17 shared plus
4 x 17 nation columns) is data in `packages/shared/src/game/tree.ts`; its node names,
prerequisites, trigger steps, caps and one-sentence descriptions live only there, and
`packages/shared/test/tree.test.ts` pins every node's name, effect, trigger, cap and
once-per-battle flag, and checks the costs and prerequisites structurally. This doc
describes the structure and the rules around the roster. How the engine runs the rules is in
[battle-steps.md](battle-steps.md); why the tree looks like this is in
[ADR 0022](../decisions/0022-talent-tree-v2.md).

## Branches

| Branch | Id prefix | Identity |
|---|---|---|
| Bastion | `bastion:` | Standing defensive rules keyed on HP lines and HP leads: cancelled crits, refused statuses, held HP, early finishers. Its nodes have kind `passive` in the editor, except the capstones (tiers 6 and 12). |
| Strike | `strike:` | Offense that rewards finishing: guaranteed crits, undodgeable and piercing follow-ups, larger crit multipliers against a weakened foe. |
| Ward | `ward:` | Denial and survival: refused statuses, voided hits, HP clamps, a knockout hold, small heals, a damage cap. |
| Tempo | `tempo:` | Turn order and move sequencing: Priority control, the opening combo, acting first, charge releases. |
| Nation column | `nation.<nation>:` | One column per nation, buildable only by mons of that nation (see Nation lock). |

The nation columns build on the nation trait in `packages/shared/src/game/nations.ts`:

| Nation | Trait | Column theme |
|---|---|---|
| Fire | Kindle (ignite) | "Heat": the foe carries a Burn or a move-applied DEF-down; payoffs arm from landing or ending it. |
| Water | Soak | A soaked foe: order suppression, refusals and crit arming while the soak is live or expires. |
| Earth | Stonehide | Hit streaks: payoffs from taking direct hits on consecutive turns, HP clamps; the tank column. |
| Air | Tailwind | Speed lead and dodges: payoffs from acting first with a lead or from dodging. |

The editor marks a node inert when the mon's loadout cannot trigger it (`treeNodeInertNote` in
`apps/desktop/src/renderer/panel/views/SkillTree.tsx`; the rules are in `docs/design/ui-panels.md`).
The `tempo:1` and `tempo:9` nodes are inert in every default loadout and are tested with an enabling
loadout instead.

## Shape of a column

Each column has twelve tiers and 17 nodes. Ids are `<branch>:<tier>`, `nation.<nation>:<tier>`,
with `:alt` (tier 3) or `:left` / `:right` (tiers 7 and 10) on a fork alternative.

| Tier | Nodes | Role |
|---|---|---|
| 1, 2 | one each | Entry nodes on a single line. |
| 3 | centre and `:alt` | Two-way fork (choice group); choose one. |
| 4 | one | Joins the fork: either alternative of tier 3 satisfies it (`prereqIds`). |
| 5 | one | Single line. |
| 6 | one | First capstone (kind `capstone`). |
| 7 | centre, `:left`, `:right` | Three-way fork. |
| 8 | one | Joins the tier-7 fork. |
| 9 | one | Single line. |
| 10 | centre, `:left`, `:right` | Three-way fork. |
| 11 | one | Joins the tier-10 fork. |
| 12 | one | Second capstone. |

Every node has `maxRank` 1. The prerequisite of tier N is the centre node of tier N-1 unless the
node is a join (tiers 4, 8, 11), which accepts any alternative of the previous fork.
`treeChoiceConflict` rejects two alternatives of one fork. Tier costs are 1/1/2/2/3/5/4/5/5/6/6/7 for
every alternative of a tier, so any complete route through one column costs exactly 47.

## Budget

| Pool | Size | Spent on |
|---|---|---|
| Tree pool | `pointsAvailable(level)` = `min(level, 50) - 3`, so 1 at level 4 and 47 at level 50 | Nodes of all five columns together |
| Main-passive pool | 3 points from level 10 (`sharedPassivePoints`) | One main passive from `SHARED_PASSIVE_NODES`, cost 3 |

One pool serves all five columns, so a mon at level 50 can finish exactly one column or split the 47
points across several. At most one main passive is equipped; the stance is a free, independent
choice (`docs/design/progression.md`). Stats are not touched by the tree; the main passives and
stances keep their own battle effects.

## Nation lock

A mon sees and may buy only its own nation column. `validateTree` returns `WRONG_NATION` for another
nation's node and `TREE_UNKNOWN_NODE` for an unknown id. `resolveTree` and `treeSpent` silently
ignore other nations' ids so a stored tree never invalidates a battle, while `simulateBattle` throws
`UnknownTreeIdError` for an id that is neither shared, own-nation nor a main passive.

Other validation codes: `TREE_RANK`, `TREE_PREREQ`, `TREE_OVER_BUDGET`, `TREE_PASSIVE_LIMIT`,
`TREE_CHOICE_LIMIT`. They surface through `validateLoadout` in
`packages/shared/src/game/progression.ts` and the `set-loadout` Edge Function.

## Rules every node follows

A node names a trigger step (one of the `TreeStep` ids in [battle-steps.md](battle-steps.md)), an
effect, and a cap:

| Cap | Meaning |
|---|---|
| `battle` | Once per battle, spent when the rule changes an outcome |
| `turn` | Once per turn |
| `pending` | Arms a payoff for the next action; may re-arm at most once per turn |
| `state` | Applies whenever its condition holds |

- **Payoffs.** A pending node arms one of three booleans for the owner's next action: cannot be
  dodged, guaranteed crit, or pierces the foe's tree defenses. At most one payoff per kind is armed;
  arming again refreshes its expiry and keeps the first source. It is consumed by the next direct
  action, lost if that turn has none, and expires at turn start two turns after arming. Each arming,
  use, loss and expiry is logged.
- **Pierce.** A piercing action bypasses the foe's tree defenses (cancelled crits, refusals, voids,
  clamps), never the base mechanics.
- **One damage factor.** At the damage step at most one tree factor applies: the largest of the
  crit-multiplier overrides and the opening combo. The others stay unspent.
- **One denial.** A foe's action is denied by at most one rule per turn, and an action denied last
  turn is not denied again (control rest). The losing rule writes a `denied` entry and keeps its flag.
- **No new draws.** Rules read state and may overwrite or defer a draw the base mechanics made; a
  rule that needs its own random draw is not allowed.
- **Conflicting sources** of one boolean are credited by cap rank, then shared before nation, then
  lower tier.

## Battle log

Every fired rule writes a `TreeTrigger` (`side`, `node`, `step`, `effect`, `detail`). Action-level
steps go to `BattleAction.treeTriggers`, turn-level steps to `BattleTurn.treeTriggers`; the array is
absent when nothing fired, so protocol-13 logs read unchanged. The table and the player's banner
playback are described in [battle-steps.md](battle-steps.md) and `docs/design/ui-panels.md`.

## Saved-tree normalization

`normalizeTree(nation, ranks)` runs on every read path: it keeps the equipped main passive and every
roster node the nation may own (rank clamped to 1), drops everything else (protocol-13 ids such as
`water:current:1`, other nations' columns, unknown ids), then refunds nodes whose prerequisite is
missing or whose fork already has a kept alternative. It returns `legacyReset`, true when anything
with a positive rank was dropped or refunded. Budgets are left to `validateTree`.

| Where | What happens |
|---|---|
| `apps/desktop/src/main/game/loadout.ts` | `normalizeLocalTree` rebuilds the stored tree on profile load and sets `treeLegacyReset` until the next tree save |
| `supabase/functions/_shared/loadout.ts` | `normalizedLoadout` runs in `set-loadout` and `battle-request` for both fighters, using the species' nation |
| `supabase/functions/_shared/monState.ts` | `buildMonState` / `monStateFor` normalize on the read path behind `ingest-xp`, `create-profile` and `set-loadout` responses and set `MonState.treeLegacyReset`; `apps/desktop/src/main/net/account.ts` adopts it |
| Skill Tree HUD and Battles panel | While `treeLegacyReset` is set both show a one-line notice that the tree was rebuilt, removed skills were dropped and their points are back in the pool |

An old tree therefore resets without a database migration (loadouts are JSON); old battle logs
replay from their stored result and snapshot, never re-simulated. Any `set-loadout` (also a
stance- or moves-only save) writes the normalized tree back, so a second device that signs in
afterwards gets the clean tree without the notice.

## Editing and respec

Left click buys a node and autosaves; right click refunds it and its dependants; Reset all clears the
tree and stance with no cooldown or cost. A respec is any change that lowers a node's rank
(`isRespec`) and is always free. Saves run one at a time. A definite server rejection (4xx) restores
the previous local loadout; after a network error or 5xx the change is kept with an "unconfirmed"
warning, and the next change syncs it (`apps/desktop/src/main/game/loadout.ts`). The map layout and
HUD are in `docs/design/ui-panels.md`; the editor is `apps/desktop/src/renderer/panel/views/SkillTree.tsx`.

## Bot trees

Wild and Trainer opponents in matchmaking and the offline fallback fight with no tree
(`apps/desktop/src/main/game/BattleService.ts` and `supabase/functions/battle-request/index.ts` pass an
empty tree). `defaultBotTree` applies only to a snapshot with `playerId` null and no stored tree, such
as the trained bots in `packages/shared/test/fairBattles.test.ts`: the shared Strike
centre route, bought tier by tier up to the level's points and capped at tier 6, never a nation column
or main passive.

## Tests and balance

| Test | Proves |
|---|---|
| `packages/shared/test/tree.test.ts` | Pinned roster, costs, prerequisites, forks, nation lock, validation, normalization |
| `packages/shared/test/treeNodes.test.ts` | One scenario per node and worked interactions |
| `packages/shared/test/treeInvariants.test.ts` | Determinism, draw-site, one-factor and control-rest invariants over random trees; every node fires |
| `apps/desktop/test/talentEditor.render.test.tsx` | Editor behaviour: purchase, refund, autosave, errors, legacy notice |

The balance bounds (route mirrors, fork bands, capstone fire rates, the Tempo Lock archetype gate,
the nation round-robin) are the talent-tree bullet under "Balance targets" in
[progression.md](progression.md), enforced by `packages/shared/test/balance.test.ts`.

## Changing the roster

Edit `packages/shared/src/game/tree.ts` and its rule in `packages/shared/src/battle/treeRules.ts`
together, update the pinned roster in `packages/shared/test/tree.test.ts` and the scenario in
`packages/shared/test/treeNodes.test.ts`, then rerun the balance suite. A change that adds or
removes an `rng()` call bumps `BATTLE_PROTOCOL_VERSION` and resets the golden log.
