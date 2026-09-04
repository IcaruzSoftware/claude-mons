import type { Stage } from '../types.ts';

/**
 * Everything that can influence the behavior engine. The host (Electron main/renderer, the sim
 * runner, tests) translates hook events, pointer input and game events into stimuli; the reducer
 * never touches the outside world.
 */
export type Stimulus =
  | { type: 'hook:prompt' }
  | { type: 'hook:tool_start' }
  | { type: 'hook:tool_end' }
  | { type: 'hook:stop' }
  | { type: 'hook:notification' }
  | { type: 'hook:session_start' }
  | { type: 'hook:session_end' }
  | {
      type: 'activity:update';
      inFlightTools: number;
      midTurnSessions: number;
      lastEventAt: number;
    }
  /** Pointer down on the sprite; x, y = world DIPs of the grab point. */
  | { type: 'input:grab'; x: number; y: number }
  /** Pointer moved while grabbed (sprite follows). */
  | { type: 'input:drag'; x: number; y: number }
  | { type: 'input:release'; x: number; y: number }
  | { type: 'input:shake-progress' }
  | { type: 'input:shake' }
  | { type: 'input:click' }
  /** Any user interaction: wakes from sleep. */
  | { type: 'input:any' }
  | { type: 'game:levelup'; level: number }
  | { type: 'game:hatch' }
  | { type: 'game:evolve'; stage: Stage }
  | { type: 'battle:play' }
  | { type: 'battle:attack' }
  | { type: 'battle:hit' }
  | { type: 'battle:win' }
  | { type: 'battle:lose' }
  | { type: 'battle:done' }
  | { type: 'world:bounds'; minX: number; maxX: number; groundY: number }
  | { type: 'stage:set'; stage: Stage };

export type StimulusType = Stimulus['type'];
