---
doc_type: design
purpose: "Read this when changing talent-tree nodes, budgets, respec rules, or the loadout editor's Talents section."
audience: agent
last_verified: 2026-09-29
last_verified_commit: cd39fe6
related_files:
  - packages/shared/src/game/tree.ts
  - packages/shared/src/battle/battle.ts
  - packages/shared/src/battle/effects.ts
  - packages/shared/src/game/progression.ts
  - packages/shared/test/tree.test.ts
  - packages/shared/test/treeCombos.test.ts
  - packages/shared/test/balance.test.ts
  - supabase/functions/set-loadout/index.ts
  - apps/desktop/src/renderer/panel/views/Battles.tsx
  - docs/design/progression.md
---

# Talent tree

Each nation has four six-node branches: its original three identity branches, plus Flow, an
optional branch for move-order combos. Ten shared passives use a separate point pool. All talents
are single purchases; move slots also require three distinct attacks. The exact node names, costs,
prerequisites and descriptions are data in `packages/shared/src/game/tree.ts`. The battle effects
are implemented in `packages/shared/src/battle/battle.ts`.

## Budget and saved trees

One nation point arrives per level from level 4, up to 47 at level 50. Each original branch costs
14 to finish: tiers 1 and 2 cost 1 each, tiers 3 and 4 cost 2 each, tier 5 costs 3 and tier 6 costs
5. Flow follows the same costs. All four cost 56, so specialization remains necessary. Tier 1/2
nodes each grant +0.33% to their listed stat once; tiers 3/4 have real battle effects; tier 5
upgrades the specified loadout slot's move by +3% effect magnitude or +1% power; tier 6 is the
branch capstone. Shared passives grant one point every 15 levels, capped at three purchases.

Saved pre-change ranks above one resolve as one purchase. The editor shows one purchase, makes the
extra points available, and submits the normalized map on the next Save without treating that rank
consolidation as a respec. The server also accepts an older client resending ranks already stored,
normalizes them, and rejects any new duplicate purchase. Removing a purchased node or its
prerequisite is a free respec at every level. The editor shows all four nation branches, Flow and
shared passives together, with names and effects always visible. Changes, including Reset all,
take effect only after Save. No database migration is needed because the loadout is stored as JSON.

## Flow combos

Flow appears alongside the three other nation branches. The player arranges the three distinct move
slots and buys the Flow nodes; combat executes itself. Nodes require the previous Flow tier:

| Tier | Talent | Automatic effect, at most once per battle |
|---|---|---|
| 1 | Quick Setup | After a landed Priority move, a different Burn or DEF-down move cannot miss and deals +5% damage. |
| 2 | Expose Weakness | True hit against a DEF-down target deals +4% damage. |
| 3 | Kindled Recovery | Drain against a burning target heals an extra 3% max HP. |
| 4 | Rhythm | The third distinct consecutive landed move deals +5% damage. |
| 5 | Patient Followup | Charge release against a burned or DEF-down target deals +5% damage. |
| 6 | Flow State | The third distinct consecutive landed move heals 4% max HP. |

The other branches' tier-3/4 effects are active too: debuffs, burn, drain, shields, dodge, speed,
critical hits and counterplay. On one hit, only the strongest regular talent damage bonus and the
strongest Flow damage bonus apply; this prevents multiplying many bought talents into a huge hit.
Specific numbers stay in `packages/shared/src/game/tree.ts` descriptions and
`packages/shared/src/battle/battle.ts` formulas. The triggered Flow name
is stored as `BattleAction.comboTalent` and displayed during playback.

Wild Mons receive a default tree down their first nation branch, tier by tier. Battle snapshots
keep the tree and protocol version, so prior logs are read from stored results rather than rerun
under new rules. Protocol 9 adds combo talents and a finisher that normally fires on turn 3–4,
allowing more equipped attacks to appear.

## Verification and balance

`packages/shared/test/tree.test.ts` checks node counts, costs, prerequisites, single purchases,
legacy-rank conversion and server validation. `packages/shared/test/treeCombos.test.ts` verifies
prepared Flow triggers in deterministic battles. The desktop render test checks visible Flow
choices, one purchase per talent, Save-only persistence and legacy conversion.

The cross-species and archetype bounds in `packages/shared/test/balance.test.ts` remain unchanged.
A near-budget-maxed four-branch tree wins about 72% against an empty tree at level 50 (60–73%
limit). The three original single-branch mirror matchups stay within 40–60%. Flow is setup-dependent
and is tested with a prepared move order instead of a default loadout that may not activate it.
