import { expect, it } from 'vitest';
import { SPRITES, tintPalette } from '../src/index.ts';

it('keeps otter fur brown after nation tinting and the fish visible in every animation', () => {
  for (const id of ['ottlet-baby', 'brookfin-teen', 'tidewhisker-adult']) {
    const sprite = SPRITES[id]!;
    expect(tintPalette(sprite.palette, 'water').p).toBe('#98624a');
    expect(Object.keys(sprite.anims).sort()).toEqual([
      'attack',
      'happy',
      'hurt',
      'idle',
      'sleep',
      'walk',
      'work',
    ]);
    for (const animation of Object.values(sprite.anims)) {
      for (const frame of animation.frames) {
        expect(frame).toContain('f'); // teal fish body, including work/sleep/hurt
        expect(frame).toContain('o'); // contrasting coral fins
      }
    }
  }
});

it('swings an unclipped fish through wind-up and impact in every evolution', () => {
  let previousFishSize = 0;
  for (const id of ['ottlet-baby', 'brookfin-teen', 'tidewhisker-adult']) {
    const sprite = SPRITES[id]!;
    const attack = sprite.anims.attack!;
    expect(attack.loop).toBe(false);
    expect(attack.frames).toHaveLength(4);
    const fish = (frame: string) =>
      [...frame.replaceAll('\n', '')].flatMap((pixel, index) =>
        'fqvo'.includes(pixel)
          ? [{ x: index % sprite.size, y: Math.floor(index / sprite.size) }]
          : [],
      );
    const positions = attack.frames.map(fish);
    expect(positions.map((pixels) => pixels.length)).toEqual(Array(4).fill(positions[0]!.length));
    const center = (pixels: { x: number; y: number }[], axis: 'x' | 'y') =>
      pixels.reduce((sum, pixel) => sum + pixel[axis], 0) / pixels.length;
    expect(center(positions[2]!, 'x') - center(positions[1]!, 'x')).toBeGreaterThanOrEqual(3);
    expect(center(positions[2]!, 'y') - center(positions[1]!, 'y')).toBeGreaterThanOrEqual(3);
    expect(attack.frames[2]).toContain('t'); // water splash at fish-first impact
    const fishSize = fish(sprite.anims.idle!.frames[0]!).length;
    expect(fishSize).toBeGreaterThan(previousFishSize);
    previousFishSize = fishSize;
  }
});
