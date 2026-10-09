---
doc_type: decision
purpose: "Read this when questioning why the talent tree is five event-triggered columns on one 47-point pool, why old trees reset, or why same-nation balance bounds are looser than cross-nation ones."
audience: both
last_verified: 2026-10-09
last_verified_commit: 64b6667
related_files:
  - packages/shared/src/game/tree.ts
  - packages/shared/src/battle/treeRules.ts
  - packages/shared/src/battle/battle.ts
  - packages/shared/test/balance.test.ts
  - apps/desktop/src/main/game/loadout.ts
  - supabase/functions/_shared/loadout.ts
  - docs/design/talent-tree.md
  - docs/design/battle-steps.md
  - docs/design/progression.md
adr_status: accepted
---

# Talent tree v2

## Context

The protocol-13 tree gave each nation four twelve-stage paths whose nodes mostly folded small stat
bonuses into the snapshot, plus a Flow branch for move-order combos. Stat nodes were invisible in
play, effects stacked freely across paths, and battle effects were scattered through
`simulateBattle`, so every new node touched the engine and the log could not explain a hit.

## Decision

- **Five columns, one pool.** Four shared branches (Bastion, Strike, Ward, Tempo) and one nation
  column per nation, 17 single-purchase nodes each, 136 in total. A mon may buy its own nation
  column only (`WRONG_NATION` otherwise). All five columns draw on one 47-point pool; any single
  column costs exactly 47. Main passives keep their own three-point pool.
- **Event-triggered rules, no stats.** Every node attaches to one of the 12 `TreeStep` ids of the 13-step turn and acts through a
  small effect vocabulary (undodgeable, guaranteed crit, pierce, void, refuse, cap, clamp, no-crit,
  multiplier, fizzle, heal, cleanse, skip tick, extend, order). Rules are plain-data tables in
  `packages/shared/src/battle/treeRules.ts`; they never draw randomness, only overwrite or defer a
  draw the base mechanics already made. See [battle-steps.md](../design/battle-steps.md).
- **Bounded stacking.** One damage factor per hit, one denial per victim per turn with a control
  rest, one pending payoff per kind with a two-turn expiry.
- **Readable logs.** Each fired rule writes a `treeTriggers` entry that the battle player shows as a
  banner step.
- **Protocol 14.** `BATTLE_PROTOCOL_VERSION` becomes 14. Stored battles replay from their snapshot
  and result; the golden log was regenerated.
- **Normalization instead of migration.** `normalizeTree` runs on every read path (client load,
  `set-loadout`, `battle-request`, and the mon state in `supabase/functions/_shared/monState.ts`): protocol-13 ids, other nations' columns and broken forks are
  dropped and the points are unspent. The Skill Tree and Battles panel show a one-line notice until the next save.
  Loadouts are JSON, so no SQL migration is needed.

## Deliberate deviations from the design spec

The implementation followed a written spec; these readings were chosen deliberately (details in the
rule tables and `docs/design/talent-tree.md`):

- **Rule readings.** Long Haul reads "while your HP is above 60%" because the spec's HP-lead
  condition was dead in every legal tree. Quartermaster never swaps a Charge, Priority, true-hit or
  differently-typed finisher, so it cannot change whether a draw happens. Opening Setup arms on any
  landed slot-1 Burn or DEF-down and may re-arm after an unused combo lapses. Same-boolean credit
  order is cap rank, then shared before nation, then tier.
- **Ignite and soak.** The trait draws happen after the hit step, so rules keyed on an ignite or a
  soak arm from dedicated hooks (status applied, soak landed) instead of the hit hook, and only water
  rules read whether the foe is soaked. A late order-rung pass after Priority suppression lets
  Undertow Pull see the order already decided.
- **Condition redesigns.** The first full measurement left many nodes dead and several branches far
  above or below an empty tree. Rather than shrinking magnitudes, conditions became narrower and
  rarer (HP lines, crit-keyed triggers, once-per-battle caps) and dead nodes got frequent arming
  events. The conditions are described in `packages/shared/src/game/tree.ts` and implemented in `packages/shared/src/battle/treeRules.ts`.

## Balance decisions

- **Same-nation fights gate timeouts only.** Fork, branch-pair and capstone bands are same-nation
  mirrors, which happen only in practice and training, and earth is the tank nation (a tree-less earth
  mirror already lasts about 9.5 turns). Their mean-turn bound was dropped by the project owner; the
  4% timeout bound stays and the cross-nation round-robins keep 3-8 turns.
- **Wider same-nation bands.** Fork routes at level 50 and branch pairs gate 38-62% and the nation fork
  band 36-64%, within about two standard errors of the old 40-60%.
- **Tempo Lock gate.** The Tempo Lock archetype won two thirds of its matches against the other
  archetypes; it is gated at 65% against all five (target 60%).
- **Loadout-keyed nodes.** `tempo:1` and `tempo:9` are inert in every default loadout, so they are
  exempt from the default-loadout firing diagnostic and must fire at least 5% with an enabling loadout.

The numeric gates are in `docs/design/progression.md` "Balance targets".

## Consequences

- Every existing player's tree resets once, on the first launch after the update; points are refunded
  by being unspent. Old battle logs stay readable.
- Adding a node is a table entry plus a roster row, a scenario and a balance run, not an engine edit.
- Rules and magnitudes live in the constants of `packages/shared/src/battle/treeRules.ts`; the roster
  and descriptions in `packages/shared/src/game/tree.ts`. Balance changes move there and in the
  pinned test, not in docs.

## Status

Accepted. Part of the same change: leveling and XP fixes (see the CHANGELOG), which are
independent of the tree.
