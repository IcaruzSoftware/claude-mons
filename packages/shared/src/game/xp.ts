/**
 * XP economy. Single source of truth for the desktop app (provisional XP) and the Edge Function
 * `ingest-xp` (authoritative XP). Pure functions only: callers supply history and time.
 */

export type ToolClass = 'mutate' | 'run' | 'read' | 'meta';

export const TOOL_XP: Record<ToolClass, number> = { mutate: 2, run: 1, read: 1, meta: 0 };

export const EVENT_XP = { prompt: 5, stop: 10 } as const;

export const CAPS = {
  /** max tool XP credited per UTC minute */
  toolXpPerMinute: 30,
  promptsPerHour: 20,
  toolXpPerHour: 600,
  workXpPerHour: 400,
  promptsPerDay: 120,
  stopsPerDay: 120,
  toolXpPerDay: 1200,
  workXpPerDay: 2000,
  /** tool calls only count if a prompt happened within this window before them */
  promptContextMs: 30 * 60 * 1000,
  /** per-minute plausibility clamps */
  bucketMaxPrompts: 6,
  bucketMaxStops: 6,
  bucketMaxTools: 60,
  /** buckets older than this (relative to now) are dropped */
  staleMs: 24 * 60 * 60 * 1000,
  /** buckets this far in the future are dropped */
  futureMs: 2 * 60 * 1000,
} as const;

export const BONUS = {
  daily: 25,
  /** a day counts as active (and pays the daily bonus) once work XP reaches this */
  dailyThreshold: 50,
  streakPerDay: 10,
  streakMaxDays: 7,
  /** streak survives gaps of up to this many calendar days (Fri -> Mon) */
  streakGapDays: 3,
} as const;

const MUTATE = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const RUN = new Set(['Bash', 'Task', 'PowerShell', 'Agent', 'Workflow']);
const META = new Set([
  'TodoWrite',
  'TodoRead',
  'AskUserQuestion',
  'ExitPlanMode',
  'EnterPlanMode',
  'ToolSearch',
  'ListAgents',
  'ScheduleWakeup',
]);

export function classifyTool(name: string | undefined): ToolClass {
  if (!name) return 'read';
  if (MUTATE.has(name)) return 'mutate';
  if (RUN.has(name) || name.startsWith('mcp__')) return 'run';
  if (META.has(name)) return 'meta';
  return 'read';
}

export function toolXp(name: string | undefined): number {
  return TOOL_XP[classifyTool(name)];
}

/** Aggregated hook events for one UTC minute. This is what the client sends to the server. */
export interface MinuteBucket {
  /** epoch ms floored to the minute */
  minute: number;
  prompts: number;
  stops: number;
  /** raw tool_name -> count; the server classifies */
  tools: Record<string, number>;
  /** distinct session ids seen (plausibility only) */
  sessions: number;
}

export function minuteFloor(ts: number): number {
  return Math.floor(ts / 60000) * 60000;
}

export function emptyBucket(minute: number): MinuteBucket {
  return { minute: minuteFloor(minute), prompts: 0, stops: 0, tools: {}, sessions: 0 };
}

/** Raw (uncapped) XP of a bucket. */
export function bucketRawXp(b: MinuteBucket): { prompt: number; stop: number; tool: number } {
  let tool = 0;
  for (const [name, count] of Object.entries(b.tools)) tool += toolXp(name) * Math.max(0, count);
  return {
    prompt: Math.max(0, b.prompts) * EVENT_XP.prompt,
    stop: Math.max(0, b.stops) * EVENT_XP.stop,
    tool,
  };
}

/** What has already been credited for a minute (server: xp_minutes row; client: local ledger). */
export interface CreditedMinute {
  minute: number;
  prompts: number;
  stops: number;
  toolXp: number;
}

export type DropReason =
  'stale' | 'future' | 'implausible' | 'no_prompt_context' | 'cap_minute' | 'cap_hour' | 'cap_day';

export interface CreditResult {
  credited: { prompt: number; stop: number; tool: number; total: number };
  dropped: Array<{ reason: DropReason; xp: number }>;
  /** the minute row after crediting (to upsert / append to history) */
  entry: CreditedMinute;
}

export interface CreditContext {
  now: number;
  /** already credited minutes, any order; should cover at least the last 24 h */
  history: readonly CreditedMinute[];
  /** total credited work XP for the bucket's UTC day, excluding `history` rows of that day if you pass them separately (see note) */
  dayTotals?: { prompts: number; stops: number; toolXp: number; workXp: number };
}

/**
 * Credits one bucket against the caps. Deterministic and side-effect free.
 *
 * History semantics: `history` is used for the per-minute cap (same minute), the hourly caps
 * (rolling 60 min window ending at the bucket's minute), and prompt-context. Daily caps use
 * `dayTotals` when provided, otherwise they are derived from `history` rows on the same UTC day.
 */
export function creditBucket(bucket: MinuteBucket, ctx: CreditContext): CreditResult {
  const dropped: CreditResult['dropped'] = [];
  const minute = minuteFloor(bucket.minute);
  const raw = bucketRawXp(bucket);
  const zero = { minute, prompts: 0, stops: 0, toolXp: 0 };

  if (minute > ctx.now + CAPS.futureMs) {
    return {
      credited: { prompt: 0, stop: 0, tool: 0, total: 0 },
      dropped: [{ reason: 'future', xp: raw.prompt + raw.stop + raw.tool }],
      entry: zero,
    };
  }
  if (minute < ctx.now - CAPS.staleMs) {
    return {
      credited: { prompt: 0, stop: 0, tool: 0, total: 0 },
      dropped: [{ reason: 'stale', xp: raw.prompt + raw.stop + raw.tool }],
      entry: zero,
    };
  }

  // plausibility clamps
  let prompts = Math.max(0, Math.floor(bucket.prompts));
  let stops = Math.max(0, Math.floor(bucket.stops));
  let toolXpRaw = raw.tool;
  const toolCount = Object.values(bucket.tools).reduce((a, b) => a + Math.max(0, b), 0);
  if (prompts > CAPS.bucketMaxPrompts) {
    dropped.push({
      reason: 'implausible',
      xp: (prompts - CAPS.bucketMaxPrompts) * EVENT_XP.prompt,
    });
    prompts = CAPS.bucketMaxPrompts;
  }
  if (stops > CAPS.bucketMaxStops) {
    dropped.push({ reason: 'implausible', xp: (stops - CAPS.bucketMaxStops) * EVENT_XP.stop });
    stops = CAPS.bucketMaxStops;
  }
  if (toolCount > CAPS.bucketMaxTools) {
    const keep = toolXpRaw * (CAPS.bucketMaxTools / toolCount);
    dropped.push({ reason: 'implausible', xp: Math.round(toolXpRaw - keep) });
    toolXpRaw = Math.floor(keep);
  }

  const sameMinute = ctx.history.filter((h) => h.minute === minute);
  const hourWindow = ctx.history.filter((h) => h.minute > minute - 3600000 && h.minute <= minute);
  const dayStart = dayFloor(minute);
  const dayRows = ctx.history.filter((h) => h.minute >= dayStart && h.minute < dayStart + 86400000);
  const day = ctx.dayTotals ?? {
    prompts: sum(dayRows, (r) => r.prompts),
    stops: sum(dayRows, (r) => r.stops),
    toolXp: sum(dayRows, (r) => r.toolXp),
    workXp: sum(dayRows, (r) => r.prompts * EVENT_XP.prompt + r.stops * EVENT_XP.stop + r.toolXp),
  };
  const hour = {
    prompts: sum(hourWindow, (r) => r.prompts),
    stops: sum(hourWindow, (r) => r.stops),
    toolXp: sum(hourWindow, (r) => r.toolXp),
    workXp: sum(
      hourWindow,
      (r) => r.prompts * EVENT_XP.prompt + r.stops * EVENT_XP.stop + r.toolXp,
    ),
  };

  // prompt context: tools count only if a prompt happened in the last 30 min (incl. this bucket)
  const hadPrompt =
    prompts > 0 ||
    ctx.history.some(
      (h) => h.prompts > 0 && h.minute <= minute && h.minute >= minute - CAPS.promptContextMs,
    );
  if (!hadPrompt && toolXpRaw > 0) {
    dropped.push({ reason: 'no_prompt_context', xp: toolXpRaw });
    toolXpRaw = 0;
  }

  // per-minute tool cap (also neutralises re-sending the same minute)
  const minuteAlready = sum(sameMinute, (r) => r.toolXp);
  let tool = Math.min(toolXpRaw, Math.max(0, CAPS.toolXpPerMinute - minuteAlready));
  if (tool < toolXpRaw) dropped.push({ reason: 'cap_minute', xp: toolXpRaw - tool });

  // hourly caps
  prompts = capWith(
    prompts,
    CAPS.promptsPerHour - hour.prompts,
    EVENT_XP.prompt,
    'cap_hour',
    dropped,
  );
  // stops may not exceed credited prompts in the hour (incl. this bucket)
  const stopCeilingHour = Math.min(CAPS.promptsPerHour, hour.prompts + prompts) - hour.stops;
  stops = capWith(stops, stopCeilingHour, EVENT_XP.stop, 'cap_hour', dropped);
  const toolHourRoom = CAPS.toolXpPerHour - hour.toolXp;
  if (tool > toolHourRoom) {
    dropped.push({ reason: 'cap_hour', xp: tool - Math.max(0, toolHourRoom) });
    tool = Math.max(0, toolHourRoom);
  }

  // daily caps
  prompts = capWith(prompts, CAPS.promptsPerDay - day.prompts, EVENT_XP.prompt, 'cap_day', dropped);
  stops = capWith(stops, CAPS.stopsPerDay - day.stops, EVENT_XP.stop, 'cap_day', dropped);
  const toolDayRoom = CAPS.toolXpPerDay - day.toolXp;
  if (tool > toolDayRoom) {
    dropped.push({ reason: 'cap_day', xp: tool - Math.max(0, toolDayRoom) });
    tool = Math.max(0, toolDayRoom);
  }

  // global work caps (hour, then day): trim tool XP first, then stops, then prompts
  let work = prompts * EVENT_XP.prompt + stops * EVENT_XP.stop + tool;
  const hourRoom = CAPS.workXpPerHour - hour.workXp;
  if (work > hourRoom) {
    const trimmed = trim({ prompts, stops, tool }, work - Math.max(0, hourRoom));
    dropped.push({ reason: 'cap_hour', xp: work - trimmed.total });
    ({ prompts, stops, tool } = trimmed);
    work = trimmed.total;
  }
  const dayRoom = CAPS.workXpPerDay - day.workXp;
  if (work > dayRoom) {
    const trimmed = trim({ prompts, stops, tool }, work - Math.max(0, dayRoom));
    dropped.push({ reason: 'cap_day', xp: work - trimmed.total });
    ({ prompts, stops, tool } = trimmed);
    work = trimmed.total;
  }

  return {
    credited: { prompt: prompts * EVENT_XP.prompt, stop: stops * EVENT_XP.stop, tool, total: work },
    dropped: dropped.filter((d) => d.xp > 0),
    entry: { minute, prompts, stops, toolXp: tool },
  };
}

/** Merge a credited entry into a history array (same minute rows are summed). */
export function mergeCredited(
  history: readonly CreditedMinute[],
  entry: CreditedMinute,
): CreditedMinute[] {
  const out = history.map((h) => ({ ...h }));
  const existing = out.find((h) => h.minute === entry.minute);
  if (existing) {
    existing.prompts += entry.prompts;
    existing.stops += entry.stops;
    existing.toolXp += entry.toolXp;
  } else {
    out.push({ ...entry });
  }
  return out;
}

export function workXpOf(rows: readonly CreditedMinute[]): number {
  return sum(rows, (r) => r.prompts * EVENT_XP.prompt + r.stops * EVENT_XP.stop + r.toolXp);
}

// --- days & streaks ---------------------------------------------------------------------------

/** UTC day key 'YYYY-MM-DD'. */
export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function dayFloor(ts: number): number {
  return Math.floor(ts / 86400000) * 86400000;
}

export function daysBetween(dayA: string, dayB: string): number {
  const a = Date.parse(`${dayA}T00:00:00Z`);
  const b = Date.parse(`${dayB}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export interface StreakState {
  streakDays: number;
  /** 'YYYY-MM-DD' of the last day that reached the daily threshold, or null */
  lastActiveDay: string | null;
}

/**
 * Called when a day's work XP first reaches BONUS.dailyThreshold. Returns the new streak and the
 * bonus to award (daily + streak). Idempotent for the same day.
 */
export function activateDay(
  state: StreakState,
  today: string,
): { state: StreakState; bonus: number } {
  if (state.lastActiveDay === today) return { state, bonus: 0 };
  let streak = 1;
  if (state.lastActiveDay) {
    const gap = daysBetween(state.lastActiveDay, today);
    if (gap >= 1 && gap <= BONUS.streakGapDays) streak = state.streakDays + 1;
  }
  const bonus = BONUS.daily + BONUS.streakPerDay * Math.min(streak, BONUS.streakMaxDays);
  return { state: { streakDays: streak, lastActiveDay: today }, bonus };
}

// --- helpers ----------------------------------------------------------------------------------

function sum<T>(rows: readonly T[], f: (r: T) => number): number {
  let s = 0;
  for (const r of rows) s += f(r);
  return s;
}

function capWith(
  count: number,
  room: number,
  unit: number,
  reason: DropReason,
  dropped: CreditResult['dropped'],
): number {
  const allowed = Math.max(0, Math.min(count, room));
  if (allowed < count) dropped.push({ reason, xp: (count - allowed) * unit });
  return allowed;
}

/** Remove `excess` XP: tool XP first, then whole stops, then whole prompts. */
function trim(
  c: { prompts: number; stops: number; tool: number },
  excess: number,
): { prompts: number; stops: number; tool: number; total: number } {
  let { prompts, stops, tool } = c;
  let left = Math.max(0, excess);
  const t = Math.min(tool, left);
  tool -= t;
  left -= t;
  while (left > 0 && stops > 0) {
    stops--;
    left -= EVENT_XP.stop;
  }
  while (left > 0 && prompts > 0) {
    prompts--;
    left -= EVENT_XP.prompt;
  }
  return { prompts, stops, tool, total: prompts * EVENT_XP.prompt + stops * EVENT_XP.stop + tool };
}
