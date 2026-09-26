import { expect, it } from 'vitest';
import { createModel, PET_STATES } from '@claude-mons/shared';
import { readyMotion } from '../src/renderer/pet/readyMotion.ts';

const model = createModel({
  stage: 'adult',
  now: 0,
  seed: 1,
  world: { minX: 100, maxX: 900, groundY: 500 },
});

it('shows brief footwork with horizontal shifts and hops, then rests without moving the anchor', () => {
  const before = JSON.stringify(model);
  const frames = Array.from({ length: 120 }, (_, i) => readyMotion(model, true, i * 100));
  expect(frames.filter((f) => f.active)).toHaveLength(24);
  expect(new Set(frames.map((f) => f.x))).toEqual(new Set([-2, -1, 0, 1, 2]));
  expect(Math.min(...frames.map((f) => f.y))).toBe(-2);
  expect(frames.every((f) => f.y <= 0)).toBe(true);
  expect(JSON.stringify(model)).toBe(before);
});

it('never interrupts activity, sleep, dragging, evolution or a battle and never animates eggs', () => {
  for (const state of PET_STATES) {
    expect(readyMotion({ ...model, state }, true, 150).active).toBe(
      ['idle', 'sit'].includes(state),
    );
  }
  expect(readyMotion(model, false, 150).active).toBe(false);
  expect(readyMotion({ ...model, stage: 'egg' }, true, 150).active).toBe(false);
});
