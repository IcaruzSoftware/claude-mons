# Skill map release 0.2.11

Release from current origin/main (0d5dfe3), preserving all 0.2.10 sprites, battle effects,
single-purchase talents, four nation branches and free respecs. The original dirty checkout
remains untouched. Shared costs and budget scale together; rank maps need no migration.

## Regression risks and automated verification
Verify every species has all 24 nation/Flow and 10 shared nodes. Check legacy rank
normalization, actual prerequisite edges, budget gates and uniqueness, cancel/removal,
tree-only saves preserving unsaved moves, cursor-anchored zoom and pan, small-screen fit.
Run pnpm check, Deno compatibility and production build. Exercise offline throwaway app
via CDP; test packaged installer before modifying the installed app. Verify published
installer/metadata checksums and installed version/process restart.

## Rollout and rollback
Direct release. Commit and push 0.2.11, deploy functions with migrations disabled before
publishing the v0.2.11 tag. Wait for Windows/Linux workflow and verify assets. Back up
local JSON state before installation. Roll back backend to 0d5dfe3 with migrations disabled;
client rollback uses a corrective higher version (never move published tags). Previous
installer remains available locally. Saved rank maps remain valid in both point-unit systems.

## Checklist
- [x] Port map to current main, all four paths and latest purchase semantics.
- [x] Full checks and offline UI QA.
- [x] Push source, deploy functions, publish release and verify assets.
- [x] Install released Windows binary, restart and verify version.

## Follow-up scope before publication
Battle shows only Abilities, Skill Tree and History. Remove duplicate talents/arena; stance
remains in the map core. History reads existing participant-only RLS at startup/login/sync.
Regression risks: defender perspective, account switches during fetch, lost animation
callbacks, duplicate/out-of-order history. Automated tests cover each history conversion,
query scope, merge order/cap, immediate persistence, same-account adoption and minimal UI.
Rollback removes these client-only changes; database schema and historical rows stay intact.

## Verification before source publication
1196 Vitest tests and 22 script tests pass; lint, types, docs and production build pass.
Deno checks pass after shared sync. Fresh production renderer CDP confirms minimal Battle,
actual recent fight, 24+10 nodes, wheel/buttons, drag, Fit/Center, one-time buys, budgets,
save round-trip, cancel/cascade and 380x520 layout. No renderer/network errors.
Focus scrolling fixed with a non-scrollable clipped viewport.

Published v0.2.11 at a197357; backend run 37121658794 and release run 37121829976 passed.
Published installer SHA512 verified, extracted package version/update manifest checked,
packaged offline QA passed. Installed silently with explicit per-user destination, then
restarted installed app (PID 52644). Version 0.2.11, identity/species/loadout preserved.
Backup: %TEMP%/cloudmon-release-0.2.11/profile-before-install.
