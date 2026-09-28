import type { BehaviorModel } from '@claude-mons/shared';

/** Brief impatient footwork every 12 seconds. Grid-pixel offsets never move the saved anchor. */
export function readyMotion(model: BehaviorModel, ready: boolean, now: number) {
  const phase = now % 12_000;
  if (!ready || model.stage === 'egg' || !['idle', 'sit'].includes(model.state) || phase >= 2400) {
    return { active: false, x: 0, y: 0 };
  }
  return {
    active: true,
    x: Math.round(Math.sin((phase / 1200) * Math.PI * 2) * 2),
    y: -Math.round(Math.abs(Math.sin((phase / 600) * Math.PI * 2)) * 2),
  };
}
