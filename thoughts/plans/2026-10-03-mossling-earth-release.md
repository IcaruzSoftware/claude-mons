---
doc_type: reference
purpose: "Implementation and release checklist for the moss evolution line and local balance tuning."
audience: agent
last_verified: 2026-10-03
last_verified_commit: da1f9c0
related_files:
  - packages/sprites/src/species/mossling.ts
  - packages/sprites/src/species/rootling.ts
  - packages/sprites/src/species/terraformer.ts
  - packages/shared/src/battle/battle.ts
  - docs/runbooks/release.md
---

# Moss evolution line and balance release

## Acceptance criteria

- Mossling, Rootling and Terraformer use original moss-heavy pixel art based on the selected
  concepts, with consistent green shading, eyes and leaf shoots; Terraformer remains a tortoise.
- Each stage has idle, walk, sleep, work, happy, hurt and attack clips in its existing grid.
- Work animates a root ball and swaying seedling, with a brief tickle/sneeze and recovery.
- Terraformer has the same playful work loop, with the plant growing on its moss shell.
- Idle/work feet stand on the existing anchor row; the moving plant is never clipped.
- Local balance tuning ships alongside the current main branch's traits, talents, opponent
  kinds, element variety and XP-hook fixes.
- Release 0.2.10 is published with Windows/Linux installers and updater metadata after the
  compatible backend is deployed successfully.

## Current state

The original checkout is based on 0.2.7 and contains uncommitted balance work plus an unrelated
startup fix. Remote main is da1f9c0, includes 0.2.9, and uses battle protocol 10. Concept PNGs
are preview artifacts; production sprites are TypeScript string-row matrices.

## Implementation approach

Use the existing compose, withRows, squashTop, shift, dots and recolor helpers. Hand-author
compact pixel layers rather than downsampling concept PNGs. Share only the palette and
seedling art used by all three actual consumers. No new animation state or event is needed:
the existing working state selects work for every non-egg stage.

Integrate the local balance formulas into current main rather than overwriting newer battle
logic. Protocol 11 records changed deterministic results. Use peers-first windows bounded
at three levels and the local 75/15/10 wild distribution. Retain recent-opponent/element
rotation, NPC strength factors, existing reward formulas and all Flow/nation talents.

## Rollout and rollback

Direct deploy, no flag or expand-contract: sprite IDs, dimensions, anchors, animation names,
database schema and API response shapes are unchanged. Deploy functions at the release
commit before tagging the desktop release. Existing logs are replayed as stored.

Rollback backend by redeploying da1f9c0 with migrations disabled. Rollback client by publishing
a higher corrective version restoring the old sprites/balance; do not move published tags.
The user's original dirty checkout remains untouched and available as a recovery source.

## Regression risks

Plant/limb clipping, missing adult work animation, shifted foot anchors, palette tinting,
or unreadable features at native resolution. Verify each stage's entire animation set.
Battle changes can affect win rates, prepared combos and wild XP/streak earnings. Existing
and user-added deterministic matrices must pass against current traits/talents/NPC scaling.
Backend/client version drift is prevented by backend-first publication.

## Phase 1: playable sprite redesign

- [x] Redraw the three species and implement their seedling work loops.
- [x] Add moss-line tests for stages, anchors, palette and plant motion/visibility.
- [x] Render all clips, inspect idle/work/walk/attack and exercise work in the offline app.

## Phase 2: integrate local balance

- [x] Apply formulas and peers-first distribution to current main; protocol becomes 11.
- [x] Merge applicable user tests, updating actual NPC tests for current strength factors.
- [x] Update owning design docs and run deterministic battle/balance tests.

## Phase 3: verify and publish

- [x] Bump desktop version and changelog to 0.2.10 dated 2026-10-03.
- [x] Run pnpm check, Deno compatibility check and production desktop build.
- [x] Verify the three stages in an offline throwaway profile and save captures.
- [ ] Commit, push reviewed source, deploy functions, and confirm successful workflow.
- [ ] Push v0.2.10; wait for release workflow and verify all installer/metadata assets.

## Automated verification

Run sprite registry/grid tests plus new moss tests; keep each seedling's unique palette
pixels visible with unchanged counts through its eight work poses. Work's first and last
poses must join smoothly; sneeze particles are brief. Check behavior-to-animation routing
for baby/teen/adult using the real shared selector. Run full lint/typecheck/unit/script/doc
checks and Deno shared-code compatibility. Validate release artifact names and versions.

## Verification results

- pnpm check: 1,184 unit tests and 22 script tests passed; lint, types and docs passed.
- Deno checked every Edge Function successfully after syncing current shared code.
- Production desktop build passed for 0.2.10.
- Offline Electron simulation logged working for baby, teen and adult; all three captures
  showed complete moss sprites and seedling poses without runtime errors. Work strips also
  show swaying foliage, the brief sneeze and recovery. Walk/attack strips retain readable forms.
- No database migration or local-profile migration is required. The original checkout's
  unrelated startup edits are excluded from this release.