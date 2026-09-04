---
doc_type: decision
purpose: "Read this when you need to know why battle turn order is probabilistic and damage variance is wide instead of matching the original design plan."
audience: both
last_verified: 2026-09-04
last_verified_commit: d7db9c0
related_files:
  - packages/shared/src/battle/battle.ts
  - packages/shared/src/game/levels.ts
  - packages/shared/test/balance.test.ts
  - docs/design/battle.md
adr_status: accepted
---

# Battle balance retune

## Context

The original plan (`docs/history/v1-design-2026-09-04.md`, §5.5, summarized in the History section
of `docs/design/battle.md`) specified strict "faster mon always acts first" turn order, a narrow
damage variance band, and a steeper per-level stat growth curve. Running the balance harness
(`packages/shared/test/balance.test.ts`) against that design showed a one-level advantage winning
roughly 90 % of mirror matches — a level edge was close to deterministic, which flattens the
incentive to try different species once a player is even slightly ahead, and leaves no room for a
larger, intentional level gap to feel meaningfully different from a small one.

Alternatives considered:

- **Keep strict speed-order turns, only widen variance or flatten growth**: modeled but insufficient
  on its own — with a deterministic first-actor, the faster mon's crit/dodge math (both keyed off
  the speed difference, see `docs/design/battle.md`) still compounded every turn in the same
  direction, so the win-rate curve stayed too steep for any single lever to fix.
- **Leave the numbers as designed and loosen the balance harness's thresholds instead.** Rejected
  per the harness's own comment (`packages/shared/test/balance.test.ts`): a failing balance test is
  a signal to adjust the simulation inputs, not to widen the acceptance band until the test passes.

## Decision

Three changes together, all in `packages/shared/src/battle/battle.ts` and
`packages/shared/src/game/levels.ts`, moved the balance harness's level-advantage assertion from
~90 % to the target window: turn order became probabilistic by speed rather than strictly
speed-ordered, damage variance widened, and per-level stat growth was roughly halved. The exact
formulas and constants are `docs/design/battle.md`'s to state (see its Damage formula, Turn order
and History sections); this decision records why they changed, not the resulting numbers. The
target the retune was tuned against: a +3-level advantage should win about 70–80 % of the time
(`packages/shared/test/balance.test.ts`, "a 3-level advantage wins roughly 70-80 % of the time"),
and every species should stay within a 35–65 % win rate against its cross-nation matchups at level
10 (same file, first test). Both thresholds are asserted directly in
`packages/shared/test/balance.test.ts` and must keep passing for any future stat or formula change.

## Consequences

- A speed advantage no longer guarantees acting first every turn, which makes individual battle logs
  less predictable from the pre-battle stats alone — intentional, since the goal was to stop a small
  level or stat edge from reading as an almost-certain win, but it also means a player who out-levels
  an opponent by a wide margin (well beyond the +3 the harness checks) can still occasionally lose,
  which was not separately verified past the one level gap the balance harness covers.
- Slower stat growth per level means the level curve needed for the same total power difference is
  longer; anything outside the shared package that assumed the original (steeper) growth constants —
  none identified at the time of this decision — would need re-checking against
  `packages/shared/src/game/levels.ts:statAtLevel`.
- The balance harness only samples cross-nation, no-mirror matchups (what matchmaking can actually
  produce, per `docs/design/battle.md`'s Matchmaking section); mirror-nation matchups, which the
  original 90 %-win-rate problem was measured against, are not re-asserted by any test after this
  retune.

## Status

Accepted, 2026-09-04
