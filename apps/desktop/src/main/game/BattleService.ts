import { randomUUID } from 'node:crypto';
import {
  BATTLE_RULES,
  wildEncounterLevel,
  NATION_INFO,
  SPECIES,
  challengerReward,
  dayKey,
  displayName,
  levelFromXp,
  npcSnapshot,
  variedWildNations,
  simulateBattle,
  snapshotFor,
  speciesForNation,
  stageForLevel,
  type MonSnapshot,
  type Nation,
} from '@claude-mons/shared';
import type { BattlePlayMessage, BattleSummary } from '../../common/ipc.ts';
import { mergeBattleHistory } from '../../common/battleHistory.ts';
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

  isReady(): boolean {
    return (
      !this.pending &&
      this.cooldownUntil() === null &&
      this.remainingToday() > 0 &&
      this.mySnapshot() !== null
    );
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
      loadout: {
        stance: s.loadout.stance,
        ...(s.loadout.moves ? { moves: s.loadout.moves } : {}),
        ...(s.loadout.tree ? { tree: s.loadout.tree } : {}),
      },
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
    // With a backend configured, a fallback battle is practice: the server never sees it, so it
    // must not show XP that is never credited.
    if (!play) play = this.wildBattle(me, s.profile.nation, this.deps.backend !== null);

    this.pending = play;
    const now = this.now();
    // A practice battle never reached the server, so it uses neither cooldown nor daily count.
    if (!play.practice)
      this.deps.state.update((st) => {
        st.battles.lastBattleAt = now;
        const today = dayKey(now);
        st.battles.today =
          st.battles.today.day === today
            ? { day: today, count: st.battles.today.count + 1 }
            : { day: today, count: 1 };
      });
    this.record(play, now);
    return { ok: true, play };
  }

  /** Called when the renderer finished the animation; returns the summary to credit. */
  finish(id: string): BattleSummary | null {
    const play = this.pending;
    if (!play || play.id !== id) return null;
    this.pending = null;
    return this.deps.state.get().battles.history.find((b) => b.id === id) ?? null;
  }

  /** Persist resolved battles before animation, so restart/hiding cannot lose recent fights. */
  private record(play: BattlePlayMessage, at: number): void {
    const won = play.result.winner === 'a';
    const summary: BattleSummary = {
      id: play.id,
      at,
      won,
      xp: play.reward,
      isBot: play.isBot,
      isElite: play.isElite,
      winStreak: play.winStreak,
      ...(play.practice ? { practice: true } : {}),
      turns: play.result.turns.length,
      reason: play.result.reason,
      me: { speciesId: play.me.speciesId, stage: play.me.stage, level: play.me.level },
      opponent: {
        nickname: play.opponent.nickname,
        speciesId: play.opponent.speciesId,
        stage: play.opponent.stage,
        level: play.opponent.level,
        nation: play.opponent.nation,
        // snapshotFor (battle.ts) always fills this in for a freshly-resolved opponent; the `?? {}`
        // is only defensive typing (MonSnapshot.loadout stays optional for old replayed logs).
        loadout: play.opponent.loadout ?? {},
      },
    };
    this.deps.state.update((st) => {
      st.battles.history = mergeBattleHistory(st.battles.history, [summary]);
      st.battles.streak = play.winStreak;
    });
  }

  /** Offline fallback: a Wild or Trainer NPC from another nation. */
  private wildBattle(me: MonSnapshot, myNation: Nation, practice: boolean): BattlePlayMessage {
    const rnd = this.deps.random ?? Math.random;
    const lastNation = this.deps.state.get().battles.history[0]?.opponent.nation;
    const nations = variedWildNations(myNation, lastNation);
    const nation = nations[Math.floor(rnd() * nations.length)]!;
    const pool = speciesForNation(nation);
    const species = pool[Math.floor(rnd() * pool.length)] ?? pool[0]!;
    const encounter = wildEncounterLevel(me.level, rnd());
    const stage = stageForLevel(encounter.level) as MonSnapshot['stage'];
    const kind = rnd() < 0.5 ? 'wild' : 'trainer';
    const opponent = npcSnapshot(
      snapshotFor({
        monId: `${kind}-${species.id}`,
        playerId: null,
        nickname: `${kind === 'wild' ? 'Wild' : 'Trainer'} ${SPECIES[species.id]!.names[stage]}`,
        speciesId: species.id,
        stage,
        level: encounter.level,
        loadout: { tree: {} },
      }),
      kind,
    );
    const id = randomUUID();
    const result = simulateBattle(me, opponent, id);
    return {
      id,
      result,
      me,
      opponent,
      reward: practice
        ? 0
        : challengerReward({
            won: result.winner === 'a',
            isBot: true,
            opponentKind: kind,
            myLevel: me.level,
            oppLevel: opponent.level,
          }),
      isBot: true,
      isElite: encounter.isElite,
      ...(practice ? { practice: true } : {}),
      // Only rival wins count toward the streak; NPC battles leave it unchanged
      // (docs/design/progression.md Matchmaking and streaks).
      winStreak: this.deps.state.get().battles.streak,
    };
  }
}

export function nationLabel(n: Nation): string {
  return NATION_INFO[n].name;
}
