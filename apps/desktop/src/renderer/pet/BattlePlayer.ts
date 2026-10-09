import { STANCE_INFO, TREE_NODES } from '@claude-mons/shared';
import type { BattleAction, MonSnapshot, Side, Stimulus, TreeTrigger } from '@claude-mons/shared';
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
/** one talent-tree trigger line on the banner */
const TRIGGER_MS = 650;
/** gap between the two anchors in grid pixels (scaled by the sprite scale) */
const GAP_GRID = 56;

/** "Keel — crit cancelled": the node's name and what it did. `detail` comes from the node's
 * `logText` ("Keel: crit cancelled"), so a leading "Name: " is not repeated. */
export function treeTriggerText(trigger: TreeTrigger): string {
  const name = TREE_NODES[trigger.node]?.name;
  if (!name) return trigger.detail;
  const detail = trigger.detail.startsWith(`${name}: `)
    ? trigger.detail.slice(name.length + 2)
    : trigger.detail;
  return detail ? `${name} — ${detail}` : name;
}

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
    // Each talent-tree trigger gets its own short banner step.
    const showTriggers = (triggers: readonly TreeTrigger[] = []) => {
      for (const trigger of triggers) {
        const line = `${this.name(trigger.side)}'s ${treeTriggerText(trigger)}`;
        this.steps.push({ at: t, run: () => (this.view.banner = line) });
        t += TRIGGER_MS;
      }
    };
    for (const turn of this.msg.result.turns) {
      showTriggers(turn.treeTriggers?.filter((x) => x.step !== 'turn_end'));
      for (const action of turn.actions) {
        const at = t;
        if (action.moveId === null) {
          // synthetic end-of-turn effect tick -- no attack animation,
          // just the banner + hp update.
          this.steps.push({ at, run: () => this.effectTick(action, at) });
        } else {
          this.steps.push({ at, run: () => this.attack(action, at) });
          this.steps.push({
            at: at + HIT_DELAY_MS,
            run: () => this.hit(action, at + HIT_DELAY_MS),
          });
        }
        t += ACTION_MS;
        // Tree rules can fire on a dodged action too (a dodge arms Riposte Step).
        showTriggers(action.treeTriggers);
      }
      showTriggers(turn.treeTriggers?.filter((x) => x.step === 'turn_end'));
    }
    const won = this.msg.result.winner === 'a';
    this.steps.push({
      at: t,
      run: () => {
        this.emit({ type: won ? 'battle:win' : 'battle:lose' });
        this.view.opponentAnim = won ? 'hurt' : 'happy';
        const streakNote = won && this.msg.winStreak > 1 ? ` (streak x${this.msg.winStreak})` : '';
        // A practice battle (offline fallback) pays no XP: label it instead of "+0 XP".
        const reward = this.msg.practice ? 'Practice' : `+${this.msg.reward} XP`;
        this.view.banner = won
          ? `You win! ${reward}${this.msg.practice ? '' : streakNote}`
          : `${this.msg.opponent.nickname} wins. ${reward}`;
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
    if (action.stancePassives?.length) {
      return action.stancePassives
        .map((trigger) => `${this.name(trigger.side)}: ${STANCE_INFO[trigger.stance].passive}`)
        .join(' · ');
    }
    if (action.nationPassive === 'ignite') return `${actor}'s Fire trait ignites ${foe}`;
    if (action.nationPassive === 'soak') return `${actor}'s Water trait slows ${foe}`;
    if (action.comboTalent) return `${actor}'s ${action.comboTalent} combo!`;
    // A knocked-out target takes no status (the engine skips it since step D2).
    const statusLands = action.moveId === null || action.targetHpAfter > 0;
    switch (action.effect) {
      case 'burn':
        if (!statusLands) return null;
        return action.moveId === null
          ? `${actor} takes burn damage`
          : `${actor}'s ${action.move} burns ${foe}`;
      case 'def_down':
        return statusLands ? `${actor}'s ${action.move} weakens ${foe}'s defense` : null;
      case 'drain':
        return `${actor}'s ${action.move} drains ${foe}`;
      case 'shield_first':
        return `${actor}'s ${action.move} shields against the next hit`;
      default:
        return null;
    }
  }

  /** Synthetic end-of-turn burn or recovery: no attack animation. */
  private effectTick(action: BattleAction, now: number): void {
    if (action.healing) {
      this.view.banner = `${this.name(action.actor)} regenerates`;
      this.view.popups.push({
        side: action.actor,
        text: `+${action.healing}`,
        color: '#65d9a4',
        bornAt: now,
      });
      if (action.actor === 'a') this.view.hp.me = action.targetHpAfter;
      else this.view.hp.opp = action.targetHpAfter;
      return;
    }
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
      if (action.followThrough) text += ' combo!';
      const color =
        action.effectiveness > 1 ? '#ffd740' : action.effectiveness < 1 ? '#9aa0ad' : '#ff5252';
      this.view.popups.push({ side: target, text, color, bornAt: now });
      if (action.effectiveness > 1)
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
