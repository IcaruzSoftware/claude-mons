import { EventEmitter } from 'node:events';
import {
  BONUS,
  activateDay,
  creditBucket,
  dayKey,
  emptyBucket,
  levelFromXp,
  levelProgress,
  mergeCredited,
  minuteFloor,
  stageForLevel,
  workXpOf,
  type HookEnvelope,
  type LevelProgress,
  type Stage,
} from '@claude-mons/shared';
import type { LocalState } from '../persistence/state.ts';

export interface ProgressSnapshot extends LevelProgress {
  /** XP the server has acknowledged, if any */
  serverXp: number | null;
  stage: Stage;
  speciesId: string | null;
  streakDays: number;
}

export interface GameEvents {
  progress: [ProgressSnapshot];
  xp: [{ amount: number; source: 'work' | 'bonus' | 'battle' | 'server' }];
  levelup: [{ from: number; to: number }];
  hatch: [{ speciesId: string }];
  evolve: [{ from: Stage; to: Stage }];
}

export interface StateAccess {
  get(): LocalState;
  update(fn: (s: LocalState) => void): LocalState;
}

/** History horizon kept in the local ledger. */
const LEDGER_HORIZON_MS = 48 * 60 * 60 * 1000;

/**
 * Turns hook events into XP and progress. Locally credited XP is provisional: the same caps run
 * here (via shared/game/xp.ts) as on the server, so the local number is normally what the server
 * will confirm. Hatching/evolution decisions are made by whoever is authoritative:
 * - `localGame: true` (Phase 3 / offline dev): this service rolls species and evolves locally.
 * - otherwise (Phase 4+): the server's `ingest-xp` response drives them via `applyServerState`.
 */
export class GameService extends EventEmitter<GameEvents> {
  constructor(
    private readonly state: StateAccess,
    private readonly opts: {
      localGame: boolean;
      rollSpecies: (nation: string | null, seed: number) => string;
      now?: () => number;
    },
  ) {
    super();
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** Total XP shown to the player: server truth when known, else local. */
  totalXp(): number {
    const s = this.state.get();
    return s.progress.serverXp ?? s.progress.localXp;
  }

  snapshot(): ProgressSnapshot {
    const s = this.state.get();
    const lp = levelProgress(this.totalXp());
    return {
      ...lp,
      stage: s.progress.stage,
      serverXp: s.progress.serverXp,
      speciesId: s.pet.speciesId,
      streakDays: s.streak.streakDays,
    };
  }

  /** Record a hook event: updates the pending minute bucket and credits provisional XP. */
  ingest(env: HookEnvelope): void {
    if (env.event !== 'UserPromptSubmit' && env.event !== 'PostToolUse' && env.event !== 'Stop')
      return;
    const ts = env.spooled ? env.ts : this.now();
    const minute = minuteFloor(ts);
    const before = this.totalXp();
    const beforeLevel = levelFromXp(before);

    this.state.update((s) => {
      // 1. pending bucket for the server
      let bucket = s.ledger.pending.find((b) => b.minute === minute);
      if (!bucket) {
        bucket = emptyBucket(minute);
        s.ledger.pending.push(bucket);
        if (s.ledger.pending.length > 24 * 60)
          s.ledger.pending.splice(0, s.ledger.pending.length - 24 * 60);
      }
      if (env.event === 'UserPromptSubmit') bucket.prompts++;
      else if (env.event === 'Stop') bucket.stops++;
      else if (env.tool_name) bucket.tools[env.tool_name] = (bucket.tools[env.tool_name] ?? 0) + 1;

      // 2. provisional credit for just this event
      const delta = emptyBucket(minute);
      if (env.event === 'UserPromptSubmit') delta.prompts = 1;
      else if (env.event === 'Stop') delta.stops = 1;
      else if (env.tool_name) delta.tools[env.tool_name] = 1;
      const horizon = ts - LEDGER_HORIZON_MS;
      s.ledger.credited = s.ledger.credited.filter((c) => c.minute >= horizon);
      const res = creditBucket(delta, { now: this.now(), history: s.ledger.credited });
      if (res.credited.total > 0) {
        s.ledger.credited = mergeCredited(s.ledger.credited, res.entry);
        s.progress.localXp += res.credited.total;
        this.emit('xp', { amount: res.credited.total, source: 'work' });
      }

      // 3. daily bonus + streak once the day's work XP reaches the threshold
      const today = dayKey(ts);
      const dayStart = Date.parse(`${today}T00:00:00Z`);
      const todayWork = workXpOf(
        s.ledger.credited.filter((c) => c.minute >= dayStart && c.minute < dayStart + 86400000),
      );
      if (todayWork >= BONUS.dailyThreshold && s.streak.lastActiveDay !== today) {
        const r = activateDay(s.streak, today);
        s.streak = r.state;
        if (r.bonus > 0) {
          s.progress.localXp += r.bonus;
          s.bonusXp += r.bonus;
          this.emit('xp', { amount: r.bonus, source: 'bonus' });
        }
      }
    });

    this.afterXpChange(before, beforeLevel);
  }

  /** Server acknowledged XP / stage (Phase 4). */
  applyServerState(server: { totalXp: number; speciesId: string | null; stage: Stage }): void {
    const before = this.totalXp();
    const beforeLevel = levelFromXp(before);
    this.state.update((s) => {
      s.progress.serverXp = server.totalXp;
      // local provisional restarts from the server's number
      s.progress.localXp = server.totalXp;
      if (server.speciesId && !s.pet.speciesId) {
        s.pet.speciesId = server.speciesId;
        s.progress.hatchedAt = this.now();
      }
    });
    if (server.speciesId && !this.stateBefore(before).speciesId)
      this.emit('hatch', { speciesId: server.speciesId });
    this.afterXpChange(before, beforeLevel, server.stage);
  }

  addBattleXp(amount: number): void {
    if (amount <= 0) return;
    const before = this.totalXp();
    const beforeLevel = levelFromXp(before);
    this.state.update((s) => {
      s.progress.localXp += amount;
      s.battleXp += amount;
    });
    this.emit('xp', { amount, source: 'battle' });
    this.afterXpChange(before, beforeLevel);
  }

  private stateBefore(_xp: number): { speciesId: string | null } {
    return { speciesId: this.state.get().pet.speciesId };
  }

  /** Level-ups, local hatching/evolution (when authoritative) and the progress event. */
  private afterXpChange(beforeXp: number, beforeLevel: number, serverStage?: Stage): void {
    const after = this.totalXp();
    const afterLevel = levelFromXp(after);
    if (afterLevel > beforeLevel) this.emit('levelup', { from: beforeLevel, to: afterLevel });

    const s = this.state.get();
    const targetStage: Stage =
      serverStage ?? (this.opts.localGame ? stageForLevel(afterLevel) : s.progress.stage);
    const order: Stage[] = ['egg', 'baby', 'teen', 'adult'];
    if (order.indexOf(targetStage) > order.indexOf(s.progress.stage)) {
      const from = s.progress.stage;
      this.state.update((st) => {
        if (from === 'egg' && !st.pet.speciesId) {
          st.pet.speciesId = this.opts.rollSpecies(st.profile.nation, st.pet.seed);
          st.progress.hatchedAt = this.now();
        }
        st.progress.stage = targetStage;
        st.progress.evolvedAt[targetStage] = this.now();
      });
      if (from === 'egg') this.emit('hatch', { speciesId: this.state.get().pet.speciesId! });
      else this.emit('evolve', { from, to: targetStage });
    }

    if (after !== beforeXp || afterLevel !== beforeLevel || serverStage)
      this.emit('progress', this.snapshot());
  }
}
