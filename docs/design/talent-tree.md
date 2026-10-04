---
doc_type: design
purpose: "Read this when changing talent-tree nodes, budgets, respec rules, or the loadout editor's Talents section."
audience: agent
last_verified: 2026-10-04
last_verified_commit: 0d5dfe3
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

Each nation has four radial twelve-stage paths: its original three identity branches, plus Flow, an
optional branch for move-order combos. Ten main passives use a separate three-point pool, with exactly one equipped alongside one free stance. All talents
are single purchases; move slots also require three distinct attacks. The exact node names, costs,
prerequisites and descriptions are data in `packages/shared/src/game/tree.ts`. The battle effects
are implemented in `packages/shared/src/battle/battle.ts`.

## Budget and saved trees

One nation point arrives per level from level 4, up to 47 at level 50. Each path costs exactly
47 to finish: the original six nodes cost 1/1/2/2/3/5 (14 total), followed by six mastery nodes
costing 4/5/5/6/6/7 (33 total). Any one path can consume the full level-50 budget without
buying another path. Each mastery fork has three alternatives at tiers 7 and 10. Choose one per fork; tiers 8 and 11 accept any of those choices. Four default routes cost 188; all available nodes cost 268, so specialization remains necessary.
Tier 1/2 grant +0.33% of the path's stat each; tiers 3/4 have battle effects; tier 5 upgrades a
move slot; tier 6 is the original capstone. Tiers 7–12 deepen the same route with stat bonuses
of cost ×0.15% (0.6%–1.05% per purchase), ending in an Ascendance capstone. Their stat sequence
is path identity, HP, DEF, SPD, ATK, path identity. Flow's identity is SPD.

Main passives cost three separate points; this pool grants three at level 10 and stays capped
at three. Exactly one may be equipped. The passives sit directly in the gaps between the four
paths, without containers or connections. Their only unlock gate is level 10. Normal nation
skills and Flow bonuses remain combinable; they do not occupy the main-passive slot. A free
stance occupies its own independent slot. Unselected passives dim while one is equipped.

Legacy multi-ranks resolve as one purchase. Legacy multiple main passives resolve to the first
owned entry in the stable shared-passive roster; extra purchases cease consuming points. The
next automatic edit submits this normalized map. The server tolerates trusted previously-owned
multi-ranks/passives only to normalize them; new duplicates or multiple main passives are rejected.

Left click purchases and autosaves immediately. Right click refunds a node and its dependants.
Reset all clears the tree and stance selection immediately, with no cooldown or cost.
Failed saves visibly restore the last confirmed allocation and permit retry. Skill edits never
submit unsaved attack drafts. No database migration is needed because loadouts are JSON.

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

Wild Mons receive a default tree down their first nation branch, limited to the original six tiers to preserve fallback difficulty. Battle snapshots
keep the tree and protocol version, so prior logs are read from stored results rather than rerun
under new rules. Protocol 9 adds combo talents and a finisher that normally fires on turn 3–4,
allowing more equipped attacks to appear.

## Verification and balance

`packages/shared/test/tree.test.ts` checks node counts, costs, prerequisites, single purchases,
legacy-rank conversion and server validation. `packages/shared/test/treeCombos.test.ts` verifies
prepared Flow triggers in deterministic battles. The desktop render test checks visible Flow
choices, immediate persistence, ordered rapid edits, error recovery, one main passive plus stance, prerequisite refunds and legacy conversion.

The cross-species and archetype bounds in `packages/shared/test/balance.test.ts` remain unchanged.
A near-budget-maxed four-branch tree wins about 72% against an empty tree at level 50 (60–73%
limit). The three identity-path mirror matchups stay within 40–60% at levels 30 and 50, using legal level budgets. Flow is setup-dependent
and is tested with a prepared move order instead of a default loadout that may not activate it.
