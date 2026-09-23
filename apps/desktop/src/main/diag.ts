import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';

/**
 * Best-effort append of one timestamped line to a log file, capped at `maxBytes` (the oldest half is
 * dropped once the cap is passed, keeping the most recent history). Never throws — a logging failure
 * must not cascade. Mirrors the crash-log capping in `src/main/index.ts`; used for
 * `<userData>/auth.log` so an auth incident is diagnosable without a debug build.
 */
export function appendCappedLog(path: string, line: string, maxBytes: number): void {
  try {
    appendFileSync(path, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
    if (statSync(path).size <= maxBytes) return;
    const buf = readFileSync(path);
    const tail = buf.subarray(buf.length - Math.floor(maxBytes / 2));
    const firstNewline = tail.indexOf(0x0a);
    writeFileSync(path, firstNewline >= 0 ? tail.subarray(firstNewline + 1) : tail);
  } catch {
    // best-effort only
  }
}
