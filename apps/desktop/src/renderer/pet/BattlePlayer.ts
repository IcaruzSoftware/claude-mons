import type { BattleAction, MonSnapshot, Side, Stimulus } from '@claude-mons/shared';
import type { AnimName } from '@claude-mons/sprites';
import type { BattlePlayMessage } from '../../common/ipc.ts';

/** What the renderer draws for the opponent and the HUD on a given frame. */
export interface BattleView {
  opponent: MonSnapshot;
  /** opponent anchor in world DIPs */
  opponentX: number;
  opponentY: number;
  opponentFacing: 1 | -1;
  opponentAnim: AnimName;
  hp: { me: number; opp: number };
  maxHp: { me: number; opp: number };
  popups: Array<{ side: Side; text: string; color: string; bornAt: number }>;
  banner: string | null;
  /** 0..1 slide-in progress of the opponent */
  intro: number;
}

const INTRO_MS = 1200;
const ACTION_MS = 700;
const HIT_DELAY_MS = 260;
const OUTRO_MS = 2600;
const POPUP_MS = 900;
/** gap between the two anchors in grid pixels (scaled by the sprite scale) */
const GAP_GRID = 56;

interface Step {
  at: number;
  run: () => void;
}

/**
 * Plays a resolved battle: drives the pet through battle_* states via stimuli, animates the
 * opponent, and keeps the HUD (hp bars, damage popups, banner) up to date. Time-based so it is
 * robust to frame drops.
 */
export class BattlePlayer {
  readonly view: BattleView;
  private steps: Step[] = [];
  private startAt = 0;
  private done = false;
  private endAt = 0;

  constructor(
    readonly msg: BattlePlayMessage,
    private readonly me: {
      x: number;
      groundY: number;
      facing: 1 | -1;
      spriteScale: number;
      worldMinX: number;
      worldMaxX: number;
    },
    private readonly emit: (s: Stimulus) => void,
    private readonly onDone: () => void,
  ) {
    const gap = GAP_GRID * me.spriteScale;
    // put the opponent on the side with more room, facing the pet
    const roomRight = me.worldMaxX - me.x;
    const opponentOnRight = roomRight >= gap || me.x - me.worldMinX < gap;
    const ox = opponentOnRight
      ? Math.min(me.x + gap, me.worldMaxX)
      : Math.max(me.x - gap, me.worldMinX);
    this.view = {
      opponent: msg.opponent,
      opponentX: ox,
      opponentY: me.groundY,
      opponentFacing: opponentOnRight ? -1 : 1,
      opponentAnim: 'idle',
      hp: { me: msg.result.maxHp.a, opp: msg.result.maxHp.b },
      maxHp: { me: msg.result.maxHp.a, opp: msg.result.maxHp.b },
      popups: [],
      banner: `${msg.opponent.nickname}${msg.isElite ? ' (Elite)' : ''} challenges you!`,
      intro: 0,
    };
    this.build();
  }

  /** The side the pet should face during the battle. */
  facing(): 1 | -1 {
    return this.view.opponentFacing === -1 ? 1 : -1;
  }

  private build(): void {
    let t = 0;
    this.steps.push({ at: 0, run: () => this.emit({ type: 'battle:play' }) });
    t = INTRO_MS;
    for (const turn of this.msg.result.turns) {
      for (const action of turn.actions) {
        const at = t;
        if (action.moveId === null) {
          // synthetic end-of-turn effect tick (currently only a burn tick) -- no attack animation,
          // just the banner + hp update.
          this.steps.push({ at, run: () => this.burnTick(action, at) });
          t += ACTION_MS;
          continue;
        }
        this.steps.push({ at, run: () => this.attack(action, at) });
        this.steps.push({ at: at + HIT_DELAY_MS, run: () => this.hit(action, at + HIT_DELAY_MS) });
        t += ACTION_MS;
      }
    }
    const won = this.msg.result.winner === 'a';
    this.steps.push({
      at: t,
      run: () => {
        this.emit({ type: won ? 'battle:win' : 'battle:lose' });
        this.view.opponentAnim = won ? 'hurt' : 'happy';
        const streakNote = won && this.msg.winStreak > 1 ? ` (streak x${this.msg.winStreak})` : '';
        this.view.banner = won
          ? `You win! +${this.msg.reward} XP${streakNote}`
          : `${this.msg.opponent.nickname} wins. +${this.msg.reward} XP`;
      },
    });
    this.endAt = t + OUTRO_MS;
  }

  private name(side: Side): string {
    return side === 'a' ? this.msg.me.nickname : this.msg.opponent.nickname;
  }

  private attack(action: BattleAction, now: number): void {
    const label =
      action.charge === 'telegraph'
        ? `${action.move} (charging...)`
        : action.charge === 'release'
          ? `★ ${action.move}!`
          : action.move;
    if (action.actor === 'a') {
      this.emit({ type: 'battle:attack' });
    } else {
      this.view.opponentAnim = 'attack';
    }
    this.view.banner = `${this.name(action.actor)} used ${label}`;
    void now;
  }

  /** One-line follow-up naming the effect this action applied, for the banner (task: "Battle
   * banners show effect names", e.g. "Sparkit's Brushfire burns Pebblet"). Returns null when this
   * action's effect has nothing visible to say (dodged, or an effect with no on-hit text). */
  private effectBanner(action: BattleAction): string | null {
    if (action.dodged) return null;
    const target: Side = action.actor === 'a' ? 'b' : 'a';
    const actor = this.name(action.actor);
    const foe = this.name(target);
    switch (action.effect) {
      case 'burn':
        return action.moveId === null
          ? `${actor} takes burn damage`
          : `${actor}'s ${action.move} burns ${foe}`;
      case 'def_down':
        return `${actor}'s ${action.move} weakens ${foe}'s defense`;
      case 'drain':
        return `${actor}'s ${action.move} drains ${foe}`;
      case 'shield_first':
        return `${actor}'s ${action.move} shields against the next hit`;
      default:
        return null;
    }
  }

  /** Synthetic end-of-turn burn tick: no attack animation, just the banner + hp update. */
  private burnTick(action: BattleAction, now: number): void {
    const banner = this.effectBanner(action);
    if (banner) this.view.banner = banner;
    const color = '#ff5252';
    this.view.popups.push({ side: action.actor, text: `-${action.damage}`, color, bornAt: now });
    if (action.actor === 'a') this.view.hp.me = action.targetHpAfter;
    else this.view.hp.opp = action.targetHpAfter;
  }

  private hit(action: BattleAction, now: number): void {
    const target: Side = action.actor === 'a' ? 'b' : 'a';
    if (action.dodged) {
      this.view.popups.push({ side: target, text: 'miss', color: '#9aa0ad', bornAt: now });
    } else {
      let text = `-${action.damage}`;
      if (action.crit) text += ' crit!';
      const color =
        action.effectiveness === 2
          ? '#ffd740'
          : action.effectiveness === 0.5
            ? '#9aa0ad'
            : '#ff5252';
      this.view.popups.push({ side: target, text, color, bornAt: now });
      if (action.effectiveness === 2)
        this.view.popups.push({
          side: target,
          text: 'super effective',
          color: '#ffd740',
          bornAt: now + 120,
        });
    }
    const effectBanner = this.effectBanner(action);
    if (effectBanner) this.view.banner = effectBanner;
    if (target === 'a') {
      this.view.hp.me = action.targetHpAfter;
      if (!action.dodged) this.emit({ type: 'battle:hit' });
    } else {
      this.view.hp.opp = action.targetHpAfter;
      this.view.opponentAnim = action.dodged ? 'idle' : 'hurt';
    }
    // return the actor to idle-ish poses
    if (action.actor === 'b' && !action.dodged) this.view.opponentAnim = 'attack';
    setTimeout(
      () => {
        if (this.view.opponentAnim === 'hurt' || this.view.opponentAnim === 'attack')
          this.view.opponentAnim = 'idle';
      },
      ACTION_MS - HIT_DELAY_MS - 50,
    );
    if (action.actor === 'a')
      setTimeout(() => this.emit({ type: 'battle:play' }), ACTION_MS - HIT_DELAY_MS - 50);
  }

  /** Advance to `now` (ms, same clock as the loop). Returns true while the battle is running. */
  tick(now: number): boolean {
    if (this.done) return false;
    if (this.startAt === 0) this.startAt = now;
    const t = now - this.startAt;
    this.view.intro = Math.min(1, t / INTRO_MS);
    while (this.steps.length > 0 && this.steps[0]!.at <= t) {
      const step = this.steps.shift()!;
      step.run();
    }
    this.view.popups = this.view.popups.filter((p) => t - p.bornAt < POPUP_MS);
    if (t >= this.endAt) {
      this.done = true;
      this.emit({ type: 'battle:done' });
      this.onDone();
      return false;
    }
    return true;
  }

  /** Elapsed ms for popup animation. */
  elapsed(now: number): number {
    return this.startAt === 0 ? 0 : now - this.startAt;
  }

  popupAge(popup: BattleView['popups'][number], now: number): number {
    return Math.max(0, this.elapsed(now) - popup.bornAt);
  }

  static popupMs(): number {
    return POPUP_MS;
  }
}
