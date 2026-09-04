---
doc_type: design
purpose: "Read this when you need to change pet behavior states, priorities, stimuli, or how hook/input events drive the pet."
audience: agent
last_verified: 2026-09-05
last_verified_commit: 6d99ae3
related_files:
  - packages/shared/src/behavior/states.ts
  - packages/shared/src/behavior/priorities.ts
  - packages/shared/src/behavior/stimuli.ts
  - packages/shared/src/behavior/reducer.ts
  - packages/shared/test/behavior.test.ts
  - apps/desktop/src/main/hooks/ActivityTracker.ts
  - apps/desktop/src/renderer/pet/loop.ts
---

# Behavior engine

The pet is driven by a pure state machine in `packages/shared/src/behavior/reducer.ts`, shared
between the Electron pet renderer, the headless sim runner and its own test suite. Every host
(`apps/desktop/src/renderer/pet/loop.ts:PetLoop`, `packages/shared/scripts/sim.ts`, and
`packages/shared/test/behavior.test.ts`) calls the same entry point:
`stepBehavior(model, stimuli, now)` → `{ model, effects }`.

## Purity contract

`stepBehavior` and everything it calls take no dependency on the outside world: no `Date.now`, no
`Math.random`, no I/O. Time comes in as the `now` parameter, randomness comes from the model's own
mulberry32 state (`packages/shared/src/util/prng.ts`) seeded once in `createModel`. `BehaviorModel`
is a plain JSON-serialisable object (no classes, no functions, no `Date`s) —
`packages/shared/test/behavior.test.ts` asserts it survives a `JSON.stringify`/`parse` round-trip
mid-run and that two runs from the same seed and stimuli produce identical models. A host owns the
*only* impure parts: reading the clock, translating platform events into `Stimulus` values, and
acting on emitted `Effect`s.

Each call to `stepBehavior` runs, in order: apply each queued stimulus, `handleExpiry`,
`handleDecay`, `handleSleep`, then `integrate` (physics). `PetLoop` queues stimuli as they arrive
and drains the queue once per `requestAnimationFrame` tick.

## States

`PetState` (`packages/shared/src/behavior/states.ts`) has 21 values, grouped by the exported
group arrays:

| Group | States | Notes |
|---|---|---|
| Base (`BASE_STATES`) | `idle`, `walk`, `sit`, `egg_idle`, `egg_wobble` | The scheduler cycles these on its own via `SCHEDULE` chances; see Egg-stage remapping. |
| Airborne (`AIRBORNE_STATES`) | `dragged`, `shaking`, `falling` | The only states where the pet's `y` may sit above `world.groundY`. |
| Battle (`BATTLE_STATES`) | `battle_intro`, `battle_attack`, `battle_hit`, `battle_win`, `battle_lose` | Driven by `battle:*` stimuli from `apps/desktop/src/renderer/pet/BattlePlayer.ts`. |
| Egg-only | `hatching` | Egg-exclusive transient triggered by `game:hatch`; not in `BASE_STATES` because it isn't part of the idle/walk/sit cycle. |
| Activity/event | `thinking`, `working`, `success`, `error`, `celebrate`, `evolving`, `sleep` | Driven by hook events, game events, or the sleep timer. |

`isBaseState`/`isAirborneState`/`isBattleState`/`isPetState` are the corresponding predicates.
`animationFor(state, stage)` (`packages/shared/src/behavior/states.ts:animationFor`) maps each state
to a sprite clip (`AnimName`) and optional `FxName` overlay, with a separate table for egg stage
(egg sprites only have `idle`/`wobble`/`crack` clips) — see that file for the full mapping.

## Priority and durations

`PRIORITY` (`packages/shared/src/behavior/priorities.ts`) ranks every state; a transition succeeds
only if the target's priority is `>=` the current state's, the current state has expired
(`expiresAt <= now`), or the target is that state's `DECAY_TARGET` entry
(`working → thinking`, `thinking → idle`). See `canTransition`/`transition` in
`packages/shared/src/behavior/reducer.ts`. Ranks, high to low: `evolving`/`hatching` (100) >
`battle_*` (90) > `dragged`/`shaking`/`falling` (80) > `celebrate` (60) > `success`/`error` (50) >
`working` (40) > `thinking` (35) > `walk`/`sit`/`idle`/`egg_idle`/`egg_wobble` (20/20/10/10/10) >
`sleep` (5).

Fixed and ranged durations live in `DURATIONS`, and scheduler chances in `SCHEDULE`, both in
`packages/shared/src/behavior/priorities.ts` — read that file for exact values rather than
duplicating them here (`WORKING_DECAY`, `THINKING_DECAY`, `SLEEP_AFTER`, the `WALK_MIN`/`WALK_MAX`,
`IDLE_MIN`/`IDLE_MAX`, `SIT_MIN`/`SIT_MAX` ranges, `EGG_WOBBLE`, `SHAKING`, and the
celebration/error/hatch/evolve fixed lengths, plus `SCHEDULE.IDLE_TO_WALK`, `SCHEDULE.IDLE_TO_SIT`,
`SCHEDULE.EGG_WOBBLE`).

## Stimuli

`Stimulus` (`packages/shared/src/behavior/stimuli.ts`) is a discriminated union grouped by source:

| Source | Stimulus types |
|---|---|
| Hook events | `hook:prompt`, `hook:tool_start`, `hook:tool_end`, `hook:stop`, `hook:notification`, `hook:session_start`, `hook:session_end` |
| Activity snapshot | `activity:update` (`inFlightTools`, `midTurnSessions`, `lastEventAt`) |
| Pointer input | `input:grab`, `input:drag`, `input:release`, `input:shake-progress`, `input:shake`, `input:click`, `input:any` |
| Game events | `game:levelup`, `game:hatch`, `game:evolve` |
| Battle playback | `battle:play`, `battle:attack`, `battle:hit`, `battle:win`, `battle:lose`, `battle:done` |
| World/host | `world:bounds`, `stage:set` |

## Hook event → stimulus → state mapping

`apps/desktop/src/main/hooks/ActivityTracker.ts` (`ActivityTracker.ingest`) is the only translator
from raw `HookEnvelope`s to `Stimulus` values; it also appends a trailing `activity:update` to
every call (see next section).

| Hook event | Stimulus | Reducer effect |
|---|---|---|
| `SessionStart` | `hook:session_start` | Updates activity bookkeeping only; no forced state. |
| `UserPromptSubmit` | `hook:prompt` | → `thinking` (gated by priority). |
| `PreToolUse` | `hook:tool_start` | → `working` (gated by priority). |
| `PostToolUse` | `hook:tool_end` | → `working` if another tool is still in flight, else → `thinking`. |
| `Notification` | `hook:notification` | → `error`. |
| `Stop` | `hook:stop` | → `success`. |
| `SessionEnd` | `hook:session_end` | Clears that session's activity; no forced state. |

## Decay chain and sleep rule

Two decays run every step in `handleDecay` (`packages/shared/src/behavior/reducer.ts:handleDecay`),
independent of new stimuli:

- `working` → `thinking` once `activity.inFlightTools === 0` and `DURATIONS.WORKING_DECAY` has
  passed since `activity.lastEventAt`.
- `thinking` → `idle` once `activity.midTurnSessions === 0` and `DURATIONS.THINKING_DECAY` has
  passed since `activity.lastEventAt`.

`handleSleep` forces `idle`/`sit`/`walk` → `sleep` (no expiry) once `now - lastInteractionAt`
exceeds `DURATIONS.SLEEP_AFTER`. Any hook stimulus or `input:click`/`input:any` refreshes
`lastInteractionAt`; leaving `sleep` always emits a `wake` effect in addition to `state-changed`.

## Egg-stage remapping

`remapForStage(state, stage)` (`packages/shared/src/behavior/reducer.ts:remapForStage`) is applied
on every transition:

- While `stage === 'egg'`: `idle`, `walk`, `sit`, `sleep` all collapse to `egg_idle` — eggs never
  walk, sit, or sleep on their own clip. `egg_idle` itself randomly rolls into `egg_wobble`
  (`SCHEDULE.EGG_WOBBLE`) on expiry.
  All other states (including `battle_*`, `dragged`, `working`, `hatching`) pass through unchanged.
- While `stage !== 'egg'`: `egg_idle`/`egg_wobble` collapse to `idle` (covers the moment a
  `stage:set` stimulus arrives before the model has left an egg state).
- `input:shake` on an egg still transitions to `shaking` but does **not** emit `request-battle`
  (eggs cannot battle).
- `game:hatch` forces `hatching` regardless of stage; a later `stage:set` stimulus to a non-egg
  stage does not cut `hatching` short — it only takes effect once `hatching` expires
  (`DURATIONS.HATCHING`), then remaps normally to `idle` under the new stage.

## Effects

`stepBehavior` returns zero or more `Effect` values for the host to act on
(`packages/shared/src/behavior/reducer.ts`, type `Effect`):

| Effect | Emitted when | Host reaction (`PetLoop`) |
|---|---|---|
| `state-changed` | Any accepted transition where `from !== to`. | Used for the periodic `pet:state` IPC push. |
| `request-battle` | `input:shake` accepted on a non-egg stage (once per shake, not re-emitted while still `shaking`). | Calls `window.mons.requestBattle()`. |
| `landed` | `falling` reaches `world.groundY`. | Calls `window.mons.landed()`. |
| `wake` | Any transition leaving `sleep`. | No dedicated handler in `PetLoop` today; state-changed still fires alongside it. |

## Physics constants

Integration (`integrate` in `packages/shared/src/behavior/reducer.ts`) only moves the pet during
`walk` (horizontal, bouncing off `world.minX`/`world.maxX`) and `falling` (gravity-driven, landing
at `world.groundY`): `DEFAULT_WALK_SPEED` = 40 DIP/s, `GRAVITY` = 1200 DIP/s². The integration step
is clamped to 0.25 s (`MAX_DT`, internal constant) so a suspended tab or slow frame never teleports
the pet.

## How multiple Claude Code sessions collapse

`ActivityTracker` (`apps/desktop/src/main/hooks/ActivityTracker.ts`) keeps one `SessionActivity` per
`session_id`, tracking its in-flight tool ids and whether a turn is mid-flight (between
`UserPromptSubmit` and `Stop`). Every `ingest()` call, after translating the event to its own
stimulus, prunes stale sessions (30 min silent) and stale in-flight tools (10 min with no
`PostToolUse`), then appends a trailing `activity:update` stimulus built from `snapshot()`: the sum
of in-flight tools and mid-turn sessions across *all* tracked sessions. The reducer treats this
snapshot as authoritative — if any session has a tool in flight the pet is `working`; otherwise if
any session is mid-turn (and the current state's priority is below `thinking`) it is `thinking`.
This is how the pet shows one coherent behavior even with several concurrent Claude Code sessions
sending hook events.

## Testing a behavior change

- Unit/property tests: `packages/shared/test/behavior.test.ts` covers priority gating, the
  working/thinking/idle decay chain, sleep and wake, egg restrictions, shake-to-battle, walking
  bounds, drag/fall/landed, long-run determinism, and JSON round-trips. Run with
  `pnpm --filter @claude-mons/shared test`, or `pnpm test` for the whole workspace.
- Manual/scripted runs: `pnpm sim <script.json>` runs `packages/shared/scripts/sim.ts` headlessly
  against a JSON timeline (`stage`, `seed`, `x`, `world`, `timeline[]` of `{ at, stimulus }`,
  optional `expect[]`, `durationMs`, `stepMs` — see
  `packages/shared/scripts/examples/day-in-the-life.json`), printing the state timeline and exiting
  1 on an expectation mismatch — no need to open the Electron app.
- `apps/desktop/src/renderer/pet/loop.ts:PetLoop` is the real host: use `--simulate <script.json>`
  (parsed in `apps/desktop/src/main/sim/ScriptRunner.ts`) to feed the same script into the actual
  desktop app when you need to see rendering, not just the state timeline.
