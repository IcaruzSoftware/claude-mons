/**
 * Renders every sprite animation to PNG strips in packages/sprites/preview/ (gitignored) plus a
 * contact sheet. Zero dependencies: a minimal PNG encoder on top of node:zlib.
 *
 *   pnpm --filter @claude-mons/sprites preview
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { SPRITES, rasterize, type AnimName, type SpriteDef } from '../src/index.ts';

const SCALE = 4;
const GAP = 4;
const BG: [number, number, number, number] = [214, 214, 214, 255];
const ANCHOR_LINE: [number, number, number, number] = [255, 120, 120, 255];
const OUT_DIR = join(import.meta.dirname, '..', 'preview');

// --- PNG encoder ----------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// --- Canvas ---------------------------------------------------------------------------------

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    this.fill(0, 0, width, height, BG);
  }

  fill(x0: number, y0: number, w: number, h: number, c: [number, number, number, number]): void {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) this.set(x, y, c);
    }
  }

  set(x: number, y: number, c: [number, number, number, number]): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.data.set(c, (y * this.width + x) * 4);
  }

  /** Blits a rasterized frame at (x0, y0) scaled by `scale`, skipping transparent pixels. */
  blit(frame: ReturnType<typeof rasterize>, x0: number, y0: number, scale: number): void {
    for (let y = 0; y < frame.height; y++) {
      for (let x = 0; x < frame.width; x++) {
        const o = (y * frame.width + x) * 4;
        const a = frame.data[o + 3]!;
        if (a === 0) continue;
        const c: [number, number, number, number] = [
          frame.data[o]!,
          frame.data[o + 1]!,
          frame.data[o + 2]!,
          255,
        ];
        this.fill(x0 + x * scale, y0 + y * scale, scale, scale, c);
      }
    }
  }
}

// --- Rendering ------------------------------------------------------------------------------

function renderStrip(def: SpriteDef, anim: AnimName, scale: number): Canvas {
  const frames = def.anims[anim]!.frames.length;
  const cell = def.size * scale;
  const canvas = new Canvas(GAP + frames * (cell + GAP), GAP + cell + GAP);
  for (let i = 0; i < frames; i++) {
    const x = GAP + i * (cell + GAP);
    canvas.fill(x, GAP, cell, cell, [236, 236, 236, 255]);
    // anchor row marker
    canvas.fill(x, GAP + def.anchor.y * scale + scale - 1, cell, 1, ANCHOR_LINE);
    canvas.blit(rasterize(def, anim, i), x, GAP, scale);
  }
  return canvas;
}

function renderSheet(defs: SpriteDef[], scale: number): Canvas {
  const rows = defs.map((def) => ({
    def,
    anims: Object.keys(def.anims) as AnimName[],
    cell: def.size * scale,
  }));
  const width = GAP + Math.max(...rows.map((r) => r.anims.length * (r.cell + GAP)));
  const height = GAP + rows.reduce((h, r) => h + r.cell + GAP, 0);
  const canvas = new Canvas(width, height);
  let y = GAP;
  for (const { def, anims, cell } of rows) {
    anims.forEach((anim, i) => {
      const x = GAP + i * (cell + GAP);
      canvas.fill(x, y, cell, cell, [236, 236, 236, 255]);
      canvas.blit(rasterize(def, anim, 0), x, y, scale);
    });
    y += cell + GAP;
  }
  return canvas;
}

mkdirSync(OUT_DIR, { recursive: true });
const defs = Object.values(SPRITES);
let count = 0;
for (const def of defs) {
  for (const anim of Object.keys(def.anims) as AnimName[]) {
    const canvas = renderStrip(def, anim, SCALE);
    writeFileSync(
      join(OUT_DIR, `${def.id}-${anim}.png`),
      encodePng(canvas.width, canvas.height, canvas.data),
    );
    count++;
  }
}
const sheet = renderSheet(defs, 3);
writeFileSync(join(OUT_DIR, 'sheet.png'), encodePng(sheet.width, sheet.height, sheet.data));
console.info(`Wrote ${count} strips + sheet.png to ${OUT_DIR}`);
