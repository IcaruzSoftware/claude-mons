import { randomUUID } from 'node:crypto';
import {
  BATTLE_RULES,
  NATION_INFO,
  SPECIES,
  challengerReward,
  dayKey,
  displayName,
  levelFromXp,
  otherNations,
  simulateBattle,
  snapshotFor,
  speciesForNation,
  stageForLevel,
  type MonSnapshot,
  type Nation,
} from '@claude-mons/shared';
import type { BattlePlayMessage, BattleSummary } from '../../common/ipc.ts';
import type { LocalState } from '../persistence/state.ts';

export type BattleRefusal =
  | { ok: false; reason: 'egg' | 'no_nation' | 'busy' }
  | { ok: false; reason: 'cooldown'; cooldownUntil: number }
  | { ok: false; reason: 'daily_cap' };

export type BattleOutcome = { ok: true; play: BattlePlayMessage } | BattleRefusal;

export interface BattleBackend {
  /** Resolve a battle remotely. Returns null when offline / not configured. */
  request(me: MonSnapshot): Promise<BattlePlayMessage | null>;
}

export interface BattleServiceDeps {
  state: { get(): LocalState; update(fn: (s: LocalState) => void): LocalState };
  totalXp(): number;
  backend: BattleBackend | null;
  now?: () => number;
  random?: () => number;
}

/**
 * Battles from the client's point of view: enforces the local cooldown/daily cap, asks the
 * backend for a resolved battle (or fights a local Wild Mon while offline), hands the result to
 * the renderer, and records history once the animation finished.
 */
export class BattleService {
  private pending: BattlePlayMessage | null = null;

  constructor(private readonly deps: BattleServiceDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  cooldownUntil(): number | null {
    const last = this.deps.state.get().battles.lastBattleAt;
    if (last === null) return null;
    const until = last + BATTLE_RULES.cooldownMs;
    return until > this.now() ? until : null;
  }

  remainingToday(): number {
    const t = this.deps.state.get().battles.today;
    const today = dayKey(this.now());
    const used = t.day === today ? t.count : 0;
    return Math.max(0, BATTLE_RULES.challengesPerDay - used);
  }

  mySnapshot(): MonSnapshot | null {
    const s = this.deps.state.get();
    if (!s.pet.speciesId || !s.profile.nation) return null;
    const level = levelFromXp(this.deps.totalXp());
    const stage = stageForLevel(level);
    if (stage === 'egg') return null;
    return snapshotFor({
      monId: s.device.id,
      playerId: s.profile.userId ?? s.device.id,
      nickname: s.profile.nickname ?? displayName(s.pet.speciesId, stage),
      speciesId: s.pet.speciesId,
      stage,
      level,
    });
  }

  async request(): Promise<BattleOutcome> {
    if (this.pending) return { ok: false, reason: 'busy' };
    const s = this.deps.state.get();
    if (!s.profile.nation) return { ok: false, reason: 'no_nation' };
    const me = this.mySnapshot();
    if (!me) return { ok: false, reason: 'egg' };
    const cd = this.cooldownUntil();
    if (cd !== null) return { ok: false, reason: 'cooldown', cooldownUntil: cd };
    if (this.remainingToday() <= 0) return { ok: false, reason: 'daily_cap' };

    let play: BattlePlayMessage | null = null;
    if (this.deps.backend) {
      try {
        play = await this.deps.backend.request(me);
      } catch (err) {
        const e = err as { code?: string; details?: { cooldownUntil?: string } };
        if (e.code === 'COOLDOWN') {
          const until = Date.parse(e.details?.cooldownUntil ?? '');
          return {
            ok: false,
            reason: 'cooldown',
            cooldownUntil: Number.isFinite(until) ? until : this.now() + BATTLE_RULES.cooldownMs,
          };
        }
        if (e.code === 'DAILY_CAP') return { ok: false, reason: 'daily_cap' };
        if (e.code === 'EGG_CANNOT_BATTLE') return { ok: false, reason: 'egg' };
        console.warn('battle backend failed, falling back to a wild mon:', err);
      }
    }
    if (!play) play = this.wildBattle(me, s.profile.nation);

    this.pending = play;
    const now = this.now();
    this.deps.state.update((st) => {
      st.battles.lastBattleAt = now;
      const today = dayKey(now);
      st.battles.today =
        st.battles.today.day === today
          ? { day: today, count: st.battles.today.count + 1 }
          : { day: today, count: 1 };
    });
    return { ok: true, play };
  }

  /** Called when the renderer finished the animation; returns the summary to credit. */
  finish(id: string): BattleSummary | null {
    const play = this.pending;
    if (!play || play.id !== id) return null;
    this.pending = null;
    const won = play.result.winner === 'a';
    const summary: BattleSummary = {
      id: play.id,
      at: this.now(),
      won,
      xp: play.reward,
      isBot: play.isBot,
      turns: play.result.turns.length,
      reason: play.result.reason,
      me: { speciesId: play.me.speciesId, stage: play.me.stage, level: play.me.level },
      opponent: {
        nickname: play.opponent.nickname,
        speciesId: play.opponent.speciesId,
        stage: play.opponent.stage,
        level: play.opponent.level,
        nation: play.opponent.nation,
      },
    };
    this.deps.state.update((st) => {
      st.battles.history.unshift(summary);
      if (st.battles.history.length > 50) st.battles.history.length = 50;
    });
    return summary;
  }

  /** Offline fallback: a Wild Mon from another nation at the same level. */
  private wildBattle(me: MonSnapshot, myNation: Nation): BattlePlayMessage {
    const rnd = this.deps.random ?? Math.random;
    const nations = otherNations(myNation);
    const nation = nations[Math.floor(rnd() * nations.length)]!;
    const pool = speciesForNation(nation);
    const species = pool[Math.floor(rnd() * pool.length)] ?? pool[0]!;
    const opponent = snapshotFor({
      monId: `wild-${species.id}`,
      playerId: null,
      nickname: `Wild ${SPECIES[species.id]!.names[me.stage]}`,
      speciesId: species.id,
      stage: me.stage,
      level: me.level,
    });
    const id = randomUUID();
    const result = simulateBattle(me, opponent, id);
    const won = result.winner === 'a';
    return {
      id,
      result,
      me,
      opponent,
      reward: challengerReward({ won, isBot: true, myLevel: me.level, oppLevel: opponent.level }),
      isBot: true,
    };
  }
}

export function nationLabel(n: Nation): string {
  return NATION_INFO[n].name;
}
