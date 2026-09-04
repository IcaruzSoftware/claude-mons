import { createModel, stepBehavior, type BehaviorModel, type Stimulus } from '@claude-mons/shared';
import type { Hitbox, PetConfig, WindowGeometry } from '../../common/ipc.ts';
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
  private raf = 0;
  private running = false;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly config: PetConfig,
  ) {
    this.renderer = new PetRenderer(canvas, {
      spriteScale: config.spriteScale,
      speciesId: config.speciesId,
      nation: config.nation,
      debug: config.debug,
    });
    this.model = createModel({
      stage: config.stage,
      world: config.world,
      now: performance.now(),
      seed: config.seed,
      x: config.x,
    });
  }

  applyConfig(config: PetConfig): void {
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
