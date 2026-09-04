import { describe, expect, it } from 'vitest';
import { CursorTracker, type TrackedWindow } from '../src/main/input/CursorTracker.ts';

function harness(hitbox: { x: number; y: number; w: number; h: number } | null) {
  const calls: boolean[] = [];
  const win: TrackedWindow = {
    getBounds: () => ({ x: 100, y: 500, width: 800, height: 240 }),
    setIgnoreMouse: (ignore) => calls.push(ignore),
  };
  const cursor = { x: 0, y: 0 };
  const drags: Array<{ x: number; y: number }> = [];
  const hovers: boolean[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const tracker = new CursorTracker(
    win,
    { getCursorScreenPoint: () => ({ ...cursor }) },
    { onDragMove: (c) => drags.push(c), onHoverChange: (h) => hovers.push(h) },
    {
      setInterval: (fn, ms) => {
        const t = { fn, ms };
        timers.push(t);
        return t;
      },
      clearInterval: (h) => {
        const i = timers.indexOf(h as { fn: () => void; ms: number });
        if (i >= 0) timers.splice(i, 1);
      },
      now: () => 0,
    },
  );
  tracker.setHitbox(hitbox);
  return { tracker, cursor, calls, drags, hovers, timers };
}

describe('CursorTracker', () => {
  it('enables mouse events only while the cursor is over the hitbox', () => {
    const h = harness({ x: 300, y: 100, w: 60, h: 80 });
    h.cursor.x = 50;
    h.cursor.y = 50; // outside window
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(false);

    h.cursor.x = 100 + 330;
    h.cursor.y = 500 + 140; // inside hitbox
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(true);
    expect(h.calls.at(-1)).toBe(false); // setIgnoreMouse(false)
    expect(h.hovers).toEqual([true]);

    h.cursor.x = 100 + 10; // inside window but off the sprite
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(false);
    expect(h.calls.at(-1)).toBe(true);
    expect(h.hovers).toEqual([true, false]);
  });

  it('inflates the hitbox slightly so the edge is grabbable', () => {
    const h = harness({ x: 300, y: 100, w: 60, h: 80 });
    h.cursor.x = 100 + 298; // 2 px left of the box, inside the 3 px inflate
    h.cursor.y = 500 + 140;
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(true);
  });

  it('never reports hovering without a hitbox', () => {
    const h = harness(null);
    h.cursor.x = 400;
    h.cursor.y = 600;
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(false);
  });

  it('streams cursor positions while dragging and keeps mouse events enabled', () => {
    const h = harness({ x: 300, y: 100, w: 60, h: 80 });
    h.tracker.beginDrag();
    expect(h.calls.at(-1)).toBe(false);
    h.cursor.x = 10;
    h.cursor.y = 20;
    h.tracker.tick();
    h.cursor.x = 30;
    h.tracker.tick();
    expect(h.drags).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 20 },
    ]);
    // hover state is not re-evaluated during a drag
    expect(h.hovers).toEqual([]);
    h.tracker.endDrag();
    expect(h.tracker.isDragging()).toBe(false);
  });

  it('polls faster while the cursor is inside the window', () => {
    const h = harness({ x: 300, y: 100, w: 60, h: 80 });
    h.tracker.start();
    h.cursor.x = 0;
    h.cursor.y = 0;
    h.tracker.tick();
    const slow = h.timers.at(-1)!.ms;
    h.cursor.x = 150;
    h.cursor.y = 520;
    h.tracker.tick();
    const fast = h.timers.at(-1)!.ms;
    expect(fast).toBeLessThan(slow);
    expect(h.timers.length).toBe(1);
    h.tracker.stop();
    expect(h.timers.length).toBe(0);
  });
});
