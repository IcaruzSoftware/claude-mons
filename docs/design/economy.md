---
doc_type: design
purpose: "Read this when you need the exact XP numbers, caps, or streak/bonus rules for the pet's activity economy."
audience: agent
last_verified: 2026-09-05
last_verified_commit: 6d99ae3
related_files:
  - packages/shared/src/game/xp.ts
  - packages/shared/test/xp.test.ts
  - supabase/functions/_shared/pipeline.ts
---

# XP economy

`packages/shared/src/game/xp.ts` is the single source of truth for the activity XP economy. It is pure (no `Math.random`/`Date.now`; callers pass `now` and history) so the same functions run client-side for provisional XP and server-side as the authoritative source. `supabase/functions/_shared/pipeline.ts` calls `creditBucket()` and `activateDay()` inside `runIngestPipeline()`, which the `ingest-xp` Edge Function invokes per batch, against a copy synced by `pnpm sync:shared` — same math, no separate server-side reimplementation.

## Event awards

| Hook event | Constant | XP |
|---|---|---|
| `UserPromptSubmit` (prompt) | `EVENT_XP.prompt` | 5 |
| `Stop` (finished turn) | `EVENT_XP.stop` | 10 |
| Tool call | `TOOL_XP[classifyTool(name)]` | see tool classes below |

## Tool classes

`classifyTool()` maps a raw tool name to a `ToolClass`, and `TOOL_XP` weights each class:

| Class | `TOOL_XP` | Tools |
|---|---|---|
| `mutate` | 2 | `Edit`, `MultiEdit`, `Write`, `NotebookEdit` |
| `run` | 1 | `Bash`, `Task`, `PowerShell`, `Agent`, `Workflow`, and any name starting with `mcp__` |
| `read` | 1 | everything else, including an unknown/undefined name (the default) |
| `meta` | 0 | `TodoWrite`, `TodoRead`, `AskUserQuestion`, `ExitPlanMode`, `EnterPlanMode`, `ToolSearch`, `ListAgents`, `ScheduleWakeup` |

## Caps

All values are `CAPS` fields in `packages/shared/src/game/xp.ts:CAPS`.

| Cap | Constant | Value |
|---|---|---|
| Tool XP per UTC minute | `toolXpPerMinute` | 30 |
| Prompts per rolling hour | `promptsPerHour` | 20 |
| Tool XP per rolling hour | `toolXpPerHour` | 600 |
| Work XP per rolling hour | `workXpPerHour` | 400 |
| Prompts per UTC day | `promptsPerDay` | 120 |
| Stops per UTC day | `stopsPerDay` | 120 |
| Tool XP per UTC day | `toolXpPerDay` | 1200 |
| Work XP per UTC day | `workXpPerDay` | 2000 |
| Prompt-context window | `promptContextMs` | 30 min (`30 * 60 * 1000` ms) |
| Plausibility clamp: prompts/minute | `bucketMaxPrompts` | 6 |
| Plausibility clamp: stops/minute | `bucketMaxStops` | 6 |
| Plausibility clamp: tool calls/minute | `bucketMaxTools` | 60 |
| Bucket staleness (dropped if older) | `staleMs` | 24 h |
| Bucket future tolerance (dropped if newer) | `futureMs` | 2 min |

"Work XP" is `prompts·5 + stops·10 + toolXp` (`workXpOf()`); it is what the global hour/day caps below apply to, on top of the per-type caps above. Stops are additionally capped so credited stops in an hour never exceed credited prompts in that hour (`creditBucket()`'s `stopCeilingHour`).

`creditBucket()` applies these in order: staleness/future check → per-minute plausibility clamps → prompt-context drop → per-minute tool cap → hourly per-type caps → daily per-type caps → global work cap (hour, then day), each trimming tool XP first, then whole stops, then whole prompts (`trim()`). Every drop is reported with a `DropReason` (`stale`, `future`, `implausible`, `no_prompt_context`, `cap_minute`, `cap_hour`, `cap_day`).

## Prompt-context rule

A tool call's XP is credited only if a prompt (this bucket's or a prior one) occurred within `CAPS.promptContextMs` (30 minutes) before or at the tool's minute. Tool XP with no qualifying prompt in that window is dropped with reason `no_prompt_context`, even if it would otherwise fit under every cap.

## Daily bonus and streak

Constants live in `BONUS` (`packages/shared/src/game/xp.ts:BONUS`):

| Rule | Constant | Value |
|---|---|---|
| Day counts as "active" once work XP reaches | `dailyThreshold` | 50 |
| Daily bonus (paid once, on the day it first becomes active) | `daily` | 25 |
| Streak bonus per active day (added to the daily bonus) | `streakPerDay` | 10 |
| Streak length cap | `streakMaxDays` | 7 |
| Gap (calendar days) the streak survives | `streakGapDays` | 3 |

`activateDay(state, today)` is idempotent for a day already marked active (returns `bonus: 0`) and pays `BONUS.daily + BONUS.streakPerDay * min(streak, BONUS.streakMaxDays)` the first time a day crosses the threshold. A gap of 1–3 calendar days since the last active day continues the streak (e.g. Friday → Monday); a longer gap resets it to a streak of 1.

## UTC day semantics

Days are UTC calendar days. `dayKey(ts)` returns `'YYYY-MM-DD'` from the UTC date; `dayFloor(ts)` floors an epoch-ms timestamp to the start of its UTC day; `daysBetween(dayA, dayB)` diffs two day keys in whole days via `Date.parse('...T00:00:00Z')`. Minute buckets use `minuteFloor(ts)`, flooring to the UTC minute.

## Typical day

The `packages/shared/test/xp.test.ts` case "a realistic day lands well under the caps" fixes the shape: 25 turns over 2.5 hours (one turn every 6 minutes), each turn one prompt + one stop + 3 `Edit` + 9 `Read` calls. Per turn that is `5 (prompt) + 10 (stop) + (3·2 + 9·1) (tool) = 30` work XP, well inside every per-minute/hour cap, so the day totals exactly `25 * 30 = 750` work XP — comfortably under the 2000/day work cap. Reaching `BONUS.dailyThreshold` (50) adds the daily bonus; a mid-streak day (say, day 4 of an unbroken streak) adds `BONUS.daily + BONUS.streakPerDay * 4 = 65` XP on top. Battle rewards are computed separately in `packages/shared/src/battle/battle.ts` and are not part of this file's economy.

The `packages/shared/test/xp.test.ts` case "8-hour day cannot beat the daily cap" confirms the ceiling holds even under sustained maximal input: it lands at or under `CAPS.workXpPerDay` (2000) and above 90% of it, i.e. the caps are tight, not merely theoretical.

## Constant reference

| Name | File | Value |
|---|---|---|
| `EVENT_XP.prompt` | `packages/shared/src/game/xp.ts` | 5 |
| `EVENT_XP.stop` | `packages/shared/src/game/xp.ts` | 10 |
| `TOOL_XP.mutate` | `packages/shared/src/game/xp.ts` | 2 |
| `TOOL_XP.run` | `packages/shared/src/game/xp.ts` | 1 |
| `TOOL_XP.read` | `packages/shared/src/game/xp.ts` | 1 |
| `TOOL_XP.meta` | `packages/shared/src/game/xp.ts` | 0 |
| `CAPS.toolXpPerMinute` | `packages/shared/src/game/xp.ts` | 30 |
| `CAPS.promptsPerHour` | `packages/shared/src/game/xp.ts` | 20 |
| `CAPS.toolXpPerHour` | `packages/shared/src/game/xp.ts` | 600 |
| `CAPS.workXpPerHour` | `packages/shared/src/game/xp.ts` | 400 |
| `CAPS.promptsPerDay` | `packages/shared/src/game/xp.ts` | 120 |
| `CAPS.stopsPerDay` | `packages/shared/src/game/xp.ts` | 120 |
| `CAPS.toolXpPerDay` | `packages/shared/src/game/xp.ts` | 1200 |
| `CAPS.workXpPerDay` | `packages/shared/src/game/xp.ts` | 2000 |
| `CAPS.promptContextMs` | `packages/shared/src/game/xp.ts` | 1,800,000 |
| `CAPS.bucketMaxPrompts` | `packages/shared/src/game/xp.ts` | 6 |
| `CAPS.bucketMaxStops` | `packages/shared/src/game/xp.ts` | 6 |
| `CAPS.bucketMaxTools` | `packages/shared/src/game/xp.ts` | 60 |
| `CAPS.staleMs` | `packages/shared/src/game/xp.ts` | 86,400,000 |
| `CAPS.futureMs` | `packages/shared/src/game/xp.ts` | 120,000 |
| `BONUS.daily` | `packages/shared/src/game/xp.ts` | 25 |
| `BONUS.dailyThreshold` | `packages/shared/src/game/xp.ts` | 50 |
| `BONUS.streakPerDay` | `packages/shared/src/game/xp.ts` | 10 |
| `BONUS.streakMaxDays` | `packages/shared/src/game/xp.ts` | 7 |
| `BONUS.streakGapDays` | `packages/shared/src/game/xp.ts` | 3 |

For the level curve and stage thresholds (`HATCH_XP`, `MAX_LEVEL`, `TEEN_LEVEL`, `ADULT_LEVEL`) that XP feeds into, see `packages/shared/src/game/levels.ts` — not restated here.
