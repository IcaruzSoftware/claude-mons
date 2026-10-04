# Passive stances release 0.2.12

Baseline a197357 / installed 0.2.11. Replace the stance-counter triangle and unconditional
stat modifiers with three build passives; keep existing stance ids and saved loadouts.
Fury Exploit: +8% direct damage on crit/charged release against an already-debuffed foe.
Bulwark Brace: 10% less direct damage while charging or at <=35% HP.
Gale Tempo: +10% direct damage on a different move immediately after landed Priority,
only when acting first. Miss/telegraph consumes the opportunity; double strikes cannot
trigger offensive stance effects. Burn never triggers Brace. No new RNG calls.

## Loop check and automated verification
Pure shared simulator, existing balance/archetype tests and live offline CDP form the loop.
Add activation/non-activation, move-order and build-fit tests; replace RPS acceptance with
non-dominance across stance/species/build matrices. Bump battle protocol; refresh golden
log only after mechanical tests pass. pnpm check, shared sync/Deno, production build, live
UI and packaged QA remain required.

## Regression risks and rollback
Conditional stacking and late mastery can overpower Flow, drain or charge. One-slot enforcement
must not remove normal nation/Flow bonuses. Refunds must retain the main passive when its gate
remains. Serialization must prevent rapid save races and recover rejected mutations. Preserve existing species,
level, archetype and tree balance bands; calibrate strengths rather than widen them.
Old logs must replay as stored; optional log fields preserve compatibility. Server must
update before desktop release. No schema/profile migration. Rollback server to a197357
and publish a corrective higher client version; retain 0.2.11 installer and profile backup.

## Delivery
Display three mutually exclusive passive nodes and contextual build hints in the map.
The map autosaves left-click purchases and stance choices, right-click refunds and free Reset all;
there is no map Save/Cancel. Stances and the one main-passive slot have separated labelled areas.
Main passives require an identity tier-6 capstone; legacy allocations normalize safely. Every
path extends to twelve nodes costing 47 points. Learned paths glow gold, available paths softly,
locked paths dim. Native window expands to display-bounded 1920×1120 and restores on close. Record triggered passives in combat logs/banner.
Remove counter claims from explanations/docs. Publish 0.2.12 and install/restart locally.


## Reference direction
Path of Exile's [passive atlas](https://www.pathofexile.com/passive-skill-tree) informs connected
prerequisite paths and specialization; Blizzard's [2020 Diablo IV tree exploration](https://news.blizzard.com/en-us/article/23529210/diablo-iv-quarterly-updateseptember-2020)
informs distinct powerful passive regions. Cloudmon retains unrestricted refunds as requested.

## Final automated verification
Legal single-path budgets from levels 4–50 for all nations, one-main-passive validation and
legacy normalization, mastery versus other identity paths at L30/L50 (40–60%), default bot
fairness, direct map autosaves/rapid edits/failure rollback, passive slot refunds and prerequisite
cascades. Live offline CDP verifies actual native expansion/restoration, all 48+10+3 nodes,
zoom/pan, hover placement, gold learned state and automatic persistence without real-account edits.


## Verification completed 2026-10-04
- pnpm check: lint, both TypeScript targets, 1,208 Vitest tests, 22 script tests and docs check pass.
- Shared source sync and Deno check of create-profile, battle-request, set-loadout, ingest-xp and heartbeat pass.
- Production Electron build passes.
- Live offline UI: 424×621 to 1904×1081 native expansion; centered 48 nation skills, ten main
  passives, three stances; map-only controls, wheel/pan, hover above cursor, immediate saved buys,
  parent refunds, one main slot, stance, Reset all and compact restoration pass. Actual 47-point
  allocation down Current uses exactly twelve skills, no other paths. Final visual spacing separates
  multiline capstones and passive groups; packaged release verification follows before installation.
