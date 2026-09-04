---
doc_type: reference
purpose: "Read this when understanding the game-logic module shared between the desktop app and Supabase Edge Functions."
audience: agent
last_verified: 2026-09-05
last_verified_commit: 6d99ae3
related_files:
  - packages/shared/src/*
  - packages/shared/package.json
  - packages/shared/scripts/sim.ts
  - tsconfig.base.json
  - eslint.config.js
---

# packages/shared

Dependency-free game logic consumed as TypeScript source by both `apps/desktop` (Node) and `supabase/functions` (Deno). The package exports 13 modules re-exported through `packages/shared/src/index.ts`; callers import these or use path exports from `packages/shared/src/*`.

Build is a no-op; the source is consumed directly. Consumed by Deno via a sync operation (`pnpm sync:shared`) that copies this directory into `supabase/functions/_shared/game/` and sets it to ESLint-ignore.

## Module Map

| File | Responsibility | Key Exports |
|---|---|---|
| `src/types.ts` | Domain primitives | Nation, Stage, Rarity, Stats; isNation(), isStage() |
| `src/api.ts` | Wire types (client ↔ Edge Functions) | ApiError, ApiErrorCode, MonState, CreateProfile*, IngestXp*, Battle* types |
| `src/game/levels.ts` | Level curve, stage thresholds, stat scaling | HATCH_XP, MAX_LEVEL, TEEN_LEVEL, ADULT_LEVEL; xpForLevel(), levelFromXp(), stageForLevel(), statAtLevel() |
| `src/game/xp.ts` | XP economy: tool classification, caps, bonuses, streaks | ToolClass, TOOL_XP, EVENT_XP, CAPS, BONUS; classifyTool(), creditBucket(), streak functions |
| `src/game/nations.ts` | Nation metadata, palettes, type effectiveness | NationInfo, NATION_INFO, NATION_BEATS; effectiveness(), otherNations() |
| `src/game/nickname.ts` | Nickname validation + deterministic generator | NICKNAME_RE, RESERVED, BLOCKLIST; validateNickname(), generateNickname() |
| `src/game/species.ts` | Species table (8), rarity rolls, display names | Species, SPECIES, SPECIES_IDS; speciesOf(), rollSpecies() |
| `src/battle/rng.ts` | Seedable PRNG (cyrb128 → sfc32) | Rng, makeRng() — bit-exact across V8 and Deno |
| `src/battle/battle.ts` | Deterministic auto-battle simulator + rewards | MonSnapshot, BattleAction, simulateBattle(), BATTLE_RULES; challengerReward(), defenderReward() |
| `src/behavior/index.ts` | Behavior-engine submodule barrel | Re-exports states, priorities, stimuli, reducer |
| `src/behavior/states.ts` | Pet state enum, state→sprite/FX mapping | PetState, PET_STATES, AnimName; isBaseState(), isBattleState(), animationFor() |
| `src/behavior/priorities.ts` | Priority table, durations, scheduler config | PRIORITY, DURATIONS, SCHEDULE, DECAY_TARGET |
| `src/behavior/stimuli.ts` | Input union (hook/activity/game/battle/world) | Stimulus, StimulusType |
| `src/behavior/reducer.ts` | Pure state machine: stimuli → physics | World, BehaviorModel, Effect; createModel(), stepBehavior(), transition(), canTransition() |
| `src/input/shake.ts` | Pure shake detector (sliding window, dominant axis) | ShakeDetectorState, ShakeVerdict; createShakeState(), pushShakeSample() |
| `src/hooks/payload.ts` | Hook envelope contract + validator | HookEventName, HOOK_EVENTS, HookEnvelope; parseHookEnvelope() |
| `src/util/prng.ts` | Mulberry32 PRNG (32-bit state, JSON-safe) | Prng, createPrng(), seedFrom() |

## Deno Compatibility

This package must run in both Node.js and Deno. Enforcement:

- **Import extensions:** All relative imports use `.ts` extensions (required by `allowImportingTsExtensions` in `tsconfig.base.json` + `noEmit`).
- **ESLint scope:** `eslint.config.js` restricts `packages/shared/src/**/*.ts` from importing Node built-ins (`node:*`, `fs`, `path`, `os`, `crypto`, `http`, `net`, `child_process`) and accessing Node globals (`process`, `Buffer`, `require`, `__dirname`). Web-standard APIs only.
- **Type check:** Run `pnpm deno:check`, which syncs this directory into `supabase/functions/_shared/game/` and type-checks Edge Function files against it.
- **Game code:** No `Math.random()` or `Date.now()`. Logic must accept injected `seed`, `now`, `roll` for determinism in tests and headless runs.

## Running Simulations

Use `pnpm sim <script.json>` to run the behavior engine headlessly. Script JSON shape:

```json
{
  "stage": "baby",
  "seed": 1,
  "x": 500,
  "world": { "minX": 0, "maxX": 1000, "groundY": 500 },
  "timeline": [{ "at": 0, "stimulus": { "type": "hook:prompt" } }],
  "expect": [{ "at": 1500, "state": "thinking" }],
  "durationMs": 20000,
  "stepMs": 16
}
```

Prints the state timeline and exits 1 on expectation mismatch. See `packages/shared/scripts/sim.ts` and `packages/shared/scripts/examples/day-in-the-life.json`.

## Tests

| File | Coverage |
|---|---|
| `packages/shared/test/api.test.ts` | Runtime-empty assertion (wire types only) |
| `packages/shared/test/levels.test.ts` | Level curve, stat scaling, stage thresholds |
| `packages/shared/test/xp.test.ts` | XP classification, credit buckets, daily caps, streaks |
| `packages/shared/test/nickname.test.ts` | Validation regex, reserved list, blocklist, deterministic generation |
| `packages/shared/test/battle.test.ts` | RNG determinism, nation cycle, stat budgets, rewards; golden snapshot |
| `packages/shared/test/behavior.test.ts` | Priority gating, decay chain, physics, egg restrictions, determinism; JSON round-trip |
| `packages/shared/test/shake.test.ts` | Shake detection (sliding window, sign reversals) |
| `packages/shared/test/balance.test.ts` | Cross-nation round-robin (35–65 % win rates, level scaling) |

Run with `pnpm test` (vitest) or `deno test` (Deno). Tests inject time, RNG, and world parameters; logic is pure and deterministic.
