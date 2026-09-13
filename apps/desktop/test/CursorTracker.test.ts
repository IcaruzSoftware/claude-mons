import { describe, expect, it } from 'vitest';
import { CursorTracker, type TrackedWindow } from '../src/main/input/CursorTracker.ts';

function harness(
  hitbox: { x: number; y: number; w: number; h: number } | null,
  opts: { geometryVersion?: number } = {},
) {
  const calls: boolean[] = [];
  let geometryVersion = opts.geometryVersion ?? 1;
  const win: TrackedWindow = {
    getBounds: () => ({ x: 100, y: 500, width: 800, height: 240 }),
    setIgnoreMouse: (ignore) => calls.push(ignore),
    getGeometryVersion: () => geometryVersion,
  };
  const cursor = { x: 0, y: 0 };
  const drags: Array<{ x: number; y: number }> = [];
  const hovers: boolean[] = [];
  const errors: unknown[] = [];
  const timers: Array<{ fn: () => void; ms: number }> = [];
  let clock = 0;
  const tracker = new CursorTracker(
    win,
    { getCursorScreenPoint: () => ({ ...cursor }) },
    {
      onDragMove: (c) => drags.push(c),
      onHoverChange: (h) => hovers.push(h),
      onError: (e) => errors.push(e),
    },
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
      now: () => clock,
    },
  );
  if (hitbox !== null) tracker.setHitbox({ hitbox, geometryVersion });
  // Drop the constructor's initial fail-closed setIgnoreMouse(true) (and any call triggered by the
  // setHitbox above) so tests can assert on calls made from their own tick()s only.
  calls.length = 0;
  return {
    tracker,
    cursor,
    calls,
    drags,
    hovers,
    errors,
    timers,
    setGeometryVersion: (v: number) => (geometryVersion = v),
    advance: (ms: number) => (clock += ms),
  };
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

  it('re-asserts setIgnoreMouse every tick, not only on change', () => {
    const h = harness({ x: 300, y: 100, w: 60, h: 80 });
    h.cursor.x = 100 + 330;
    h.cursor.y = 500 + 140; // inside hitbox
    h.tracker.tick();
    h.tracker.tick();
    h.tracker.tick();
    // three ticks, same "over" result each time, but setIgnoreMouse(false) called on every one
    expect(h.calls).toEqual([false, false, false]);
    // the edge-triggered hover event only fired once
    expect(h.hovers).toEqual([true]);
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

  it('discards a hitbox tagged with an older geometry version than the window currently has', () => {
    const h = harness({ x: 300, y: 100, w: 60, h: 80 }, { geometryVersion: 1 });
    h.cursor.x = 100 + 330;
    h.cursor.y = 500 + 140; // inside hitbox
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(true);

    // the window hopped (mode switch/resize/reposition): geometry version moved on, but the
    // tracker still only knows about the hitbox tagged with the old version.
    h.setGeometryVersion(2);
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(false);
    expect(h.calls.at(-1)).toBe(true); // setIgnoreMouse(true)

    // a fresh hitbox tagged with the new version is accepted again.
    h.tracker.setHitbox({ hitbox: { x: 300, y: 100, w: 60, h: 80 }, geometryVersion: 2 });
    expect(h.tracker.isHovering()).toBe(true);
  });

  it('discards a hitbox report older than hitboxFreshMs', () => {
    const h = harness({ x: 300, y: 100, w: 60, h: 80 });
    h.cursor.x = 100 + 330;
    h.cursor.y = 500 + 140;
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(true);

    h.advance(501); // default hitboxFreshMs is 500
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(false);
  });

  it('forceIgnore immediately closes click-through and clears the hitbox', () => {
    const h = harness({ x: 300, y: 100, w: 60, h: 80 });
    h.cursor.x = 100 + 330;
    h.cursor.y = 500 + 140;
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(true);

    h.tracker.forceIgnore();
    expect(h.tracker.isHovering()).toBe(false);
    expect(h.calls.at(-1)).toBe(true);

    // even the same cursor sample, same geometry version, does not re-accept until a fresh hitbox
    // report arrives (the old one was discarded, not just its freshness clock reset).
    h.tracker.tick();
    expect(h.tracker.isHovering()).toBe(false);
  });

  it('forces click-through closed when a tick throws', () => {
    const boom = new Error('boom');
    const calls: boolean[] = [];
    const errors: unknown[] = [];
    const throwingTracker = new CursorTracker(
      {
        getBounds: () => ({ x: 100, y: 500, width: 800, height: 240 }),
        setIgnoreMouse: (ignore) => calls.push(ignore),
        getGeometryVersion: () => 1,
      },
      {
        getCursorScreenPoint: () => {
          throw boom;
        },
      },
      { onDragMove: () => {}, onHoverChange: () => {}, onError: (e) => errors.push(e) },
      { now: () => 0 },
    );
    calls.length = 0; // drop the constructor's initial fail-closed setIgnoreMouse(true) call
    throwingTracker.tick();
    expect(errors).toEqual([boom]);
    expect(calls.at(-1)).toBe(true); // forced ignore=true
    expect(throwingTracker.isHovering()).toBe(false);
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

  it('drops a non-finite cursor sample instead of forwarding NaN', () => {
    const h = harness({ x: 300, y: 100, w: 60, h: 80 });
    h.tracker.beginDrag();
    h.cursor.x = 10;
    h.cursor.y = 20;
    h.tracker.tick();
    h.cursor.x = NaN;
    h.tracker.tick(); // dropped: no onDragMove call for the bad sample
    h.cursor.x = 30;
    h.tracker.tick();
    expect(h.drags).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 20 },
    ]);
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

  describe('isPointAccepted', () => {
    it('accepts a point inside the (inflated) hitbox with a fresh, version-matched report', () => {
      const h = harness({ x: 300, y: 100, w: 60, h: 80 }, { geometryVersion: 3 });
      // must have taken at least one cursor sample for isPointAccepted's cursor-freshness check
      h.cursor.x = 100 + 330;
      h.cursor.y = 500 + 140;
      h.tracker.tick();
      expect(h.tracker.isPointAccepted({ x: 100 + 330, y: 500 + 140 })).toBe(true);
    });

    it('rejects a point outside the window', () => {
      const h = harness({ x: 300, y: 100, w: 60, h: 80 });
      h.tracker.tick();
      expect(h.tracker.isPointAccepted({ x: 0, y: 0 })).toBe(false);
    });

    it('rejects once the last cursor sample goes stale (no recent tick)', () => {
      const h = harness({ x: 300, y: 100, w: 60, h: 80 });
      h.cursor.x = 100 + 330;
      h.cursor.y = 500 + 140;
      h.tracker.tick();
      expect(h.tracker.isPointAccepted({ x: 100 + 330, y: 500 + 140 })).toBe(true);

      h.advance(251); // default cursorFreshMs is 250; no tick has run since
      expect(h.tracker.isPointAccepted({ x: 100 + 330, y: 500 + 140 })).toBe(false);
    });

    it('rejects a stale geometry version even for a point inside the hitbox', () => {
      const h = harness({ x: 300, y: 100, w: 60, h: 80 }, { geometryVersion: 1 });
      h.cursor.x = 100 + 330;
      h.cursor.y = 500 + 140;
      h.tracker.tick();
      h.setGeometryVersion(2);
      expect(h.tracker.isPointAccepted({ x: 100 + 330, y: 500 + 140 })).toBe(false);
    });
  });
});
