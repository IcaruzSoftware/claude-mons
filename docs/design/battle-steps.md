---
doc_type: design
purpose: "Read this when adding or debugging a talent-tree rule in the battle engine: the step model, where rules attach, and how triggers are logged."
audience: agent
last_verified: 2026-10-09
last_verified_commit: 64b6667
related_files:
  - packages/shared/src/battle/battle.ts
  - packages/shared/src/battle/treeRules.ts
  - packages/shared/src/battle/effects.ts
  - packages/shared/src/game/tree.ts
  - packages/shared/test/treeNodes.test.ts
  - packages/shared/test/treeInvariants.test.ts
  - apps/desktop/src/renderer/pet/BattlePlayer.ts
  - docs/design/battle.md
  - docs/design/talent-tree.md
---

# Battle step model and tree triggers

Since protocol 14 the talent tree acts on the battle only through event-triggered rules. This doc
is the map; the damage formula, RNG contract and rewards stay in `docs/design/battle.md`, and every
node's text, cost and numbers live in `docs/design/talent-tree.md` and `packages/shared/src/game/tree.ts`.
The authoritative node rules are the plain-data rule tables in `packages/shared/src/battle/treeRules.ts`,
called by `simulateBattle` in `packages/shared/src/battle/battle.ts`.

## Steps

Each turn runs 13 ordered steps. A node's `trigger` field in `packages/shared/src/game/tree.ts` names the step it
attaches to, using the `TreeStep` id in the table (`aura` nodes have no step; steps 8 and 12 have no id of their own).

| Step | Name (`TreeStep`) | What runs |
|---|---|---|
| 1 | TURN_START (`turn_start`) | Reset per-turn flags, expire stale pending payoffs |
| 2 | PICK (`pick`) | Both sides pick a move; a rule may change which move is played, never whether the pick draw is made |
| 3 | ORDER (`order`) | 3a Initiative (due flag), 3b order rung (Anchor overrides), 3c Priority with suppression, 3d Updraft, 3e Initiative Read, 3f speed roll. The roll is drawn exactly where protocol 13 drew it; 3a and 3e only overwrite its result, and a rule that would not change the order writes nothing |
| 4 | ACT_PRE (`act_pre`) | Per action: fizzle and denial checks, then the PIERCE, UNDODGE and GUARANTEED_CRIT conditions |
| 5 | DODGE (`dodge`) | Dodge draw; UNDODGE overwrites a dodged result |
| 6 | CRIT (`crit`) | Crit draw; GUARANTEED_CRIT overwrites it, NOCRIT sources may cancel it |
| 7 | DAMAGE (`damage`) | Existing formula plus at most one tree damage factor; VOID zeroes damage after the variance draw |
| 8 | SHIELDS (none) | `shield_first` and Stone Skin |
| 9 | CAP, CLAMP, LETHAL (`clamp`, `lethal`) | Ward cap (`ward:12`), then HP-line clamps in descending order, then Lastline (`ward:6`, lethal) |
| 10 | HIT (`hit`) | HP applied, then Second Breath (shared passive); hit-landed and hit-taken rules fire, payoffs are armed |
| 11 | STATUS (`status`) | REFUSE sources check each status; applied statuses fire their hooks |
| 12 | DOUBLE_STRIKE (none) | Existing roll; counts as a direct hit taken, applies no status |
| 13 | TURN_END (`turn_end`) | (a) burn tick (Stonewall or Quick Recovery may skip it), then Bleed Line; (b) streak counters; (b2) nation hooks; (c) duration decrements; (d) expiry; (e) arming (Afterburn, Order Snap, Initiative); (f) queued heals (`ward:8`, `ward:11`), each a synthetic action |

Rules never call `rng()`. A rule reads state and may overwrite or defer the result of a draw the base
mechanics already made. The per-step order and caps are in `packages/shared/src/battle/battle.ts` and
`packages/shared/src/battle/treeRules.ts`; per-node behaviour is in `docs/design/talent-tree.md`.

## Treating a rule as data

A rule table entry names its `node`; the engine calls `holds` only when the side owns the node and the
node's cap (`battle`, `turn`, `pending` or `state`, from `packages/shared/src/game/tree.ts`) is still available, and spends
the cap when the rule changes an outcome. Tables are skipped for a side with no tree nodes, and the
tree-only turn phases are skipped when neither side owns a node, so battles between empty trees
cost nothing extra.

## Trigger log

Each fired rule writes one `TreeTrigger` (`{ side, node, step, effect, detail }`):

| Where | Field | Steps |
|---|---|---|
| `BattleAction.treeTriggers` | the action the rule changed | `act_pre` to `status` |
| `BattleTurn.treeTriggers` | the turn | `turn_start`, `pick`, `order`, `turn_end` |

`effect` and `detail` are always present. `effect` is a closed set the client keys on. `detail` is the
node's fixed `logText` when the effect is the node's own; arming, consumption and denial entries use
the shared `META_TEXT` lines in `packages/shared/src/battle/treeRules.ts`. What is absent when
nothing fired is the `treeTriggers` array itself, so pre-14 logs and untouched actions are unchanged. `apps/desktop/src/renderer/pet/BattlePlayer.ts` plays each entry as a banner step
(`treeTriggerText` renders "Node name — what it did"); see `docs/design/ui-panels.md`.

## Tests

| Test | Proves |
|---|---|
| `packages/shared/test/treeNodes.test.ts` | one scenario per node, interactions and worked fights |
| `packages/shared/test/treeInvariants.test.ts` | the draw-site invariant (see Determinism contract in `docs/design/battle.md`) |
| `packages/shared/test/battle.test.ts` | the golden log |

## Adding a rule

1. Define the node in `packages/shared/src/game/tree.ts` and its prose in `docs/design/talent-tree.md`.
2. Insert an entry at its step position in the matching table in `packages/shared/src/battle/treeRules.ts`;
   new per-side state goes in `SideEffectState` in `packages/shared/src/battle/effects.ts`.
3. Add its scenario to `packages/shared/test/treeNodes.test.ts` and run `packages/shared/test/treeInvariants.test.ts`. A rule that needs a
   new draw is not allowed: it needs a protocol bump and a spec change.
