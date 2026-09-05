import { createModel, stepBehavior, type BehaviorModel, type Stimulus } from '@claude-mons/shared';
import type { BattlePlayMessage, Hitbox, PetConfig, WindowGeometry } from '../../common/ipc.ts';
import { BattlePlayer } from './BattlePlayer.ts';
import { PetRenderer } from './PetRenderer.ts';

/**
 * The pet's animation loop: steps the pure behavior reducer on requestAnimationFrame, draws,
 * and reports hitbox/state changes to the main process.
 */
export class PetLoop {
  private model: BehaviorModel;
  private readonly renderer: PetRenderer;
  private queue: Stimulus[] = [];
  private lastHitbox: Hitbox = null;
  private lastStateSentAt = -Infinity;
  private lastRenderKey = '';
  private battle: BattlePlayer | null = null;
  private raf = 0;
  private running = false;

  constructor(
    canvas: HTMLCanvasElement,
    private config: PetConfig,
  ) {
    this.renderer = new PetRenderer(
      canvas,
      {
        spriteScale: config.spriteScale,
        speciesId: config.speciesId,
        nation: config.nation,
        debug: config.debug,
      },
      config.windowGeometry,
    );
    this.model = createModel({
      stage: config.stage,
      world: config.world,
      now: performance.now(),
      seed: config.seed,
      x: config.x,
    });
  }

  applyConfig(config: PetConfig): void {
    this.config = config;
    this.renderer.setOptions({
      spriteScale: config.spriteScale,
      speciesId: config.speciesId,
      nation: config.nation,
      debug: config.debug,
    });
    if (config.stage !== this.model.stage)
      this.queue.push({ type: 'stage:set', stage: config.stage });
  }

  setGeometry(g: WindowGeometry): void {
    this.renderer.setGeometry(g);
  }

  resize(): void {
    this.renderer.resize();
  }

  push(s: Stimulus): void {
    this.queue.push(s);
  }

  /** Start playing a resolved battle (ignored while another one is running). */
  playBattle(msg: BattlePlayMessage): void {
    if (this.battle) return;
    const m = this.model;
    this.battle = new BattlePlayer(
      msg,
      {
        x: m.pos.x,
        groundY: m.world.groundY,
        facing: m.facing,
        spriteScale: this.config.spriteScale,
        worldMinX: m.world.minX,
        worldMaxX: m.world.maxX,
      },
      (s) => this.queue.push(s),
      () => window.mons.battleDone(msg.id),
    );
    this.renderer.setBattle(this.battle);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = (now: number) => {
      if (!this.running) return;
      this.step(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  getModel(): BehaviorModel {
    return this.model;
  }

  private step(now: number): void {
    const stimuli = this.queue;
    this.queue = [];
    const prevState = this.model.state;
    const result = stepBehavior(this.model, stimuli, now);
    this.model = result.model;

    for (const effect of result.effects) {
      if (effect.type === 'request-battle') window.mons.requestBattle();
      else if (effect.type === 'landed') window.mons.landed();
    }

    if (this.battle) {
      // face the opponent for the whole battle
      if (this.model.facing !== this.battle.facing())
        this.model = { ...this.model, facing: this.battle.facing() };
      if (!this.battle.tick(now)) {
        this.renderer.setBattle(null);
        this.battle = null;
      }
    }

    const key = this.renderer.renderKey(this.model, now);
    if (key !== this.lastRenderKey) {
      this.lastRenderKey = key;
      const hitbox = this.renderer.draw(this.model, now);
      if (this.renderer.hitboxChanged(hitbox, this.lastHitbox)) {
        this.lastHitbox = hitbox;
        window.mons.sendHitbox(hitbox);
      }
    }

    if (this.model.state !== prevState || stimuli.length > 0 || now - this.lastStateSentAt > 1000) {
      this.lastStateSentAt = now;
      window.mons.sendState({
        state: this.model.state,
        stage: this.model.stage,
        x: this.model.pos.x,
        y: this.model.pos.y,
      });
    }
  }
}
