import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { parseHookEnvelope, type HookEnvelope } from '@claude-mons/shared';

export const SPOOL_FILE = 'hook-spool.jsonl';

/**
 * Drains events the hook binary buffered while the app was not running.
 * Renames the spool first (the binary recreates it on its next append, so no locking is needed),
 * parses line by line, and deletes the drained file. Malformed lines are skipped.
 */
export class SpoolDrainer {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly home: string,
    private readonly onEvent: (env: HookEnvelope) => void,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    void this.drain();
    this.timer = setInterval(() => void this.drain(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Returns the number of envelopes delivered. */
  async drain(): Promise<number> {
    const spool = join(this.home, SPOOL_FILE);
    let stat;
    try {
      stat = await fs.stat(spool);
    } catch {
      return 0;
    }
    if (stat.size === 0) return 0;
    const draining = `${spool}.${Date.now()}.draining`;
    try {
      await fs.rename(spool, draining);
    } catch {
      return 0; // the hook binary may be appending right now; try again next tick
    }
    let count = 0;
    try {
      const text = await fs.readFile(draining, 'utf8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const env = parseHookEnvelope(JSON.parse(trimmed));
          if (env) {
            this.onEvent({ ...env, spooled: true });
            count++;
          }
        } catch {
          /* skip malformed line */
        }
      }
    } finally {
      await fs.rm(draining, { force: true }).catch(() => {});
    }
    return count;
  }
}
