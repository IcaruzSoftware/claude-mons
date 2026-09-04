// Generates the app icons from the pixel-art source so they always match the pet.
// Usage: node --experimental-strip-types scripts/make-icons.ts
// Output: resources/icon.ico (Windows), resources/icons/<size>x<size>.png (Linux), resources/icon.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { EGG } from '../../../packages/sprites/src/egg.ts';
import { tintPalette } from '../../../packages/sprites/src/palette.ts';
import { frameBBox, rasterize } from '../../../packages/sprites/src/raster.ts';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'resources');
mkdirSync(join(out, 'icons'), { recursive: true });

// The icon: a Fire-tinted egg (the first thing every player sees), on a rounded dark plate.
const def = EGG;
const palette = tintPalette(def.palette, 'fire');
const frame = rasterize(def, 'idle', 0, palette);
const bbox = frameBBox(def, 'idle', 0)!;

function renderIcon(size: number): Uint8Array {
  const img = new Uint8Array(size * size * 4);
  // plate
  const r = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x, x - (size - 1 - r), 0);
      const dy = Math.max(r - y, y - (size - 1 - r), 0);
      if (dx * dx + dy * dy <= r * r) {
        const i = (y * size + x) * 4;
        img[i] = 0x1c;
        img[i + 1] = 0x1f;
        img[i + 2] = 0x27;
        img[i + 3] = 255;
      }
    }
  }
  // egg, scaled to ~70 % of the plate height, nearest neighbor
  const scale = Math.max(1, Math.floor((size * 0.7) / bbox.h));
  const w = bbox.w * scale;
  const h = bbox.h * scale;
  const ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = bbox.x + Math.floor(x / scale);
      const sy = bbox.y + Math.floor(y / scale);
      const si = (sy * def.size + sx) * 4;
      if (frame.data[si + 3] === 0) continue;
      const di = ((oy + y) * size + (ox + x)) * 4;
      img[di] = frame.data[si]!;
      img[di + 1] = frame.data[si + 1]!;
      img[di + 2] = frame.data[si + 2]!;
      img[di + 3] = frame.data[si + 3]!;
    }
  }
  return img;
}

function png(width: number, height: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
    return Buffer.concat([len, t, data, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let table: Uint32Array | null = null;
function crc32(buf: Buffer): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** ICO container holding PNG-compressed images (supported since Windows Vista). */
function ico(images: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const o = i * 16;
    dir[o] = img.size >= 256 ? 0 : img.size;
    dir[o + 1] = img.size >= 256 ? 0 : img.size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(img.png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += img.png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}

const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const pngs = sizes.map((s) => ({ size: s, png: png(s, s, renderIcon(s)) }));
for (const p of pngs) writeFileSync(join(out, 'icons', `${p.size}x${p.size}.png`), p.png);
writeFileSync(join(out, 'icon.png'), pngs.find((p) => p.size === 512)!.png);
writeFileSync(join(out, 'icon.ico'), ico(pngs.filter((p) => p.size <= 256)));
console.info(`icons written to ${out}`);
