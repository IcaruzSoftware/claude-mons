import { deflateSync } from 'node:zlib';

/** Minimal PNG encoder for RGBA buffers (used for tray/app icons generated from sprites). */
export function encodePng(
  width: number,
  height: number,
  rgba: Uint8ClampedArray | Uint8Array,
): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
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
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Nearest-neighbor upscale of an RGBA buffer. */
export function scaleRgba(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  factor: number,
): { width: number; height: number; data: Uint8Array } {
  const w = width * factor;
  const h = height * factor;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x / factor);
      const si = (sy * width + sx) * 4;
      const di = (y * w + x) * 4;
      out[di] = src[si]!;
      out[di + 1] = src[si + 1]!;
      out[di + 2] = src[si + 2]!;
      out[di + 3] = src[si + 3]!;
    }
  }
  return { width: w, height: h, data: out };
}

/** Crop an RGBA buffer to a rectangle. */
export function cropRgba(
  src: Uint8ClampedArray | Uint8Array,
  width: number,
  rect: { x: number; y: number; w: number; h: number },
): { width: number; height: number; data: Uint8Array } {
  const out = new Uint8Array(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    const srcStart = ((rect.y + y) * width + rect.x) * 4;
    out.set(src.subarray(srcStart, srcStart + rect.w * 4), y * rect.w * 4);
  }
  return { width: rect.w, height: rect.h, data: out };
}
