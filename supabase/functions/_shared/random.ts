// Cryptographic randomness for the few server-side rolls (species hatch, Wild Mon pick).
// Battle outcomes never use this: they are seeded by the battle id (shared/battle/rng.ts).

/** Uniform double in [0, 1) with 53 bits of entropy. */
export function randomUnit(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const hi = buf[0]! >>> 5; // 27 bits
  const lo = buf[1]! >>> 6; // 26 bits
  return (hi * 67108864 + lo) / 9007199254740992;
}

/** Uniform integer in [0, n). */
export function randomInt(n: number): number {
  if (!Number.isInteger(n) || n <= 0)
    throw new RangeError('randomInt: n must be a positive integer');
  return Math.min(n - 1, Math.floor(randomUnit() * n));
}
