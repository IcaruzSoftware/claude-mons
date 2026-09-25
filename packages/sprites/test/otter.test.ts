import { expect, it } from 'vitest';
import { SPRITES, tintPalette } from '../src/index.ts';

it('keeps otter fur brown after nation tinting and the fish visible in every animation', () => {
  for (const id of ['ottlet-baby', 'brookfin-teen', 'tidewhisker-adult']) {
    const sprite = SPRITES[id]!;
    expect(tintPalette(sprite.palette, 'water').p).toBe('#98624a');
    expect(Object.keys(sprite.anims).sort()).toEqual(
      ['attack', 'happy', 'hurt', 'idle', 'sleep', 'walk', 'work'],
    );
    for (const animation of Object.values(sprite.anims)) {
      for (const frame of animation.frames) {
        expect(frame).toContain('f'); // teal fish body, including work/sleep/hurt
        expect(frame).toContain('o'); // contrasting coral fins
      }
    }
  }
});
