/** Animation names shared by all sprites. Not every sprite implements every anim; `idle` is required. */
export type AnimName =
  'idle' | 'walk' | 'sleep' | 'work' | 'happy' | 'hurt' | 'attack' | 'wobble' | 'crack';

export interface AnimDef {
  fps: number;
  loop: boolean;
  /**
   * Each frame is one string of `size` rows of `size` chars joined by `\n`. `.` is transparent,
   * every other char is a palette key. Author frames with `frame()` from util.ts.
   */
  frames: string[];
}

export interface SpriteDef {
  /** e.g. 'egg', 'sparkit-baby', 'blazebit-teen', 'infernode-adult', 'fx-zzz' */
  id: string;
  /** Grid size; frames are size x size chars. */
  size: 32 | 48;
  /** char -> '#rrggbb' or '#rrggbbaa'. '.' is always transparent. */
  palette: Record<string, string>;
  /** Foot point in grid px (where the sprite touches the ground), typically { x: size/2, y: size-1 }. */
  anchor: { x: number; y: number };
  /** 'idle' is required for every sprite. */
  anims: Partial<Record<AnimName, AnimDef>>;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** RGBA, row-major. `bbox` is the bounds of pixels with alpha > 0, or null if the frame is empty. */
export interface RasterFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  bbox: BBox | null;
}
