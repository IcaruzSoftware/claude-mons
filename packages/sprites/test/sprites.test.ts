import { describe, expect, it } from 'vitest';
import { SPRITES, frameBBox, hexToRgba, type AnimName } from '../src/index.ts';

const ids = Object.keys(SPRITES);

describe('sprite definitions', () => {
  it('registers the expected sprites', () => {
    expect(ids).toEqual(
      expect.arrayContaining([
        'egg',
        'sparkit-baby',
        'blazebit-teen',
        'infernode-adult',
        'fx-zzz',
        'fx-sparkle',
        'fx-sweat',
        'fx-question',
        'fx-heart',
      ]),
    );
    for (const id of ids) expect(SPRITES[id]?.id).toBe(id);
  });

  it('gives the fire line the full animation set', () => {
    const full: AnimName[] = ['idle', 'walk', 'sleep', 'work', 'happy', 'hurt', 'attack'];
    for (const id of ['sparkit-baby', 'blazebit-teen', 'infernode-adult']) {
      expect(Object.keys(SPRITES[id]!.anims).sort()).toEqual([...full].sort());
    }
    expect(Object.keys(SPRITES.egg!.anims).sort()).toEqual(['crack', 'idle', 'wobble']);
  });

  describe.each(ids)('%s', (id) => {
    const def = SPRITES[id]!;

    it('has an idle animation', () => {
      expect(def.anims.idle).toBeDefined();
      expect(def.anims.idle!.frames.length).toBeGreaterThan(0);
    });

    it('has a valid palette', () => {
      expect(def.palette['.']).toBeUndefined();
      for (const [key, hex] of Object.entries(def.palette)) {
        expect(key).toHaveLength(1);
        expect(() => hexToRgba(hex)).not.toThrow();
      }
    });

    it('has its anchor inside the grid', () => {
      expect(def.anchor.x).toBeGreaterThanOrEqual(0);
      expect(def.anchor.x).toBeLessThan(def.size);
      expect(def.anchor.y).toBeGreaterThanOrEqual(0);
      expect(def.anchor.y).toBeLessThan(def.size);
    });

    for (const [anim, a] of Object.entries(def.anims) as Array<
      [AnimName, NonNullable<(typeof def.anims)[AnimName]>]
    >) {
      it(`${anim}: frames fit the grid and use only palette chars`, () => {
        expect(a.frames.length).toBeGreaterThan(0);
        expect(a.fps).toBeGreaterThan(0);
        a.frames.forEach((f, i) => {
          const rows = f.split('\n');
          expect(rows, `${id}/${anim}#${i} row count`).toHaveLength(def.size);
          rows.forEach((row, r) => {
            expect(row, `${id}/${anim}#${i} row ${r} width`).toHaveLength(def.size);
            for (const c of row) {
              if (c === '.') continue;
              expect(def.palette[c], `${id}/${anim}#${i} row ${r} char ${c}`).toBeDefined();
            }
          });
        });
      });

      it(`${anim}: every frame is non-empty`, () => {
        a.frames.forEach((_f, i) => {
          const bbox = frameBBox(def, anim, i);
          expect(bbox).not.toBeNull();
          expect(bbox!.w).toBeGreaterThan(0);
          expect(bbox!.h).toBeGreaterThan(0);
        });
      });

      if (a.frames.length > 1) {
        it(`${anim}: consecutive frames differ`, () => {
          for (let i = 1; i < a.frames.length; i++) {
            expect(a.frames[i]).not.toBe(a.frames[i - 1]);
          }
        });
      }
    }
  });

  it('mons stand on the anchor row', () => {
    for (const id of ['egg', 'sparkit-baby', 'blazebit-teen', 'infernode-adult']) {
      const def = SPRITES[id]!;
      const bbox = frameBBox(def, 'idle', 0)!;
      expect(bbox.y + bbox.h - 1).toBe(def.anchor.y);
      expect(Math.abs(bbox.x + bbox.w / 2 - def.anchor.x)).toBeLessThanOrEqual(2);
    }
  });
});
